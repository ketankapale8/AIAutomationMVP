// backend/embeddings.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Manually load env variables if running standalone CLI indexer
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

/**
 * Generates vector embeddings for a given text.
 * @param {string} text - The input text to embed.
 * @returns {Promise<Array<number>>} The vector embedding array.
 */
async function embedText(text) {
  if (!text || text.trim() === '') {
    return new Array(768).fill(0); // return dummy vector
  }

  // 1. OpenAI Embeddings
  if (process.env.OPENAI_API_KEY) {
    try {
      const response = await axios.post('https://api.openai.com/v1/embeddings', {
        model: 'text-embedding-3-small',
        input: text
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.data && response.data.data && response.data.data[0]) {
        return response.data.data[0].embedding;
      }
      throw new Error("Invalid response format from OpenAI embeddings API.");
    } catch (err) {
      console.error("OpenAI Embedding error details:", err.response ? err.response.data : err.message);
      throw err;
    }
  }

  // 2. Google Gemini Embeddings
  if (process.env.GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`;
      const response = await axios.post(url, {
        model: "models/text-embedding-004",
        content: {
          parts: [{ text: text }]
        }
      });
      if (response.data && response.data.embedding && response.data.embedding.values) {
        return response.data.embedding.values;
      }
      throw new Error("Invalid response format from Gemini embeddings API: " + JSON.stringify(response.data));
    } catch (err) {
      console.error("Gemini Embedding error details:", err.response ? err.response.data : err.message);
      throw err;
    }
  }

  // 3. Local Ollama Fallback
  const ollamaUrl = process.env.OLLAMA_EMBED_URL || 'http://localhost:11434/api/embeddings';
  const ollamaModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  try {
    const response = await axios.post(ollamaUrl, {
      model: ollamaModel,
      prompt: text
    });
    if (response.data && response.data.embedding) {
      return response.data.embedding;
    }
    throw new Error("Invalid response format from Ollama embeddings API.");
  } catch (err) {
    console.error(`Ollama Embedding error details: ${err.message}. Ensure Ollama is running with ${ollamaModel} loaded.`);
    throw new Error(`Failed to generate embeddings. Set OPENAI_API_KEY, GEMINI_API_KEY or start Ollama. Error: ${err.message}`);
  }
}

module.exports = {
  embedText
};
