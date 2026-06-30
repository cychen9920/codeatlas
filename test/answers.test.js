import assert from "node:assert/strict";
import test from "node:test";

import { answerQuestion } from "../src/answers.js";

// Fixture strategy:
//    two auth chunks from the same file verify citation and file grouping behavior
//    one unrelated profile chunk gives non-matching queries something to ignore
function fixtureSession() {
  return {
    usesEmbeddings: false,
    chunks: [
      {
        path: "src/auth.js",
        startLine: 1,
        endLine: 20,
        text: "export function loginUser() {\n  return verifyPassword();\n}",
        tokens: ["export", "function", "loginuser", "verifypassword", "auth"]
      },
      {
        path: "src/auth.js",
        startLine: 21,
        endLine: 40,
        text: "export function registerUser() {\n  return hashPassword();\n}",
        tokens: ["export", "function", "registeruser", "hashpassword", "auth"]
      },
      {
        path: "src/profile.js",
        startLine: 1,
        endLine: 10,
        text: "export function profilePage() {}",
        tokens: ["export", "function", "profilepage"]
      }
    ]
  };
}

// normal explanatory questions should return source-section answers
// with citations preserving file path and line range
test("answerQuestion returns citations for matching source chunks", async () => {
  const result = await answerQuestion(fixtureSession(), "login auth");

  assert.match(result.answer, /I found these relevant source sections/);
  assert.equal(result.citations[0].path, "src/auth.js");
  assert.equal(result.citations[0].startLine, 1);
  assert.equal(result.citations[0].endLine, 20);
  assert.match(result.citations[0].snippet, /loginUser/);
});

// "which files" questions should use file-finder output, merge
// evidence from repeated chunks, and explain why a file matched
test("answerQuestion routes file-location questions to ranked file output", async () => {
  const result = await answerQuestion(fixtureSession(), "Which files handle auth?");

  assert.match(result.answer, /Related files/);
  assert.match(result.answer, /src\/auth\.js/);
  assert.match(result.answer, /Reason:/);
  assert.match(result.answer, /Evidence: 1-20, 21-40/);
});

// no retrieval hits should produce a clear empty-state answer.
test("answerQuestion returns an empty-state answer when nothing matches", async () => {
  const result = await answerQuestion(fixtureSession(), "zebra payment gateway");

  assert.equal(result.answer, "I could not find relevant code for that question.");
  assert.deepEqual(result.citations, []);
});
