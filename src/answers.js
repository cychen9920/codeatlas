import { GENERATE_ANSWERS } from "./config.js";
import { askOpenAI } from "./openai.js";
import { retrieve } from "./retrieval.js";
import { tokenize, trimSnippet } from "./text.js";

/**
 * Answers a user question with citations from retrieved source chunks.
 *
 * File-location questions get a ranked file list with reasons. Other questions
 * either use OpenAI to write an answer from the citations or return the
 * cited sections directly (when generated answers are disabled).
 *
 * @param {object} session - Indexed repository session from `indexRepo`
 * @param {string} question - User question
 * @returns {Promise<{answer: string, citations: Array<object>}>>} Answer text and supporting source citations
 */
export async function answerQuestion(session, question) {
  const chunks = await retrieve(session, question);
  const citations = chunks.map(chunk => ({
    path: chunk.path,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    snippet: trimSnippet(chunk.text)
  }));

  if (answerMode(question) === "files") {
    return {
      answer: fileFinderAnswer(question, chunks),
      citations
    };
  }

  const answer = GENERATE_ANSWERS
    ? await askOpenAI(question, citations).catch(() => null)
    : null;

  return {
    answer: answer || simpleAnswer(citations),
    citations
  };
}

function answerMode(question) {
  const q = question.toLowerCase();
  // Route "where should I look/change?" prompts to the file finder instead of
  // treating them as open-ended explanation questions
  if (
    /\b(what|which)\s+files?\b/.test(q) ||
    /\bwhere\s+(is|are)\b/.test(q) ||
    /\b(files?|code)\s+(for|related to|associated with)\b/.test(q) ||
    /\b(would|should)\s+i\s+change\b/.test(q) ||
    /\bimplemented\b/.test(q)
  ) {
    return "files";
  }

  return "snippets";
}

// Formats ranked files with reasons and line ranges
function fileFinderAnswer(question, chunks) {
  const files = rankedFiles(question, chunks);
  if (files.length === 0) {
    return "I could not find files that look related to that feature.";
  }

  const lines = files.map((file, index) => {
    return `${index + 1}. ${file.path}
   Reason: ${file.reason}
   Evidence: ${file.ranges.join(", ")}`;
  });

  return `Related files

${lines.join("\n\n")}`;
}

// returns top 5 files by combined scores of chunks
function rankedFiles(question, chunks) {
  const byPath = new Map();

  // Multiple chunks from the same file should strengthen that file's rank
  // rather than appear as duplicate file recommendations
  for (const chunk of chunks) {
    const item = byPath.get(chunk.path) || { path: chunk.path, score: 0, ranges: [], snippets: [] };
    item.score += chunk.score || 1;
    item.ranges.push(`${chunk.startLine}-${chunk.endLine}`);
    item.snippets.push(chunk.text);
    byPath.set(chunk.path, item);
  }

  return [...byPath.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(file => ({
      ...file,
      reason: fileReason(question, file)
    }));
}

// Generates reasons based on path matches and text matches
function fileReason(question, file) {
  const tokens = tokenize(question);
  const pathMatches = tokens.filter(token => file.path.toLowerCase().includes(token));
  const text = file.snippets.join("\n").toLowerCase();
  const textMatches = tokens.filter(token => text.includes(token) && !pathMatches.includes(token)).slice(0, 4);

  if (pathMatches.length && textMatches.length) {
    return `the file path matches "${pathMatches.join(", ")}" and the retrieved code also mentions "${textMatches.join(", ")}".`;
  }
  if (pathMatches.length) {
    return `the file path matches "${pathMatches.join(", ")}", which makes it a likely place for this feature.`;
  }
  if (textMatches.length) {
    return `retrieved code in this file mentions "${textMatches.join(", ")}".`;
  }
  return "it was one of the closest semantic matches from retrieval.";
}

// fallback when OpenAI-generated answers disabled
function simpleAnswer(citations) {
  if (citations.length === 0) {
    return "I could not find relevant code for that question.";
  }

  const files = citations.map(citation => `- ${citation.path}:${citation.startLine}-${citation.endLine}`).join("\n");
  return `I found these relevant source sections:\n${files}`;
}
