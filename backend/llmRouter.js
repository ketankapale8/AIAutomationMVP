// backend/llmRouter.js
// LLM Router — selects and calls the appropriate provider based on tier + config.
// Reads the provider chain from config.yaml, tries each in order until one succeeds.
//
// Tiers:
//   fast     → Bug, Task, Sub-task (low-latency, low-cost)
//   balanced → Story, Improvement (mid-tier quality)
//   deep     → Epic, Architecture, New Feature (highest quality)

const axios = require('axios');
const { getLLMProviders } = require('./configLoader');
const { estimateTokens } = require('./promptBuilder');

/**
 * Calls a specific LLM provider.
 * @param {object} provider   Provider config from config.yaml
 * @param {string} prompt
 * @returns {{ text: string, provider: string, model: string }}
 */
async function callProvider(provider, prompt) {
  const envKey = provider.envKey;
  const apiKey = envKey ? process.env[envKey] : null;

  switch (provider.name) {
    case 'groq': {
      if (!apiKey) throw new Error('GROQ_API_KEY not set');
      const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: provider.model || 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2048
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000
      });
      return { text: res.data.choices[0].message.content, provider: 'groq', model: provider.model };
    }

    case 'gemini': {
      if (!apiKey) throw new Error('GEMINI_API_KEY not set');
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model || 'gemini-1.5-flash'}:generateContent?key=${apiKey}`;
      const res = await axios.post(geminiUrl, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
      }, { timeout: 45000 });
      const candidates = res.data.candidates;
      if (!candidates || !candidates[0] || !candidates[0].content) {
        throw new Error('Unexpected Gemini response structure: ' + JSON.stringify(res.data).slice(0, 200));
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
      const res = await axios.post(`${baseUrl}/api/chat`, {
        model: provider.model || 'llama3',
        messages: [{ role: 'user', content: prompt }],
        stream: false
      }, { timeout: 120000 });
      return { text: res.data.message.content, provider: 'ollama', model: provider.model };
    }

    default:
      throw new Error(`Unknown LLM provider: ${provider.name}`);
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

  let lastError = null;

  for (const provider of providers) {
    try {
      console.log(`  ↳ Trying ${provider.name} (${provider.model})...`);
      const result = await callProvider(provider, prompt);
      const outputTokens = estimateTokens(result.text);
      console.log(`  ✅ ${provider.name} responded. ~${outputTokens} output tokens.`);
      return {
        text: result.text,
        provider: result.provider,
        model: result.model,
        inputTokens,
        outputTokens
      };
    } catch (err) {
      lastError = err;
      const isConfigError = err.message.includes('not set') || err.message.includes('API key');
      if (isConfigError) {
        console.log(`  ⏭️  ${provider.name}: skipped (${err.message})`);
      } else {
        console.error(`  ❌ ${provider.name} failed: ${err.message}`);
      }
    }
  }

  // All providers exhausted
  throw new Error(`All LLM providers failed for tier "${tier}". Last error: ${lastError ? lastError.message : 'unknown'}`);
}

module.exports = {
  routeToLLM
};
