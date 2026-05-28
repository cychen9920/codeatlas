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

const IGNORE_DIRS = new Set([".git", ".code-atlas", "node_modules", "dist", "build", ".next", ".venv", "venv", "coverage"]);
const CODE_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".rs", ".json", ".md", ".yml", ".yaml"]);
const STOP_WORDS = new Set(["the", "is", "a", "an", "to", "of", "in", "on", "and", "for", "with", "this", "that", "where", "what", "how", "does"]);

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
        chunkCount: session.chunks.length
      });
    }

    if (req.method === "POST" && url.pathname === "/api/ask") {
      const { sessionId, question } = await readJson(req);
      const session = sessions.get(sessionId);
      if (!session) return json(res, 404, { error: "Index a repository first." });
      if (!question) return json(res, 400, { error: "Ask a question about the repo." });

      return json(res, 200, await answerQuestion(session, String(question).trim()));
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

  for (const file of files) {
    const text = await readFile(file.absolutePath, "utf8").catch(() => "");
    const lines = text.split(/\r?\n/);

    for (let start = 1; start <= lines.length; start += 80) {
      const end = Math.min(start + 79, lines.length);
      const chunkText = lines.slice(start - 1, end).join("\n");
      if (!chunkText.trim()) continue;

      chunks.push({
        path: file.path,
        startLine: start,
        endLine: end,
        text: chunkText,
        tokens: tokenize(`${file.path}\n${chunkText}`)
      });
    }
  }

  return { id: randomUUID(), files, chunks };
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
  const citations = retrieve(session, question).map(chunk => ({
    path: chunk.path,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    snippet: trimSnippet(chunk.text)
  }));

  const answer = await askOpenAI(question, citations).catch(() => null);

  return {
    answer: answer || simpleAnswer(citations),
    citations
  };
}

function retrieve(session, question) {
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
