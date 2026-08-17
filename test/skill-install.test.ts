import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { projectConfig, templateConfig, writeConfig } from "../src/format/config.js";
import { gitText, runGit } from "../src/git.js";
import { packageRoot } from "../src/skills/catalog.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tembiter-skill-"));
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

function createRepo(
  root: string,
  name: string,
  kind: "project" | "template",
): { repo: string; env: NodeJS.ProcessEnv } {
  const home = join(root, `${name}-home`);
  mkdirSync(home);
  const env = gitTestEnv(home);
  const repo = join(root, name);
  mkdirSync(repo);
  writeFileSync(join(repo, "marker.txt"), `${name}\n`, "utf8");
  if (kind === "project") {
    writeConfig(repo, projectConfig("/path/to/template", "v1.0.0"));
  } else {
    writeConfig(repo, templateConfig());
  }
  runGit(["init"], { cwd: repo, env });
  runGit(["add", "-A"], { cwd: repo, env });
  runGit(["commit", "-m", `${name} commit`], { cwd: repo, env });
  return { repo, env };
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

function packagedSkillBody(id: string): string {
  return readFileSync(join(packageRoot(), "skills", id, "SKILL.md"), "utf8");
}

describe("tembiter skill install", () => {
  it("skill install --help names --skill and --path", () => {
    const result = runCli(["skill", "install", "--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--skill/);
    assert.match(result.stdout, /--path/);
    assert.match(result.stdout, /tembiter-apply-template-update/);
    assert.match(result.stdout, /tembiter-prepare-template/);
  });

  it("installs tembiter-apply-template-update onto a project (A9)", () => {
    const root = tempDir();
    const project = createRepo(root, "project", "project");

    const result = runCli(
      ["skill", "install", "--skill", "tembiter-apply-template-update", "--path", project.repo],
      project.env,
    );

    assert.equal(result.status, 0, result.stderr);
    const installed = join(
      project.repo,
      ".agents",
      "skills",
      "tembiter-apply-template-update",
      "SKILL.md",
    );
    assert.equal(
      readFileSync(installed, "utf8"),
      packagedSkillBody("tembiter-apply-template-update"),
    );
    assert.equal(existsSync(join(project.repo, ".claude")), false);
    assert.equal(existsSync(join(project.repo, ".tembiter", "skills")), false);
    assert.match(
      readFileSync(join(project.repo, ".tembiter", "config.json"), "utf8"),
      /"kind": "project"/,
    );
    assert.match(
      readFileSync(join(project.repo, ".gitignore"), "utf8"),
      /^\.tembiter\/sync\/$/m,
    );
    assert.equal(
      gitText(["rev-list", "--count", "HEAD"], { cwd: project.repo, env: project.env }),
      "1",
    );
    const ignoreInHead = runGit(["cat-file", "-e", "HEAD:.gitignore"], {
      cwd: project.repo,
      env: project.env,
      allowFailure: true,
    });
    assert.notEqual(ignoreInHead.status, 0);
  });

  it("installs tembiter-prepare-template onto a template (A9)", () => {
    const root = tempDir();
    const template = createRepo(root, "template", "template");

    const result = runCli(
      ["skill", "install", "--skill", "tembiter-prepare-template", "--path", template.repo],
      template.env,
    );

    assert.equal(result.status, 0, result.stderr);
    const installed = join(
      template.repo,
      ".agents",
      "skills",
      "tembiter-prepare-template",
      "SKILL.md",
    );
    assert.equal(readFileSync(installed, "utf8"), packagedSkillBody("tembiter-prepare-template"));
    assert.equal(existsSync(join(template.repo, ".claude")), false);
    assert.match(
      readFileSync(join(template.repo, ".gitignore"), "utf8"),
      /^\.tembiter\/sync\/$/m,
    );
    assert.equal(
      gitText(["rev-list", "--count", "HEAD"], { cwd: template.repo, env: template.env }),
      "1",
    );
  });

  it("fails when installing a project skill onto a template", () => {
    const root = tempDir();
    const template = createRepo(root, "template", "template");

    const result = runCli(
      ["skill", "install", "--skill", "tembiter-apply-template-update", "--path", template.repo],
      template.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /project/);
    assert.match(result.stderr, /template/);
    assert.equal(existsSync(join(template.repo, ".agents")), false);
    assert.equal(existsSync(join(template.repo, ".gitignore")), false);
  });

  it("fails when installing a template skill onto a project", () => {
    const root = tempDir();
    const project = createRepo(root, "project", "project");

    const result = runCli(
      ["skill", "install", "--skill", "tembiter-prepare-template", "--path", project.repo],
      project.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /template/);
    assert.match(result.stderr, /project/);
    assert.equal(existsSync(join(project.repo, ".agents")), false);
    assert.equal(existsSync(join(project.repo, ".gitignore")), false);
  });

  it("symlinks into .claude/skills when .claude already exists (T37)", () => {
    const root = tempDir();
    const project = createRepo(root, "project", "project");
    mkdirSync(join(project.repo, ".claude"));

    const result = runCli(
      ["skill", "install", "--skill", "tembiter-apply-template-update", "--path", project.repo],
      project.env,
    );

    assert.equal(result.status, 0, result.stderr);
    const linkPath = join(project.repo, ".claude", "skills", "tembiter-apply-template-update");
    const destPath = join(project.repo, ".agents", "skills", "tembiter-apply-template-update");
    assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
    assert.equal(readlinkSync(linkPath), "../../.agents/skills/tembiter-apply-template-update");
    assert.equal(
      readFileSync(join(linkPath, "SKILL.md"), "utf8"),
      packagedSkillBody("tembiter-apply-template-update"),
    );
    assert.equal(existsSync(destPath), true);
  });

  it("does not create .claude when it is absent", () => {
    const root = tempDir();
    const template = createRepo(root, "template", "template");

    const result = runCli(
      ["skill", "install", "--skill", "tembiter-prepare-template", "--path", template.repo],
      template.env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(template.repo, ".claude")), false);
    assert.equal(
      existsSync(join(template.repo, ".agents", "skills", "tembiter-prepare-template", "SKILL.md")),
      true,
    );
  });

  it("fails when a regular file already occupies the host skill path", () => {
    const root = tempDir();
    const project = createRepo(root, "project", "project");
    mkdirSync(join(project.repo, ".claude", "skills"), { recursive: true });
    writeFileSync(
      join(project.repo, ".claude", "skills", "tembiter-apply-template-update"),
      "not a symlink\n",
      "utf8",
    );

    const result = runCli(
      ["skill", "install", "--skill", "tembiter-apply-template-update", "--path", project.repo],
      project.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /not a symlink/);
    assert.equal(
      readFileSync(join(project.repo, ".claude", "skills", "tembiter-apply-template-update"), "utf8"),
      "not a symlink\n",
    );
  });

  it("re-install refreshes canonical skill files", () => {
    const root = tempDir();
    const project = createRepo(root, "project", "project");

    const first = runCli(
      ["skill", "install", "--skill", "tembiter-apply-template-update", "--path", project.repo],
      project.env,
    );
    assert.equal(first.status, 0, first.stderr);

    const installed = join(
      project.repo,
      ".agents",
      "skills",
      "tembiter-apply-template-update",
      "SKILL.md",
    );
    writeFileSync(installed, "stale local copy\n", "utf8");

    const second = runCli(
      ["skill", "install", "--skill", "tembiter-apply-template-update", "--path", project.repo],
      project.env,
    );
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(installed, "utf8"), packagedSkillBody("tembiter-apply-template-update"));
  });

  it("fails for an unknown skill id", () => {
    const root = tempDir();
    const project = createRepo(root, "project", "project");

    const result = runCli(
      ["skill", "install", "--skill", "not-a-skill", "--path", project.repo],
      project.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /Unknown skill/);
    assert.match(result.stderr, /tembiter-apply-template-update/);
    assert.match(result.stderr, /tembiter-prepare-template/);
  });

  it("treats unprefixed apply-template-update as unknown", () => {
    const root = tempDir();
    const project = createRepo(root, "project", "project");

    const result = runCli(
      ["skill", "install", "--skill", "apply-template-update", "--path", project.repo],
      project.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /Unknown skill 'apply-template-update'/);
    assert.match(result.stderr, /tembiter-apply-template-update/);
    assert.match(result.stderr, /tembiter-prepare-template/);
    assert.equal(existsSync(join(project.repo, ".agents")), false);
  });

  it("treats unprefixed prepare-template as unknown", () => {
    const root = tempDir();
    const template = createRepo(root, "template", "template");

    const result = runCli(
      ["skill", "install", "--skill", "prepare-template", "--path", template.repo],
      template.env,
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /Unknown skill 'prepare-template'/);
    assert.match(result.stderr, /tembiter-apply-template-update/);
    assert.match(result.stderr, /tembiter-prepare-template/);
    assert.equal(existsSync(join(template.repo, ".agents")), false);
  });

  it("fails when --path is not a git repository", () => {
    const root = tempDir();
    const dir = join(root, "not-git");
    mkdirSync(dir);
    writeConfig(dir, projectConfig("/path/to/template", "v1.0.0"));

    const result = runCli(
      ["skill", "install", "--skill", "tembiter-apply-template-update", "--path", dir],
    );

    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /not a git repository/);
  });

  it("fails when required flags are missing", () => {
    const result = runCli(["skill", "install"]);
    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /Missing required flags/);
    assert.match(result.stderr, /--skill/);
    assert.match(result.stderr, /--path/);
    assert.match(result.stderr, /Usage:/);
  });
});
