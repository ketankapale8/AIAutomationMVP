// backend/hashCache.js
// Incremental file-hash cache — tracks SHA-256 hashes of indexed files per repo.
// On re-index runs, only changed/new files are re-embedded (delta indexing).
// Deleted files are detected and removed from the vector store.
//
// Storage: one JSON file per repo at data/hashes/<repoId>.json

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getIndexerConfig } = require('./configLoader');

/** Returns the directory for hash cache files */
function getCacheDir() {
  const cfg = getIndexerConfig();
  const cacheDir = path.isAbsolute(cfg.hashCachePath)
    ? cfg.hashCachePath
    : path.join(__dirname, cfg.hashCachePath);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

/** Returns the full path to the hash cache file for a repo */
function getCachePath(repoId) {
  return path.join(getCacheDir(), `${repoId}.json`);
}

/**
 * Loads the hash cache for a given repo.
 * @param {string} repoId
 * @returns {Object} Map of { [absoluteFilePath]: sha256hex }
 */
function loadCache(repoId) {
  const cachePath = getCachePath(repoId);
  if (!fs.existsSync(cachePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Saves the hash cache for a given repo to disk.
 * @param {string} repoId
 * @param {Object} cache  Map of { [absoluteFilePath]: sha256hex }
 */
function saveCache(repoId, cache) {
  const cachePath = getCachePath(repoId);
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
}

/**
 * Computes the SHA-256 hash of a file's content.
 * @param {string} content  File content string
 * @returns {string}  Hex digest
 */
function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Checks whether a file has changed since last index.
 * @param {string} filePath     Absolute file path
 * @param {string} content      Current file content
 * @param {Object} cache        Loaded cache object
 * @returns {boolean}           true = changed or new, false = unchanged
 */
function isChanged(filePath, content, cache) {
  const currentHash = hashContent(content);
  return cache[filePath] !== currentHash;
}

/**
 * Updates the cache entry for a file.
 * @param {string} filePath
 * @param {string} content
 * @param {Object} cache  Cache object (mutated in-place)
 */
function updateCache(filePath, content, cache) {
  cache[filePath] = hashContent(content);
}

/**
 * Detects files in the cache that no longer exist on disk.
 * @param {Object} cache  Loaded cache object
 * @returns {Array<string>}  Array of deleted file paths
 */
function findDeletedFiles(cache) {
  const deleted = [];
  for (const filePath of Object.keys(cache)) {
    if (!fs.existsSync(filePath)) {
      deleted.push(filePath);
    }
  }
  return deleted;
}

/**
 * Removes a file entry from the cache.
 * @param {string} filePath
 * @param {Object} cache  Cache object (mutated in-place)
 */
function removeFromCache(filePath, cache) {
  delete cache[filePath];
}

module.exports = {
  loadCache,
  saveCache,
  hashContent,
  isChanged,
  updateCache,
  findDeletedFiles,
  removeFromCache
};
