import assert from "node:assert/strict";
import test from "node:test";

import { buildCodebaseSummary, summarizeCodebase } from "../src/summarizer.js";

// Fixture strategy:
//    server.js should be detected as an entrypoint
//    src/auth.js and src/model.js should be detected as important files
//    README ensures docs can appear in metadata without dominating the summary
function fixtureSession() {
  return {
    files: [{ path: "server.js" }, { path: "src/auth.js" }, { path: "src/model.js" }],
    fileSummaries: [
      {
        path: "server.js",
        lineCount: 12,
        preview: "import express from 'express';"
      },
      {
        path: "src/auth.js",
        lineCount: 40,
        preview: "export function loginUser() {}"
      },
      {
        path: "src/model.js",
        lineCount: 60,
        preview: "export class UserModel {}"
      },
      {
        path: "README.md",
        lineCount: 8,
        preview: "# Project"
      }
    ]
  };
}

// the structured summary should expose each heuristic output that the
// UI displays: folders, entrypoints, important files, reading order, citations.
test("buildCodebaseSummary identifies folders, entrypoints, important files, and citations", () => {
  const summary = buildCodebaseSummary(fixtureSession());

  assert.ok(summary.folders.some(folder => folder.name === "src" && folder.count === 2));
  assert.ok(summary.entrypoints.includes("server.js"));
  assert.ok(summary.importantFiles.includes("src/auth.js"));
  assert.ok(summary.readingOrder.includes("server.js"));
  assert.ok(summary.citations.some(citation => citation.path === "server.js"));
});

// default summary mode should be deterministic and not depend on
// OpenAI-generated prose.
test("summarizeCodebase returns deterministic summary text and citations by default", async () => {
  const result = await summarizeCodebase(fixtureSession());

  assert.match(result.answer, /Codebase Summary/);
  assert.match(result.answer, /Likely entrypoints/);
  assert.ok(result.citations.length > 0);
});
