// backend/chunker.js

/**
 * Splits a file's content into overlapping chunks.
 * @param {string} filePath - Relative or absolute path to the file.
 * @param {string} content - Full text content of the file.
 * @param {number} chunkSize - Max characters per chunk.
 * @param {number} chunkOverlap - Overlap size in characters.
 * @returns {Array<{filePath: string, content: string, startLine: number, endLine: number}>}
 */
function splitCodeIntoChunks(filePath, content, chunkSize = 1000, chunkOverlap = 200) {
  if (!content) return [];
  
  const lines = content.split('\n');
  const chunks = [];
  let currentChunkLines = [];
  let currentChunkSize = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentChunkLines.push(line);
    currentChunkSize += line.length + 1; // +1 for the newline
    
    // Create a chunk if size is reached or if it's the last line of the file
    if (currentChunkSize >= chunkSize || i === lines.length - 1) {
      const startLine = i - currentChunkLines.length + 2; // 1-indexed
      const endLine = i + 1; // 1-indexed
      const chunkContent = currentChunkLines.join('\n');
      
      chunks.push({
        filePath,
        content: chunkContent,
        startLine,
        endLine
      });
      
      // Calculate overlap rollback
      let overlapSize = 0;
      let rollbackIndex = currentChunkLines.length - 1;
      
      // Keep adding preceding lines to rollback until overlap size target is hit or we hit start of the chunk
      while (rollbackIndex >= 0 && overlapSize < chunkOverlap) {
        overlapSize += currentChunkLines[rollbackIndex].length + 1;
        rollbackIndex--;
      }
      
      // The remaining lines in rollback are retained for the next chunk
      const sliceStart = Math.max(0, rollbackIndex + 1);
      
      if (sliceStart >= currentChunkLines.length) {
        currentChunkLines = [];
      } else {
        currentChunkLines = currentChunkLines.slice(sliceStart);
      }
      
      currentChunkSize = currentChunkLines.join('\n').length;
    }
  }
  return chunks;
}

module.exports = {
  splitCodeIntoChunks
};
