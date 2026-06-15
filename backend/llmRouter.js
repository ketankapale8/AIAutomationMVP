// backend/llmRouter.js
// LLM Router — selects and calls the appropriate provider based on tier + config.
// Reads the provider chain from config.yaml, tries each in order until one succeeds.
//
// Strategy:
//   LOCAL mode  → ollama first (free, offline). Cloud = fallback only if Ollama fails.
//   DEMO mode   → add GROQ_API_KEY to .env → Groq activates automatically (~7s)
//   PAID mode   → add ANTHROPIC_API_KEY → Claude used for best quality
//
// Circuit Breaker: after a provider fails (non-config error), it is skipped
// for CIRCUIT_RESET_MS (5 min) to avoid hammering a downed service on every ticket.

const axios = require('axios');
const { getLLMProviders, getConfig } = require('./configLoader');
const { estimateTokens } = require('./promptBuilder');
const { getDailyCloudTokenUsage } = require('./db');

// ── Circuit Breaker ───────────────────────────────────────────
const CIRCUIT_RESET_MS = 5 * 60 * 1000;
const _circuit = {};

function isCircuitOpen(name) {
  const s = _circuit[name];
  if (!s) return false;
  if (Date.now() - s.failedAt > CIRCUIT_RESET_MS) { delete _circuit[name]; return false; }
  return true;
}

function openCircuit(name) {
  _circuit[name] = { failedAt: Date.now() };
  console.warn(`  ⚡ LLM circuit open for "${name}" — skipping for ${CIRCUIT_RESET_MS/60000} min`);
}

/**
 * Returns true if the error is an HTTP 429 Rate Limit response.
 * 429 is transient — it means the provider is temporarily at capacity,
 * NOT that the provider is broken. We skip it for this request only,
 * WITHOUT opening the circuit breaker.
 */
function isRateLimitError(err) {
  // Axios wraps HTTP errors in err.response
  return err?.response?.status === 429;
}

/**
 * Calls a specific LLM provider.
 * @param {object} provider   Provider config from config.yaml
 * @param {string} prompt
 * @returns {{ text: string, provider: string, model: string }}
 */
async function callProvider(provider, prompt) {
  const envKey = provider.envKey;
  const apiKey = envKey ? process.env[envKey] : null;

  const MAX_RETRIES = 3;
  const BACKOFF_FACTOR = 2;
  const INITIAL_DELAY_MS = 1500;

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      switch (provider.name) {
        case 'groq': {
          if (!apiKey) throw new Error('GROQ_API_KEY not set');
          const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: provider.model || 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            max_tokens: 2048
          }, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: 30000
          });
          return { text: res.data.choices[0].message.content, provider: 'groq', model: provider.model };
        }

        case 'anthropic': {
          if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
          const res = await axios.post('https://api.anthropic.com/v1/messages', {
            model: provider.model || 'claude-3-5-haiku-20241022',
            max_tokens: 2048,
            messages: [{ role: 'user', content: prompt }]
          }, {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json'
            },
            timeout: 60000
          });
          const text = res.data.content?.[0]?.text;
          if (!text) throw new Error('Unexpected Anthropic response: ' + JSON.stringify(res.data).slice(0, 200));
          return { text, provider: 'anthropic', model: provider.model };
        }

        case 'gemini': {
          if (!apiKey) throw new Error('GEMINI_API_KEY not set');
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model || 'gemini-1.5-flash'}:generateContent?key=${apiKey}`;
          const res = await axios.post(geminiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
          }, { timeout: 45000 });
          const candidates = res.data.candidates;
          if (!candidates?.[0]?.content) {
            throw new Error('Unexpected Gemini response: ' + JSON.stringify(res.data).slice(0, 200));
          }
          return { text: candidates[0].content.parts[0].text, provider: 'gemini', model: provider.model };
        }

        case 'openai': {
          if (!apiKey) throw new Error('OPENAI_API_KEY not set');
          const res = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: provider.model || 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            max_tokens: 2048
          }, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: 60000
          });
          return { text: res.data.choices[0].message.content, provider: 'openai', model: provider.model };
        }

        case 'deepseek': {
          if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');
          const res = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: provider.model || 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            max_tokens: 2048
          }, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: 60000
          });
          return { text: res.data.choices[0].message.content, provider: 'deepseek', model: provider.model };
        }

        case 'ollama': {
          const baseUrl = provider.baseUrl || 'http://localhost:11434';
          const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '240000', 10);
          const res = await axios.post(`${baseUrl}/api/chat`, {
            model: provider.model || 'llama3',
            messages: [{ role: 'user', content: prompt }],
            stream: false
          }, { timeout: timeoutMs });
          return { text: res.data.message.content, provider: 'ollama', model: provider.model };
        }

        default:
          throw new Error(`Unknown LLM provider: ${provider.name}`);
      }
    } catch (err) {
      const isRateLimit = isRateLimitError(err);
      const isNetworkTimeoutOrError = err.code === 'ECONNABORTED' || err.message?.includes('timeout') || err.message?.includes('Network Error');
      
      // Retry ONLY on transient issues: 429 rate limit or network timeout
      if ((isRateLimit || isNetworkTimeoutOrError) && attempt < MAX_RETRIES) {
        const delay = INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt - 1);
        console.warn(`  ⏳ [Retry] ${provider.name} failed: ${err.message}. Retrying attempt ${attempt}/${MAX_RETRIES} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw err; // Final attempt failed or error is non-transient, bubble it up
      }
    }
  }
}

/**
 * Routes the prompt to the appropriate LLM tier, trying each provider in order.
 * @param {string} prompt    The assembled prompt string
 * @param {string} tier      'fast' | 'balanced' | 'deep'
 * @returns {{ text: string, provider: string, model: string, inputTokens: number, outputTokens: number }}
 */
async function routeToLLM(prompt, tier = 'fast') {
  const providers = getLLMProviders(tier);
  const inputTokens = estimateTokens(prompt);

  console.log(`🤖 LLM Router: tier="${tier}", providers=${providers.map(p => p.name).join(' → ')}, ~${inputTokens} input tokens`);

  const config = getConfig();
  const limit = config.llm?.dailyCloudTokenLimit || 0;
  let forceLocal = false;
  if (limit > 0) {
    const dailyUsage = getDailyCloudTokenUsage();
    if (dailyUsage >= limit) {
      console.log(`⚠️ Cloud token limit reached (${dailyUsage}/${limit}). Forcing local fallback.`);
      forceLocal = true;
    }
  }

  let lastError = null;

  for (const provider of providers) {
    const isConfigError = (msg) => msg.includes('not set') || msg.includes('API key');

    // Force local if cloud token limit reached
    if (forceLocal && !provider.name.startsWith('ollama')) {
      console.log(`  ⏭️  ${provider.name}: skipped (Cloud limit reached)`);
      continue;
    }

    // Skip providers whose API key isn't set
    if (provider.envKey && !process.env[provider.envKey]) {
      console.log(`  ⏭️  ${provider.name}: skipped (${provider.envKey} not set)`);
      continue;
    }

    // Skip providers that recently failed (circuit breaker)
    if (isCircuitOpen(provider.name)) {
      console.log(`  ⚡ ${provider.name}: circuit open — skipping`);
      continue;
    }

    try {
      console.log(`  ↳ Trying ${provider.name} (${provider.model})...`);
      const result = await callProvider(provider, prompt);
      const outputTokens = estimateTokens(result.text);
      console.log(`  ✅ ${provider.name} responded. ~${outputTokens} output tokens.`);
      return { text: result.text, provider: result.provider, model: result.model, inputTokens, outputTokens };
    } catch (err) {
      lastError = err;
      if (isConfigError(err.message)) {
        // Missing API key — skip silently
        console.log(`  ⏭️  ${provider.name}: skipped (${err.message})`);
      } else if (isRateLimitError(err)) {
        // 429 Rate Limit — transient, skip for this request only (DO NOT open circuit)
        const retryAfter = err.response?.headers?.['retry-after'];
        console.warn(`  ⏳ ${provider.name}: rate-limited (429)${retryAfter ? ` — retry-after: ${retryAfter}s` : ''}. Falling back to next provider.`);
      } else {
        // Genuine failure (timeout, 500, connection error) — open circuit for 5 min
        console.error(`  ❌ ${provider.name} failed: ${err.message}`);
        openCircuit(provider.name);
      }
    }
  }

  // All providers exhausted — give actionable guidance
  throw new Error(
    `All LLM providers exhausted for tier "${tier}". ` +
    `Last error: ${lastError?.message || 'unknown'}. ` +
    `Fix: Start Ollama (ollama serve) OR add GROQ_API_KEY / ANTHROPIC_API_KEY to .env`
  );
}

/**
 * Classifies a ticket's complexity using the fast model.
 * Returns 'balanced' (for complex tickets that need Deepseek) or 'fast' (for simple fixes that need Qwen).
 * @param {string} title 
 * @param {string} description 
 * @returns {Promise<'fast'|'balanced'>}
 */
async function classifyTicketComplexity(title, description) {
  const classificationPrompt = `You are a triage assistant. Read this software ticket and classify its complexity.
If it is a bug fix, syntax correction, wording tweak, minor refactoring, configuration adjustment, writing test cases, writing unit tests, or has very simple changes, output exactly: SIMPLE.
If it requires creating brand new features, implementing new screens/APIs, doing complex integrations, writing new pages, or changing major files, output exactly: COMPLEX.

Ticket Title: ${title}
Description: ${description}

Output ONLY "SIMPLE" or "COMPLEX" (no other text).`;

  try {
    console.log(`🤖 Classifying ticket complexity...`);
    const result = await routeToLLM(classificationPrompt, 'fast');
    const answer = (result.text || '').trim().toUpperCase();
    console.log(`📊 Classifier output: "${answer}"`);
    return answer.includes('COMPLEX') ? 'balanced' : 'fast';
  } catch (err) {
    console.warn('⚠️ Complexity classification failed (defaulting to fast tier):', err.message);
    return 'fast';
  }
}

module.exports = {
  routeToLLM,
  classifyTicketComplexity
};
