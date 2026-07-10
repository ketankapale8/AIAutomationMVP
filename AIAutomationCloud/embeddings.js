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
// PKG: __dirname is virtual snapshot path; use process.execPath dir for real .env location
const APP_DIR = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;

if (fs.existsSync(path.join(APP_DIR, '.env'))) {
  try {
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`;
  
  // Gemini free tier = 15 RPM. On 429, wait a full 65s (minute reset) before retrying.
  // Short exponential backoff (2s→4s→8s→16s) is NOT enough for RPM limits.
  const RATE_LIMIT_WAIT_MS = 65000; // 65 seconds — full minute reset
  let retries = 3;
  
  while (true) {
    try {
      const res = await axios.post(url, {
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: 768
      }, { timeout: 15000 });

      const values = res.data?.embedding?.values;
      if (!values) throw new Error('No embedding in Gemini response');
      return { vector: values, provider: 'gemini', model: 'gemini-embedding-001', dims: values.length };
    } catch (err) {
      const isRateLimit = err.response?.status === 429;
      if (isRateLimit && retries > 0) {
        console.warn(`  ⚠️  Gemini rate limit hit (429). Waiting ${RATE_LIMIT_WAIT_MS / 1000}s for RPM window to reset... (${retries} retries left)`);
        // Reset the global throttle clock so the next call after this wait is also properly spaced
        _lastRequestTime = Date.now() + RATE_LIMIT_WAIT_MS - MIN_GAP_MS;
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
        retries--;
        continue;
      }
      throw err; // Throw any other error or if retries run out
    }
  }
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

// ── Global Rate Limiting Throttle ─────────────────────────────
// Gemini free tier enforces 15 RPM (Requests Per Minute) = 1 request per 4s.
// We enforce 1 every 7 seconds (≈8.5 RPM) to safely stay under the limit.
let _lastRequestTime = 0;
const MIN_GAP_MS = 7000; // 7s gap = ~8.5 RPM, safely under the 15 RPM limit

async function throttleRequest() {
  const now = Date.now();
  const elapsed = now - _lastRequestTime;
  if (elapsed < MIN_GAP_MS) {
    const waitTime = MIN_GAP_MS - elapsed;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  _lastRequestTime = Date.now();
}

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

  // ── Provider 1: Gemini (768 dims — free, fast, cloud) ──
  if (process.env.GEMINI_API_KEY && !isCircuitOpen('gemini')) {
    try {
      await throttleRequest(); // Enforce strict 5s spacing between calls
      const result = await embedWithGemini(text);
      if (!_firstCallDone) {
        console.log(`🧲 Embedding: ${result.provider}/${result.model} (${result.dims} dims)`);
        _firstCallDone = true;
      }
      return result.vector;
    } catch (err) {
      console.warn(`  ⚠️  Gemini embedding failed: ${err.message}`);
      // Do NOT open circuit for Gemini during indexing — temporary rate limits shouldn't disable it completely
    }
  }

  // ── Provider 2: Ollama (local fallback, 768 dims, free, offline) ──────
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
