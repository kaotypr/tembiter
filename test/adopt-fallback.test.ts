import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readConfig } from "../src/format/config.js";
import { gitText, runGit } from "../src/git.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tembiter-adopt-fallback-"));
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

function commitAt(
  repo: string,
  env: NodeJS.ProcessEnv,
  message: string,
  committerDate: string,
): string {
  runGit(["add", "-A"], { cwd: repo, env });
  runGit(["commit", "-m", message], {
    cwd: repo,
    env: {
      ...env,
      GIT_AUTHOR_DATE: committerDate,
      GIT_COMMITTER_DATE: committerDate,
    },
  });
  return gitText(["rev-parse", "HEAD"], { cwd: repo, env });
}

function createDatedUntaggedTemplate(root: string, env: NodeJS.ProcessEnv): {
  repo: string;
  morning: string;
  latest: string;
  nextDay: string;
} {
  const repo = join(root, "untagged-template");
  mkdirSync(repo);
  runGit(["init"], { cwd: repo, env });

  writeFileSync(join(repo, "known.txt"), "before\n", "utf8");
  commitAt(repo, env, "day before", "2024-01-14T18:00:00+00:00");

  writeFileSync(join(repo, "known.txt"), "morning\n", "utf8");
  const morning = commitAt(repo, env, "morning that day", "2024-01-15T09:00:00+00:00");

  writeFileSync(join(repo, "known.txt"), "latest that day\n", "utf8");
  const latest = commitAt(
    repo,
    env,
    "afternoon latest that day",
    "2024-01-15T18:30:00+00:00",
  );

  writeFileSync(join(repo, "known.txt"), "next day\n", "utf8");
  const nextDay = commitAt(repo, env, "next day", "2024-01-16T10:00:00+00:00");

  return { repo, morning, latest, nextDay };
}

function createDatedProject(
  root: string,
  env: NodeJS.ProcessEnv,
  firstCommitterDate: string,
): { repo: string; first: string } {
  const repo = join(root, "project");
  mkdirSync(repo);
  runGit(["init"], { cwd: repo, env });
  writeFileSync(join(repo, "unique-project.txt"), "project only\n", "utf8");
  const first = commitAt(repo, env, "project first commit", firstCommitterDate);
  writeFileSync(join(repo, "later.txt"), "second project commit\n", "utf8");
  commitAt(repo, env, "project second commit", "2024-01-20T12:00:00+00:00");
  return { repo, first };
}

function createTaggedTemplate(root: string, env: NodeJS.ProcessEnv): {
  repo: string;
  tag: string;
} {
  const repo = join(root, "tagged-template");
  mkdirSync(repo);
  writeFileSync(join(repo, "known.txt"), "hello from tagged template\n", "utf8");
  runGit(["init"], { cwd: repo, env });
  commitAt(repo, env, "tagged template commit", "2024-01-15T12:00:00+00:00");
  runGit(["tag", "v1.0.0"], { cwd: repo, env });
  return { repo, tag: "v1.0.0" };
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env,
    cwd,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

describe("tembiter adopt no-tags fallback", () => {
  it("prints the latest template commit on the first-commit calendar day and writes nothing", () => {
    const root = tempDir();
    const home = join(root, "home");
    mkdirSync(home);
    const env = gitTestEnv(home);
    const template = createDatedUntaggedTemplate(root, env);
    const project = createDatedProject(root, env, "2024-01-15T12:00:00+00:00");
    const countBefore = gitText(["rev-list", "--count", "HEAD"], {
      cwd: project.repo,
      env,
    });

    const result = runCli(
      ["adopt", "--template", template.repo, "--project", project.repo],
      env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stdout, /Project first-commit date: 2024-01-15/);
    assert.match(result.stdout, new RegExp(`Candidate commit: ${template.latest}`));
    assert.match(result.stdout, /Subject: afternoon latest that day/);
    assert.match(
      result.stdout,
      new RegExp(
        `git -C ${template.repo} tag v0\\.0\\.0-tembiter-20240115 ${template.latest}`,
      ),
    );
    assert.doesNotMatch(result.stdout, new RegExp(template.morning));
    assert.doesNotMatch(result.stdout, new RegExp(template.nextDay));
    assert.match(result.stderr, /Did not bind the project/);
    assert.equal(existsSync(join(project.repo, ".tembiter")), false);
    assert.equal(existsSync(join(project.repo, ".tembiter", "config.json")), false);
    assert.equal(existsSync(join(project.repo, ".gitignore")), false);
    assert.equal(
      gitText(["rev-list", "--count", "HEAD"], { cwd: project.repo, env }),
      countBefore,
    );
  });

  it("does not enter the fallback when the template already has tags", () => {
    const root = tempDir();
    const home = join(root, "home");
    mkdirSync(home);
    const env = gitTestEnv(home);
    const tagged = createTaggedTemplate(root, env);
    const project = createDatedProject(root, env, "2024-01-15T12:00:00+00:00");

    const omitted = runCli(
      ["adopt", "--template", tagged.repo, "--project", project.repo],
      env,
    );

    assert.notEqual(omitted.status, 0);
    assert.notEqual(omitted.status, null);
    assert.match(omitted.stderr, /--tag is required/);
    assert.match(omitted.stderr, /v1\.0\.0/);
    assert.match(omitted.stderr, /does not pick a tag or run the no-tags fallback/);
    assert.doesNotMatch(omitted.stdout, /Candidate commit:/);
    assert.equal(existsSync(join(project.repo, ".tembiter", "config.json")), false);
  });

  it("fails without writing when --tag is passed for a template with no tags", () => {
    const root = tempDir();
    const home = join(root, "home");
    mkdirSync(home);
    const env = gitTestEnv(home);
    const template = createDatedUntaggedTemplate(root, env);
    const project = createDatedProject(root, env, "2024-01-15T12:00:00+00:00");

    const result = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        "v1.0.0",
        "--project",
        project.repo,
      ],
      env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /not found/);
    assert.match(result.stderr, /no version tags/);
    assert.doesNotMatch(result.stdout, /Candidate commit:/);
    assert.equal(existsSync(join(project.repo, ".tembiter")), false);
    assert.equal(existsSync(join(project.repo, ".gitignore")), false);
  });

  it("fails when the project has several root commits", () => {
    const root = tempDir();
    const home = join(root, "home");
    mkdirSync(home);
    const env = gitTestEnv(home);
    const template = createDatedUntaggedTemplate(root, env);

    const repo = join(root, "project");
    mkdirSync(repo);
    runGit(["init"], { cwd: repo, env });
    writeFileSync(join(repo, "a.txt"), "a\n", "utf8");
    const firstRoot = commitAt(repo, env, "first root", "2024-01-15T12:00:00+00:00");
    runGit(["checkout", "--orphan", "other-root"], { cwd: repo, env });
    writeFileSync(join(repo, "b.txt"), "b\n", "utf8");
    const secondRoot = commitAt(repo, env, "second root", "2024-01-15T13:00:00+00:00");
    runGit(["checkout", "-B", "main", firstRoot], { cwd: repo, env });
    runGit(["merge", "--allow-unrelated-histories", "-m", "join roots", secondRoot], {
      cwd: repo,
      env,
    });

    const result = runCli(
      ["adopt", "--template", template.repo, "--project", repo],
      env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /more than one root commit/);
    assert.match(result.stderr, /Do not guess/);
    assert.match(result.stderr, new RegExp(firstRoot));
    assert.match(result.stderr, new RegExp(secondRoot));
    assert.doesNotMatch(result.stdout, /Candidate commit:/);
    assert.equal(existsSync(join(repo, ".tembiter")), false);
    assert.equal(existsSync(join(repo, ".gitignore")), false);
  });

  it("fails when no template commit matches the first-commit calendar day", () => {
    const root = tempDir();
    const home = join(root, "home");
    mkdirSync(home);
    const env = gitTestEnv(home);
    const template = createDatedUntaggedTemplate(root, env);
    const project = createDatedProject(root, env, "2023-12-01T12:00:00+00:00");

    const result = runCli(
      ["adopt", "--template", template.repo, "--project", project.repo],
      env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /No template commit has committer calendar day 2023-12-01/);
    assert.doesNotMatch(result.stdout, /Candidate commit:/);
    assert.equal(existsSync(join(project.repo, ".tembiter")), false);
    assert.equal(existsSync(join(project.repo, ".gitignore")), false);
  });

  it("binds after the owner tags the suggested commit outside tembiter", () => {
    const root = tempDir();
    const home = join(root, "home");
    mkdirSync(home);
    const env = gitTestEnv(home);
    const template = createDatedUntaggedTemplate(root, env);
    const project = createDatedProject(root, env, "2024-01-15T12:00:00+00:00");

    const assistance = runCli(
      ["adopt", "--template", template.repo, "--project", project.repo],
      env,
    );
    assert.notEqual(assistance.status, 0);
    const match = assistance.stdout.match(/Candidate commit: ([0-9a-f]{40})/);
    assert.ok(match !== null, assistance.stdout);
    const candidate = match[1];
    assert.equal(candidate, template.latest);

    runGit(["tag", "v0.0.0-tembiter-20240115", template.latest], {
      cwd: template.repo,
      env,
    });

    const bound = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        "v0.0.0-tembiter-20240115",
        "--project",
        project.repo,
      ],
      env,
    );
    assert.equal(bound.status, 0, bound.stderr);
    assert.equal(existsSync(join(project.repo, ".tembiter", "config.json")), true);
    assert.match(
      gitText(["show", "HEAD:.gitignore"], { cwd: project.repo, env }),
      /^\.tembiter\/sync\/$/m,
    );
    const config = readConfig(project.repo);
    assert.equal(config.kind, "project");
    if (config.kind === "project") {
      assert.equal(config.template.identity, template.repo);
      assert.equal(config.template.version, "v0.0.0-tembiter-20240115");
    }
  });
});
