// backend/db.js
// SQLite persistence layer — stores ticket analyses, repo index status, and cost tracking.
// Uses better-sqlite3 (synchronous, zero-dependency, perfect for on-prem single-instance).

const path = require('path');
const fs = require('fs');

// PKG: __dirname is a virtual snapshot; data must be written next to the exe
const APP_DIR = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;

const DB_DIR = path.join(APP_DIR, 'data');
const DB_PATH = path.join(DB_DIR, 'analyzer.db');

let db = null;

/**
 * Returns the initialized SQLite database connection (singleton).
 */
function getDb() {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema();
  console.log(`✅ SQLite DB initialized at ${DB_PATH}`);
  return db;
}

/**
 * Creates all tables if they don't exist.
 */
function initSchema() {
  db.exec(`
    -- Stores every ticket analysis result
    CREATE TABLE IF NOT EXISTS ticket_analyses (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key     TEXT NOT NULL,           -- e.g. SCRUM-101
      project_key   TEXT NOT NULL,           -- e.g. SCRUM
      repo_id       TEXT NOT NULL,           -- which repo was searched
      title         TEXT NOT NULL,
      description   TEXT,
      issue_type    TEXT,                    -- Bug, Story, Epic, etc.
      format        TEXT,                    -- 'A' or 'B'
      analysis      TEXT NOT NULL,           -- full LLM output
      llm_provider  TEXT,                    -- which provider/model was used
      input_tokens  INTEGER DEFAULT 0,       -- estimated input token count
      output_tokens INTEGER DEFAULT 0,       -- estimated output token count
      jira_url      TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ticket_analyses_issue_key ON ticket_analyses(issue_key);
    CREATE INDEX IF NOT EXISTS idx_ticket_analyses_project_key ON ticket_analyses(project_key);
    CREATE INDEX IF NOT EXISTS idx_ticket_analyses_created_at ON ticket_analyses(created_at DESC);

    -- Tracks the index status of each repo
    CREATE TABLE IF NOT EXISTS indexed_repos (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id         TEXT NOT NULL UNIQUE,
      repo_name       TEXT,
      local_path      TEXT,
      total_files     INTEGER DEFAULT 0,
      total_chunks    INTEGER DEFAULT 0,
      last_indexed_at TEXT,
      status          TEXT DEFAULT 'pending'  -- pending, indexing, ready, error
    );

    -- Audit log of every index run
    CREATE TABLE IF NOT EXISTS indexing_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id     TEXT NOT NULL,
      run_type    TEXT,        -- 'full' or 'delta'
      files_added INTEGER DEFAULT 0,
      files_skipped INTEGER DEFAULT 0,
      files_removed INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      error       TEXT,
      started_at  TEXT DEFAULT (datetime('now')),
      finished_at TEXT
    );
  `);
}

// ── Ticket Analyses ─────────────────────────────────────────

/**
 * Inserts or replaces a ticket analysis record.
 * @param {object} data
 */
function upsertTicketAnalysis(data) {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO ticket_analyses
      (issue_key, project_key, repo_id, title, description, issue_type, format, analysis, llm_provider, input_tokens, output_tokens, jira_url)
    VALUES
      (@issue_key, @project_key, @repo_id, @title, @description, @issue_type, @format, @analysis, @llm_provider, @input_tokens, @output_tokens, @jira_url)
  `);
  return stmt.run({
    issue_key: data.issueKey || '',
    project_key: data.projectKey || '',
    repo_id: data.repoId || 'default',
    title: data.title || '',
    description: data.description || '',
    issue_type: data.issueType || 'Unknown',
    format: data.format || 'A',
    analysis: data.analysis || '',
    llm_provider: data.llmProvider || '',
    input_tokens: data.inputTokens || 0,
    output_tokens: data.outputTokens || 0,
    jira_url: data.jiraUrl || ''
  });
}

/**
 * Gets the most recent analysis for a ticket key.
 * @param {string} issueKey
 * @returns {object|undefined}
 */
function getLatestAnalysis(issueKey) {
  const database = getDb();
  return database.prepare(`
    SELECT * FROM ticket_analyses
    WHERE issue_key = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(issueKey);
}

/**
 * Gets all analyses with pagination.
 * @param {number} limit
 * @param {number} offset
 * @returns {Array<object>}
 */
function getAllAnalyses(limit = 50, offset = 0) {
  const database = getDb();
  return database.prepare(`
    SELECT id, issue_key, project_key, repo_id, title, issue_type, format, llm_provider,
           input_tokens, output_tokens, jira_url, created_at
    FROM ticket_analyses
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * Returns analytics summary data.
 */
function getAnalyticsSummary() {
  const database = getDb();
  return {
    totalTickets: database.prepare('SELECT COUNT(*) as count FROM ticket_analyses').get().count,
    byType: database.prepare(`
      SELECT issue_type, COUNT(*) as count
      FROM ticket_analyses GROUP BY issue_type ORDER BY count DESC
    `).all(),
    byFormat: database.prepare(`
      SELECT format, COUNT(*) as count
      FROM ticket_analyses GROUP BY format
    `).all(),
    totalTokensIn: database.prepare('SELECT SUM(input_tokens) as total FROM ticket_analyses').get().total || 0,
    totalTokensOut: database.prepare('SELECT SUM(output_tokens) as total FROM ticket_analyses').get().total || 0,
    byProvider: database.prepare(`
      SELECT llm_provider, COUNT(*) as count, SUM(input_tokens) as total_input_tokens
      FROM ticket_analyses GROUP BY llm_provider ORDER BY count DESC
    `).all(),
    recentActivity: database.prepare(`
      SELECT date(created_at) as date, COUNT(*) as count
      FROM ticket_analyses
      WHERE created_at >= date('now', '-30 days')
      GROUP BY date(created_at)
      ORDER BY date ASC
    `).all()
  };
}

/**
 * Returns the total number of tokens (input + output) used by cloud providers today.
 */
function getDailyCloudTokenUsage() {
  const database = getDb();
  // We assume any provider not starting with 'ollama' is a cloud provider
  const row = database.prepare(`
    SELECT SUM(input_tokens + output_tokens) as total 
    FROM ticket_analyses 
    WHERE llm_provider NOT LIKE 'ollama%' 
      AND date(created_at) = date('now', 'localtime')
  `).get();
  return row.total || 0;
}

// ── Repo Index Status ───────────────────────────────────────

/**
 * Upserts the status record for a repo.
 */
function upsertRepoStatus(data) {
  const database = getDb();
  database.prepare(`
    INSERT INTO indexed_repos (repo_id, repo_name, local_path, total_files, total_chunks, last_indexed_at, status)
    VALUES (@repo_id, @repo_name, @local_path, @total_files, @total_chunks, @last_indexed_at, @status)
    ON CONFLICT(repo_id) DO UPDATE SET
      repo_name = excluded.repo_name,
      local_path = excluded.local_path,
      total_files = COALESCE(NULLIF(excluded.total_files, 0), total_files),
      total_chunks = COALESCE(NULLIF(excluded.total_chunks, 0), total_chunks),
      last_indexed_at = excluded.last_indexed_at,
      status = excluded.status
  `).run({
    repo_id: data.repoId,
    repo_name: data.repoName || data.repoId,
    local_path: data.localPath || '',
    total_files: data.totalFiles || 0,
    total_chunks: data.totalChunks || 0,
    last_indexed_at: new Date().toISOString(),
    status: data.status || 'ready'
  });
}

/**
 * Returns all repo status records.
 */
function getAllRepoStatus() {
  const database = getDb();
  return database.prepare('SELECT * FROM indexed_repos ORDER BY last_indexed_at DESC').all();
}

// ── Indexing Log ────────────────────────────────────────────

/**
 * Logs the start of an index run.
 * @returns {number} ID of the log record
 */
function startIndexLog(repoId, runType = 'delta') {
  const database = getDb();
  return database.prepare(`
    INSERT INTO indexing_log (repo_id, run_type) VALUES (?, ?)
  `).run(repoId, runType).lastInsertRowid;
}

/**
 * Updates an index log record when a run finishes.
 */
function finishIndexLog(logId, data) {
  const database = getDb();
  database.prepare(`
    UPDATE indexing_log SET
      files_added = ?,
      files_skipped = ?,
      files_removed = ?,
      duration_ms = ?,
      error = ?,
      finished_at = datetime('now')
    WHERE id = ?
  `).run(
    data.filesAdded || 0,
    data.filesSkipped || 0,
    data.filesRemoved || 0,
    data.durationMs || 0,
    data.error || null,
    logId
  );
}

module.exports = {
  getDb,
  upsertTicketAnalysis,
  getLatestAnalysis,
  getAllAnalyses,
  getAnalyticsSummary,
  getDailyCloudTokenUsage,
  upsertRepoStatus,
  getAllRepoStatus,
  startIndexLog,
  finishIndexLog
};
