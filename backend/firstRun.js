// backend/firstRun.js
// Validates the environment on startup and prints a clear status table.
// Checks: config.yaml parse, Ollama reachability, Jira credentials, LLM providers.

const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function validateEnvironment() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║     Agentic Jira Analyzer v2.0 — Environment Check  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const checks = [];

  // ── 1. config.yaml ────────────────────────────────────────────
  try {
    const { getConfig } = require('./configLoader');
    const cfg = getConfig();
    const repoCount = cfg.repos?.length || 0;
    checks.push({ name: 'config.yaml', ok: repoCount > 0, detail: `${repoCount} repo(s) configured` });
  } catch (e) {
    checks.push({ name: 'config.yaml', ok: false, detail: e.message });
  }

  // ── 2. Ollama ──────────────────────────────────────────────────
  try {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const res = await axios.get(`${ollamaUrl}/api/tags`, { timeout: 5000 });
    const models = res.data.models?.map(m => m.name) || [];
    const hasEmbed = models.some(m => m.includes('nomic-embed'));
    checks.push({
      name: 'Ollama',
      ok: models.length > 0,
      detail: hasEmbed
        ? `✅ ${models.length} model(s) — nomic-embed-text ready`
        : `⚠️  ${models.length} model(s) — run: ollama pull nomic-embed-text`
    });
  } catch (e) {
    checks.push({
      name: 'Ollama',
      ok: false,
      detail: 'Not running — start Ollama or add a cloud API key to .env'
    });
  }

  // ── 3. LanceDB index ──────────────────────────────────────────
  try {
    const lanceDbPath = path.join(__dirname, 'data', 'lancedb');
    const exists = fs.existsSync(lanceDbPath);
    if (exists) {
      const tables = fs.readdirSync(lanceDbPath).filter(f => !f.startsWith('.'));
      checks.push({
        name: 'Vector Index',
        ok: tables.length > 0,
        detail: tables.length > 0 ? `${tables.length} repo table(s) indexed` : 'Run: index.bat to build index'
      });
    } else {
      checks.push({ name: 'Vector Index', ok: false, detail: 'Not built yet — run: index.bat' });
    }
  } catch (e) {
    checks.push({ name: 'Vector Index', ok: false, detail: e.message });
  }

  // ── 4. Jira credentials ───────────────────────────────────────
  const hasJiraDomain = !!process.env.JIRA_DOMAIN;
  const hasJiraEmail  = !!process.env.JIRA_EMAIL;
  const hasJiraToken  = !!process.env.JIRA_API_TOKEN;
  const jiraOk = hasJiraDomain && hasJiraEmail && hasJiraToken;
  checks.push({
    name: 'Jira Credentials',
    ok: jiraOk,
    detail: jiraOk
      ? `${process.env.JIRA_DOMAIN}`
      : 'Add JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN to .env'
  });

  // ── 5. LLM providers available ───────────────────────────────
  const providers = [];
  if (process.env.GROQ_API_KEY)      providers.push('Groq ⚡');
  if (process.env.ANTHROPIC_API_KEY) providers.push('Claude 🧠');
  if (process.env.OPENAI_API_KEY)    providers.push('OpenAI');
  if (process.env.GEMINI_API_KEY)    providers.push('Gemini');
  if (process.env.DEEPSEEK_API_KEY)  providers.push('DeepSeek');
  const ollamaCheck = checks.find(c => c.name === 'Ollama');
  if (ollamaCheck?.ok) providers.push('Ollama (local)');

  checks.push({
    name: 'LLM Providers',
    ok: providers.length > 0,
    detail: providers.length > 0 ? providers.join(', ') : 'No providers! Add a key to .env or start Ollama'
  });

  // ── Print results ─────────────────────────────────────────────
  const maxName = Math.max(...checks.map(c => c.name.length));
  checks.forEach(c => {
    const icon   = c.ok ? '✅' : '❌';
    const padded = c.name.padEnd(maxName + 2);
    console.log(`  ${icon}  ${padded}${c.detail}`);
  });

  const allOk = checks.every(c => c.ok);
  console.log('');
  if (allOk) {
    console.log('  🚀 All checks passed — server starting...\n');
  } else {
    console.log('  ⚠️  Some checks failed — server will start but may have limited functionality.');
    console.log('     See README-SETUP.md for setup instructions.\n');
  }

  return allOk;
}

module.exports = { validateEnvironment };
