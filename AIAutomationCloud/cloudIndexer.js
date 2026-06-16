// AIAutomationCloud/cloudIndexer.js
// Incremental repository indexer adapted for Cloud/Supabase environments.

const fs = require('fs');
const path = require('path');

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
    try { entries = fs.readdirSync(currentDir); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }
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

async function indexFile(absoluteFilePath, content, repoId, repoRootPath, fileHash, delayMs = 120) {
  const relativePath = path.relative(repoRootPath, absoluteFilePath).replace(/\\/g, '/');
  await lanceStore.removeDocumentsForFile(relativePath, repoId);

  const chunks = astChunker.splitCodeIntoChunks(absoluteFilePath, content);
  if (chunks.length === 0) return 0;

  console.log(`  ⚡ ${relativePath} → ${chunks.length} chunk(s)`);
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

  if (docs.length > 0) {
    await lanceStore.addDocuments(docs);
  }
  return docs.length;
}

async function indexRepo(repoConfig, { force = false } = {}) {
  const { id: repoId, name: repoName, localPath, extensions = [], excludeDirs = [] } = repoConfig;
  const cfg = getIndexerConfig();

  console.log(`\n📂 Indexing repo: ${repoName} (${repoId})`);
  console.log(`   Path: ${localPath}`);

  await db.upsertRepoStatus({ repoId, repoName, localPath, status: 'indexing' });
  const logId = await db.startIndexLog(repoId, force ? 'full' : 'delta');
  const startTime = Date.now();

  let filesAdded = 0, filesSkipped = 0, filesRemoved = 0;

  try {
    const allFiles = scanDirectory(localPath, extensions, excludeDirs);
    console.log(`   Found ${allFiles.length} indexable files`);

    const cache = force ? {} : hashCache.loadCache(repoId);
    const deletedFiles = hashCache.findDeletedFiles(cache);

    for (const deletedPath of deletedFiles) {
      const relPath = path.relative(localPath, deletedPath).replace(/\\/g, '/');
      await lanceStore.removeDocumentsForFile(relPath, repoId);
      hashCache.removeFromCache(deletedPath, cache);
      filesRemoved++;
      console.log(`   🗑️ Removed deleted file: ${relPath}`);
    }

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
        continue;
      }

      const fileHash = hashCache.hashContent(content);
      await indexFile(filePath, content, repoId, localPath, fileHash, cfg.embeddingDelayMs);
      hashCache.updateCache(filePath, content, cache);
      filesAdded++;
    }

    hashCache.saveCache(repoId, cache);

    const totalChunks = await lanceStore.getChunkCount(repoId);
    const durationMs = Date.now() - startTime;

    await db.upsertRepoStatus({
      repoId, repoName, localPath,
      totalFiles: allFiles.length,
      totalChunks,
      status: 'ready'
    });
    await db.finishIndexLog(logId, { filesAdded, filesSkipped, filesRemoved, durationMs });

    console.log(`\n✅ Repo "${repoId}" indexed in ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`   Added: ${filesAdded} | Skipped: ${filesSkipped} | Removed: ${filesRemoved} | Total chunks: ${totalChunks}`);

  } catch (err) {
    const durationMs = Date.now() - startTime;
    await db.upsertRepoStatus({ repoId, repoName, localPath, status: 'error' });
    await db.finishIndexLog(logId, { filesAdded, filesSkipped, filesRemoved, durationMs, error: err.message });
    console.error(`❌ Indexing failed for repo "${repoId}": ${err.message}`);
    throw err;
  }
}

async function runIndexer() {
  const force = process.argv.includes('--force');
  console.log(`\n🚀 Starting ${force ? 'FULL' : 'Incremental'} Cloud Indexer...`);
  const repos = getAllRepos();
  if (repos.length === 0) {
    console.error('❌ No repos configured in config.yaml');
    return;
  }

  for (const repo of repos) {
    if (!repo.gitUrl) continue;
    try {
      const simpleGit = require('simple-git');
      const token = process.env.GIT_TOKEN || repo.gitToken || '';
      const branch = repo.gitBranch || 'main';

      let cloneUrl = repo.gitUrl;
      if (token && cloneUrl.startsWith('https://')) {
        const urlObj = new URL(cloneUrl);
        urlObj.username = 'oauth2';
        urlObj.password = token;
        cloneUrl = urlObj.toString();
      }

      const localPath = repo.localPath;
      const gitDir = path.join(localPath, '.git');

      if (!fs.existsSync(gitDir)) {
        console.log(`\n📥 Cloning ${repo.id} from ${repo.gitUrl}...`);
        fs.mkdirSync(localPath, { recursive: true });
        await simpleGit().clone(cloneUrl, localPath, ['--branch', branch, '--depth', '1']);
        console.log(`  ✅ Cloned to ${localPath}`);
      } else {
        console.log(`\n🔄 Pulling latest for ${repo.id} (branch: ${branch})...`);
        await simpleGit(localPath).pull('origin', branch);
        console.log(`  ✅ Pulled latest changes`);
      }
    } catch (err) {
      console.error(`  ⚠️ Git operation failed for ${repo.id}: ${err.message}`);
    }
  }

  for (const repo of repos) {
    try {
      await indexRepo(repo, { force });
    } catch (err) {
      console.error(`❌ Skipping repo "${repo.id}" due to error: ${err.message}`);
    }
  }
  console.log('\n✅ All repos indexed successfully.\n');
}

async function indexSingleFile(filePath, content, repoId, repoRoot) {
  const cfg = getIndexerConfig();
  const fileHash = hashCache.hashContent(content);
  const cache = hashCache.loadCache(repoId);
  await indexFile(filePath, content, repoId, repoRoot, fileHash, cfg.embeddingDelayMs);
  hashCache.updateCache(filePath, content, cache);
  hashCache.saveCache(repoId, cache);
}

if (require.main === module) {
  runIndexer().then(() => process.exit(0)).catch(err => {
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
