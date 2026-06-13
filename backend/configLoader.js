// backend/configLoader.js
// Loads and parses config.yaml — the single configuration surface for all clients.
// Exposes helpers used by indexer and webhook handler for multi-repo routing.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let _config = null;

// PKG: __dirname is virtual snapshot path; config.yaml lives next to the exe
const APP_DIR = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;

/**
 * Loads and parses config.yaml (cached after first call).
 * @returns {object} Parsed config object
 */
function getConfig() {
  if (_config) return _config;

  const configPath = path.join(APP_DIR, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`config.yaml not found at ${configPath}. Please create it from config.yaml.example.`);
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    _config = yaml.load(raw);
    console.log(`✅ Config loaded: ${_config.repos.length} repo(s) configured.`);
    return _config;
  } catch (err) {
    throw new Error(`Failed to parse config.yaml: ${err.message}`);
  }
}

/**
 * Given a Jira project key (e.g. "SCRUM" from issue "SCRUM-101"),
 * returns the matching repo config object, or null if none found.
 * @param {string} projectKey  e.g. "SCRUM"
 * @returns {object|null}
 */
function getRepoForJiraProject(projectKey) {
  const config = getConfig();
  const key = (projectKey || '').toUpperCase().trim();

  for (const repo of config.repos) {
    const projects = (repo.jiraProjects || []).map(p => p.toUpperCase().trim());
    if (projects.includes(key)) {
      return repo;
    }
  }

  console.warn(`⚠️ No repo configured for Jira project key: "${key}". Falling back to first repo.`);
  return config.repos[0] || null;
}

/**
 * Extracts the project key from a full Jira issue key (e.g. "SCRUM-101" → "SCRUM").
 * @param {string} issueKey
 * @returns {string}
 */
function extractProjectKey(issueKey) {
  if (!issueKey) return '';
  const match = String(issueKey).match(/^([A-Z]+)-\d+/i);
  return match ? match[1].toUpperCase() : '';
}

/**
 * Returns the LLM provider chain for a given tier ('fast' | 'balanced' | 'deep').
 * @param {string} tier
 * @returns {Array<object>}
 */
function getLLMProviders(tier) {
  const config = getConfig();
  const llmConfig = config.llm || {};
  return (llmConfig[tier] && llmConfig[tier].providers) || llmConfig.fast.providers;
}

/**
 * Returns all repos defined in config.
 * @returns {Array<object>}
 */
function getAllRepos() {
  return getConfig().repos || [];
}

/**
 * Returns the token budget config for a given format ('formatA' | 'formatB').
 * @param {string} format
 * @returns {object}
 */
function getTokenBudget(format) {
  const config = getConfig();
  return (config.tokenBudget && config.tokenBudget[format]) || { ticketTokens: 200, codeTokens: 1800, instructionTokens: 150, maxChunks: 15 };
}

/**
 * Returns the indexer config block.
 * @returns {object}
 */
function getIndexerConfig() {
  const config = getConfig();
  return config.indexer || {
    chunkSizeChars: 1200,
    chunkOverlapChars: 200,
    embeddingDelayMs: 120,
    lanceDbPath: './data/lancedb',
    hashCachePath: './data/hashes'
  };
}

/** Reload config from disk (useful for hot-reload without restarting server) */
function reloadConfig() {
  _config = null;
  return getConfig();
}

module.exports = {
  getConfig,
  getRepoForJiraProject,
  extractProjectKey,
  getLLMProviders,
  getAllRepos,
  getTokenBudget,
  getIndexerConfig,
  reloadConfig
};
