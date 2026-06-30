import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getRepoPath } from "../src/repo-source.js";


// valid local folder: should resolve to an indexable path
test("getRepoPath resolves existing absolute local folders", async () => {
  const absolutePath = await mkdtemp(join(tmpdir(), "codeatlas-local-source-"));

  try {
    const resolved = await getRepoPath(absolutePath);

    assert.equal(resolved, absolutePath);
  } finally {
    await rm(absolutePath, { recursive: true, force: true });
  }
});
// missing local folder: should reject with the user-facing source error
test("getRepoPath rejects missing local folders", async () => {
  await assert.rejects(
    () => getRepoPath("missing-codeatlas-folder"),
    /Source must be a GitHub repo URL or an existing local folder/
  );
});

// non-GitHub URL: should reject instead of treating arbitrary URLs as repos
test("getRepoPath rejects invalid source strings", async () => {
  await assert.rejects(
    () => getRepoPath("https://example.com/not-github"),
    /Source must be a GitHub repo URL or an existing local folder/
  );
});
