// backend/indexer.js
// Production-grade incremental repository indexer.
//
// What's new vs MVP:
//   - Config-driven: reads all repos from config.yaml (no code changes per client)
//   - Delta indexing: SHA-256 hash cache — only re-embeds changed/new files
//   - AST-aware chunking: function/class-level chunks with rich metadata
//   - LanceDB storage: persistent, ANN-searchable, per-repo collections
//   - SQLite logging: every run is recorded with stats
//   - Multi-repo support: indexes all repos in config in a single run

const fs = require('fs');
const path = require('path');

// Manually load .env before importing any module that reads env vars
// PKG: __dirname is virtual snapshot path; use process.execPath dir for real .env location
const APP_DIR = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;

if (fs.existsSync(path.join(APP_DIR, '.env'))) {
  const envContent = fs.readFileSync(path.join(APP_DIR, '.env'), 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?/);
    if (match) {
      const key = match[1];
      let value = (match[2] || '').trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

const embeddings = require('./embeddings');
const lanceStore = require('./lanceStore');
const astChunker = require('./astChunker');
const hashCache = require('./hashCache');
const { getAllRepos, getIndexerConfig } = require('./configLoader');
const db = require('./db');

/**
 * Recursively scans a directory and returns all indexable file paths.
 * @param {string} dir           Absolute path to scan
 * @param {Array<string>} extensions  File extensions to include (e.g. ['.ts', '.js'])
 * @param {Array<string>} excludeDirs Directory names to skip
 * @returns {Array<string>}      Absolute file paths
 */
function scanDirectory(dir, extensions, excludeDirs = []) {
  const results = [];

  if (!fs.existsSync(dir)) {
    console.warn(`⚠️ Directory does not exist, skipping: ${dir}`);
    return results;
  }

  const defaultExclude = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.pnpm-store', 'coverage', '__pycache__', '.venv']);
  const exclusions = new Set([...defaultExclude, ...excludeDirs]);
  const validExts = new Set(extensions);

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (!exclusions.has(entry)) walk(fullPath);
      } else if (stat.isFile()) {
        if (validExts.has(path.extname(entry).toLowerCase())) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Indexes a single file: chunks it, embeds chunks, stores in LanceDB.
 * @param {string} absoluteFilePath  Full path to file on disk
 * @param {string} content           File content
 * @param {string} repoId            Repo identifier
 * @param {string} repoRootPath      Repo root (used for computing relative paths)
 * @param {string} fileHash          SHA-256 of content
 * @param {number} delayMs           Delay between embedding API calls
 * @returns {number}  Number of chunks indexed
 */
async function indexFile(absoluteFilePath, content, repoId, repoRootPath, fileHash, delayMs = 120) {
  // Use relative path for storage (portable across environments)
  const relativePath = path.relative(repoRootPath, absoluteFilePath).replace(/\\/g, '/');

  // 1. Remove old chunks for this file
  await lanceStore.removeDocumentsForFile(relativePath, repoId);

  // 2. Chunk the file using AST-aware chunker
  const chunks = astChunker.splitCodeIntoChunks(absoluteFilePath, content);
  if (chunks.length === 0) return 0;

  console.log(`  ⚡ ${relativePath} → ${chunks.length} chunk(s)`);

  // 3. Embed each chunk and collect for batch insert
  const cfg = getIndexerConfig();
  const docs = [];

  for (const chunk of chunks) {
    try {
      const vector = await embeddings.embedText(chunk.content);
      if (!vector) {
        throw new Error("Embedding generation failed. All configured embedding providers (Ollama, Gemini, OpenAI) are offline or missing API keys.");
      }
      docs.push({
        filePath: relativePath,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        embedding: vector,
        repoId,
        symbolName: chunk.symbolName || '',
        symbolType: chunk.symbolType || '',
        language: chunk.language || '',
        fileHash
      });
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    } catch (err) {
      console.error(`    ❌ Embed failed for ${relativePath}:${chunk.startLine} — ${err.message}`);
    }
  }

  // 4. Batch insert into LanceDB
  if (docs.length > 0) {
    await lanceStore.addDocuments(docs);
  }

  return docs.length;
}

/**
 * Indexes a single repo (delta mode by default).
 * @param {object} repoConfig  Repo config object from config.yaml
 * @param {object} options
 * @param {boolean} options.force  If true, ignores hash cache (full re-index)
 */
async function indexRepo(repoConfig, { force = false } = {}) {
  const { id: repoId, name: repoName, localPath, extensions = [], excludeDirs = [] } = repoConfig;
  const cfg = getIndexerConfig();

  console.log(`\n📂 Indexing repo: ${repoName} (${repoId})`);
  console.log(`   Path: ${localPath}`);

  // Mark as indexing in DB
  db.upsertRepoStatus({ repoId, repoName, localPath, status: 'indexing' });
  const logId = db.startIndexLog(repoId, force ? 'full' : 'delta');
  const startTime = Date.now();

  let filesAdded = 0, filesSkipped = 0, filesRemoved = 0;

  try {
    // 1. Scan directory for indexable files
    const allFiles = scanDirectory(localPath, extensions, excludeDirs);
    console.log(`   Found ${allFiles.length} indexable files`);

    // 2. Load hash cache (for delta detection)
    const cache = force ? {} : hashCache.loadCache(repoId);

    // 3. Find deleted files (in cache but not on disk anymore)
    const deletedFiles = hashCache.findDeletedFiles(cache);
    for (const deletedPath of deletedFiles) {
      const relPath = path.relative(localPath, deletedPath).replace(/\\/g, '/');
      await lanceStore.removeDocumentsForFile(relPath, repoId);
      hashCache.removeFromCache(deletedPath, cache);
      filesRemoved++;
      console.log(`   🗑️ Removed deleted file: ${relPath}`);
    }

    // 4. Index new and changed files
    for (const filePath of allFiles) {
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        console.error(`   ❌ Failed to read ${filePath}: ${err.message}`);
        continue;
      }

      if (!force && !hashCache.isChanged(filePath, content, cache)) {
        filesSkipped++;
        continue; // Unchanged — skip
      }

      const fileHash = hashCache.hashContent(content);
      const chunksIndexed = await indexFile(filePath, content, repoId, localPath, fileHash, cfg.embeddingDelayMs);
      hashCache.updateCache(filePath, content, cache);
      filesAdded++;
    }

    // 5. Save updated hash cache
    hashCache.saveCache(repoId, cache);

    // 6. Get total chunk count from LanceDB
    const totalChunks = await lanceStore.getChunkCount(repoId);
    const durationMs = Date.now() - startTime;

    // 7. Update DB status
    db.upsertRepoStatus({
      repoId, repoName, localPath,
      totalFiles: allFiles.length,
      totalChunks,
      status: 'ready'
    });
    db.finishIndexLog(logId, { filesAdded, filesSkipped, filesRemoved, durationMs });

    console.log(`\n✅ Repo "${repoId}" indexed in ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`   Added: ${filesAdded} | Skipped: ${filesSkipped} | Removed: ${filesRemoved} | Total chunks: ${totalChunks}`);

  } catch (err) {
    const durationMs = Date.now() - startTime;
    db.upsertRepoStatus({ repoId, repoName, localPath, status: 'error' });
    db.finishIndexLog(logId, { filesAdded, filesSkipped, filesRemoved, durationMs, error: err.message });
    console.error(`❌ Indexing failed for repo "${repoId}": ${err.message}`);
    throw err;
  }
}

/**
 * Main run function — indexes all repos defined in config.yaml.
 * Pass --force to ignore hash cache and re-index everything.
 *
 * If a repo has `gitUrl` set, it will be cloned/pulled automatically.
 * Set GIT_TOKEN env var for private repos.
 */
async function runIndexer() {
  const force = process.argv.includes('--force');
  console.log(`\n🚀 Starting ${force ? 'FULL' : 'Incremental'} Indexer...`);
  console.log(`   Mode: ${force ? 'Full Re-index (ignoring hash cache)' : 'Delta (only changed files)'}`);

  const repos = getAllRepos();
  if (repos.length === 0) {
    console.error('❌ No repos configured in config.yaml');
    return;
  }

  console.log(`   Repos to index: ${repos.map(r => r.id).join(', ')}`);

  // ── Git auto-clone / pull ─────────────────────────────────────
  for (const repo of repos) {
    if (!repo.gitUrl) continue;

    try {
      const simpleGit = require('simple-git');
      const token = process.env.GIT_TOKEN || repo.gitToken || '';
      const branch = repo.gitBranch || 'main';

      // Inject auth token into URL for private repos
      let cloneUrl = repo.gitUrl;
      if (token && cloneUrl.startsWith('https://')) {
        const urlObj = new URL(cloneUrl);
        urlObj.username = 'oauth2';
        urlObj.password = token;
        cloneUrl = urlObj.toString();
      }

      const localPath = repo.localPath;
      const gitDir = require('path').join(localPath, '.git');

      if (!require('fs').existsSync(gitDir)) {
        // First run — clone
        console.log(`\n📥 Cloning ${repo.id} from ${repo.gitUrl}...`);
        require('fs').mkdirSync(localPath, { recursive: true });
        await simpleGit().clone(cloneUrl, localPath, ['--branch', branch, '--depth', '1']);
        console.log(`  ✅ Cloned to ${localPath}`);
      } else {
        // Subsequent runs — pull latest
        console.log(`\n🔄 Pulling latest for ${repo.id} (branch: ${branch})...`);
        await simpleGit(localPath).pull('origin', branch);
        console.log(`  ✅ Pulled latest changes`);
      }
    } catch (err) {
      console.error(`  ⚠️  Git operation failed for ${repo.id}: ${err.message}`);
      console.error(`     Will index from existing localPath if it exists.`);
    }
  }

  // ── Index each repo ───────────────────────────────────────────
  for (const repo of repos) {
    try {
      await indexRepo(repo, { force });
    } catch (err) {
      console.error(`❌ Skipping repo "${repo.id}" due to error: ${err.message}`);
    }
  }

  console.log('\n✅ All repos indexed successfully.\n');
}

// ── Single-file indexer (called by server on git webhook) ────

/**
 * Re-indexes a single file in a specific repo (called on git push webhook).
 * @param {string} filePath  Absolute file path
 * @param {string} content   File content
 * @param {string} repoId    Repo identifier
 * @param {string} repoRoot  Repo root path
 */
async function indexSingleFile(filePath, content, repoId, repoRoot) {
  const cfg = getIndexerConfig();
  const fileHash = hashCache.hashContent(content);
  const cache = hashCache.loadCache(repoId);
  await indexFile(filePath, content, repoId, repoRoot, fileHash, cfg.embeddingDelayMs);
  hashCache.updateCache(filePath, content, cache);
  hashCache.saveCache(repoId, cache);
}

// Run if executed directly
if (require.main === module) {
  runIndexer().catch(err => {
    console.error('❌ Indexer crashed:', err);
    process.exit(1);
  });
}

module.exports = {
  runIndexer,
  indexRepo,
  indexSingleFile,
  scanDirectory
};
