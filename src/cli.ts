#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAdoptFlags,
  printAdoptUsage,
  runAdopt,
  type AdoptFlags,
} from "./commands/adopt.js";
import {
  parseInitFlags,
  printInitUsage,
  runInit,
  type InitFlags,
} from "./commands/init.js";
import {
  parseRegisterFlags,
  printRegisterUsage,
  runRegister,
  type RegisterFlags,
} from "./commands/register.js";
import {
  parseSkillInstallFlags,
  printSkillInstallUsage,
  runSkillInstall,
  type SkillInstallFlags,
} from "./commands/skill-install.js";
import { printBanner } from "./ui/banner.js";
import { pickSetupCommand } from "./ui/picker.js";
import {
  createProgressReporter,
  type ProgressReporter,
} from "./ui/progress.js";
import {
  createReadlinePrompt,
  detectInteractive,
  PromptCancelled,
  promptFlag,
  type PromptFlagOptions,
  type PromptIo,
  type TtyLike,
} from "./ui/prompt.js";

const PACKAGE_NAME = "tembiter";
const PACKAGE_VERSION = readPackageVersion();

function readPackageVersion(): string {
  const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(`package.json is missing a version at ${packageJsonPath}`);
  }
  return pkg.version;
}

export type MainOptions = {
  stdin?: NodeJS.ReadableStream & TtyLike;
  stdout?: NodeJS.WritableStream & TtyLike;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  prompt?: PromptIo;
};

type CommandContext = {
  interactive: boolean;
  fromPicker: boolean;
  env: NodeJS.ProcessEnv;
  cwd: string;
  ensurePrompt: () => PromptIo;
  closePrompt: () => void;
  progress: ProgressReporter;
};

const INIT_FIELDS = {
  template: {
    title: "Template repository",
    description: "Local git repository path or git URL (file:// allowed)",
    required: true,
  },
  target: {
    title: "New project directory",
    description: "Destination directory (must not exist or must be empty)",
    required: true,
  },
  tag: {
    title: "Template version",
    description: "An existing git tag on that repository",
    required: true,
  },
  message: {
    title: "First-commit message",
    description: "Overrides the first commit message",
    required: false,
    defaultLabel: "Initial commit",
  },
} as const satisfies Record<string, PromptFlagOptions>;

const REGISTER_FIELDS = {
  path: {
    title: "Template repository",
    description: "Git repository to mark",
    required: false,
    defaultLabel: "current working directory",
  },
  message: {
    title: "Commit message",
    description: "Overrides the register commit message",
    required: false,
    defaultLabel: "Register tembiter template",
  },
} as const satisfies Record<string, PromptFlagOptions>;

const ADOPT_FIELDS = {
  template: {
    title: "Template repository",
    description: "Local git repository path or git URL (file:// allowed)",
    required: true,
  },
  tag: {
    title: "Template version",
    description: "Existing git tag; omit when the template has no tags",
    required: false,
  },
  project: {
    title: "Project repository",
    description: "Project git repository",
    required: false,
    defaultLabel: "current working directory",
  },
  message: {
    title: "Commit message",
    description: "Overrides the connect commit message",
    required: false,
    defaultLabel: "Connect tembiter to <identity>@<tag>",
  },
} as const satisfies Record<string, PromptFlagOptions>;

const SKILL_INSTALL_FIELDS = {
  skill: {
    title: "Skill id",
    description:
      "Catalog id (tembiter-apply-template-update, tembiter-prepare-template)",
    required: true,
  },
  path: {
    title: "Repository root",
    description: "Template or project repository root",
    required: true,
  },
} as const satisfies Record<string, PromptFlagOptions>;

function printUsage(stream: NodeJS.WritableStream): void {
  stream.write(`${PACKAGE_NAME} ${PACKAGE_VERSION}\n`);
  stream.write("\n");
  stream.write("Usage:\n");
  stream.write("  tembiter\n");
  stream.write(
    "  tembiter init --template <path-or-url> --target <dir> --tag <git-tag> [--message <text>]\n",
  );
  stream.write("  tembiter template register [--path <dir>] [--message <text>]\n");
  stream.write(
    "  tembiter adopt --template <path-or-url> [--tag <git-tag>] [--project <dir>] [--message <text>]\n",
  );
  stream.write("  tembiter skill install --skill <id> --path <dir>\n");
  stream.write("  tembiter --non-interactive <command> [flags]\n");
  stream.write("  tembiter --help\n");
  stream.write("  tembiter --version\n");
}

function flagArgs(flags: object): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(flags)) {
    if (key === "help" || value === undefined || typeof value === "boolean") {
      continue;
    }
    args.push(`--${key}`, String(value));
  }
  return args;
}

function missingInit(flags: InitFlags): string[] {
  const missing: string[] = [];
  if (flags.template === undefined || flags.template.length === 0) {
    missing.push("template");
  }
  if (flags.target === undefined || flags.target.length === 0) {
    missing.push("target");
  }
  if (flags.tag === undefined || flags.tag.length === 0) {
    missing.push("tag");
  }
  return missing;
}

function missingAdopt(flags: AdoptFlags): string[] {
  if (flags.template === undefined || flags.template.length === 0) {
    return ["template"];
  }
  return [];
}

function missingSkillInstall(flags: SkillInstallFlags): string[] {
  const missing: string[] = [];
  if (flags.skill === undefined || flags.skill.length === 0) {
    missing.push("skill");
  }
  if (flags.path === undefined || flags.path.length === 0) {
    missing.push("path");
  }
  return missing;
}

async function assignOptional(
  flags: { [key: string]: string | boolean | undefined },
  key: string,
  io: PromptIo,
  options: PromptFlagOptions,
): Promise<void> {
  if (flags[key] !== undefined) {
    return;
  }
  const value = await promptFlag(io, key, options);
  if (value !== undefined) {
    flags[key] = value;
  }
}

function afterFill(ctx: CommandContext): void {
  ctx.closePrompt();
  process.stdout.write("\n");
}

async function fillInit(flags: InitFlags, io: PromptIo): Promise<void> {
  if (flags.template === undefined || flags.template.length === 0) {
    flags.template = await promptFlag(io, "template", INIT_FIELDS.template);
  }
  if (flags.target === undefined || flags.target.length === 0) {
    flags.target = await promptFlag(io, "target", INIT_FIELDS.target);
  }
  if (flags.tag === undefined || flags.tag.length === 0) {
    flags.tag = await promptFlag(io, "tag", INIT_FIELDS.tag);
  }
  await assignOptional(flags, "message", io, INIT_FIELDS.message);
}

async function fillRegister(flags: RegisterFlags, io: PromptIo): Promise<void> {
  await assignOptional(flags, "path", io, REGISTER_FIELDS.path);
  await assignOptional(flags, "message", io, REGISTER_FIELDS.message);
}

async function fillAdopt(flags: AdoptFlags, io: PromptIo): Promise<void> {
  if (flags.template === undefined || flags.template.length === 0) {
    flags.template = await promptFlag(io, "template", ADOPT_FIELDS.template);
  }
  await assignOptional(flags, "tag", io, ADOPT_FIELDS.tag);
  await assignOptional(flags, "project", io, ADOPT_FIELDS.project);
  await assignOptional(flags, "message", io, ADOPT_FIELDS.message);
}

async function fillSkillInstall(flags: SkillInstallFlags, io: PromptIo): Promise<void> {
  if (flags.skill === undefined || flags.skill.length === 0) {
    flags.skill = await promptFlag(io, "skill", SKILL_INSTALL_FIELDS.skill);
  }
  if (flags.path === undefined || flags.path.length === 0) {
    flags.path = await promptFlag(io, "path", SKILL_INSTALL_FIELDS.path);
  }
}

async function handleInit(commandArgs: string[], ctx: CommandContext): Promise<number> {
  const run = (args: string[]): number =>
    runInit(args, { env: ctx.env, progress: ctx.progress });

  if (!ctx.interactive) {
    return run(commandArgs);
  }

  let flags: InitFlags;
  try {
    flags = parseInitFlags(commandArgs);
  } catch {
    return run(commandArgs);
  }
  if (flags.help) {
    return run(commandArgs);
  }
  if (ctx.fromPicker || missingInit(flags).length > 0) {
    await fillInit(flags, ctx.ensurePrompt());
    afterFill(ctx);
    return run(flagArgs(flags));
  }
  return run(commandArgs);
}

async function handleRegister(commandArgs: string[], ctx: CommandContext): Promise<number> {
  const run = (args: string[]): number =>
    runRegister(args, { env: ctx.env, progress: ctx.progress });

  if (!ctx.interactive) {
    return run(commandArgs);
  }

  let flags: RegisterFlags;
  try {
    flags = parseRegisterFlags(commandArgs);
  } catch {
    return run(commandArgs);
  }
  if (flags.help) {
    return run(commandArgs);
  }
  if (ctx.fromPicker) {
    await fillRegister(flags, ctx.ensurePrompt());
    afterFill(ctx);
    return run(flagArgs(flags));
  }
  return run(commandArgs);
}

async function handleAdopt(commandArgs: string[], ctx: CommandContext): Promise<number> {
  const run = (args: string[]): number =>
    runAdopt(args, { env: ctx.env, cwd: ctx.cwd, progress: ctx.progress });

  if (!ctx.interactive) {
    return run(commandArgs);
  }

  let flags: AdoptFlags;
  try {
    flags = parseAdoptFlags(commandArgs);
  } catch {
    return run(commandArgs);
  }
  if (flags.help) {
    return run(commandArgs);
  }
  if (ctx.fromPicker || missingAdopt(flags).length > 0) {
    await fillAdopt(flags, ctx.ensurePrompt());
    afterFill(ctx);
    return run(flagArgs(flags));
  }
  return run(commandArgs);
}

async function handleSkillInstall(commandArgs: string[], ctx: CommandContext): Promise<number> {
  const run = (args: string[]): number =>
    runSkillInstall(args, { progress: ctx.progress });

  if (!ctx.interactive) {
    return run(commandArgs);
  }

  let flags: SkillInstallFlags;
  try {
    flags = parseSkillInstallFlags(commandArgs);
  } catch {
    return run(commandArgs);
  }
  if (flags.help) {
    return run(commandArgs);
  }
  if (ctx.fromPicker || missingSkillInstall(flags).length > 0) {
    await fillSkillInstall(flags, ctx.ensurePrompt());
    afterFill(ctx);
    return run(flagArgs(flags));
  }
  return run(commandArgs);
}

async function dispatch(args: string[], ctx: CommandContext): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h") {
    printUsage(process.stdout);
    return 0;
  }

  if (args[0] === "--version") {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return 0;
  }

  if (args[0] === "init") {
    if (args.length === 2 && (args[1] === "--help" || args[1] === "-h")) {
      printInitUsage(process.stdout);
      return 0;
    }
    return handleInit(args.slice(1), ctx);
  }

  if (args[0] === "template") {
    if (args[1] === "register") {
      if (args.length === 3 && (args[2] === "--help" || args[2] === "-h")) {
        printRegisterUsage(process.stdout);
        return 0;
      }
      return handleRegister(args.slice(2), ctx);
    }
    const rest = args[1] === undefined ? "template" : `template ${args[1]}`;
    process.stderr.write(`Not implemented: ${rest}\n`);
    printUsage(process.stderr);
    return 1;
  }

  if (args[0] === "adopt") {
    if (args.length === 2 && (args[1] === "--help" || args[1] === "-h")) {
      printAdoptUsage(process.stdout);
      return 0;
    }
    return handleAdopt(args.slice(1), ctx);
  }

  if (args[0] === "skill") {
    if (args[1] === "install") {
      if (args.length === 3 && (args[2] === "--help" || args[2] === "-h")) {
        printSkillInstallUsage(process.stdout);
        return 0;
      }
      return handleSkillInstall(args.slice(2), ctx);
    }
    const rest = args[1] === undefined ? "skill" : `skill ${args[1]}`;
    process.stderr.write(`Not implemented: ${rest}\n`);
    printUsage(process.stderr);
    return 1;
  }

  process.stderr.write(`Not implemented: ${args[0]}\n`);
  printUsage(process.stderr);
  return 1;
}

export async function main(argv: string[], options: MainOptions = {}): Promise<number> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const interactive = detectInteractive(argv, stdin, stdout);
  const args = argv.slice(2).filter((arg) => arg !== "--non-interactive");
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  let prompt = options.prompt;
  let createdPrompt = false;
  const progress = createProgressReporter(stdout);

  const ensurePrompt = (): PromptIo => {
    if (prompt === undefined) {
      prompt = createReadlinePrompt(stdin, stdout);
      createdPrompt = true;
    }
    return prompt;
  };

  const closePrompt = (): void => {
    prompt?.close();
  };

  const ctx: CommandContext = {
    interactive,
    fromPicker: false,
    env,
    cwd,
    ensurePrompt,
    closePrompt,
    progress,
  };

  try {
    if (args.length === 0) {
      if (!interactive) {
        printUsage(process.stdout);
        return 0;
      }
      printBanner(process.stdout, env);
      const picked = await pickSetupCommand(ensurePrompt());
      return await dispatch(picked, { ...ctx, fromPicker: true });
    }
    return await dispatch(args, ctx);
  } catch (err) {
    if (err instanceof PromptCancelled) {
      return 1;
    }
    throw err;
  } finally {
    if (createdPrompt) {
      prompt?.close();
    }
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    const self = resolve(fileURLToPath(import.meta.url));
    const resolved = resolve(entry);
    if (resolved === self) {
      return true;
    }
    const base = resolved.split(/[/\\]/).pop() ?? "";
    return base === "tembiter" || base === "tembiter.js";
  } catch {
    return false;
  }
}

async function runDirect(): Promise<void> {
  try {
    const code = await main(process.argv);
    process.exit(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

if (isDirectRun()) {
  void runDirect();
}
