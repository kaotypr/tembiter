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
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  readConfig,
  templateConfig,
  writeConfig,
} from "../src/format/config.js";
import { gitText, runGit } from "../src/git.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tembiter-adopt-"));
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

function createTaggedTemplate(root: string): {
  repo: string;
  tag: string;
  env: NodeJS.ProcessEnv;
} {
  const home = join(root, "home");
  mkdirSync(home);
  const env = gitTestEnv(home);
  const repo = join(root, "template");
  mkdirSync(repo);
  writeFileSync(join(repo, "known.txt"), "hello from template\n", "utf8");

  runGit(["init"], { cwd: repo, env });
  runGit(["add", "-A"], { cwd: repo, env });
  runGit(["commit", "-m", "template commit"], { cwd: repo, env });
  runGit(["tag", "v1.0.0"], { cwd: repo, env });

  return {
    repo,
    tag: "v1.0.0",
    env,
  };
}

function createUntaggedTemplate(root: string, env: NodeJS.ProcessEnv): string {
  const repo = join(root, "untagged-template");
  mkdirSync(repo);
  writeFileSync(join(repo, "known.txt"), "hello from untagged template\n", "utf8");
  runGit(["init"], { cwd: repo, env });
  runGit(["add", "-A"], { cwd: repo, env });
  runGit(["commit", "-m", "untagged template commit"], { cwd: repo, env });
  return repo;
}

function createProjectFixture(
  root: string,
  env: NodeJS.ProcessEnv,
): {
  repo: string;
  commits: string[];
} {
  const repo = join(root, "project");
  mkdirSync(repo);
  writeFileSync(join(repo, "unique-project.txt"), "project only\n", "utf8");
  runGit(["init"], { cwd: repo, env });
  runGit(["add", "-A"], { cwd: repo, env });
  runGit(["commit", "-m", "project first commit"], { cwd: repo, env });
  writeFileSync(join(repo, "later.txt"), "second project commit\n", "utf8");
  runGit(["add", "-A"], { cwd: repo, env });
  runGit(["commit", "-m", "project second commit"], { cwd: repo, env });

  const commits = gitText(["rev-list", "--reverse", "HEAD"], { cwd: repo, env })
    .split("\n")
    .filter((line) => line.length > 0);

  return { repo, commits };
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

describe("tembiter adopt", () => {
  it("binds a diverged local project to a tagged template without copying files (A4, A10)", () => {
    const root = tempDir();
    const template = createTaggedTemplate(root);
    const project = createProjectFixture(root, template.env);
    const parentBefore = gitText(["rev-parse", "HEAD"], {
      cwd: project.repo,
      env: template.env,
    });
    const countBefore = gitText(["rev-list", "--count", "HEAD"], {
      cwd: project.repo,
      env: template.env,
    });

    const result = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        template.tag,
        "--project",
        project.repo,
      ],
      template.env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      gitText(["rev-list", "--count", "HEAD"], { cwd: project.repo, env: template.env }),
      String(Number(countBefore) + 1),
    );
    assert.equal(
      gitText(["rev-parse", "HEAD^"], { cwd: project.repo, env: template.env }),
      parentBefore,
    );
    for (const sha of project.commits) {
      assert.equal(
        gitText(["cat-file", "-t", sha], { cwd: project.repo, env: template.env }),
        "commit",
      );
    }

    const committedFiles = gitText(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
      { cwd: project.repo, env: template.env },
    );
    assert.equal(committedFiles, ".tembiter/config.json");
    assert.equal(
      gitText(["log", "-1", "--format=%s"], { cwd: project.repo, env: template.env }),
      `Connect tembiter to ${template.repo}@${template.tag}`,
    );

    assert.equal(
      readFileSync(join(project.repo, "unique-project.txt"), "utf8"),
      "project only\n",
    );
    assert.equal(
      readFileSync(join(project.repo, "later.txt"), "utf8"),
      "second project commit\n",
    );
    assert.equal(existsSync(join(project.repo, "known.txt")), false);

    const config = readConfig(project.repo);
    assert.equal(config.kind, "project");
    if (config.kind === "project") {
      assert.equal(config.template.identity, template.repo);
      assert.equal(config.template.version, template.tag);
    }

    const raw = readFileSync(join(project.repo, ".tembiter", "config.json"), "utf8");
    assert.equal(
      raw,
      `${JSON.stringify(
        {
          formatVersion: 1,
          kind: "project",
          template: {
            identity: template.repo,
            version: template.tag,
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("overrides the adopt commit message with --message", () => {
    const root = tempDir();
    const template = createTaggedTemplate(root);
    const project = createProjectFixture(root, template.env);

    const result = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        template.tag,
        "--project",
        project.repo,
        "--message",
        "Custom adopt",
      ],
      template.env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      gitText(["log", "-1", "--format=%s"], { cwd: project.repo, env: template.env }),
      "Custom adopt",
    );
  });

  it("stores a file:// template URL as identity", () => {
    const root = tempDir();
    const template = createTaggedTemplate(root);
    const project = createProjectFixture(root, template.env);
    const url = pathToFileURL(template.repo).href;

    const result = runCli(
      ["adopt", "--template", url, "--tag", template.tag, "--project", project.repo],
      template.env,
    );

    assert.equal(result.status, 0, result.stderr);
    const config = readConfig(project.repo);
    assert.equal(config.kind, "project");
    if (config.kind === "project") {
      assert.equal(config.template.identity, url);
      assert.equal(config.template.version, template.tag);
    }
    assert.equal(existsSync(join(project.repo, "known.txt")), false);
  });

  it("fails when --tag is omitted and the template already has tags", () => {
    const root = tempDir();
    const template = createTaggedTemplate(root);
    const project = createProjectFixture(root, template.env);

    const result = runCli(
      ["adopt", "--template", template.repo, "--project", project.repo],
      template.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /--tag is required/);
    assert.match(result.stderr, /v1\.0\.0/);
    assert.doesNotMatch(result.stderr, /invent/);
    assert.equal(existsSync(join(project.repo, ".tembiter", "config.json")), false);
    assert.equal(
      gitText(["rev-list", "--count", "HEAD"], { cwd: project.repo, env: template.env }),
      "2",
    );
  });

  it("fails when --tag is unknown and lists existing tags", () => {
    const root = tempDir();
    const template = createTaggedTemplate(root);
    const project = createProjectFixture(root, template.env);

    const result = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        "no-such-tag",
        "--project",
        project.repo,
      ],
      template.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /no-such-tag/);
    assert.match(result.stderr, /v1\.0\.0/);
    assert.equal(existsSync(join(project.repo, ".tembiter", "config.json")), false);
  });

  it("fails when --tag is passed and the template has no tags", () => {
    const root = tempDir();
    const tagged = createTaggedTemplate(root);
    const untagged = createUntaggedTemplate(root, tagged.env);
    const project = createProjectFixture(root, tagged.env);

    const withTag = runCli(
      ["adopt", "--template", untagged, "--tag", "v1.0.0", "--project", project.repo],
      tagged.env,
    );
    assert.notEqual(withTag.status, 0);
    assert.notEqual(withTag.status, null);
    assert.match(withTag.stderr, /not found/);
    assert.match(withTag.stderr, /no version tags/);
    assert.match(withTag.stderr, /does not invent a version/);
    assert.doesNotMatch(withTag.stdout, /Candidate commit:/);
    assert.equal(existsSync(join(project.repo, ".tembiter", "config.json")), false);
    assert.equal(
      gitText(["rev-list", "--count", "HEAD"], { cwd: project.repo, env: tagged.env }),
      "2",
    );
  });

  it("is idempotent when config already matches identity and tag", () => {
    const root = tempDir();
    const template = createTaggedTemplate(root);
    const project = createProjectFixture(root, template.env);

    const first = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        template.tag,
        "--project",
        project.repo,
      ],
      template.env,
    );
    assert.equal(first.status, 0, first.stderr);
    const headAfterFirst = gitText(["rev-parse", "HEAD"], {
      cwd: project.repo,
      env: template.env,
    });

    const second = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        template.tag,
        "--project",
        project.repo,
      ],
      template.env,
    );
    assert.equal(second.status, 0, second.stderr);
    assert.equal(
      gitText(["rev-parse", "HEAD"], { cwd: project.repo, env: template.env }),
      headAfterFirst,
    );
    assert.equal(
      gitText(["rev-list", "--count", "HEAD"], { cwd: project.repo, env: template.env }),
      "3",
    );
  });

  it("commits matching untracked config.json", () => {
    const root = tempDir();
    const template = createTaggedTemplate(root);
    const project = createProjectFixture(root, template.env);
    writeConfig(project.repo, {
      formatVersion: 1,
      kind: "project",
      template: {
        identity: template.repo,
        version: template.tag,
      },
    });

    const result = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        template.tag,
        "--project",
        project.repo,
      ],
      template.env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      gitText(["rev-list", "--count", "HEAD"], { cwd: project.repo, env: template.env }),
      "3",
    );
    assert.equal(
      gitText(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], {
        cwd: project.repo,
        env: template.env,
      }),
      ".tembiter/config.json",
    );
  });

  it("fails when config exists with a different template, tag, or kind", () => {
    const root = tempDir();
    const template = createTaggedTemplate(root);
    const project = createProjectFixture(root, template.env);

    writeConfig(project.repo, {
      formatVersion: 1,
      kind: "project",
      template: {
        identity: template.repo,
        version: "v0.9.0",
      },
    });
    const differentTag = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        template.tag,
        "--project",
        project.repo,
      ],
      template.env,
    );
    assert.notEqual(differentTag.status, 0);
    assert.match(differentTag.stderr, /already connected/);
    assert.match(differentTag.stderr, /v0\.9\.0/);

    writeConfig(project.repo, {
      formatVersion: 1,
      kind: "project",
      template: {
        identity: "/other/template",
        version: template.tag,
      },
    });
    const differentIdentity = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        template.tag,
        "--project",
        project.repo,
      ],
      template.env,
    );
    assert.notEqual(differentIdentity.status, 0);
    assert.match(differentIdentity.stderr, /already connected/);
    assert.match(differentIdentity.stderr, /\/other\/template/);

    writeConfig(project.repo, templateConfig());
    const templateKind = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        template.tag,
        "--project",
        project.repo,
      ],
      template.env,
    );
    assert.notEqual(templateKind.status, 0);
    assert.match(templateKind.stderr, /kind "template"/);
    assert.equal(
      gitText(["rev-list", "--count", "HEAD"], { cwd: project.repo, env: template.env }),
      "2",
    );
  });

  it("fails when --project is not a git repository", () => {
    const root = tempDir();
    const template = createTaggedTemplate(root);
    const notGit = join(root, "not-git");
    mkdirSync(notGit);

    const result = runCli(
      [
        "adopt",
        "--template",
        template.repo,
        "--tag",
        template.tag,
        "--project",
        notGit,
      ],
      template.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /not a git repository/);
  });

  it("defaults --project to the current working directory", () => {
    const root = tempDir();
    const template = createTaggedTemplate(root);
    const project = createProjectFixture(root, template.env);

    const result = runCli(
      ["adopt", "--template", template.repo, "--tag", template.tag],
      template.env,
      project.repo,
    );

    assert.equal(result.status, 0, result.stderr);
    const config = readConfig(project.repo);
    assert.equal(config.kind, "project");
    if (config.kind === "project") {
      assert.equal(config.template.identity, template.repo);
      assert.equal(config.template.version, template.tag);
    }
  });
});
