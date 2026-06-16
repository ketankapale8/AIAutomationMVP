// backend/vectorStore.js
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'vector_store.json');

class LocalVectorStore {
  constructor() {
    this.documents = [];
    this.load();
  }

  // Normalize file paths to forward slashes for cross-platform consistency
  normalizePath(filePath) {
    if (!filePath) return '';
    return filePath.replace(/\\/g, '/');
  }

  load() {
    if (fs.existsSync(STORE_PATH)) {
      try {
        const data = fs.readFileSync(STORE_PATH, 'utf8');
        this.documents = JSON.parse(data);
        console.log(`📂 Loaded vector store: ${this.documents.length} chunks.`);
      } catch (err) {
        console.error(`⚠️ Error loading vector store from ${STORE_PATH}:`, err.message);
        this.documents = [];
      }
    } else {
      this.documents = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.documents, null, 2), 'utf8');
      console.log(`💾 Saved vector store: ${this.documents.length} chunks.`);
    } catch (err) {
      console.error(`❌ Failed to save vector store to ${STORE_PATH}:`, err.message);
    }
  }

  addDocuments(newDocs) {
    // newDocs is an array of objects: { filePath, content, startLine, endLine, embedding }
    const formattedDocs = newDocs.map(doc => ({
      ...doc,
      filePath: this.normalizePath(doc.filePath)
    }));
    this.documents.push(...formattedDocs);
    this.save();
  }

  removeDocumentsForFile(filePath) {
    const normalized = this.normalizePath(filePath);
    const initialCount = this.documents.length;
    this.documents = this.documents.filter(doc => doc.filePath !== normalized);
    const removedCount = initialCount - this.documents.length;
    if (removedCount > 0) {
      console.log(`🗑️ Removed ${removedCount} chunks for file ${normalized}.`);
      this.save();
    }
  }

  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  similaritySearch(queryEmbedding, k = 10) {
    if (!queryEmbedding) return [];
    
    const scores = this.documents.map(doc => {
      const score = this.cosineSimilarity(queryEmbedding, doc.embedding);
      return {
        document: {
          filePath: doc.filePath,
          content: doc.content,
          startLine: doc.startLine,
          endLine: doc.endLine
        },
        score
      };
    });

    // Sort by descending score
    scores.sort((a, b) => b.score - a.score);

    // Return the top k elements
    return scores.slice(0, k).map(item => item.document);
  }
}

module.exports = new LocalVectorStore();
