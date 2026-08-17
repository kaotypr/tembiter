import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const requiredPaths = [
  "dist/src/cli.js",
  "skills/tembiter-apply-template-update/SKILL.md",
  "skills/tembiter-prepare-template/SKILL.md",
  "README.md",
  "LICENSE",
  "package.json",
];

type PackFile = { path?: unknown };
type PackResult = { files?: PackFile[] };

function packJsonText(stdout: string): string {
  const start = stdout.lastIndexOf("\n[");
  if (start >= 0) {
    return stdout.slice(start + 1);
  }
  const trimmed = stdout.trimStart();
  if (trimmed.startsWith("[")) {
    return trimmed;
  }
  throw new Error("npm pack --json did not print a JSON array");
}

function packFilePaths(stdout: string): string[] {
  const parsed: unknown = JSON.parse(packJsonText(stdout));
  const results: PackResult[] = Array.isArray(parsed) ? parsed : [parsed as PackResult];
  const paths: string[] = [];
  for (const result of results) {
    for (const file of result.files ?? []) {
      if (typeof file.path === "string") {
        paths.push(file.path);
      }
    }
  }
  return paths;
}

describe("npm pack contents", () => {
  it("includes the CLI, skills, README, LICENSE, and package.json", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stderr);
    const paths = packFilePaths(result.stdout);
    for (const required of requiredPaths) {
      assert.ok(paths.includes(required), `missing ${required} in ${JSON.stringify(paths)}`);
    }
    assert.equal(paths.includes("skills/apply-template-update/SKILL.md"), false);
    assert.equal(paths.includes("skills/prepare-template/SKILL.md"), false);
  });
});
