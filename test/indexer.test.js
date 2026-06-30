import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findCodeFiles, indexRepo } from "../src/indexer.js";

// Fixture strategy:
//    supported files: README.md and src/server.js should be indexed
//    unsupported files: .txt files should be skipped
//    ignored folders: .git and node_modules should be skipped even with code files
//    boundary files: files over 400 KB should be skipped to avoid noisy indexing
async function withFixtureRepo(fn) {
  const root = await mkdtemp(join(tmpdir(), "codeatlas-indexer-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });

    await writeFile(join(root, "README.md"), "# Fixture\n\nAuth route docs\n");
    await writeFile(join(root, "src", "server.js"), "export function authRoute() {}\n");
    await writeFile(join(root, "src", "notes.txt"), "not indexed\n");
    await writeFile(join(root, "node_modules", "pkg", "ignored.js"), "ignored dependency\n");
    await writeFile(join(root, ".git", "config"), "ignored git metadata\n");
    await writeFile(join(root, "src", "large.js"), "x".repeat(400_001));

    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// file discovery should include only readable source/docs and exclude
// dependencies, metadata folders, unsupported extensions, and oversized files.
test("findCodeFiles includes supported files and skips ignored or oversized files", async () => {
  await withFixtureRepo(async root => {
    const files = await findCodeFiles(root);
    const paths = files.map(file => file.path).sort();

    assert.deepEqual(paths, ["README.md", "src/server.js"]);
  });
});

// no OPENAI_API_KEY should still produce a complete keyword-search
// session, including summaries, chunks, embedding text, and retrieval tokens.
test("indexRepo creates summaries and keyword-searchable chunks without embeddings", async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    await withFixtureRepo(async root => {
      const session = await indexRepo(root);

      assert.equal(session.usesEmbeddings, false);
      assert.equal(session.embeddingError, null);
      assert.equal(session.files.length, 2);
      assert.equal(session.fileSummaries.length, 2);
      assert.ok(session.id);
      assert.ok(session.chunks.length >= 2);

      const serverChunk = session.chunks.find(chunk => chunk.path === "src/server.js");
      assert.ok(serverChunk);
      assert.equal(serverChunk.startLine, 1);
      assert.ok(serverChunk.embeddingText.includes("src/server.js"));
      assert.ok(serverChunk.tokens.includes("authroute"));
    });
  } finally {
    if (originalApiKey) process.env.OPENAI_API_KEY = originalApiKey;
    else delete process.env.OPENAI_API_KEY;
  }
});
