import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readConfig, templateConfig, writeConfig } from "../src/format/config.js";
import { gitText, runGit } from "../src/git.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tembiter-init-"));
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

function createTemplateFixture(root: string): {
  repo: string;
  tag: string;
  commit: string;
  env: NodeJS.ProcessEnv;
} {
  const home = join(root, "home");
  mkdirSync(home);
  const env = gitTestEnv(home);
  const repo = join(root, "template");
  mkdirSync(repo);
  writeFileSync(join(repo, "known.txt"), "hello from template\n", "utf8");
  writeConfig(repo, templateConfig());

  runGit(["init"], { cwd: repo, env });
  runGit(["add", "-A"], { cwd: repo, env });
  runGit(["commit", "-m", "template commit"], { cwd: repo, env });
  runGit(["tag", "v1.0.0"], { cwd: repo, env });

  return {
    repo,
    tag: "v1.0.0",
    commit: gitText(["rev-parse", "HEAD"], { cwd: repo, env }),
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

describe("tembiter init", () => {
  it("copies a tagged template into a new one-commit project (A2, A3)", () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "project");

    const result = runCli(
      ["init", "--template", fixture.repo, "--target", target, "--tag", fixture.tag],
      fixture.env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(gitText(["rev-list", "--count", "HEAD"], { cwd: target, env: fixture.env }), "1");
    assert.equal(
      gitText(["log", "-1", "--format=%s"], { cwd: target, env: fixture.env }),
      "Initial commit",
    );

    const projectCommit = gitText(["rev-parse", "HEAD"], { cwd: target, env: fixture.env });
    assert.notEqual(projectCommit, fixture.commit);
    const cat = runGit(["cat-file", "-t", fixture.commit], {
      cwd: target,
      env: fixture.env,
      allowFailure: true,
    });
    assert.notEqual(cat.status, 0);

    assert.equal(readFileSync(join(target, "known.txt"), "utf8"), "hello from template\n");

    const config = readConfig(target);
    assert.equal(config.kind, "project");
    if (config.kind === "project") {
      assert.equal(config.template.identity, fixture.repo);
      assert.equal(config.template.version, fixture.tag);
    }

    const raw = readFileSync(join(target, ".tembiter", "config.json"), "utf8");
    assert.match(raw, /"kind": "project"/);
    assert.doesNotMatch(raw, /"kind": "template"/);

    const committed = gitText(["ls-tree", "-r", "--name-only", "HEAD"], {
      cwd: target,
      env: fixture.env,
    }).split("\n");
    assert.ok(committed.includes(".tembiter/config.json"));
    assert.ok(committed.includes(".gitignore"));
    assert.equal(
      committed.some((name) => name === ".tembiter/sync" || name.startsWith(".tembiter/sync/")),
      false,
    );
    assert.match(
      gitText(["show", "HEAD:.gitignore"], { cwd: target, env: fixture.env }),
      /^\.tembiter\/sync\/$/m,
    );
  });

  it("overrides the first-commit message with --message", () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "project");

    const result = runCli(
      [
        "init",
        "--template",
        fixture.repo,
        "--target",
        target,
        "--tag",
        fixture.tag,
        "--message",
        "Custom start",
      ],
      fixture.env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      gitText(["log", "-1", "--format=%s"], { cwd: target, env: fixture.env }),
      "Custom start",
    );
  });

  it("accepts a file:// template URL", () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "project");
    const url = pathToFileURL(fixture.repo).href;

    const result = runCli(
      ["init", "--template", url, "--target", target, "--tag", fixture.tag],
      fixture.env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(gitText(["rev-list", "--count", "HEAD"], { cwd: target, env: fixture.env }), "1");
    const config = readConfig(target);
    assert.equal(config.kind, "project");
    if (config.kind === "project") {
      assert.equal(config.template.identity, url);
      assert.equal(config.template.version, fixture.tag);
    }
    assert.equal(readFileSync(join(target, "known.txt"), "utf8"), "hello from template\n");
  });

  it("fails when --target is not empty", () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "project");
    mkdirSync(target);
    writeFileSync(join(target, "already.txt"), "nope\n", "utf8");

    const result = runCli(
      ["init", "--template", fixture.repo, "--target", target, "--tag", fixture.tag],
      fixture.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /not empty/);
    assert.equal(readFileSync(join(target, "already.txt"), "utf8"), "nope\n");
  });

  it("fails when required flags are missing and prints usage on stderr", () => {
    const result = runCli(["init"]);
    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /Missing required flags/);
    assert.match(result.stderr, /--template/);
    assert.match(result.stderr, /--target/);
    assert.match(result.stderr, /--tag/);
    assert.match(result.stderr, /Usage:/);
  });

  it("fails when --tag does not exist", () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "project");

    const result = runCli(
      ["init", "--template", fixture.repo, "--target", target, "--tag", "no-such-tag"],
      fixture.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /no-such-tag/);
  });
});
