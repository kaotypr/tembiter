#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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
  createReadlinePrompt,
  detectInteractive,
  PromptCancelled,
  promptFlag,
  type PromptIo,
  type TtyLike,
} from "./ui/prompt.js";

const PACKAGE_NAME = "tembiter";
const PACKAGE_VERSION = "0.0.1-alpha.2";

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
};

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
): Promise<void> {
  if (flags[key] !== undefined) {
    return;
  }
  const value = await promptFlag(io, key, { required: false });
  if (value !== undefined) {
    flags[key] = value;
  }
}

async function fillInit(flags: InitFlags, io: PromptIo): Promise<void> {
  if (flags.template === undefined || flags.template.length === 0) {
    flags.template = await promptFlag(io, "template", { required: true });
  }
  if (flags.target === undefined || flags.target.length === 0) {
    flags.target = await promptFlag(io, "target", { required: true });
  }
  if (flags.tag === undefined || flags.tag.length === 0) {
    flags.tag = await promptFlag(io, "tag", { required: true });
  }
  await assignOptional(flags, "message", io);
}

async function fillRegister(flags: RegisterFlags, io: PromptIo): Promise<void> {
  await assignOptional(flags, "path", io);
  await assignOptional(flags, "message", io);
}

async function fillAdopt(flags: AdoptFlags, io: PromptIo): Promise<void> {
  if (flags.template === undefined || flags.template.length === 0) {
    flags.template = await promptFlag(io, "template", { required: true });
  }
  await assignOptional(flags, "tag", io);
  await assignOptional(flags, "project", io);
  await assignOptional(flags, "message", io);
}

async function fillSkillInstall(flags: SkillInstallFlags, io: PromptIo): Promise<void> {
  if (flags.skill === undefined || flags.skill.length === 0) {
    flags.skill = await promptFlag(io, "skill", { required: true });
  }
  if (flags.path === undefined || flags.path.length === 0) {
    flags.path = await promptFlag(io, "path", { required: true });
  }
}

async function handleInit(commandArgs: string[], ctx: CommandContext): Promise<number> {
  if (!ctx.interactive) {
    return runInit(commandArgs, { env: ctx.env });
  }

  let flags: InitFlags;
  try {
    flags = parseInitFlags(commandArgs);
  } catch {
    return runInit(commandArgs, { env: ctx.env });
  }
  if (flags.help) {
    return runInit(commandArgs, { env: ctx.env });
  }
  if (ctx.fromPicker || missingInit(flags).length > 0) {
    await fillInit(flags, ctx.ensurePrompt());
    return runInit(flagArgs(flags), { env: ctx.env });
  }
  return runInit(commandArgs, { env: ctx.env });
}

async function handleRegister(commandArgs: string[], ctx: CommandContext): Promise<number> {
  if (!ctx.interactive) {
    return runRegister(commandArgs, { env: ctx.env });
  }

  let flags: RegisterFlags;
  try {
    flags = parseRegisterFlags(commandArgs);
  } catch {
    return runRegister(commandArgs, { env: ctx.env });
  }
  if (flags.help) {
    return runRegister(commandArgs, { env: ctx.env });
  }
  if (ctx.fromPicker) {
    await fillRegister(flags, ctx.ensurePrompt());
    return runRegister(flagArgs(flags), { env: ctx.env });
  }
  return runRegister(commandArgs, { env: ctx.env });
}

async function handleAdopt(commandArgs: string[], ctx: CommandContext): Promise<number> {
  if (!ctx.interactive) {
    return runAdopt(commandArgs, { env: ctx.env, cwd: ctx.cwd });
  }

  let flags: AdoptFlags;
  try {
    flags = parseAdoptFlags(commandArgs);
  } catch {
    return runAdopt(commandArgs, { env: ctx.env, cwd: ctx.cwd });
  }
  if (flags.help) {
    return runAdopt(commandArgs, { env: ctx.env, cwd: ctx.cwd });
  }
  if (ctx.fromPicker || missingAdopt(flags).length > 0) {
    await fillAdopt(flags, ctx.ensurePrompt());
    return runAdopt(flagArgs(flags), { env: ctx.env, cwd: ctx.cwd });
  }
  return runAdopt(commandArgs, { env: ctx.env, cwd: ctx.cwd });
}

async function handleSkillInstall(commandArgs: string[], ctx: CommandContext): Promise<number> {
  if (!ctx.interactive) {
    return runSkillInstall(commandArgs);
  }

  let flags: SkillInstallFlags;
  try {
    flags = parseSkillInstallFlags(commandArgs);
  } catch {
    return runSkillInstall(commandArgs);
  }
  if (flags.help) {
    return runSkillInstall(commandArgs);
  }
  if (ctx.fromPicker || missingSkillInstall(flags).length > 0) {
    await fillSkillInstall(flags, ctx.ensurePrompt());
    return runSkillInstall(flagArgs(flags));
  }
  return runSkillInstall(commandArgs);
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

  const ensurePrompt = (): PromptIo => {
    if (prompt === undefined) {
      prompt = createReadlinePrompt(stdin, stdout);
      createdPrompt = true;
    }
    return prompt;
  };

  const ctx: CommandContext = {
    interactive,
    fromPicker: false,
    env,
    cwd,
    ensurePrompt,
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
