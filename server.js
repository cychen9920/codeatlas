import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

import { answerQuestion } from "./src/answers.js";
import { indexRepo } from "./src/indexer.js";
import { PORT, PUBLIC_DIR, REPOS_DIR } from "./src/config.js";
import { getRepoPath } from "./src/repo-source.js";
import { summarizeCodebase } from "./src/summarizer.js";

const sessions = new Map();

await mkdir(REPOS_DIR, { recursive: true });

// The server keeps the transport layer thin: routes validate input, then call
// focused modules for indexing, retrieval-backed answers, and summaries.
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
  // Normalize the browser path before joining it to the public directory so a
  // request cannot escape into arbitrary files on the local machine.
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
