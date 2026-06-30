import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";

import { CODE_EXTS, IGNORE_DIRS } from "./config.js";
import { embedTexts } from "./openai.js";
import { tokenize, trimSnippet } from "./text.js";

/**
 * Builds an in-memory search session for a repository.
 *
 * Each indexed file becomes both a file summary and one or more line-numbered
 * chunks. Chunks carry their raw text, retrieval tokens, and optional OpenAI
 * embeddings.
 *
 * @param {string} repoPath - Absolute path to the repository folder to index
 * @returns {Promise<object>} Search session containing files, summaries, chunks, and retrieval mode
 */
export async function indexRepo(repoPath) {
  const files = await findCodeFiles(repoPath);
  const chunks = [];
  const fileSummaries = [];

  for (const file of files) {
    const text = await readFile(file.absolutePath, "utf8").catch(() => "");
    const lines = text.split(/\r?\n/);
    fileSummaries.push({
      path: file.path,
      lineCount: lines.length,
      preview: trimSnippet(text)
    });

    for (let start = 1; start <= lines.length; start += 80) {
      const end = Math.min(start + 79, lines.length);
      const chunkText = lines.slice(start - 1, end).join("\n");
      if (!chunkText.trim()) continue;

      // Include the path in the searchable text so queries like "auth route"
      // can match both filenames and code contents
      chunks.push({
        path: file.path,
        startLine: start,
        endLine: end,
        text: chunkText,
        embeddingText: `${file.path}\n${chunkText}`,
        tokens: tokenize(`${file.path}\n${chunkText}`)
      });
    }
  }

  let embeddingError = null;
  // Embeddings are optional: without an API key, use deterministic keyword retrieval
  const embeddings = await embedTexts(chunks.map(chunk => chunk.embeddingText)).catch(error => {
    embeddingError = error.message;
    console.warn(`Embedding indexing failed: ${error.message}`);
    return null;
  });
  if (embeddings) {
    chunks.forEach((chunk, index) => {
      chunk.embedding = embeddings[index];
    });
  }

  return { id: randomUUID(), files, fileSummaries, chunks, usesEmbeddings: Boolean(embeddings), embeddingError };
}

/**
 * Recursively finds readable source/documentation files worth indexing.
 *
 * Generated folders, dependency folders, unsupported extensions, and very large
 * files are skipped.
 *
 * @param {string} dir - Directory currently being scanned.
 * @param {string} [base=dir] - Root directory used to compute relative paths.
 * @param {Array<object>} [files=[]] - Accumulator used during recursive scans.
 * @returns {Promise<Array<{absolutePath: string, path: string}>>} Indexable files with absolute and repo-relative paths.
 */
export async function findCodeFiles(dir, base = dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolutePath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) await findCodeFiles(absolutePath, base, files);
      continue;
    }

    const ext = extname(entry.name).toLowerCase();
    if (!CODE_EXTS.has(ext)) continue;
    if ((await stat(absolutePath)).size > 400_000) continue;

    files.push({
      absolutePath,
      path: relative(base, absolutePath).replaceAll("\\", "/")
    });
  }

  return files;
}
