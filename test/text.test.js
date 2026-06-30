import assert from "node:assert/strict";
import test from "node:test";

import { cosineSimilarity, tokenize, trimSnippet } from "../src/text.js";


test("tokenize lowercases text, removes stop words, and keeps code-like identifiers", () => {
  assert.deepEqual(
    tokenize("Where is USER_AUTH handled in the Auth Route?"),
    ["user_auth", "handled", "auth", "route"]
  );
});

test("tokenize returns an empty array when no searchable tokens exist", () => {
  assert.deepEqual(tokenize("!!! 123 ?"), []);
});

test("trimSnippet removes blank lines and keeps at most 30 nonblank lines", () => {
  const text = Array.from({ length: 35 }, (_, index) => `line ${index + 1}`).join("\n\n");
  const snippet = trimSnippet(text);
  const lines = snippet.split("\n");

  assert.equal(lines.length, 30);
  assert.equal(lines[0], "line 1");
  assert.equal(lines.at(-1), "line 30");
});

test("trimSnippet caps output at 2500 characters", () => {
  const snippet = trimSnippet("x".repeat(3000));

  assert.equal(snippet.length, 2500);
});

test("cosineSimilarity scores identical vectors above orthogonal vectors", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(cosineSimilarity([1, 1], [1, 0]) > cosineSimilarity([0, 1], [1, 0]));
});
