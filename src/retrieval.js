import { embedTexts } from "./openai.js";
import { cosineSimilarity, tokenize } from "./text.js";

/**
 * Returns the top 5 source chunks for a question.
 *
 * If the repo was indexed with embeddings, this uses cosine similarity between
 * the question embedding and each chunk embedding. If embeddings are unavailable,
 * it falls back to keyword retrieval.
 *
 * @param {object} session - Indexed repository session from `indexRepo`
 * @param {string} question - User question
 * @returns {Promise<Array<object>>} Top matching chunks with retrieval scores
 */
export async function retrieve(session, question) {
  if (session.usesEmbeddings) {
    const embeddings = await embedTexts([question]).catch(error => {
      console.warn(`Embedding question failed: ${error.message}`);
      return null;
    });
    const questionEmbedding = embeddings?.[0];
    if (questionEmbedding) {
      return session.chunks
        .map(chunk => ({
          ...chunk,
          // Add a small path score so filename matches help
          score: cosineSimilarity(questionEmbedding, chunk.embedding) + pathScore(chunk.path, question)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    }
  }

  return keywordRetrieve(session, question);
}

/**
 * Simple deterministic retrieval used when no OpenAI API key is configured.
 *
 * Scores chunks by token overlap, and gives extra points when query tokens
 * appear in file paths. Returns top 5 chunks.
 *
 * @param {object} session - Indexed repository session from `indexRepo`
 * @param {string} question - User's natural-language question
 * @returns {Array<object>} Top matching chunks with keyword scores
 */
export function keywordRetrieve(session, question) {
  const queryTokens = new Set(tokenize(question));

  return session.chunks
    .map(chunk => {
      let score = 0;
      for (const token of chunk.tokens) {
        if (queryTokens.has(token)) score += 1;
      }
      for (const token of queryTokens) {
        if (chunk.path.toLowerCase().includes(token)) score += 2;
      }
      return { ...chunk, score };
    })
    .filter(chunk => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function pathScore(path, question) {
  const lowerPath = path.toLowerCase();
  return tokenize(question).reduce((score, token) => {
    return lowerPath.includes(token) ? score + 0.05 : score;
  }, 0);
}
