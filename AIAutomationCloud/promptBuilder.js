// backend/promptBuilder.js
// Dual-format prompt builder with token budget controller.
//
// Format A — Bug / Task / Sub-task:
//   ~2,150 input tokens: 200 ticket + 1,800 code context + 150 instructions
//   Output: file table + targeted code snippets + line references
//
// Format B — Story / Feature / Epic / New Feature:
//   ~2,950 input tokens: 350 ticket + 2,400 code context + 200 instructions
//   Output: full design blueprint — files to create, files to modify, API contracts, implementation steps, test strategy
//
// Token estimation: ~4 chars ≈ 1 token (GPT-style approximation)

const fs = require('fs');
const path = require('path');
const CHARS_PER_TOKEN = 4;

// ── File Tree Generator (Anti-Hallucination) ─────────────────

function getFileTree(dirPath, depth = 0, maxDepth = 4) {
  if (!dirPath || !fs.existsSync(dirPath) || depth > maxDepth) return '';
  let tree = '';
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    // Common ignores
    const ignore = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
    
    for (const item of items) {
      if (ignore.has(item.name)) continue;
      const indent = '  '.repeat(depth);
      if (item.isDirectory()) {
        tree += `${indent}📁 ${item.name}/\n`;
        tree += getFileTree(path.join(dirPath, item.name), depth + 1, maxDepth);
      } else {
        tree += `${indent}📄 ${item.name}\n`;
      }
    }
  } catch (err) { return ''; }
  return tree;
}

// ── Ticket type classification ───────────────────────────────

const FORMAT_A_TYPES = new Set([
  'bug', 'task', 'sub-task', 'subtask', 'hotfix', 'defect', 'fix', 'chore', 'technical debt'
]);

const FORMAT_B_TYPES = new Set([
  'story', 'feature', 'new feature', 'epic', 'improvement', 'enhancement',
  'initiative', 'architecture', 'spike', 'research'
]);

/**
 * Determines which output format to use based on the Jira issue type.
 * @param {string} issueType  e.g. "Bug", "Story", "Epic"
 * @returns {'A'|'B'}
 */
function detectFormat(issueType) {
  const normalized = (issueType || '').toLowerCase().trim();
  if (FORMAT_B_TYPES.has(normalized)) return 'B';
  if (FORMAT_A_TYPES.has(normalized)) return 'A';
  // Default: if unknown issue type, use A (conservative)
  return 'A';
}

/**
 * Determines which LLM tier to use based on the issue type.
 * @param {string} issueType
 * @returns {'fast'|'balanced'|'deep'}
 */
function detectLLMTier(issueType) {
  const normalized = (issueType || '').toLowerCase().trim();
  if (['epic', 'architecture', 'initiative', 'research', 'spike'].includes(normalized)) return 'deep';
  if (['story', 'feature', 'new feature', 'improvement', 'enhancement'].includes(normalized)) return 'balanced';
  return 'fast';
}

// ── Code context compression ─────────────────────────────────

/**
 * Strips single-line (//) and multi-line (/* *\/) comments from code.
 * Preserves URL protocols (http://) and shebangs (#!).
 * @param {string} content
 * @returns {string}
 */
function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')          // Multi-line /* ... */
    .replace(/([^:]|^)\/\/(?!http).*$/gm, '$1') // Single-line // (not URLs)
    .replace(/#.*$/gm, '');                     // Python/shell # comments
}

/**
 * Collapses consecutive blank lines to a single blank line.
 * @param {string} content
 * @returns {string}
 */
function collapseBlankLines(content) {
  return content.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Compresses a code chunk to reduce token usage.
 * @param {string} content
 * @returns {string}
 */
function compressChunk(content) {
  return collapseBlankLines(stripComments(content));
}

/**
 * Estimates the token count for a string (4 chars ≈ 1 token).
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

/**
 * Selects and compresses the top chunks to fit within the code token budget.
 * @param {Array<object>} chunks   Sorted by relevance (most relevant first)
 * @param {number} maxTokens       Max tokens for code context
 * @returns {{ contextText: string, usedChunks: number, totalTokens: number }}
 */
function buildCodeContext(chunks, maxTokens) {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  let totalChars = 0;
  let usedChunks = 0;
  const parts = [];

  for (const chunk of chunks) {
    const compressed = compressChunk(chunk.content);
    if (!compressed.trim()) continue;

    const header = `--- File: ${chunk.filePath} | Lines: ${chunk.startLine}-${chunk.endLine}${chunk.symbolName ? ` | Symbol: ${chunk.symbolName}` : ''} ---\n`;
    const block = header + compressed;
    const blockChars = block.length;

    if (totalChars + blockChars > maxChars) {
      // Try to fit a truncated version
      const remaining = maxChars - totalChars - header.length - 40;
      if (remaining > 200) {
        parts.push(header + compressed.slice(0, remaining) + '\n... [truncated]');
        totalChars += remaining + header.length + 40;
        usedChunks++;
      }
      break;
    }

    parts.push(block);
    totalChars += blockChars;
    usedChunks++;
  }

  return {
    contextText: parts.join('\n\n'),
    usedChunks,
    totalTokens: estimateTokens(parts.join('\n\n'))
  };
}

// ── Format A Prompt (Bug / Task) ─────────────────────────────

function buildFormatAPrompt(params) {
  const { title, description, issueType, contextText } = params;
  return `You are an expert AI Technical Analyst embedded in a software team's CI/CD pipeline.
A Jira ${issueType || 'ticket'} has been received. Perform a concise technical analysis.

## Jira Ticket
**Title:** ${title}
**Type:** ${issueType || 'Unknown'}
**Description:**
${description}

## Relevant Codebase Context
${contextText || 'No relevant code context found. Run the indexer first.'}

## Repository File Structure (DO NOT INVENT FILES)
\`\`\`
${params.fileTree || 'File tree unavailable.'}
\`\`\`

---
Respond ONLY using the exact headings below. Be concise and precise. Reference specific file names and line numbers.

## 1. Scope
One paragraph: what is in-scope for this ticket.

## 2. Change Type
State: Functionality Change / Core System Change / Configuration Change / Documentation.

## 3. Feasibility & Priority
Short assessment (2–3 sentences) of implementation effort and risk.

## 4. Files to Modify
| File | Lines | Change Required |
|------|-------|-----------------|
(Fill this table. Max 10 rows.)

## 5. Code Recommendations
Provide the exact code changes needed. Use code blocks with the language and file path:
\`\`\`typescript:path/to/file.ts
// code here
\`\`\`
Keep total code snippets under 200 lines.

**CONSTRAINTS:**
1. Total response must be under 400 words. No conversational filler.
2. CRITICAL: DO NOT INVENT OR GUESS FILE PATHS. You must ONLY suggest modifying files that are explicitly listed in the "Relevant Codebase Context" above. If you need to create a new file, use a realistic path based on the context.`;
}

// ── Format B Prompt (Feature / Epic) ─────────────────────────

function buildFormatBPrompt(params) {
  const { title, description, issueType, contextText } = params;
  return `You are a Principal Software Architect reviewing a Jira ${issueType || 'feature'} ticket.
Your job is to produce a comprehensive technical design and implementation blueprint.

## Jira Ticket
**Title:** ${title}
**Type:** ${issueType || 'Unknown'}
**Description:**
${description}

## Existing Codebase Context (Relevant Sections)
${contextText || 'No relevant code context found. Run the indexer first.'}

## Repository File Structure (DO NOT INVENT FILES)
\`\`\`
${params.fileTree || 'File tree unavailable.'}
\`\`\`

---
Respond ONLY using the exact headings below. Be thorough but concise.

## 1. Feature Overview
What the feature does and why it's needed (2–3 sentences).

## 2. Architecture Impact
Which layers are affected: Frontend / Backend / Database / Infrastructure / External APIs.

## 3. Files to Create (NEW)
| File Path | Purpose |
|-----------|---------|
(List all new files to create.)

## 4. Files to Modify (EXISTING)
| File | Section/Function | Change Required |
|------|-----------------|-----------------|
(List all files that need changes.)

## 5. API Contracts
For any new or changed endpoints, provide:
- Method + path
- Request body schema (JSON)
- Response body schema (JSON)
- Auth required (yes/no)

## 6. Implementation Steps
Numbered step-by-step developer guide (ordered by dependency). Each step should reference specific files.

## 7. Data Model Changes
Any new tables, columns, or schema changes needed.

## 8. Test Strategy
| Test Type | What to Test | File |
|-----------|-------------|------|

## 9. Open Questions / Risks
Any ambiguities, dependencies, or risks the team should resolve before starting.

**CONSTRAINTS:** 
1. Response should be 600–900 words. Use code examples sparingly (only for API schemas or complex logic).
2. CRITICAL: DO NOT INVENT OR GUESS EXISTING FILE PATHS. When listing "Files to Modify", you must ONLY list files that explicitly appear in the "Existing Codebase Context" above.`;
}

// ── Main export ───────────────────────────────────────────────

/**
 * Builds the full LLM prompt for a ticket with token-budgeted code context.
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.description
 * @param {string} params.issueType       e.g. "Bug", "Story", "Epic"
 * @param {Array<object>} params.chunks   Ranked code chunks from vector search
 * @param {object} [params.tokenBudget]   Optional override from config
 * @returns {{ prompt: string, format: string, tier: string, estimatedTokens: number }}
 */
function buildPrompt({ title, description, issueType, chunks, tokenBudget, repoPath }) {
  // Fallback title keyword upgrade: if issueType says Task/Bug but title starts with Story/Feature/Epic, override type
  let resolvedType = issueType || 'Task';
  const cleanTitle = (title || '').toLowerCase().trim();
  if (cleanTitle.startsWith('story:') || cleanTitle.startsWith('story ')) {
    resolvedType = 'Story';
  } else if (cleanTitle.startsWith('feature:') || cleanTitle.startsWith('feature ')) {
    resolvedType = 'Feature';
  } else if (cleanTitle.startsWith('epic:') || cleanTitle.startsWith('epic ')) {
    resolvedType = 'Epic';
  }

  const format = detectFormat(resolvedType);
  const tier = detectLLMTier(resolvedType);

  const fileTree = repoPath ? getFileTree(repoPath, 0, 3) : '';

  // Token budgets
  const budget = tokenBudget || {};
  const codeTokens = budget.codeTokens || (format === 'B' ? 2400 : 1800);

  const { contextText, usedChunks, totalTokens: codeTokensUsed } = buildCodeContext(chunks || [], codeTokens);

  const ticketText = `${title}\n${description}`;
  const ticketTokens = estimateTokens(ticketText);

  let prompt;
  if (format === 'A') {
    prompt = buildFormatAPrompt({ title, description, issueType, contextText, fileTree });
  } else {
    prompt = buildFormatBPrompt({ title, description, issueType, contextText, fileTree });
  }

  const totalEstimatedTokens = estimateTokens(prompt);

  console.log(`📊 Prompt Builder: Format=${format}, Tier=${tier}, Chunks=${usedChunks}, ~${totalEstimatedTokens} input tokens`);

  return {
    prompt,
    format,
    tier,
    estimatedInputTokens: totalEstimatedTokens,
    usedChunks
  };
}

module.exports = {
  buildPrompt,
  detectFormat,
  detectLLMTier,
  estimateTokens,
  compressChunk
};
