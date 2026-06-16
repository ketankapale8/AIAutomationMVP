// AIAutomationCloud/db.js
// PostgreSQL persistence layer for cloud environments.
// Uses pg pool to connect asynchronously to Supabase.

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    console.error('❌ Error: DATABASE_URL or SUPABASE_DB_URL environment variable is missing.');
    process.exit(1);
  }

  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false // Required for Supabase/Render free connections
    }
  });

  // Test connection and initialize tables
  pool.query('SELECT NOW()')
    .then(() => {
      console.log('✅ Connected to Supabase/PostgreSQL');
      return initSchema();
    })
    .catch(err => {
      console.error('❌ Database connection error:', err);
    });

  return pool;
}

async function initSchema() {
  const p = getPool();
  try {
    await p.query(`
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE TABLE IF NOT EXISTS code_chunks (
        id SERIAL PRIMARY KEY,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        embedding vector(768),
        repo_id VARCHAR(100),
        symbol_name VARCHAR(100),
        symbol_type VARCHAR(100),
        language VARCHAR(50),
        file_hash VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding ON code_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

      CREATE TABLE IF NOT EXISTS ticket_analyses (
        id SERIAL PRIMARY KEY,
        issue_key VARCHAR(50) NOT NULL,
        project_key VARCHAR(50) NOT NULL,
        repo_id VARCHAR(100) NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        issue_type VARCHAR(50),
        format VARCHAR(5),
        analysis TEXT NOT NULL,
        llm_provider VARCHAR(100),
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        jira_url TEXT,
        jira_comment_id VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_ticket_analyses_issue_key ON ticket_analyses(issue_key);
      CREATE INDEX IF NOT EXISTS idx_ticket_analyses_project_key ON ticket_analyses(project_key);
      CREATE INDEX IF NOT EXISTS idx_ticket_analyses_created_at ON ticket_analyses(created_at DESC);

      CREATE TABLE IF NOT EXISTS indexed_repos (
        id SERIAL PRIMARY KEY,
        repo_id VARCHAR(100) NOT NULL UNIQUE,
        repo_name VARCHAR(100),
        local_path TEXT,
        total_files INTEGER DEFAULT 0,
        total_chunks INTEGER DEFAULT 0,
        last_indexed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS indexing_log (
        id SERIAL PRIMARY KEY,
        repo_id VARCHAR(100) NOT NULL,
        run_type VARCHAR(20),
        files_added INTEGER DEFAULT 0,
        files_skipped INTEGER DEFAULT 0,
        files_removed INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        error TEXT,
        started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP WITH TIME ZONE
      );
    `);
    
    // Dynamically migrate table if it already existed in Supabase without the jira_comment_id column
    await p.query(`
      ALTER TABLE ticket_analyses ADD COLUMN IF NOT EXISTS jira_comment_id VARCHAR(100);
    `);

    console.log('✅ Schema initialized or verified');
  } catch (err) {
    console.error('❌ Schema initialization failed:', err);
  }
}

// ── Ticket Analyses ─────────────────────────────────────────

async function upsertTicketAnalysis(data) {
  const p = getPool();
  const query = `
    INSERT INTO ticket_analyses
      (issue_key, project_key, repo_id, title, description, issue_type, format, analysis, llm_provider, input_tokens, output_tokens, jira_url, jira_comment_id)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id;
  `;
  const values = [
    data.issueKey || '',
    data.projectKey || '',
    data.repoId || 'default',
    data.title || '',
    data.description || '',
    data.issueType || 'Unknown',
    data.format || 'A',
    data.analysis || '',
    data.llmProvider || '',
    data.inputTokens || 0,
    data.outputTokens || 0,
    data.jiraUrl || '',
    data.jiraCommentId || null
  ];
  const res = await p.query(query, values);
  return res.rows[0];
}

async function getLatestAnalysis(issueKey) {
  const p = getPool();
  const res = await p.query(`
    SELECT * FROM ticket_analyses
    WHERE issue_key = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [issueKey]);
  return res.rows[0];
}

async function getAllAnalyses(limit = 50, offset = 0) {
  const p = getPool();
  const res = await p.query(`
    SELECT id, issue_key, project_key, repo_id, title, issue_type, format, llm_provider,
           input_tokens, output_tokens, jira_url, created_at
    FROM ticket_analyses
    ORDER BY id DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return res.rows;
}

async function getAnalyticsSummary() {
  const p = getPool();
  
  const totalTicketsRes = await p.query('SELECT COUNT(*) as count FROM ticket_analyses');
  
  const byTypeRes = await p.query(`
    SELECT issue_type, COUNT(*) as count
    FROM ticket_analyses GROUP BY issue_type ORDER BY count DESC
  `);
  
  const byFormatRes = await p.query(`
    SELECT format, COUNT(*) as count
    FROM ticket_analyses GROUP BY format
  `);
  
  const totalTokensInRes = await p.query('SELECT SUM(input_tokens) as total FROM ticket_analyses');
  const totalTokensOutRes = await p.query('SELECT SUM(output_tokens) as total FROM ticket_analyses');
  
  const byProviderRes = await p.query(`
    SELECT llm_provider, COUNT(*) as count, SUM(input_tokens) as total_input_tokens
    FROM ticket_analyses GROUP BY llm_provider ORDER BY count DESC
  `);
  
  const recentActivityRes = await p.query(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM ticket_analyses
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);

  return {
    totalTickets: parseInt(totalTicketsRes.rows[0].count, 10) || 0,
    byType: byTypeRes.rows,
    byFormat: byFormatRes.rows,
    totalTokensIn: parseInt(totalTokensInRes.rows[0].total, 10) || 0,
    totalTokensOut: parseInt(totalTokensOutRes.rows[0].total, 10) || 0,
    byProvider: byProviderRes.rows.map(r => ({
      llm_provider: r.llm_provider,
      count: parseInt(r.count, 10) || 0,
      total_input_tokens: parseInt(r.total_input_tokens, 10) || 0
    })),
    recentActivity: recentActivityRes.rows
  };
}

async function getDailyCloudTokenUsage() {
  const p = getPool();
  const res = await p.query(`
    SELECT SUM(input_tokens + output_tokens) as total 
    FROM ticket_analyses 
    WHERE llm_provider NOT LIKE 'ollama%' 
      AND DATE(created_at) = CURRENT_DATE
  `);
  return parseInt(res.rows[0].total, 10) || 0;
}

// ── Repo Index Status ───────────────────────────────────────

async function upsertRepoStatus(data) {
  const p = getPool();
  const query = `
    INSERT INTO indexed_repos (repo_id, repo_name, local_path, total_files, total_chunks, last_indexed_at, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT(repo_id) DO UPDATE SET
      repo_name = EXCLUDED.repo_name,
      local_path = EXCLUDED.local_path,
      total_files = COALESCE(NULLIF(EXCLUDED.total_files, 0), indexed_repos.total_files),
      total_chunks = COALESCE(NULLIF(EXCLUDED.total_chunks, 0), indexed_repos.total_chunks),
      last_indexed_at = EXCLUDED.last_indexed_at,
      status = EXCLUDED.status;
  `;
  const lastIndexedAt = new Date().toISOString();
  await p.query(query, [
    data.repoId,
    data.repoName || data.repoId,
    data.localPath || '',
    data.totalFiles || 0,
    data.totalChunks || 0,
    lastIndexedAt,
    data.status || 'ready'
  ]);
}

async function getAllRepoStatus() {
  const p = getPool();
  const res = await p.query('SELECT * FROM indexed_repos ORDER BY last_indexed_at DESC');
  return res.rows;
}

// ── Indexing Log ────────────────────────────────────────────

async function startIndexLog(repoId, runType = 'delta') {
  const p = getPool();
  const res = await p.query(`
    INSERT INTO indexing_log (repo_id, run_type) VALUES ($1, $2) RETURNING id;
  `, [repoId, runType]);
  return res.rows[0].id;
}

async function finishIndexLog(logId, data) {
  const p = getPool();
  await p.query(`
    UPDATE indexing_log SET
      files_added = $1,
      files_skipped = $2,
      files_removed = $3,
      duration_ms = $4,
      error = $5,
      finished_at = CURRENT_TIMESTAMP
    WHERE id = $6;
  `, [
    data.filesAdded || 0,
    data.filesSkipped || 0,
    data.filesRemoved || 0,
    data.durationMs || 0,
    data.error || null,
    logId
  ]);
}

module.exports = {
  getPool,
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
