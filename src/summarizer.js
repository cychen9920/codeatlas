import { askOpenAI } from "./openai.js";
import { GENERATE_ANSWERS } from "./config.js";

/**
 * Produces a high-level codebase summary from indexed files
 *
 * The deterministic summary is always available; OpenAI can optionally rewrite
 * it from cited snippets when generated answers are enabled.
 *
 * @param {object} session - Indexed repository session from `indexRepo`
 * @returns {Promise<{answer: string, citations: Array<object>}>>} Summary text and source citations
 */
export async function summarizeCodebase(session) {
  const summary = buildCodebaseSummary(session);
  const answer = GENERATE_ANSWERS
    ? await askOpenAI("Summarize this codebase: what it does, main files/folders, likely entrypoints, and where to start reading.", summary.citations).catch(() => null)
    : null;

  return {
    answer: answer || formatSummary(summary),
    citations: summary.citations
  };
}

/**
 * Selects folders, likely entrypoints, important files, and a reading order.
 *
 * @param {object} session - Indexed repository session from `indexRepo`
 * @returns {object} Structured summary data used to format the codebase overview
 */
export function buildCodebaseSummary(session) {
  const folders = topFolders(session.fileSummaries);
  const entrypoints = likelyEntrypoints(session.fileSummaries);
  const importantFiles = likelyImportantFiles(session.fileSummaries, entrypoints);
  const readingOrder = [...new Set([...entrypoints, ...importantFiles])].slice(0, 6);
  const citations = readingOrder
    .map(path => session.fileSummaries.find(file => file.path === path))
    .filter(Boolean)
    .map(file => ({
      path: file.path,
      startLine: 1,
      endLine: Math.min(file.lineCount, 30),
      snippet: file.preview
    }));

  return { folders, entrypoints, importantFiles, readingOrder, citations, fileCount: session.files.length };
}

//Converts the summary object into readable text
function formatSummary(summary) {
  const folders = summary.folders.map(item => `- ${item.name}/ (${item.count} files)`).join("\n") || "- No major folders found";
  const entrypoints = summary.entrypoints.map(path => `- ${path}`).join("\n") || "- No obvious entrypoint found";
  const importantFiles = summary.importantFiles.map(path => `- ${path}`).join("\n") || "- No important files identified";
  const readingOrder = summary.readingOrder.map((path, index) => `${index + 1}. ${path}`).join("\n") || "1. Start with the cited source snippets below";

  return `Codebase Summary

What this repo appears to do:
This repository contains ${summary.fileCount} indexed source/documentation files. Based on the filenames and snippets, start by inspecting the entrypoints and important files below to understand the app structure.

Main folders:
${folders}

Likely entrypoints:
${entrypoints}

Important files:
${importantFiles}

Where to start reading:
${readingOrder}`;
}

// Counts files by top-level folder
function topFolders(files) {
  const counts = new Map();
  for (const file of files) {
    const folder = file.path.includes("/") ? file.path.split("/")[0] : ".";
    counts.set(folder, (counts.get(folder) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));
}

function likelyEntrypoints(files) {
  // filenames like server.js, app.py, index.tsx, and
  // package metadata are usually the fastest places to begin reading
  const patterns = [
    /(^|\/)(main|index|app|server|client|router|routes)\.(js|jsx|ts|tsx|py|go|rb|java)$/i,
    /(^|\/)(package\.json|vite\.config\.[jt]s|next\.config\.[jt]s|README\.md)$/i
  ];

  return files
    .map(file => ({ ...file, score: patterns.reduce((score, pattern) => score + (pattern.test(file.path) ? 1 : 0), 0) }))
    .filter(file => file.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 5)
    .map(file => file.path);
}

function likelyImportantFiles(files, entrypoints) {
  const entrypointSet = new Set(entrypoints);
  // boosts files with certain keywords
  const importantWords = /auth|api|route|model|schema|service|controller|store|db|config|middleware|component|page|view/i;

  return files
    .filter(file => !entrypointSet.has(file.path))
    .map(file => ({
      ...file,
      score:
        (importantWords.test(file.path) ? 3 : 0) +
        (file.path.toLowerCase().includes("readme") ? 2 : 0) +
        Math.min(file.lineCount / 120, 2)
    }))
    .filter(file => file.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 6)
    .map(file => file.path);
}
