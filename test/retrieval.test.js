import assert from "node:assert/strict";
import test from "node:test";

import { keywordRetrieve, retrieve } from "../src/retrieval.js";

// Fixture strategy:
//    auth and database chunks each have obvious path/text signals
//    README is a lower-relevance chunk used to verify zero-score filtering
//    overrides let individual tests simulate embedding-capable sessions
function fixtureSession(overrides = {}) {
  return {
    usesEmbeddings: false,
    chunks: [
      {
        path: "src/auth.js",
        startLine: 1,
        endLine: 10,
        text: "function loginRoute() {}",
        tokens: ["function", "loginroute", "auth"]
      },
      {
        path: "src/database.js",
        startLine: 1,
        endLine: 10,
        text: "function connectDatabase() {}",
        tokens: ["function", "connectdatabase", "database"]
      },
      {
        path: "README.md",
        startLine: 1,
        endLine: 5,
        text: "Project overview",
        tokens: ["project", "overview"]
      }
    ],
    ...overrides
  };
}

// a direct path/text match should outrank unrelated chunks.
test("keywordRetrieve scores token overlap and boosts path matches", () => {
  const results = keywordRetrieve(fixtureSession(), "auth route");

  assert.equal(results[0].path, "src/auth.js");
  assert.ok(results[0].score > 0);
  assert.ok(results.every(chunk => chunk.score > 0));
});

// retrieval should cap output at five chunks and preserve descending
// score order when more matches exist.
test("keywordRetrieve returns at most five results sorted by score", () => {
  const chunks = Array.from({ length: 8 }, (_, index) => ({
    path: `src/file-${index}.js`,
    startLine: 1,
    endLine: 1,
    text: "auth",
    tokens: index === 0 ? ["auth", "auth", "auth"] : ["auth"]
  }));

  const results = keywordRetrieve({ usesEmbeddings: false, chunks }, "auth");

  assert.equal(results.length, 5);
  assert.ok(results[0].score >= results[1].score);
});

// an embedding-enabled session must still work offline if the
// question embedding cannot be created.
test("retrieve falls back to keyword retrieval when embeddings are unavailable", async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const results = await retrieve(fixtureSession({ usesEmbeddings: true }), "database");

    assert.equal(results[0].path, "src/database.js");
  } finally {
    if (originalApiKey) process.env.OPENAI_API_KEY = originalApiKey;
    else delete process.env.OPENAI_API_KEY;
  }
});
