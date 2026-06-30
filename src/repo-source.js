import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { REPOS_DIR, ROOT } from "./config.js";

/**
 * Turns a user’s input into a local folder path to index
 *
 * If source is a GitHub repo URL, it clones it into .code-atlas/repos/<random-id>.
 * If source is local, it resolves it relative to the app root and checks that it exists.
 * If neither works, it throws an error
 */
export async function getRepoPath(source) {
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

/**
 * Helper process used for git clone.
 * Collects stderr so failed clones produce useful errors.
 */
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
