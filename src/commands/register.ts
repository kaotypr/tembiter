import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CliError } from "./init.js";
import {
  CONFIG_DIR,
  CONFIG_RELATIVE_PATH,
  ConfigError,
  configPath,
  readConfig,
  templateConfig,
  writeConfig,
} from "../format/config.js";
import { GitError, gitConfigGet, runGit } from "../git.js";
import { createProgressReporter, type ProgressReporter } from "../ui/progress.js";

export const DEFAULT_COMMIT_MESSAGE = "Register tembiter template";

export type RegisterFlags = {
  help: boolean;
  path?: string;
  message?: string;
};

const FLAG_NAMES = new Set(["path", "message"]);

export function printRegisterUsage(stream: NodeJS.WritableStream): void {
  stream.write("Usage:\n");
  stream.write("  tembiter template register [--path <dir>] [--message <text>]\n");
  stream.write("\n");
  stream.write("Mark a git repository as a tembiter template.\n");
  stream.write("\n");
  stream.write("Flags:\n");
  stream.write("  --path     Git repository to mark (default: current working directory)\n");
  stream.write("  --message  Commit message (default: Register tembiter template)\n");
}

function assignFlag(flags: RegisterFlags, key: string, value: string): void {
  if (!FLAG_NAMES.has(key)) {
    throw new CliError(`Unknown flag --${key}.`, { showUsage: true });
  }
  if (key === "path") {
    flags.path = value;
    return;
  }
  flags.message = value;
}

export function parseRegisterFlags(args: string[]): RegisterFlags {
  const flags: RegisterFlags = { help: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      break;
    }

    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }

    if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      const key = arg.slice(2, eq);
      const value = arg.slice(eq + 1);
      assignFlag(flags, key, value);
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliError(`Flag --${key} requires a value.`, { showUsage: true });
      }
      assignFlag(flags, key, value);
      i += 1;
      continue;
    }

    throw new CliError(`Unexpected argument ${arg}.`, { showUsage: true });
  }

  return flags;
}

function requireGitIdentity(cwd: string, env: NodeJS.ProcessEnv): void {
  const userName = gitConfigGet(cwd, "user.name", env);
  const userEmail = gitConfigGet(cwd, "user.email", env);
  const authorName = env.GIT_AUTHOR_NAME || userName;
  const authorEmail = env.GIT_AUTHOR_EMAIL || userEmail;
  const committerName = env.GIT_COMMITTER_NAME || userName;
  const committerEmail = env.GIT_COMMITTER_EMAIL || userEmail;

  if (!authorName || !authorEmail || !committerName || !committerEmail) {
    throw new CliError(
      "Git author identity is not set. Set user.name and user.email (git config), or set GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, and GIT_COMMITTER_EMAIL.",
    );
  }
}

function resolveGitRoot(pathArg: string | undefined, env: NodeJS.ProcessEnv): string {
  const start = resolve(pathArg ?? process.cwd());
  if (!existsSync(start)) {
    throw new CliError(
      `Path does not exist: ${pathArg}. Pass --path to a git working tree.`,
    );
  }

  const cwd = statSync(start).isDirectory() ? start : dirname(start);
  const result = runGit(["rev-parse", "--show-toplevel"], {
    cwd,
    env,
    allowFailure: true,
  });
  if (result.status !== 0) {
    throw new CliError(
      `Not a git repository: ${start}. Run this command from a git working tree, or pass --path to a git repository.`,
    );
  }

  return result.stdout.toString("utf8").trim();
}

function pathInHead(
  cwd: string,
  relativePath: string,
  env: NodeJS.ProcessEnv,
): boolean {
  const result = runGit(["cat-file", "-e", `HEAD:${relativePath}`], {
    cwd,
    env,
    allowFailure: true,
  });
  return result.status === 0;
}

function pathInIndex(
  cwd: string,
  relativePath: string,
  env: NodeJS.ProcessEnv,
): boolean {
  const result = runGit(["ls-files", "--error-unmatch", "--", relativePath], {
    cwd,
    env,
    allowFailure: true,
  });
  return result.status === 0;
}

function commitTembiter(
  cwd: string,
  message: string,
  env: NodeJS.ProcessEnv,
): void {
  requireGitIdentity(cwd, env);
  runGit(["add", "--", CONFIG_DIR], { cwd, env });
  const cached = runGit(["diff", "--cached", "--quiet", "--", CONFIG_DIR], {
    cwd,
    env,
    allowFailure: true,
  });
  if (cached.status === 0) {
    return;
  }
  runGit(["commit", "-m", message, "--", CONFIG_DIR], { cwd, env });
}

function existingTemplateConfig(repoRoot: string): "template" | "project" | "none" {
  try {
    const config = readConfig(repoRoot);
    if (config.kind === "project") {
      return "project";
    }
    if (config.kind === "template" && config.formatVersion === 1) {
      return "template";
    }
    return "none";
  } catch (err) {
    if (err instanceof ConfigError) {
      return "none";
    }
    throw err;
  }
}

export function registerFromFlags(
  flags: RegisterFlags,
  env: NodeJS.ProcessEnv = process.env,
  progress: ProgressReporter = createProgressReporter(process.stdout),
): void {
  const message = flags.message ?? DEFAULT_COMMIT_MESSAGE;
  const repoRoot = resolveGitRoot(flags.path, env);
  const existing = existsSync(configPath(repoRoot))
    ? existingTemplateConfig(repoRoot)
    : "none";

  if (existing === "project") {
    throw new CliError(
      "This repository is already a tembiter project. Do not convert a project into a template.",
    );
  }

  if (existing === "template") {
    const inHead = pathInHead(repoRoot, CONFIG_RELATIVE_PATH, env);
    const inIndex = pathInIndex(repoRoot, CONFIG_RELATIVE_PATH, env);
    if (inHead && inIndex) {
      progress.done(`Registered template at ${repoRoot}.`);
      return;
    }
    progress.step("Creating commit…");
    commitTembiter(repoRoot, message, env);
    progress.done(`Registered template at ${repoRoot}.`);
    return;
  }

  progress.step("Writing .tembiter/…");
  writeConfig(repoRoot, templateConfig());
  progress.step("Creating commit…");
  commitTembiter(repoRoot, message, env);
  progress.done(`Registered template at ${repoRoot}.`);
}

export function runRegister(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; progress?: ProgressReporter } = {},
): number {
  const progress = options.progress ?? createProgressReporter(process.stdout);
  try {
    const flags = parseRegisterFlags(args);
    if (flags.help) {
      printRegisterUsage(process.stdout);
      return 0;
    }
    registerFromFlags(flags, options.env ?? process.env, progress);
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`);
      if (err.showUsage) {
        printRegisterUsage(process.stderr);
      }
      progress.fail();
      return err.exitCode;
    }
    if (err instanceof GitError) {
      process.stderr.write(`${err.message}\n`);
      progress.fail();
      return 1;
    }
    throw err;
  }
}
