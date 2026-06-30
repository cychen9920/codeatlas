import { join } from "node:path";

export const PORT = Number(process.env.PORT || 5173);
export const ROOT = process.cwd();
export const PUBLIC_DIR = join(ROOT, "public");
export const REPOS_DIR = join(ROOT, ".code-atlas", "repos");
export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
export const EMBEDDING_BATCH_SIZE = 24;
export const GENERATE_ANSWERS = process.env.GENERATE_ANSWERS === "true";

export const IGNORE_DIRS = new Set([
  ".git",
  ".code-atlas",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".venv",
  "venv",
  "coverage"
]);

export const CODE_EXTS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".java",
  ".rb",
  ".rs",
  ".html",
  ".css",
  ".scss",
  ".json",
  ".md",
  ".yml",
  ".yaml"
]);

export const STOP_WORDS = new Set([
  "the",
  "is",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "and",
  "for",
  "with",
  "this",
  "that",
  "where",
  "what",
  "which",
  "how",
  "does",
  "file",
  "files"
]);
