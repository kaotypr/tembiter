import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  ensureSyncGitignore,
  GITIGNORE_FILE,
  SYNC_GITIGNORE_LINE,
} from "../../src/format/gitignore.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tembiter-gitignore-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function gitignoreBody(repoRoot: string): string {
  return readFileSync(join(repoRoot, GITIGNORE_FILE), "utf8");
}

describe("ensureSyncGitignore", () => {
  it("creates .gitignore with .tembiter/sync/ and a trailing newline", () => {
    const repo = tempDir();
    assert.equal(ensureSyncGitignore(repo), true);
    assert.equal(gitignoreBody(repo), `${SYNC_GITIGNORE_LINE}\n`);
  });

  it("appends the ignore line while preserving a trailing newline", () => {
    const repo = tempDir();
    writeFileSync(join(repo, GITIGNORE_FILE), "node_modules/\n", "utf8");
    assert.equal(ensureSyncGitignore(repo), true);
    assert.equal(gitignoreBody(repo), `node_modules/\n${SYNC_GITIGNORE_LINE}\n`);
  });

  it("inserts a newline before appending when the file has no trailing newline", () => {
    const repo = tempDir();
    writeFileSync(join(repo, GITIGNORE_FILE), "dist/", "utf8");
    assert.equal(ensureSyncGitignore(repo), true);
    assert.equal(gitignoreBody(repo), `dist/\n${SYNC_GITIGNORE_LINE}\n`);
  });

  it("is idempotent and does not duplicate the line", () => {
    const repo = tempDir();
    assert.equal(ensureSyncGitignore(repo), true);
    assert.equal(ensureSyncGitignore(repo), false);
    assert.equal(gitignoreBody(repo), `${SYNC_GITIGNORE_LINE}\n`);

    writeFileSync(
      join(repo, GITIGNORE_FILE),
      `*.log\n.tembiter/sync\n`,
      "utf8",
    );
    assert.equal(ensureSyncGitignore(repo), false);
    assert.equal(gitignoreBody(repo), `*.log\n.tembiter/sync\n`);
  });

  it("does not write .tembiter/template-sync/ or ignore .tembiter/ itself", () => {
    const repo = tempDir();
    mkdirSync(join(repo, ".tembiter"));
    writeFileSync(join(repo, ".tembiter", "config.json"), "{}\n", "utf8");
    assert.equal(ensureSyncGitignore(repo), true);

    const body = gitignoreBody(repo);
    assert.equal(body, `${SYNC_GITIGNORE_LINE}\n`);
    assert.doesNotMatch(body, /template-sync/);
    assert.doesNotMatch(body, /^\.tembiter\/$/m);
    assert.doesNotMatch(body, /^\.tembiter\/config\.json$/m);
    assert.equal(existsSync(join(repo, ".tembiter", "template-sync")), false);
    assert.equal(existsSync(join(repo, ".tembiter", "sync")), false);
    assert.equal(readFileSync(join(repo, ".tembiter", "config.json"), "utf8"), "{}\n");
  });
});
