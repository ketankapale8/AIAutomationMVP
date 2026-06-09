// backend/indexer.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const chunker = require('./chunker');
const embeddings = require('./embeddings');
const vectorStore = require('./vectorStore');

// Manually load env variables if process.env is not populated (running standalone)
if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY && fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value.trim();
    }
  });
}

const githubOwner = process.env.GITHUB_OWNER;
const githubRepo = process.env.GITHUB_REPO;
const githubToken = process.env.GITHUB_TOKEN;
const githubBranch = process.env.GITHUB_BRANCH || "main";

// Utility to recursively scan local directories for indexable files
function scanLocalDirectory(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== '.next') {
        scanLocalDirectory(filePath, fileList);
      }
    } else {
      const ext = path.extname(file);
      if (['.tsx', '.ts', '.jsx', '.js', '.css', '.json'].includes(ext)) {
        fileList.push(filePath);
      }
    }
  });
  return fileList;
}

// Function to index a single file (splits it into chunks, embeds them, and adds them to store)
async function indexFile(filePath, content) {
  // Clear any existing chunks for this file to ensure clean overwrite
  vectorStore.removeDocumentsForFile(filePath);

  const chunks = chunker.splitCodeIntoChunks(filePath, content);
  if (chunks.length === 0) return;

  console.log(`⚡ Indexing file: ${filePath} (${chunks.length} chunks)`);
  const docsToInsert = [];
  
  for (const chunk of chunks) {
    try {
      // Generate embedding
      const vector = await embeddings.embedText(chunk.content);
      docsToInsert.push({
        filePath: chunk.filePath,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        embedding: vector
      });
      // Small sleep to avoid LLM API rate limits when indexing many files
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch (err) {
      console.error(`❌ Failed to embed chunk for ${filePath}:${chunk.startLine}:`, err.message);
    }
  }

  if (docsToInsert.length > 0) {
    vectorStore.addDocuments(docsToInsert);
  }
}

// Main run function
async function runIndexer() {
  console.log("🚀 Starting Repository Offline Indexer...");
  
  if (githubToken && githubOwner && githubRepo) {
    console.log(`🌐 GitHub Mode: Fetching files from API: ${githubOwner}/${githubRepo} (${githubBranch})...`);
    try {
      const treeUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/git/trees/${githubBranch}?recursive=1`;
      const headers = {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ICIMS-AI-Agent-Indexer'
      };

      const treeResponse = await axios.get(treeUrl, { headers });
      const files = treeResponse.data.tree || [];

      // Filter indexable files
      const indexableFiles = files.filter(f => 
        f.type === 'blob' && 
        f.path.startsWith('src/') && 
        ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'].includes(path.extname(f.path))
      );

      console.log(`Found ${indexableFiles.length} files to index on GitHub.`);
      
      for (const file of indexableFiles) {
        try {
          const fileUrl = `https://raw.githubusercontent.com/${githubOwner}/${githubRepo}/${githubBranch}/${file.path}`;
          const contentRes = await axios.get(fileUrl, { headers });
          const content = typeof contentRes.data === 'object' ? JSON.stringify(contentRes.data, null, 2) : contentRes.data;
          await indexFile(file.path, content);
        } catch (fileErr) {
          console.error(`❌ Failed to fetch and index GitHub file ${file.path}:`, fileErr.message);
        }
      }
    } catch (err) {
      console.error("❌ GitHub indexing failed:", err.message);
    }
  } else {
    // Local Scan Mode
    const localRepoPath = process.env.REPO_PATH || path.join(__dirname, '..', 'repo', 'nextjs-dnd', 'src');
    console.log(`💻 Local Mode: Scanning directory: ${localRepoPath}...`);
    
    if (!fs.existsSync(localRepoPath)) {
      console.error(`❌ Local directory does not exist: ${localRepoPath}`);
      return;
    }

    const files = scanLocalDirectory(localRepoPath);
    console.log(`Found ${files.length} indexable files locally.`);

    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const relativePath = path.relative(path.join(__dirname, '..', 'repo', 'nextjs-dnd'), filePath);
        await indexFile(relativePath, content);
      } catch (err) {
        console.error(`❌ Failed to read and index local file ${filePath}:`, err.message);
      }
    }
  }

  console.log("✅ Repository Indexing Completed successfully.");
}

// Check if run directly
if (require.main === module) {
  runIndexer().catch(err => {
    console.error("❌ Indexer crashed:", err);
    process.exit(1);
  });
}

module.exports = {
  runIndexer,
  indexFile
};
