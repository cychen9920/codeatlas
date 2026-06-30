import { STOP_WORDS } from "./config.js";

/**
 * Converts text into searchable lowercase tokens and removes common words.
 *
 * @param {string} input - Text to tokenize
 * @returns {Array<string>} Searchable tokens with stop words removed
 */
export function tokenize(input) {
  return (String(input).toLowerCase().match(/[a-z_][a-z0-9_]{1,}/g) || [])
    .filter(token => !STOP_WORDS.has(token));
}

/**
 * Keeps source snippets readable in answers by removing blank lines and capping
 * the amount of text sent to the UI or OpenAI.
 *
 * @param {string} text - Raw source text
 * @returns {string} Short snippet suitable for citations
 */
export function trimSnippet(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim()).slice(0, 30);
  return lines.join("\n").slice(0, 2500);
}

/**
 * Computes cosine similarity for two embedding vectors.
 *
 * @param {Array<number>} a - First embedding vector
 * @param {Array<number>} b - Second embedding vector
 * @returns {number} Cosine similarity score
 */
export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
