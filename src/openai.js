import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL
} from "./config.js";

/**
 * Embeds text chunks in batches. and returns an array of embedding vectors.
 *
 * Returns null when no API key is configured.
 *
 * @param {Array<string>} texts - Text chunks to embed
 * @returns {Promise<Array<Array<number>> | null>} Embedding vectors, or null when embeddings are unavailable
 */
export async function embedTexts(texts) {
  if (!process.env.OPENAI_API_KEY || texts.length === 0) return null;

  const embeddings = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const data = await requestEmbeddings(texts.slice(i, i + EMBEDDING_BATCH_SIZE));
    embeddings.push(...data.data.map(item => item.embedding));
  }

  return embeddings;
}

/**
 * Generates an answer from retrieved source citations using the Responses API.
 *
 * @param {string} question - User question
 * @param {Array<object>} citations - Retrieved source citations used as grounding context
 * @returns {Promise<string | null>} Generated answer text, or null if generation is unavailable
 */
export async function askOpenAI(question, citations) {
  if (!process.env.OPENAI_API_KEY || citations.length === 0) return null;

  const context = citations
    .map(citation => `File: ${citation.path}:${citation.startLine}-${citation.endLine}\n${citation.snippet}`)
    .join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: `Answer this question using only the code excerpts below. Cite file paths and line ranges.\n\nQuestion: ${question}\n\n${context}`
    })
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data.output_text || null;
}

// Makes the embeddings API request;
// Retries on rate limits up to 5 times
async function requestEmbeddings(input, attempt = 1) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input
    })
  });

  if (!response.ok) {
    const message = await response.text();
    // Respect rate-limit when possible, then retry a few times
    if (response.status === 429 && attempt <= 5) {
      await sleep(retryDelay(message, attempt));
      return requestEmbeddings(input, attempt + 1);
    }
    throw new Error(`Embedding request failed (${response.status}): ${message}`);
  }

  return response.json();
}

// Parses rate-limit backoff text if available, else uses increasing delay
function retryDelay(message, attempt) {
  const match = message.match(/try again in ([\d.]+)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000) + 500;
  return attempt * 2000;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
