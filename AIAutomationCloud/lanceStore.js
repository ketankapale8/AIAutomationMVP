// AIAutomationCloud/lanceStore.js
// Cloud-native vector store replacing LanceDB with Supabase pgvector.

const { getPool } = require('./db');

/**
 * Adds an array of document chunks to the database.
 * @param {Array<{filePath, content, startLine, endLine, embedding, repoId, symbolName, symbolType, language, fileHash}>} docs
 */
async function addDocuments(docs) {
  if (!docs || docs.length === 0) return;

  const pool = getPool();
  const query = `
    INSERT INTO code_chunks 
      (file_path, content, start_line, end_line, embedding, repo_id, symbol_name, symbol_type, language, file_hash)
    VALUES 
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `;

  try {
    await Promise.all(docs.map(doc => {
      const vecString = `[${doc.embedding.join(',')}]`;
      return pool.query(query, [
        doc.filePath || '',
        doc.content || '',
        doc.startLine || 0,
        doc.endLine || 0,
        vecString,
        doc.repoId || 'default',
        doc.symbolName || '',
        doc.symbolType || '',
        doc.language || '',
        doc.fileHash || ''
      ]);
    }));
    console.log(`📦 pgvector: Inserted ${docs.length} chunks.`);
  } catch (err) {
    console.error('❌ pgvector: Failed to insert documents:', err.message);
  }
}

/**
 * Removes all chunks belonging to a specific file from a specific repo.
 * @param {string} filePath
 * @param {string} repoId
 */
async function removeDocumentsForFile(filePath, repoId = 'default') {
  try {
    const pool = getPool();
    await pool.query(
      `DELETE FROM code_chunks WHERE file_path = $1 AND repo_id = $2`,
      [filePath, repoId]
    );
    console.log(`🗑️ pgvector: Removed chunks for ${filePath} from repo "${repoId}".`);
  } catch (err) {
    console.error(`❌ pgvector: Failed to remove chunks for ${filePath}:`, err.message);
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
    const pool = getPool();
    const vecString = `[${queryVector.join(',')}]`;

    const res = await pool.query(
      `SELECT file_path, content, start_line, end_line, repo_id, symbol_name, symbol_type, language,
              (1 - (embedding <=> $1)) as score
       FROM code_chunks
       WHERE repo_id = $2
       ORDER BY embedding <=> $1
       LIMIT $3`,
      [vecString, repoId, topK]
    );

    return res.rows.map(row => ({
      filePath: row.file_path,
      content: row.content,
      startLine: row.start_line,
      endLine: row.end_line,
      repoId: row.repo_id,
      symbolName: row.symbol_name,
      symbolType: row.symbol_type,
      language: row.language,
      score: Number(row.score)
    }));
  } catch (err) {
    console.error(`❌ pgvector search failed for repo "${repoId}":`, err.message);
    return [];
  }
}

/**
 * Returns the count of chunks indexed for a given repo.
 * @param {string} repoId
 * @returns {number}
 */
async function getChunkCount(repoId = 'default') {
  try {
    const pool = getPool();
    const res = await pool.query(
      `SELECT COUNT(*) as count FROM code_chunks WHERE repo_id = $1`,
      [repoId]
    );
    return parseInt(res.rows[0].count, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Drops all data for a repo (full re-index).
 * @param {string} repoId
 */
async function dropRepo(repoId) {
  try {
    const pool = getPool();
    await pool.query(
      `DELETE FROM code_chunks WHERE repo_id = $1`,
      [repoId]
    );
    console.log(`🗑️ pgvector: Dropped all chunks for repo "${repoId}"`);
  } catch (err) {
    console.error(`❌ pgvector: Failed to drop repo "${repoId}":`, err.message);
  }
}

module.exports = {
  addDocuments,
  removeDocumentsForFile,
  similaritySearch,
  getChunkCount,
  dropRepo
};
