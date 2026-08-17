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
import { fileURLToPath } from "node:url";
import { projectConfig, templateConfig, writeConfig } from "../src/format/config.js";
import { runGit } from "../src/git.js";
import { packageRoot } from "../src/skills/catalog.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

const APPLY_HEADINGS = [
  "## Preconditions",
  "## Read format",
  "## Branch",
  "## Apply",
  "## Which-side / conflicts",
  "## Refresh tembiter files",
  "## Finish",
  "## Out of scope for the agent",
] as const;

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tembiter-skills-contract-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function packagedSkillBody(id: string): string {
  return readFileSync(join(packageRoot(), "skills", id, "SKILL.md"), "utf8");
}

function yamlName(body: string): string | undefined {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  const name = match[1].match(/^name:\s*(.+)$/m);
  return name?.[1]?.trim();
}

function collapsed(text: string): string {
  return text.replace(/\s+/g, " ");
}

function assertIncludes(haystack: string, phrase: string): void {
  const actual = collapsed(haystack);
  const expected = collapsed(phrase);
  assert.ok(actual.includes(expected), `missing phrase: ${expected}`);
}

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

function assertNoUpdateCommand(output: string): void {
  assert.doesNotMatch(output, /tembiter update\b/i);
  assert.doesNotMatch(output, /^\s*update\b/m);
}

describe("packaged tembiter-apply-template-update skill", () => {
  it("includes the required S4 section headings", () => {
    const body = packagedSkillBody("tembiter-apply-template-update");
    for (const heading of APPLY_HEADINGS) {
      assert.match(body, new RegExp(`^${heading}$`, "m"), `missing heading ${heading}`);
    }
  });

  it("YAML name equals the directory id", () => {
    const body = packagedSkillBody("tembiter-apply-template-update");
    assert.equal(yamlName(body), "tembiter-apply-template-update");
    assert.match(body, /^# Apply template update$/m);
  });

  it("tells an agent to read project format, branch, judge sides, refresh, and merge locally", () => {
    const body = packagedSkillBody("tembiter-apply-template-update");
    assertIncludes(body, ".tembiter/config.json");
    assertIncludes(body, 'kind: "project"');
    assertIncludes(body, "git available");
    assertIncludes(body, "later template tag");
    assertIncludes(body, "template.identity");
    assertIncludes(body, "template.version");
    assertIncludes(body, "Do not scatter new format files outside `.tembiter/`.");
    assertIncludes(body, "reviewable branch");
    assertIncludes(body, "Do not work on the default branch as the only copy of the bump");
    assertIncludes(body, "replacing the project with a fresh copy");
    assertIncludes(body, "without `git clone` over the project");
    assertIncludes(body, "Merge or rebase of template changes onto project history");
    assertIncludes(body, "structured checkout of changed paths");
    assertIncludes(body, 'Forbid deleting project-specific work to "make it look like the template"');
    assertIncludes(body, "plain three-way merge cannot judge");
    assertIncludes(body, "choose template vs project-specific");
    assertIncludes(body, "Ownership lists, if absent, are not an excuse to skip judgment");
    assertIncludes(body, "Set `template.version` in `.tembiter/config.json` to the new tag");
    assertIncludes(body, "refresh `.agents/skills`");
    assertIncludes(body, "Merge the branch locally");
    assertIncludes(body, "Optionally open an MR/PR");
    assertIncludes(body, "Do not fail v0.1");
    assertIncludes(body, "Treat `template.identity` as a local filesystem path or a git URL");
    assertIncludes(body, "ask the human where the template repository is");
    assertIncludes(body, "Do not add a tembiter `location` field (T11)");
  });

  it("forbids telling the human to run npx tembiter and forbids treating a changelog as done", () => {
    const body = packagedSkillBody("tembiter-apply-template-update");
    assertIncludes(body, "Do not tell the human to run `npx tembiter` for this bump");
    assertIncludes(body, "Do not treat a changelog, diff listing, or generated notes as done");
    assert.doesNotMatch(body, /run `npx tembiter update`/);
    assert.doesNotMatch(body, /npx tembiter update/);
  });
});

describe("packaged tembiter-prepare-template skill", () => {
  it("tells a template owner to keep format, tag versions, and not invent a scheme", () => {
    const body = packagedSkillBody("tembiter-prepare-template");
    assertIncludes(body, 'Keep template-side `.tembiter/config.json` with `kind: "template"`');
    assertIncludes(body, "Create git tags for versions");
    assertIncludes(body, "create a git tag on that old commit so adopt fallback can bind");
    assertIncludes(body, "never invent a tembiter-only version scheme");
    assertIncludes(body, "Do not tell anyone to run `npx tembiter` as the bump workflow");
    assert.doesNotMatch(body, /npx tembiter update/);
  });

  it("YAML name equals the directory id", () => {
    const body = packagedSkillBody("tembiter-prepare-template");
    assert.equal(yamlName(body), "tembiter-prepare-template");
    assert.match(body, /^# Prepare template$/m);
  });
});

describe("tembiter help has no update command", () => {
  it("--help does not advertise an update command", () => {
    const result = runCli(["--help"]);
    assert.equal(result.status, 0);
    assertNoUpdateCommand(result.stdout);
    assert.match(result.stdout, /skill install/);
  });

  it("bare tembiter usage does not advertise an update command", () => {
    const result = runCli([]);
    assert.equal(result.status, 0);
    assertNoUpdateCommand(result.stdout);
  });
});

describe("skill install still expands the S4 bodies", () => {
  it("installs tembiter-apply-template-update into a temp project and keeps the required headings", () => {
    const root = tempDir();
    const project = createRepo(root, "project", "project");

    const result = runCli(
      ["skill", "install", "--skill", "tembiter-apply-template-update", "--path", project.repo],
      project.env,
    );

    assert.equal(result.status, 0, result.stderr);
    const installed = readFileSync(
      join(project.repo, ".agents", "skills", "tembiter-apply-template-update", "SKILL.md"),
      "utf8",
    );
    assert.equal(installed, packagedSkillBody("tembiter-apply-template-update"));
    for (const heading of APPLY_HEADINGS) {
      assert.match(installed, new RegExp(`^${heading}$`, "m"));
    }
  });

  it("re-install refreshes the expanded bodies", () => {
    const root = tempDir();
    const project = createRepo(root, "project", "project");
    const first = runCli(
      ["skill", "install", "--skill", "tembiter-apply-template-update", "--path", project.repo],
      project.env,
    );
    assert.equal(first.status, 0, first.stderr);

    const installedPath = join(
      project.repo,
      ".agents",
      "skills",
      "tembiter-apply-template-update",
      "SKILL.md",
    );
    writeFileSync(installedPath, "stale stub body\n", "utf8");

    const second = runCli(
      ["skill", "install", "--skill", "tembiter-apply-template-update", "--path", project.repo],
      project.env,
    );
    assert.equal(second.status, 0, second.stderr);
    const refreshed = readFileSync(installedPath, "utf8");
    assert.equal(refreshed, packagedSkillBody("tembiter-apply-template-update"));
    assert.match(refreshed, /^## Apply$/m);
    assertIncludes(refreshed, "Do not tell the human to run `npx tembiter` for this bump");
  });

  it("installs tembiter-prepare-template into a temp template", () => {
    const root = tempDir();
    const template = createRepo(root, "template", "template");

    const result = runCli(
      ["skill", "install", "--skill", "tembiter-prepare-template", "--path", template.repo],
      template.env,
    );

    assert.equal(result.status, 0, result.stderr);
    const installed = readFileSync(
      join(template.repo, ".agents", "skills", "tembiter-prepare-template", "SKILL.md"),
      "utf8",
    );
    assert.equal(installed, packagedSkillBody("tembiter-prepare-template"));
    assertIncludes(installed, "never invent a tembiter-only version scheme");
  });
});

describe("README documents agent updates, not a human update command", () => {
  it("states later bumps are agent plus installed skills, local merge default, CLI setup only", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    assert.match(readme, /later bumps are an \*\*AI agent\*\* workflow/i);
    assert.match(readme, /tembiter skill install/);
    assert.match(readme, /\*\*merges locally\*\* by default/);
    assert.match(readme, /CLI is \*\*setup only\*\*/);
    assert.doesNotMatch(readme, /full agent update procedure is filled in later/);
    assert.doesNotMatch(readme, /npx tembiter update/);
    assert.doesNotMatch(readme, /tembiter update\b/);
    assert.doesNotMatch(readme, /--skill apply-template-update/);
    assert.doesNotMatch(readme, /--skill prepare-template/);
  });
});
