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
import { main, type MainOptions } from "../src/cli.js";
import { readConfig, templateConfig, writeConfig } from "../src/format/config.js";
import { gitText, runGit } from "../src/git.js";
import { formatPickerMenu, pickerLabels } from "../src/ui/picker.js";
import type { PromptIo } from "../src/ui/prompt.js";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "..", "src", "cli.js");
const packageJson = JSON.parse(
  readFileSync(join(here, "..", "..", "package.json"), "utf8"),
) as { version: string };

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tembiter-ui-"));
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
  return { repo, tag: "v1.0.0", env };
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

function createProjectRepo(root: string, env: NodeJS.ProcessEnv, name = "project"): string {
  const repo = join(root, name);
  mkdirSync(repo);
  writeFileSync(join(repo, "unique-project.txt"), "project only\n", "utf8");
  runGit(["init"], { cwd: repo, env });
  runGit(["add", "-A"], { cwd: repo, env });
  runGit(["commit", "-m", "project first commit"], { cwd: repo, env });
  return repo;
}

function createSkillRepo(
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
    writeConfig(repo, {
      formatVersion: 1,
      kind: "project",
      template: { identity: "/path/to/template", version: "v1.0.0" },
    });
  } else {
    writeConfig(repo, templateConfig());
  }
  runGit(["init"], { cwd: repo, env });
  runGit(["add", "-A"], { cwd: repo, env });
  runGit(["commit", "-m", `${name} commit`], { cwd: repo, env });
  return { repo, env };
}

function scriptedPrompt(answers: string[]): PromptIo & { questions: string[]; writes: string[] } {
  const remaining = [...answers];
  const questions: string[] = [];
  const writes: string[] = [];
  return {
    questions,
    writes,
    write(text: string) {
      writes.push(text);
    },
    question(query: string) {
      questions.push(query);
      const next = remaining.shift();
      if (next === undefined) {
        return Promise.reject(new Error(`No scripted answer for: ${query}`));
      }
      return Promise.resolve(next);
    },
    close() {},
  };
}

function throwingPrompt(): PromptIo {
  return {
    write() {
      throw new Error("prompt write should not be called");
    },
    question() {
      return Promise.reject(new Error("prompt should not be called"));
    },
    close() {},
  };
}

function ttyStreams(): Pick<MainOptions, "stdin" | "stdout"> {
  return {
    stdin: { isTTY: true } as MainOptions["stdin"],
    stdout: { isTTY: true } as MainOptions["stdout"],
  };
}

async function runMain(
  args: string[],
  options: MainOptions = {},
): Promise<{ status: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
    stdout += String(chunk);
    if (typeof encoding === "function") {
      encoding();
    }
    if (typeof cb === "function") {
      cb();
    }
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
    stderr += String(chunk);
    if (typeof encoding === "function") {
      encoding();
    }
    if (typeof cb === "function") {
      cb();
    }
    return true;
  }) as typeof process.stderr.write;

  try {
    const status = await main(["node", "tembiter", ...args], options);
    return { status, stdout, stderr };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

function spawnCli(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

describe("interactive setup UI", () => {
  it("picker lists only the four setup commands and never lists update", () => {
    const labels = pickerLabels();
    assert.deepEqual(labels, ["init", "template register", "adopt", "skill install"]);
    assert.equal(labels.includes("update"), false);
    const menu = formatPickerMenu();
    assert.match(menu, /init/);
    assert.match(menu, /template register/);
    assert.match(menu, /adopt/);
    assert.match(menu, /skill install/);
    assert.doesNotMatch(menu, /update/);
  });

  it("fake picker answers for init produce the same git and format effects as flags", async () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "project");
    const prompt = scriptedPrompt(["1", fixture.repo, target, fixture.tag, ""]);

    const result = await runMain([], {
      ...ttyStreams(),
      prompt,
      env: fixture.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(prompt.questions, [
      "Command: ",
      "--template: ",
      "--target: ",
      "--tag: ",
      "--message: ",
    ]);
    assert.match(prompt.writes.join(""), /init/);
    assert.doesNotMatch(prompt.writes.join(""), /update/);
    assert.equal(gitText(["rev-list", "--count", "HEAD"], { cwd: target, env: fixture.env }), "1");
    assert.equal(
      gitText(["log", "-1", "--format=%s"], { cwd: target, env: fixture.env }),
      "Initial commit",
    );
    assert.equal(readFileSync(join(target, "known.txt"), "utf8"), "hello from template\n");
    const config = readConfig(target);
    assert.equal(config.kind, "project");
    if (config.kind === "project") {
      assert.equal(config.template.identity, fixture.repo);
      assert.equal(config.template.version, fixture.tag);
    }
  });

  it("TTY init without required flags prompts then matches the flags path", async () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "from-prompt");
    const prompt = scriptedPrompt([fixture.repo, target, fixture.tag, "Custom start"]);

    const result = await runMain(["init"], {
      ...ttyStreams(),
      prompt,
      env: fixture.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(prompt.questions, [
      "--template: ",
      "--target: ",
      "--tag: ",
      "--message: ",
    ]);
    assert.equal(
      gitText(["log", "-1", "--format=%s"], { cwd: target, env: fixture.env }),
      "Custom start",
    );
    assert.equal(readConfig(target).kind, "project");
  });

  it("complete flags skip prompts even on a TTY", async () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "complete");

    const result = await runMain(
      ["init", "--template", fixture.repo, "--target", target, "--tag", fixture.tag],
      {
        ...ttyStreams(),
        prompt: throwingPrompt(),
        env: fixture.env,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readConfig(target).kind, "project");
  });

  it("fake picker answers for template register match the flags path", async () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const repo = join(root, "to-register");
    mkdirSync(repo);
    writeFileSync(join(repo, "known.txt"), "hello from template\n", "utf8");
    runGit(["init"], { cwd: repo, env: fixture.env });
    runGit(["add", "known.txt"], { cwd: repo, env: fixture.env });
    runGit(["commit", "-m", "existing history"], { cwd: repo, env: fixture.env });
    const parent = gitText(["rev-parse", "HEAD"], { cwd: repo, env: fixture.env });
    const prompt = scriptedPrompt(["2", repo, ""]);

    const result = await runMain([], {
      ...ttyStreams(),
      prompt,
      env: fixture.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(prompt.questions, ["Command: ", "--path: ", "--message: "]);
    const config = readConfig(repo);
    assert.equal(config.kind, "template");
    assert.equal(gitText(["rev-list", "--count", "HEAD"], { cwd: repo, env: fixture.env }), "2");
    assert.equal(gitText(["rev-parse", "HEAD^"], { cwd: repo, env: fixture.env }), parent);
    assert.equal(
      gitText(["log", "-1", "--format=%s"], { cwd: repo, env: fixture.env }),
      "Register tembiter template",
    );
  });

  it("fake prompt answers for adopt match the flags path", async () => {
    const root = tempDir();
    const template = createTemplateFixture(root);
    const project = createProjectRepo(root, template.env);
    const parentBefore = gitText(["rev-parse", "HEAD"], {
      cwd: project,
      env: template.env,
    });
    const prompt = scriptedPrompt([template.repo, template.tag, project, ""]);

    const result = await runMain(["adopt"], {
      ...ttyStreams(),
      prompt,
      env: template.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(prompt.questions, [
      "--template: ",
      "--tag: ",
      "--project: ",
      "--message: ",
    ]);
    assert.equal(
      gitText(["rev-parse", "HEAD^"], { cwd: project, env: template.env }),
      parentBefore,
    );
    const config = readConfig(project);
    assert.equal(config.kind, "project");
    if (config.kind === "project") {
      assert.equal(config.template.identity, template.repo);
      assert.equal(config.template.version, template.tag);
    }
    assert.equal(existsSync(join(project, "known.txt")), false);
  });

  it("adopt no-tags fallback stays assistance-only after prompts", async () => {
    const root = tempDir();
    const home = join(root, "home");
    mkdirSync(home);
    const env = gitTestEnv(home);
    const template = createUntaggedTemplate(root, env);
    const project = createProjectRepo(root, env);
    const countBefore = gitText(["rev-list", "--count", "HEAD"], { cwd: project, env });
    const prompt = scriptedPrompt([template, "", project, ""]);

    const result = await runMain(["adopt"], {
      ...ttyStreams(),
      prompt,
      env,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /assistance only/);
    assert.match(result.stderr, /Did not bind the project/);
    assert.equal(existsSync(join(project, ".tembiter")), false);
    assert.equal(gitText(["rev-list", "--count", "HEAD"], { cwd: project, env }), countBefore);
  });

  it("fake prompt answers for skill install match the flags path", async () => {
    const root = tempDir();
    const project = createSkillRepo(root, "project", "project");
    const prompt = scriptedPrompt(["apply-template-update", project.repo]);

    const result = await runMain(["skill", "install"], {
      ...ttyStreams(),
      prompt,
      env: project.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(prompt.questions, ["--skill: ", "--path: "]);
    const installed = join(
      project.repo,
      ".agents",
      "skills",
      "apply-template-update",
      "SKILL.md",
    );
    assert.equal(existsSync(installed), true);
    assert.match(readFileSync(installed, "utf8"), /Apply template update/);
  });

  it("--non-interactive missing flags stay a usage error even when streams look like a TTY", async () => {
    const result = await runMain(["--non-interactive", "init"], {
      ...ttyStreams(),
      prompt: throwingPrompt(),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing required flags/);
    assert.match(result.stderr, /--template/);
  });

  it("non-TTY missing flags stay a usage error without prompting", async () => {
    const result = await runMain(["init"], {
      stdin: { isTTY: false } as MainOptions["stdin"],
      stdout: { isTTY: false } as MainOptions["stdout"],
      prompt: throwingPrompt(),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing required flags/);
  });

  it("non-TTY no-args still prints usage and exits 0 without hanging", () => {
    const result = spawnCli([]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /tembiter/);
    assert.match(result.stdout, /init/);
  });

  it("picker cancel exits non-zero without writing files", async () => {
    const root = tempDir();
    const prompt = scriptedPrompt([""]);
    const result = await runMain([], {
      ...ttyStreams(),
      prompt,
    });
    assert.equal(result.status, 1);
    assert.equal(existsSync(join(root, ".tembiter")), false);
  });

  it("--help and --version stay non-prompting on a TTY", async () => {
    const help = await runMain(["--help"], {
      ...ttyStreams(),
      prompt: throwingPrompt(),
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /init/);

    const version = await runMain(["--version"], {
      ...ttyStreams(),
      prompt: throwingPrompt(),
    });
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), packageJson.version);
  });
});
