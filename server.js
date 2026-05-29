import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 5173);
const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, "public");
const REPOS_DIR = join(ROOT, ".code-atlas", "repos");
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_BATCH_SIZE = 24;
const GENERATE_ANSWERS = process.env.GENERATE_ANSWERS === "true";

const IGNORE_DIRS = new Set([".git", ".code-atlas", "node_modules", "dist", "build", ".next", ".venv", "venv", "coverage"]);
const CODE_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".rs", ".html", ".css", ".scss", ".json", ".md", ".yml", ".yaml"]);
const STOP_WORDS = new Set(["the", "is", "a", "an", "to", "of", "in", "on", "and", "for", "with", "this", "that", "where", "what", "which", "how", "does", "file", "files"]);

const sessions = new Map();

await mkdir(REPOS_DIR, { recursive: true });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/index") {
      const { source } = await readJson(req);
      if (!source) return json(res, 400, { error: "Enter a GitHub URL or local folder path." });

      const repoPath = await getRepoPath(String(source).trim());
      const session = await indexRepo(repoPath);
      sessions.set(session.id, session);

      return json(res, 200, {
        id: session.id,
        fileCount: session.files.length,
        chunkCount: session.chunks.length,
        retrievalMode: session.usesEmbeddings ? "embeddings" : "keywords",
        embeddingError: session.embeddingError
      });
    }

    if (req.method === "POST" && url.pathname === "/api/ask") {
      const { sessionId, question } = await readJson(req);
      const session = sessions.get(sessionId);
      if (!session) return json(res, 404, { error: "Index a repository first." });
      if (!question) return json(res, 400, { error: "Ask a question about the repo." });

      return json(res, 200, await answerQuestion(session, String(question).trim()));
    }

    if (req.method === "POST" && url.pathname === "/api/summary") {
      const { sessionId } = await readJson(req);
      const session = sessions.get(sessionId);
      if (!session) return json(res, 404, { error: "Index a repository first." });

      return json(res, 200, await summarizeCodebase(session));
    }

    return serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || "Something went wrong." });
  }
}).listen(PORT, () => {
  console.log(`CodeAtlas running at http://localhost:${PORT}`);
});

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function serveStatic(res, pathname) {
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = safePath === "/" ? join(PUBLIC_DIR, "index.html") : join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "Forbidden" });

  try {
    const file = await stat(filePath);
    const target = file.isDirectory() ? join(filePath, "index.html") : filePath;
    res.writeHead(200, { "content-type": mimeType(target) });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}

function mimeType(filePath) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  }[extname(filePath)] || "application/octet-stream";
}

async function getRepoPath(source) {
  if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(source)) {
    const destination = join(REPOS_DIR, randomUUID());
    await run("git", ["clone", "--depth", "1", source, destination]);
    return destination;
  }

  const localPath = resolve(ROOT, source);
  const info = await stat(localPath).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Source must be a GitHub repo URL or an existing local folder.");
  return localPath;
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", data => {
      stderr += data.toString();
    });

    child.on("close", code => {
      if (code === 0) resolveRun();
      else reject(new Error(stderr.trim() || `${command} failed`));
    });
  });
}

async function indexRepo(repoPath) {
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

async function findCodeFiles(dir, base = dir, files = []) {
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

async function answerQuestion(session, question) {
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

function rankedFiles(question, chunks) {
  const byPath = new Map();

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

async function summarizeCodebase(session) {
  const summary = buildCodebaseSummary(session);
  const answer = GENERATE_ANSWERS
    ? await askOpenAI("Summarize this codebase: what it does, main files/folders, likely entrypoints, and where to start reading.", summary.citations).catch(() => null)
    : null;

  return {
    answer: answer || formatSummary(summary),
    citations: summary.citations
  };
}

function buildCodebaseSummary(session) {
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

async function retrieve(session, question) {
  if (session.usesEmbeddings) {
    const [questionEmbedding] = await embedTexts([question]).catch(error => {
      console.warn(`Embedding question failed: ${error.message}`);
      return [null];
    });
    if (questionEmbedding) {
      return session.chunks
        .map(chunk => ({
          ...chunk,
          score: cosineSimilarity(questionEmbedding, chunk.embedding) + pathScore(chunk.path, question)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    }
  }

  return keywordRetrieve(session, question);
}

function keywordRetrieve(session, question) {
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

async function embedTexts(texts) {
  if (!process.env.OPENAI_API_KEY || texts.length === 0) return null;

  const embeddings = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const data = await requestEmbeddings(texts.slice(i, i + EMBEDDING_BATCH_SIZE));
    embeddings.push(...data.data.map(item => item.embedding));
  }

  return embeddings;
}

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
    if (response.status === 429 && attempt <= 5) {
      await sleep(retryDelay(message, attempt));
      return requestEmbeddings(input, attempt + 1);
    }
    throw new Error(`Embedding request failed (${response.status}): ${message}`);
  }

  return response.json();
}

function retryDelay(message, attempt) {
  const match = message.match(/try again in ([\d.]+)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000) + 500;
  return attempt * 2000;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cosineSimilarity(a, b) {
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

function pathScore(path, question) {
  const lowerPath = path.toLowerCase();
  return tokenize(question).reduce((score, token) => {
    return lowerPath.includes(token) ? score + 0.05 : score;
  }, 0);
}

async function askOpenAI(question, citations) {
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

function simpleAnswer(citations) {
  if (citations.length === 0) {
    return "I could not find relevant code for that question.";
  }

  const files = citations.map(citation => `- ${citation.path}:${citation.startLine}-${citation.endLine}`).join("\n");
  return `I found these relevant source sections:\n${files}`;
}

function tokenize(input) {
  return (String(input).toLowerCase().match(/[a-z_][a-z0-9_]{1,}/g) || [])
    .filter(token => !STOP_WORDS.has(token));
}

function trimSnippet(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim()).slice(0, 30);
  return lines.join("\n").slice(0, 2500);
}
