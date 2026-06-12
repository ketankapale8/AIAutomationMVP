// backend/lanceStore.js
// Production vector store using LanceDB — replaces the flat JSON vectorStore.js.
// 
// Key improvements over the MVP:
//  - Persistent on-disk storage (Apache Arrow / Lance format)
//  - Per-repo named tables (repoId as table prefix)
//  - ANN (Approximate Nearest Neighbor) search — O(log n) vs O(n)
//  - Metadata filtering (search within a specific repo only)
//  - No memory limits — handles millions of chunks
//  - Zero external services — pure Node.js, no Docker required

const path = require('path');
const fs = require('fs');
const { getIndexerConfig } = require('./configLoader');

// Lazy-loaded LanceDB module (avoid import failure if not installed yet)
let lancedb = null;
let db = null;
// Map from tableKey → opened LanceDB table
const openTables = {};

/**
 * Returns the LanceDB storage path from config.
 */
function getDbPath() {
  const cfg = getIndexerConfig();
  const dbPath = path.isAbsolute(cfg.lanceDbPath)
    ? cfg.lanceDbPath
    : path.join(__dirname, cfg.lanceDbPath);
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath, { recursive: true });
  }
  return dbPath;
}

/**
 * Lazily connects to the LanceDB database.
 */
async function getDb() {
  if (!lancedb) {
    lancedb = require('@lancedb/lancedb');
  }
  if (!db) {
    db = await lancedb.connect(getDbPath());
  }
  return db;
}

/**
 * Returns the LanceDB table for a given repoId, creating it if it doesn't exist.
 * Table schema: { vector: Float32Array, filePath, content, startLine, endLine, repoId, symbolName, symbolType, language, fileHash }
 * @param {string} repoId
 */
async function getTable(repoId) {
  const tableKey = `repo_${repoId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

  if (openTables[tableKey]) return openTables[tableKey];

  const database = await getDb();
  const existingTables = await database.tableNames();

  if (existingTables.includes(tableKey)) {
    openTables[tableKey] = await database.openTable(tableKey);
  } else {
    // Create table with a dummy record to establish schema, then delete it
    const { Float32Array: _f } = global; // just to be safe
    const placeholder = [buildRecord({
      vector: new Array(768).fill(0),
      filePath: '__init__',
      content: '',
      startLine: 0,
      endLine: 0,
      repoId,
      symbolName: '',
      symbolType: '',
      language: '',
      fileHash: ''
    })];
    openTables[tableKey] = await database.createTable(tableKey, placeholder);
    // Remove placeholder
    await openTables[tableKey].delete(`filePath = '__init__'`);
    console.log(`✅ LanceDB: Created new table "${tableKey}" for repo "${repoId}"`);
  }

  return openTables[tableKey];
}

/** Builds a flat record object for LanceDB insertion */
function buildRecord({ vector, filePath, content, startLine, endLine, repoId, symbolName, symbolType, language, fileHash }) {
  return {
    vector: Array.isArray(vector) ? vector : Array.from(vector),
    filePath: String(filePath || ''),
    content: String(content || ''),
    startLine: Number(startLine || 0),
    endLine: Number(endLine || 0),
    repoId: String(repoId || 'default'),
    symbolName: String(symbolName || ''),
    symbolType: String(symbolType || ''),
    language: String(language || ''),
    fileHash: String(fileHash || '')
  };
}

/**
 * Adds an array of document chunks to the vector store.
 * @param {Array<{filePath, content, startLine, endLine, embedding, repoId, symbolName, symbolType, language, fileHash}>} docs
 */
async function addDocuments(docs) {
  if (!docs || docs.length === 0) return;

  // Group by repoId for efficient batch inserts
  const byRepo = {};
  for (const doc of docs) {
    const rid = doc.repoId || 'default';
    if (!byRepo[rid]) byRepo[rid] = [];
    byRepo[rid].push(buildRecord({
      vector: doc.embedding,
      filePath: doc.filePath,
      content: doc.content,
      startLine: doc.startLine,
      endLine: doc.endLine,
      repoId: rid,
      symbolName: doc.symbolName || '',
      symbolType: doc.symbolType || '',
      language: doc.language || '',
      fileHash: doc.fileHash || ''
    }));
  }

  for (const [rid, records] of Object.entries(byRepo)) {
    const table = await getTable(rid);
    await table.add(records);
    console.log(`📦 LanceDB: Added ${records.length} chunks to repo "${rid}"`);
  }
}

/**
 * Removes all chunks belonging to a specific file from a specific repo.
 * @param {string} filePath
 * @param {string} repoId
 */
async function removeDocumentsForFile(filePath, repoId = 'default') {
  try {
    const table = await getTable(repoId);
    // Escape single quotes in path
    const safeFilePath = String(filePath).replace(/'/g, "\\'");
    await table.delete(`filePath = '${safeFilePath}'`);
  } catch (err) {
    // Table may not exist yet if this is the first index run — that's fine
    if (!err.message.includes('does not exist')) {
      console.error(`❌ LanceDB: Failed to remove chunks for ${filePath}:`, err.message);
    }
  }
}

/**
 * Semantic similarity search within a specific repo.
 * @param {Array<number>} queryVector  Embedding vector
 * @param {number} topK               Number of results to return
 * @param {string} repoId             Repo to search within
 * @returns {Array<{filePath, content, startLine, endLine, repoId, symbolName, symbolType, score}>}
 */
async function similaritySearch(queryVector, topK = 15, repoId = 'default') {
  try {
    const table = await getTable(repoId);
    const results = await table.search(queryVector).limit(topK).toArray();
    return results.map(row => ({
      filePath: row.filePath,
      content: row.content,
      startLine: row.startLine,
      endLine: row.endLine,
      repoId: row.repoId,
      symbolName: row.symbolName,
      symbolType: row.symbolType,
      language: row.language,
      score: row._distance !== undefined ? (1 - row._distance) : 1
    }));
  } catch (err) {
    if (err.message.includes('does not exist') || err.message.includes('No data')) {
      console.warn(`⚠️ LanceDB: No indexed data found for repo "${repoId}". Run "npm run index" first.`);
      return [];
    }
    throw err;
  }
}

/**
 * Returns the count of chunks indexed for a given repo.
 * @param {string} repoId
 * @returns {number}
 */
async function getChunkCount(repoId = 'default') {
  try {
    const table = await getTable(repoId);
    return await table.countRows();
  } catch {
    return 0;
  }
}

/**
 * Drops all data for a repo (full re-index).
 * @param {string} repoId
 */
async function dropRepo(repoId) {
  const tableKey = `repo_${repoId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  try {
    const database = await getDb();
    await database.dropTable(tableKey);
    delete openTables[tableKey];
    console.log(`🗑️ LanceDB: Dropped table for repo "${repoId}"`);
  } catch (err) {
    if (!err.message.includes('does not exist')) {
      console.error(`❌ LanceDB: Failed to drop repo "${repoId}":`, err.message);
    }
  }
}

module.exports = {
  addDocuments,
  removeDocumentsForFile,
  similaritySearch,
  getChunkCount,
  dropRepo
};
