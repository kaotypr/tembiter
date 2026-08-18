import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  projectConfig,
  readConfig,
  templateConfig,
  writeConfig,
} from "../src/format/config.js";
import { gitText, runGit } from "../src/git.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tembiter-register-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function gitTestEnv(homeDir: string): NodeJS.ProcessEnv {
  writeFileSync(join(homeDir, "gitconfig"), "", "utf8");
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "Tembiter Test",
    GIT_AUTHOR_EMAIL: "tembiter-test@example.com",
    GIT_COMMITTER_NAME: "Tembiter Test",
    GIT_COMMITTER_EMAIL: "tembiter-test@example.com",
    GIT_CONFIG_GLOBAL: join(homeDir, "gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    HOME: homeDir,
  };
}

function createRepoFixture(root: string): {
  repo: string;
  parent: string;
  env: NodeJS.ProcessEnv;
} {
  const home = join(root, "home");
  mkdirSync(home);
  const env = gitTestEnv(home);
  const repo = join(root, "template");
  mkdirSync(repo);
  writeFileSync(join(repo, "known.txt"), "hello from template\n", "utf8");

  runGit(["init"], { cwd: repo, env });
  runGit(["add", "known.txt"], { cwd: repo, env });
  runGit(["commit", "-m", "existing history"], { cwd: repo, env });

  return {
    repo,
    parent: gitText(["rev-parse", "HEAD"], { cwd: repo, env }),
    env,
  };
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function committedPaths(cwd: string, env: NodeJS.ProcessEnv): string[] {
  const names = gitText(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], {
    cwd,
    env,
  });
  return names.length === 0 ? [] : names.split("\n");
}

describe("tembiter template register", () => {
  it("writes template-side config and one new commit of .tembiter/ only", () => {
    const root = tempDir();
    const fixture = createRepoFixture(root);

    writeFileSync(join(fixture.repo, "dirty.txt"), "leave me uncommitted\n", "utf8");

    const result = runCli(
      ["template", "register", "--path", fixture.repo],
      fixture.env,
    );

    assert.equal(result.status, 0, result.stderr);

    const config = readConfig(fixture.repo);
    assert.equal(config.kind, "template");
    assert.equal(config.formatVersion, 1);

    const raw = readFileSync(join(fixture.repo, ".tembiter", "config.json"), "utf8");
    assert.equal(
      raw,
      `${JSON.stringify({ formatVersion: 1, kind: "template" }, null, 2)}\n`,
    );

    assert.equal(gitText(["rev-list", "--count", "HEAD"], { cwd: fixture.repo, env: fixture.env }), "2");
    assert.equal(
      gitText(["rev-parse", "HEAD^"], { cwd: fixture.repo, env: fixture.env }),
      fixture.parent,
    );
    assert.equal(
      gitText(["log", "-1", "--format=%s"], { cwd: fixture.repo, env: fixture.env }),
      "Register tembiter template",
    );
    assert.deepEqual(committedPaths(fixture.repo, fixture.env).sort(), [
      ".gitignore",
      ".tembiter/config.json",
    ]);
    assert.match(
      gitText(["show", "HEAD:.gitignore"], { cwd: fixture.repo, env: fixture.env }),
      /^\.tembiter\/sync\/$/m,
    );

    const dirty = gitText(["status", "--porcelain", "--", "dirty.txt"], {
      cwd: fixture.repo,
      env: fixture.env,
    });
    assert.match(dirty, /dirty\.txt/);

    const tags = gitText(["tag"], { cwd: fixture.repo, env: fixture.env });
    assert.equal(tags, "");
  });

  it("overrides the commit message with --message", () => {
    const root = tempDir();
    const fixture = createRepoFixture(root);

    const result = runCli(
      ["template", "register", "--path", fixture.repo, "--message", "Mark as template"],
      fixture.env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      gitText(["log", "-1", "--format=%s"], { cwd: fixture.repo, env: fixture.env }),
      "Mark as template",
    );
  });

  it("is idempotent when kind template is already committed", () => {
    const root = tempDir();
    const fixture = createRepoFixture(root);

    const first = runCli(
      ["template", "register", "--path", fixture.repo],
      fixture.env,
    );
    assert.equal(first.status, 0, first.stderr);
    const afterFirst = gitText(["rev-parse", "HEAD"], { cwd: fixture.repo, env: fixture.env });

    const second = runCli(
      ["template", "register", "--path", fixture.repo],
      fixture.env,
    );
    assert.equal(second.status, 0, second.stderr);
    assert.equal(
      gitText(["rev-parse", "HEAD"], { cwd: fixture.repo, env: fixture.env }),
      afterFirst,
    );
    assert.equal(gitText(["rev-list", "--count", "HEAD"], { cwd: fixture.repo, env: fixture.env }), "2");
  });

  it("commits an existing uncommitted template config", () => {
    const root = tempDir();
    const fixture = createRepoFixture(root);
    writeConfig(fixture.repo, templateConfig());

    const result = runCli(
      ["template", "register", "--path", fixture.repo],
      fixture.env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readConfig(fixture.repo).kind, "template");
    assert.equal(
      gitText(["rev-parse", "HEAD^"], { cwd: fixture.repo, env: fixture.env }),
      fixture.parent,
    );
    assert.deepEqual(committedPaths(fixture.repo, fixture.env).sort(), [
      ".gitignore",
      ".tembiter/config.json",
    ]);
  });

  it("does not write gitignore on a true no-op already-registered template", () => {
    const root = tempDir();
    const fixture = createRepoFixture(root);
    writeConfig(fixture.repo, templateConfig());
    runGit(["add", ".tembiter"], { cwd: fixture.repo, env: fixture.env });
    runGit(["commit", "-m", "already registered"], { cwd: fixture.repo, env: fixture.env });
    const before = gitText(["rev-parse", "HEAD"], { cwd: fixture.repo, env: fixture.env });

    const result = runCli(
      ["template", "register", "--path", fixture.repo],
      fixture.env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      gitText(["rev-parse", "HEAD"], { cwd: fixture.repo, env: fixture.env }),
      before,
    );
    assert.equal(existsSync(join(fixture.repo, ".gitignore")), false);
    const porcelain = gitText(["status", "--porcelain"], {
      cwd: fixture.repo,
      env: fixture.env,
    });
    assert.equal(porcelain, "");
  });

  it("fails when the repository is already a tembiter project", () => {
    const root = tempDir();
    const fixture = createRepoFixture(root);
    writeConfig(fixture.repo, projectConfig("/some/template", "v1.0.0"));
    runGit(["add", ".tembiter"], { cwd: fixture.repo, env: fixture.env });
    runGit(["commit", "-m", "project config"], { cwd: fixture.repo, env: fixture.env });
    const before = gitText(["rev-parse", "HEAD"], { cwd: fixture.repo, env: fixture.env });

    const result = runCli(
      ["template", "register", "--path", fixture.repo],
      fixture.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /project/);
    assert.equal(readConfig(fixture.repo).kind, "project");
    assert.equal(
      gitText(["rev-parse", "HEAD"], { cwd: fixture.repo, env: fixture.env }),
      before,
    );
  });

  it("fails when --path is not a git repository", () => {
    const root = tempDir();
    const home = join(root, "home");
    mkdirSync(home);
    const env = gitTestEnv(home);
    const notGit = join(root, "not-git");
    mkdirSync(notGit);

    const result = runCli(["template", "register", "--path", notGit], env);

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /git repository/);
  });

  it("fails when git author identity is missing", () => {
    const root = tempDir();
    const fixture = createRepoFixture(root);
    const env: NodeJS.ProcessEnv = {
      ...fixture.env,
      GIT_AUTHOR_NAME: "",
      GIT_AUTHOR_EMAIL: "",
      GIT_COMMITTER_NAME: "",
      GIT_COMMITTER_EMAIL: "",
    };

    const result = runCli(["template", "register", "--path", fixture.repo], env);

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /identity/);
    assert.equal(
      gitText(["rev-parse", "HEAD"], { cwd: fixture.repo, env: fixture.env }),
      fixture.parent,
    );
  });
});
