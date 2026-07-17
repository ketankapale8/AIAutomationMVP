// sync-supabase.js
// Utility script to run indexing locally and push embeddings directly to Supabase pgvector.
// Run with: node sync-supabase.js

const fs = require('fs');
const path = require('path');

console.log('🏁 Starting Local-to-Supabase Indexer...');

// 1. Load local .env variables
const envPath = path.join(__dirname, 'backend', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
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
  console.log('✅ Local .env file loaded successfully.');
} else {
  console.error('❌ Could not find backend/.env file.');
  process.exit(1);
}

// 2. Set Cloud DATABASE_URL from Supabase
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:Noxiath@8888@db.qjwezphwqrcbbuetblsg.supabase.co:5432/postgres';
process.env.DATABASE_URL = dbUrl;

// 3. Import cloud packages and adapters
const cloudDir = path.join(__dirname, 'AIAutomationCloud');
const configLoader = require(path.join(cloudDir, 'configLoader'));
const embeddings = require(path.join(__dirname, 'backend', 'embeddings'));
const pgStore = require(path.join(cloudDir, 'lanceStore')); // uses pgvector
const astChunker = require(path.join(cloudDir, 'astChunker'));
const hashCache = require(path.join(cloudDir, 'hashCache'));
const db = require(path.join(cloudDir, 'db'));

const repos = configLoader.getAllRepos();
const repo = repos[0]; // prozilla-os
const localPath = path.join(__dirname, 'testingrepo', 'ProzillaOS');

console.log(`📡 Target database: Supabase (pgvector)`);
console.log(`📂 Scanning local path: ${localPath}`);

function scanDirectory(dir, extensions, excludeDirs = []) {
  const results = [];
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

async function run() {
  const allFiles = scanDirectory(localPath, repo.extensions, repo.excludeDirs);
  console.log(`📊 Found ${allFiles.length} indexable files locally.`);

  console.log('⚡ Initializing DB tables on Supabase if not present...');
  db.getPool(); // Connects and triggers initSchema

  // Comment out dropRepo to resume indexing
  // console.log(`🗑️ Clearing old entries for "${repo.id}" in Supabase...`);
  // await pgStore.dropRepo(repo.id);

  let successCount = 0;
  const cfg = configLoader.getIndexerConfig();
  const cache = hashCache.loadCache(repo.id);

  for (let i = 0; i < allFiles.length; i++) {
    const filePath = allFiles[i];
    const relativePath = path.relative(localPath, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Skip if already successfully indexed (using hashCache)
    if (hashCache.isChanged && !hashCache.isChanged(filePath, content, cache)) {
      console.log(`⏭️  [${i + 1}/${allFiles.length}] Skipping (already indexed): ${relativePath}`);
      continue;
    }

    const fileHash = hashCache.hashContent(content);
    const chunks = astChunker.splitCodeIntoChunks(filePath, content);
    if (chunks.length === 0) continue;

    console.log(`⚡ [${i + 1}/${allFiles.length}] Indexing: ${relativePath} (${chunks.length} chunks)`);
    const docs = [];

    for (const chunk of chunks) {
      try {
        const vector = await embeddings.embedText(chunk.content);
        if (vector) {
          docs.push({
            filePath: relativePath,
            content: chunk.content,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            embedding: vector,
            repoId: repo.id,
            symbolName: chunk.symbolName || '',
            symbolType: chunk.symbolType || '',
            language: chunk.language || '',
            fileHash
          });
        }
      } catch (err) {
        console.error(`  ❌ Failed to embed chunk at line ${chunk.startLine}: ${err.message}`);
      }
    }

    if (docs.length > 0) {
      await pgStore.addDocuments(docs);
      hashCache.updateCache(filePath, content, cache);
      hashCache.saveCache(repo.id, cache);
      successCount += docs.length;
    }
  }

  console.log(`\n🎉 Success! Locally indexed ProzillaOS to Supabase.`);
  console.log(`   Total chunks uploaded: ${successCount}`);
  process.exit(0);
}

// Start run
setTimeout(run, 2000);
