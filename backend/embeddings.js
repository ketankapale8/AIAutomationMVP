// backend/embeddings.js
// Embedding provider with:
//   - Local-first ordering (Ollama → Gemini → OpenAI) to ensure consistent dimensions
//   - Circuit breaker per provider (skip downed providers for 5 min)
//   - Fast health check before slow Ollama timeout
//   - Degraded mode: returns null so caller can run LLM-only analysis
//
// ⚠️  DIMENSION CONSISTENCY RULE:
//   LanceDB stores a fixed vector dimension per table.
//   The SAME provider must be used for both INDEXING and QUERYING.
//   Changing providers after indexing requires re-running the indexer.
//   The active provider is logged at startup so mismatches are obvious.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Manually load .env for standalone CLI use (indexer.js)
if (fs.existsSync(path.join(__dirname, '.env'))) {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
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
  } catch (_) {}
}

// ── Circuit Breaker ───────────────────────────────────────────
// Tracks provider failures. Skips a provider for CIRCUIT_RESET_MS after failure.
const CIRCUIT_RESET_MS = 5 * 60 * 1000; // 5 minutes
const _circuitBreaker = {}; // { providerName: { failedAt: Date, failCount: number } }

function isCircuitOpen(name) {
  const state = _circuitBreaker[name];
  if (!state) return false;
  const elapsed = Date.now() - state.failedAt;
  if (elapsed > CIRCUIT_RESET_MS) {
    delete _circuitBreaker[name]; // reset after cool-down
    return false;
  }
  return true;
}

function openCircuit(name) {
  _circuitBreaker[name] = { failedAt: Date.now() };
  console.warn(`  ⚡ Circuit open for "${name}" embeddings — skipping for ${CIRCUIT_RESET_MS / 60000} min`);
}

// ── Fast Ollama health check ──────────────────────────────────
// Checks port 11434 before attempting a full embedding call.
// Returns true if Ollama is reachable (HTTP 200 on /api/tags).
async function isOllamaReachable() {
  try {
    const baseUrl = (process.env.OLLAMA_URL || 'http://localhost:11434');
    await axios.get(`${baseUrl}/api/tags`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ── Provider implementations ──────────────────────────────────

async function embedWithOllama(text) {
  const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model   = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  const timeout = parseInt(process.env.OLLAMA_EMBED_TIMEOUT_MS || '30000', 10);

  const res = await axios.post(`${baseUrl}/api/embeddings`, {
    model,
    prompt: text
  }, { timeout });

  if (!res.data?.embedding) throw new Error('No embedding in Ollama response');
  return { vector: res.data.embedding, provider: 'ollama', model, dims: res.data.embedding.length };
}

async function embedWithGemini(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`;
  const res = await axios.post(url, {
    model: 'models/text-embedding-004',
    content: { parts: [{ text }] }
  }, { timeout: 15000 });

  const values = res.data?.embedding?.values;
  if (!values) throw new Error('No embedding in Gemini response');
  return { vector: values, provider: 'gemini', model: 'text-embedding-004', dims: values.length };
}

async function embedWithOpenAI(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');

  const res = await axios.post('https://api.openai.com/v1/embeddings', {
    model: 'text-embedding-3-small',
    input: text
  }, {
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    timeout: 15000
  });

  const vector = res.data?.data?.[0]?.embedding;
  if (!vector) throw new Error('No embedding in OpenAI response');
  return { vector, provider: 'openai', model: 'text-embedding-3-small', dims: vector.length };
}

// ── Main embedText function ───────────────────────────────────

let _firstCallDone = false;

/**
 * Generates a vector embedding for the given text.
 * Provider priority: Ollama (local) → Gemini → OpenAI
 * This order MUST match the order used during indexing (same dims required).
 *
 * Returns the embedding vector, or null if all providers are unavailable
 * (caller should proceed in degraded mode — LLM analysis without code context).
 *
 * @param {string} text
 * @returns {Promise<number[] | null>}
 */
async function embedText(text) {
  if (!text || !text.trim()) return new Array(768).fill(0);

  // ── Provider 1: Ollama (local, 768 dims, free, offline) ──────
  if (!isCircuitOpen('ollama')) {
    const reachable = await isOllamaReachable();
    if (reachable) {
      try {
        const result = await embedWithOllama(text);
        if (!_firstCallDone) {
          console.log(`🧲 Embedding: ${result.provider}/${result.model} (${result.dims} dims)`);
          _firstCallDone = true;
        }
        return result.vector;
      } catch (err) {
        console.warn(`  ⚠️  Ollama embedding failed: ${err.message}`);
        openCircuit('ollama');
      }
    } else {
      console.warn('  ⚠️  Ollama not reachable (port 11434) — skipping');
      openCircuit('ollama');
    }
  }

  // ── Provider 2: Gemini (768 dims — same as nomic, compatible!) ──
  if (process.env.GEMINI_API_KEY && !isCircuitOpen('gemini')) {
    try {
      const result = await embedWithGemini(text);
      if (!_firstCallDone) {
        console.log(`🧲 Embedding: ${result.provider}/${result.model} (${result.dims} dims)`);
        _firstCallDone = true;
      }
      return result.vector;
    } catch (err) {
      console.warn(`  ⚠️  Gemini embedding failed: ${err.message}`);
      openCircuit('gemini');
    }
  }

  // ── Provider 3: OpenAI (1536 dims — only if indexed with OpenAI!) ──
  if (process.env.OPENAI_API_KEY && !isCircuitOpen('openai')) {
    try {
      const result = await embedWithOpenAI(text);
      if (!_firstCallDone) {
        console.warn('⚠️  Using OpenAI embeddings (1536 dims). Only works if repo was also indexed with OpenAI.');
        _firstCallDone = true;
      }
      return result.vector;
    } catch (err) {
      console.warn(`  ⚠️  OpenAI embedding failed: ${err.message}`);
      openCircuit('openai');
    }
  }

  // ── All providers failed — degraded mode ─────────────────────
  console.warn('\n⚠️  All embedding providers unavailable. Falling back to LLM-only analysis (no code context).');
  console.warn('   To fix: start Ollama, or add GEMINI_API_KEY / OPENAI_API_KEY to .env\n');
  return null; // Signal degraded mode to caller
}

module.exports = { embedText };
