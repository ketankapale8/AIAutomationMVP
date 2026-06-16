const axios = require('axios');
const { getPool } = require('./db');

let pollerInterval = null;
let _pollFunction = null;
const processingTickets = new Set();

/**
 * Start polling Jira for new tickets.
 * @param {Object} config - The loaded config.yaml object.
 * @param {Function} onNewTicket - Callback invoked with (ticketKey, title, description, imagePaths, selfUrl, issueType).
 */
function startPolling(config, onNewTicket) {
  const pollingConfig = config.jiraPolling || {};
  if (!pollingConfig.enabled) {
    console.log('ℹ️ Jira polling is disabled in config.yaml.');
    return;
  }

  const intervalSeconds = pollingConfig.intervalSeconds || 30;
  const projects = config.repos.flatMap(r => r.jiraProjects || []);
  
  if (projects.length === 0) {
    console.warn('⚠️ No jiraProjects configured in config.yaml. Poller has nothing to watch.');
    return;
  }

  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const rawDomain = process.env.JIRA_DOMAIN || 'your-domain.atlassian.net';
  let domain = 'your-domain.atlassian.net';
  try {
    domain = new URL(rawDomain.startsWith('http') ? rawDomain : 'https://' + rawDomain).host;
  } catch (e) {
    domain = rawDomain.replace(/^https?:\/\//i, '').split('/')[0];
  }

  if (!email || !token) {
    console.warn('⚠️ Jira credentials missing. Poller cannot start.');
    return;
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const projectList = projects.join(', ');

  console.log(`📡 Jira Poller started: Checking projects [${projectList}] every ${intervalSeconds} seconds...`);

  // Simple ADF parser helper (since we don't have access to server.js's internal one easily)
  const parseADF = (doc) => {
    if (!doc || !doc.content) return '';
    let text = '';
    for (const block of doc.content) {
      if (block.type === 'paragraph' && block.content) {
        text += block.content.map(c => c.text).join('') + '\n\n';
      } else if (block.type === 'heading' && block.content) {
        text += '# ' + block.content.map(c => c.text).join('') + '\n\n';
      }
    }
    return text.trim();
  };
  _pollFunction = async () => {
    try {
      const pool = getPool();
      if (!pool) return; // Wait for DB

      // Build JQL to find recently created tickets in our target projects
      // We limit to the 5 most recently created tickets to avoid massive payloads
      const jql = `project IN (${projectList}) ORDER BY created DESC`;
      const url = `https://${domain}/rest/api/3/search/jql`;

      const response = await axios.post(url, {
        jql,
        maxResults: 5,
        fields: ['summary', 'description', 'issuetype', 'attachment']
      }, {
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }
      });

      const issues = response.data.issues || [];
      const { getLatestAnalysis } = require('./db');

      for (const issue of issues) {
        const ticketKey = issue.key;

        // Skip if currently processing to prevent double-analysis during long LLM runs
        if (processingTickets.has(ticketKey)) continue;

        // Check if ticket already exists in database
        const existing = await getLatestAnalysis(ticketKey);
        
        if (!existing) {
          console.log(`\n📡 [Poller] Found NEW Ticket: [${ticketKey}] ${issue.fields.summary}`);
          
          processingTickets.add(ticketKey);
          
          const title = issue.fields.summary;
          const rawDescription = issue.fields.description || 'No description provided.';
          const description = typeof rawDescription === 'object' ? parseADF(rawDescription) : rawDescription;
          const issueType = issue.fields.issuetype ? issue.fields.issuetype.name : 'Task';
          
          const imagePaths = [];
          
          // Trigger the analysis pipeline!
          try {
            await onNewTicket(ticketKey, title, description, imagePaths, issue.self, issueType);
          } catch (err) {
            console.error(`❌ [Poller] Error triggering analysis for ${ticketKey}:`, err.message);
          } finally {
            // Wait an extra minute before removing from processing set just to be safe
            setTimeout(() => processingTickets.delete(ticketKey), 60000);
          }
        }
      }
    } catch (err) {
      console.error(`❌ [Poller] Error polling Jira API:`, err.message);
    }
  };

  // Run once immediately, then on interval
  _pollFunction();
  pollerInterval = setInterval(_pollFunction, intervalSeconds * 1000);
}

function stopPolling() {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}

async function forcePoll() {
  if (_pollFunction) {
    console.log('⚡ Force Jira poll triggered manually');
    await _pollFunction();
    return true;
  }
  return false;
}

module.exports = { startPolling, stopPolling, forcePoll };
