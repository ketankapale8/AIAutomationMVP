// backend/astChunker.js
// AST-aware code chunker — splits files at function/class/export boundaries.
// Produces richer metadata (symbolName, symbolType, language) vs character sliding window.
//
// Language support:
//   JavaScript / TypeScript / JSX / TSX → tree-sitter-javascript / tree-sitter-typescript
//   Python  → tree-sitter-python (if installed)
//   Generic fallback → 40-line windows for CSS, JSON, YAML, Markdown, etc.
//
// Usage:
//   const astChunker = require('./astChunker');
//   const chunks = astChunker.splitCodeIntoChunks('/path/to/file.ts', content);

const path = require('path');

// ── Language dispatch map ────────────────────────────────────
const EXT_TO_LANG = {
  '.js':   'javascript',
  '.jsx':  'javascript',
  '.ts':   'typescript',
  '.tsx':  'typescript',
  '.py':   'python',
  '.css':  'generic',
  '.json': 'generic',
  '.yaml': 'generic',
  '.yml':  'generic',
  '.md':   'generic',
  '.txt':  'generic'
};

// Node types that represent logical code symbols to split on
const SYMBOL_NODES = new Set([
  'function_declaration',
  'function_definition',       // Python
  'arrow_function',
  'method_definition',
  'class_declaration',
  'class_definition',          // Python
  'export_statement',
  'lexical_declaration',       // const/let at module level
  'variable_declaration'
]);

// Cache loaded parsers to avoid re-creating them
const _parsers = {};

/**
 * Tries to load a tree-sitter parser for the given language.
 * Returns null if tree-sitter or the grammar is not installed.
 */
function loadParser(lang) {
  if (_parsers[lang] !== undefined) return _parsers[lang];

  try {
    const Parser = require('tree-sitter');
    let Grammar;

    if (lang === 'javascript') {
      Grammar = require('tree-sitter-javascript');
    } else if (lang === 'typescript') {
      Grammar = require('tree-sitter-typescript').typescript;
    } else if (lang === 'python') {
      Grammar = require('tree-sitter-python');
    } else {
      _parsers[lang] = null;
      return null;
    }

    const parser = new Parser();
    parser.setLanguage(Grammar);
    _parsers[lang] = parser;
    return parser;
  } catch {
    // tree-sitter or grammar not installed → fall back to generic chunker
    _parsers[lang] = null;
    return null;
  }
}

/**
 * Converts a byte offset within source code to a line number (1-indexed).
 */
function offsetToLine(source, offset) {
  const sub = source.slice(0, offset);
  return sub.split('\n').length;
}

/**
 * Extracts the best human-readable name for a syntax node.
 */
function extractSymbolName(node, source) {
  // Look for a child named 'name' or 'identifier'
  for (const child of node.children) {
    if (child.type === 'identifier' || child.type === 'property_identifier') {
      return source.slice(child.startIndex, child.endIndex);
    }
    if (child.type === 'name') {
      return source.slice(child.startIndex, child.endIndex);
    }
  }
  return '';
}

/**
 * Recursively walks the AST and collects symbol-level chunks.
 * @param {SyntaxNode} node
 * @param {string} source
 * @param {string} filePath
 * @param {string} language
 * @param {Array} chunks   Output array (mutated)
 * @param {Set} usedRanges Already-covered byte ranges (to avoid duplication)
 */
function walkNode(node, source, filePath, language, chunks, usedRanges) {
  if (SYMBOL_NODES.has(node.type)) {
    const start = node.startIndex;
    const end = node.endIndex;

    // Skip if already covered by a parent node
    for (const [s, e] of usedRanges) {
      if (start >= s && end <= e) return;
    }

    usedRanges.add([start, end]);
    const content = source.slice(start, end);
    const startLine = offsetToLine(source, start);
    const endLine = offsetToLine(source, end);
    const symbolName = extractSymbolName(node, source);

    chunks.push({
      filePath,
      content,
      startLine,
      endLine,
      language,
      symbolName,
      symbolType: node.type
    });
    return; // Don't recurse further into symbol we just captured
  }

  for (const child of node.children) {
    walkNode(child, source, filePath, language, chunks, usedRanges);
  }
}

/**
 * Generic fallback chunker — 40-line sliding windows.
 * Used for CSS, JSON, Markdown, and any file where AST parsing is unavailable.
 */
function genericChunk(filePath, content, windowLines = 40, overlapLines = 8) {
  const lines = content.split('\n');
  const chunks = [];
  let i = 0;

  while (i < lines.length) {
    const sliceLines = lines.slice(i, i + windowLines);
    const chunkContent = sliceLines.join('\n');
    if (chunkContent.trim().length > 0) {
      chunks.push({
        filePath,
        content: chunkContent,
        startLine: i + 1,
        endLine: Math.min(i + windowLines, lines.length),
        language: 'generic',
        symbolName: '',
        symbolType: 'block'
      });
    }
    i += windowLines - overlapLines;
    if (i + overlapLines >= lines.length) break;
  }

  // Capture the tail if not covered
  if (lines.length > 0) {
    const lastChunk = chunks[chunks.length - 1];
    const lastLine = lastChunk ? lastChunk.endLine : 0;
    if (lastLine < lines.length) {
      const tailLines = lines.slice(lastLine);
      if (tailLines.join('').trim().length > 0) {
        chunks.push({
          filePath,
          content: tailLines.join('\n'),
          startLine: lastLine + 1,
          endLine: lines.length,
          language: 'generic',
          symbolName: '',
          symbolType: 'block'
        });
      }
    }
  }

  return chunks;
}

/**
 * Main entry point — splits a file's content into semantic chunks.
 * Attempts AST parsing first; falls back to generic sliding window.
 * @param {string} filePath   Absolute or relative path (used for language detection)
 * @param {string} content    Full file content
 * @returns {Array<{filePath, content, startLine, endLine, language, symbolName, symbolType}>}
 */
function splitCodeIntoChunks(filePath, content) {
  if (!content || content.trim().length === 0) return [];

  const ext = path.extname(filePath).toLowerCase();
  const lang = EXT_TO_LANG[ext] || 'generic';

  // Use generic chunker for non-code files
  if (lang === 'generic') {
    return genericChunk(filePath, content);
  }

  // Attempt AST-based chunking
  const parser = loadParser(lang);

  if (!parser) {
    // tree-sitter not installed → fall back to generic
    console.warn(`⚠️ astChunker: tree-sitter not available for "${lang}" — using generic chunker for ${path.basename(filePath)}`);
    return genericChunk(filePath, content);
  }

  try {
    const tree = parser.parse(content);
    const chunks = [];
    const usedRanges = new Set();
    walkNode(tree.rootNode, content, filePath, lang, chunks, usedRanges);

    if (chunks.length === 0) {
      // File parsed fine but had no extractable symbols (e.g. pure type declarations)
      return genericChunk(filePath, content);
    }

    return chunks;
  } catch (err) {
    console.warn(`⚠️ astChunker: AST parse failed for ${filePath} — falling back to generic chunker. Error: ${err.message}`);
    return genericChunk(filePath, content);
  }
}

module.exports = {
  splitCodeIntoChunks
};
