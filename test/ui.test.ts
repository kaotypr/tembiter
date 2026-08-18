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
import { TITLE, formatBanner, printBanner } from "../src/ui/banner.js";
import { bold, cyan, dim, inverse, magenta } from "../src/ui/color.js";
import { formatPickerMenu, pickerLabels, pickerSelectChoices } from "../src/ui/picker.js";
import { PromptCancelled, type PromptIo } from "../src/ui/prompt.js";
import { selectChoice } from "../src/ui/select.js";

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

function scriptedPrompt(
  answers: string[],
  selectValue?: string[],
): PromptIo & { questions: string[]; writes: string[] } {
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
    select<T = string[]>() {
      if (selectValue === undefined) {
        return Promise.reject(new Error("select should not be called"));
      }
      return Promise.resolve(selectValue as T);
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
    select() {
      return Promise.reject(new Error("select should not be called"));
    },
    close() {},
  };
}

function cancellingSelectPrompt(): PromptIo {
  return {
    write() {},
    question() {
      return Promise.reject(new Error("question should not be called"));
    },
    select() {
      return Promise.reject(new PromptCancelled());
    },
    close() {},
  };
}

function fakeRawStdin(): NodeJS.ReadStream & { emitData: (chunk: string) => void } {
  const listeners = new Map<string, Set<(chunk: string) => void>>();
  const stdin = {
    isTTY: true,
    isRaw: false,
    setRawMode(mode: boolean) {
      stdin.isRaw = mode;
      return stdin;
    },
    resume() {
      return stdin;
    },
    pause() {
      return stdin;
    },
    setEncoding() {
      return stdin;
    },
    on(event: string, fn: (chunk: string) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
      return stdin;
    },
    off(event: string, fn: (chunk: string) => void) {
      listeners.get(event)?.delete(fn);
      return stdin;
    },
    emitData(chunk: string) {
      for (const fn of listeners.get("data") ?? []) {
        fn(chunk);
      }
    },
  };
  return stdin as unknown as NodeJS.ReadStream & { emitData: (chunk: string) => void };
}

function withTimeout<T>(promise: Promise<T>, ms = 1000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("select timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
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
  it("TITLE is Tembiter and the banner includes the hinge, not TEMBITER", () => {
    assert.equal(TITLE, "Tembiter");
    const banner = formatBanner({ env: { NO_COLOR: "1" }, stream: { isTTY: true } });
    assert.match(banner, /template/);
    assert.match(banner, /project/);
    assert.match(banner, /◆/);
    assert.match(banner, /Arbiter for template format, setup CLI, and skills/);
    assert.doesNotMatch(banner, /TEMBITER/);
    for (const line of banner.split("\n")) {
      assert.ok(line.length <= 80, JSON.stringify(line));
    }

    const printed: string[] = [];
    printBanner(
      {
        isTTY: false,
        write(chunk: string) {
          printed.push(chunk);
          return true;
        },
      } as unknown as NodeJS.WritableStream & { isTTY?: boolean },
      { NO_COLOR: "1" },
    );
    const out = printed.join("");
    assert.match(out, /template/);
    assert.match(out, /project/);
    assert.match(out, /◆/);
    assert.doesNotMatch(out, /TEMBITER/);
  });

  it("color helper returns plain text when NO_COLOR is set", () => {
    const ctx = { env: { NO_COLOR: "1" }, stream: { isTTY: true } };
    assert.equal(cyan("hello", ctx), "hello");
    assert.equal(magenta("◆", ctx), "◆");
    assert.equal(dim("template", ctx), "template");
    assert.equal(bold("T", ctx), "T");
    assert.equal(inverse("init", ctx), "init");
  });

  it("picker lists only the four setup commands and never lists update", () => {
    const labels = pickerLabels();
    assert.deepEqual(labels, ["init", "template register", "adopt", "skill install"]);
    assert.equal(labels.includes("update"), false);
    const menu = formatPickerMenu();
    assert.match(menu, /init/);
    assert.match(menu, /template register/);
    assert.match(menu, /adopt/);
    assert.match(menu, /skill install/);
    assert.match(menu, /Start a new project from a template tag/);
    assert.match(menu, /Mark a git repository as a tembiter template/);
    assert.match(menu, /Connect an existing project to a tagged template/);
    assert.match(menu, /Install a packaged skill onto a template or project/);
    assert.doesNotMatch(menu, /update/);
    const choices = pickerSelectChoices();
    assert.deepEqual(
      choices.map((choice) => choice.value),
      [["init"], ["template", "register"], ["adopt"], ["skill", "install"]],
    );
    assert.deepEqual(
      choices.map((choice) => choice.label),
      ["init", "template register", "adopt", "skill install"],
    );
    assert.deepEqual(
      choices.map((choice) => choice.description),
      [
        "Start a new project from a template tag",
        "Mark a git repository as a tembiter template",
        "Connect an existing project to a tagged template",
        "Install a packaged skill onto a template or project",
      ],
    );
  });

  it("fake picker answers for init produce the same git and format effects as flags", async () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "project");
    const prompt = scriptedPrompt([fixture.repo, target, fixture.tag, ""], ["init"]);

    const result = await runMain([], {
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
    const initWrites = prompt.writes.join("");
    assert.match(initWrites, /Template repository/);
    assert.match(initWrites, /Local git repository path or git URL \(file:\/\/ allowed\)/);
    assert.match(initWrites, /New project directory/);
    assert.match(initWrites, /Destination directory \(must not exist or must be empty\)/);
    assert.match(initWrites, /Template version/);
    assert.match(initWrites, /An existing git tag on that repository/);
    assert.match(initWrites, /First-commit message/);
    assert.match(initWrites, /Overrides the first commit message/);
    assert.match(initWrites, /optional, Enter for "Initial commit"/);
    assert.match(result.stdout, /template/);
    assert.match(result.stdout, /project/);
    assert.match(result.stdout, /◆/);
    assert.doesNotMatch(result.stdout, /TEMBITER/);
    assert.match(result.stdout, /Copying tag v1\.0\.0 into /);
    assert.match(result.stdout, /Done\. Created project at /);
    assert.ok(result.stdout.includes(target));
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
    const promptWrites = prompt.writes.join("");
    assert.match(promptWrites, /Template repository/);
    assert.match(promptWrites, /First-commit message/);
    assert.doesNotMatch(result.stdout, /◆/);
    assert.doesNotMatch(prompt.writes.join(""), /◆/);
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
    assert.match(result.stdout, /Copying tag v1\.0\.0 into /);
    assert.match(result.stdout, /Done\. Created project at /);
    assert.ok(result.stdout.includes(target));
    assert.doesNotMatch(result.stdout, /Cloning template/);
  });

  it("TTY init with a missing tag prints Failed and does not write a project", async () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "missing-tag");

    const result = await runMain(
      ["init", "--template", fixture.repo, "--target", target, "--tag", "no-such-tag"],
      {
        ...ttyStreams(),
        prompt: throwingPrompt(),
        env: fixture.env,
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Failed\./);
    assert.match(result.stderr, /Pass an existing --tag/);
    assert.doesNotMatch(result.stdout, /Pass an existing --tag/);
    assert.equal(existsSync(join(target, ".tembiter")), false);
    assert.equal(existsSync(join(target, ".git")), false);
  });

  it("non-TTY successful init does not print Done", async () => {
    const root = tempDir();
    const fixture = createTemplateFixture(root);
    const target = join(root, "quiet");

    const result = await runMain(
      ["init", "--template", fixture.repo, "--target", target, "--tag", fixture.tag],
      {
        stdin: { isTTY: false } as MainOptions["stdin"],
        stdout: { isTTY: false } as MainOptions["stdout"],
        prompt: throwingPrompt(),
        env: fixture.env,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /Done\./);
    assert.doesNotMatch(result.stdout, /Copying tag/);
    assert.doesNotMatch(result.stdout, /Failed\./);
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
    const prompt = scriptedPrompt([repo, ""], ["template", "register"]);

    const result = await runMain([], {
      ...ttyStreams(),
      prompt,
      env: fixture.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(prompt.questions, ["--path: ", "--message: "]);
    const registerWrites = prompt.writes.join("");
    assert.match(registerWrites, /Template repository/);
    assert.match(registerWrites, /Git repository to mark/);
    assert.match(registerWrites, /Commit message/);
    assert.match(registerWrites, /Overrides the register commit message/);
    assert.match(registerWrites, /optional, Enter for "current working directory"/);
    assert.match(registerWrites, /optional, Enter for "Register tembiter template"/);
    assert.match(result.stdout, /Done\. Registered template at /);
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
    const adoptWrites = prompt.writes.join("");
    assert.match(adoptWrites, /Template repository/);
    assert.match(adoptWrites, /Existing git tag; omit when the template has no tags/);
    assert.match(adoptWrites, /Project repository/);
    assert.match(adoptWrites, /Overrides the connect commit message/);
    assert.match(result.stdout, /Done\. Connected /);
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
    assert.match(result.stdout, /write \.tembiter\//);
    assert.match(result.stdout, /Failed\./);
    assert.match(result.stderr, /Did not bind the project/);
    assert.equal(existsSync(join(project, ".tembiter")), false);
    assert.equal(gitText(["rev-list", "--count", "HEAD"], { cwd: project, env }), countBefore);
  });

  it("fake picker select for adopt produces the same git and format effects as flags", async () => {
    const root = tempDir();
    const template = createTemplateFixture(root);
    const project = createProjectRepo(root, template.env, "from-picker");
    const parentBefore = gitText(["rev-parse", "HEAD"], {
      cwd: project,
      env: template.env,
    });
    const prompt = scriptedPrompt([template.repo, template.tag, project, ""], ["adopt"]);

    const result = await runMain([], {
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
  });

  it("fake prompt answers for skill install match the flags path", async () => {
    const root = tempDir();
    const project = createSkillRepo(root, "project", "project");
    const prompt = scriptedPrompt(["tembiter-sync", project.repo]);

    const result = await runMain(["skill", "install"], {
      ...ttyStreams(),
      prompt,
      env: project.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(prompt.questions, ["--skill: ", "--path: "]);
    const skillWrites = prompt.writes.join("");
    assert.match(skillWrites, /Skill id/);
    assert.match(
      skillWrites,
      /Catalog id \(tembiter-sync \(project\), tembiter-setup \(template\)\)/,
    );
    assert.match(skillWrites, /Repository root/);
    assert.match(skillWrites, /Template or project repository root/);
    assert.match(result.stdout, /Done\. Installed tembiter-sync at /);
    const installed = join(
      project.repo,
      ".agents",
      "skills",
      "tembiter-sync",
      "SKILL.md",
    );
    assert.equal(existsSync(installed), true);
    assert.match(readFileSync(installed, "utf8"), /Apply template update/);
  });

  it("fake picker select for skill install produces the same install as flags", async () => {
    const root = tempDir();
    const project = createSkillRepo(root, "picker-project", "project");
    const prompt = scriptedPrompt(["tembiter-sync", project.repo], ["skill", "install"]);

    const result = await runMain([], {
      ...ttyStreams(),
      prompt,
      env: project.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(prompt.questions, ["--skill: ", "--path: "]);
    assert.equal(
      existsSync(join(project.repo, ".agents", "skills", "tembiter-sync", "SKILL.md")),
      true,
    );
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
    const prompt = cancellingSelectPrompt();
    const result = await runMain([], {
      ...ttyStreams(),
      prompt,
    });
    assert.equal(result.status, 1);
    assert.equal(existsSync(join(root, ".tembiter")), false);
  });

  it("--non-interactive no-args prints usage and does not prompt", async () => {
    const result = await runMain(["--non-interactive"], {
      ...ttyStreams(),
      prompt: throwingPrompt(),
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.doesNotMatch(result.stdout, /◆/);
  });

  it("falls back to the numbered prompt when raw mode is unavailable", async () => {
    const questions: string[] = [];
    const writes: string[] = [];
    const value = await selectChoice(pickerSelectChoices(), {
      stdin: { isTTY: false } as unknown as NodeJS.ReadableStream,
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as unknown as NodeJS.WritableStream,
      question: (query) => {
        questions.push(query);
        return Promise.resolve("4");
      },
    });
    assert.deepEqual(value, ["skill", "install"]);
    assert.deepEqual(questions, ["Command: "]);
    const numbered = writes.join("");
    assert.match(numbered, /1\) init/);
    assert.match(numbered, /Start a new project from a template tag/);
    assert.match(numbered, /Install a packaged skill onto a template or project/);
    assert.doesNotMatch(numbered, /update/);
  });

  it("raw-mode select moves with arrows and confirms Enter without a real TTY", async () => {
    const stdin = fakeRawStdin();
    const writes: string[] = [];
    const pending = selectChoice(pickerSelectChoices(), {
      stdin,
      stdout: {
        isTTY: true,
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as unknown as NodeJS.WritableStream & { isTTY?: boolean },
    });
    queueMicrotask(() => {
      stdin.emitData("\x1b[B");
      stdin.emitData("\r");
    });
    assert.deepEqual(await withTimeout(pending), ["template", "register"]);
    const rawOut = writes.join("");
    assert.match(rawOut, /Start a new project from a template tag/);
    assert.match(rawOut, /Mark a git repository as a tembiter template/);
    assert.match(rawOut, /\x1b\[10F/);
  });

  it("raw-mode select treats digit 1-4 as an immediate choice", async () => {
    const stdin = fakeRawStdin();
    const pending = selectChoice(pickerSelectChoices(), {
      stdin,
      stdout: {
        isTTY: true,
        write() {
          return true;
        },
      } as unknown as NodeJS.WritableStream & { isTTY?: boolean },
    });
    queueMicrotask(() => {
      stdin.emitData("3");
    });
    assert.deepEqual(await withTimeout(pending), ["adopt"]);
  });

  it("raw-mode Ctrl-C cancels without hanging", async () => {
    const stdin = fakeRawStdin();
    const pending = selectChoice(pickerSelectChoices(), {
      stdin,
      stdout: {
        isTTY: true,
        write() {
          return true;
        },
      } as unknown as NodeJS.WritableStream & { isTTY?: boolean },
    });
    queueMicrotask(() => {
      stdin.emitData("\x03");
    });
    await assert.rejects(withTimeout(pending), (err: unknown) => err instanceof PromptCancelled);
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
