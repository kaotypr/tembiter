import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CONFIG_DIR, projectConfig, writeConfig } from "../format/config.js";
import {
  GitError,
  gitConfigGet,
  isGitUrl,
  runGit,
} from "../git.js";

export const DEFAULT_COMMIT_MESSAGE = "Initial commit";

export class CliError extends Error {
  readonly exitCode: number;
  readonly showUsage: boolean;

  constructor(message: string, options: { exitCode?: number; showUsage?: boolean } = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = options.exitCode ?? 1;
    this.showUsage = options.showUsage ?? false;
  }
}

export type InitFlags = {
  help: boolean;
  template?: string;
  target?: string;
  tag?: string;
  message?: string;
};

const FLAG_NAMES = new Set(["template", "target", "tag", "message"]);

export function printInitUsage(stream: NodeJS.WritableStream): void {
  stream.write("Usage:\n");
  stream.write(
    "  tembiter init --template <path-or-url> --target <dir> --tag <git-tag> [--message <text>]\n",
  );
  stream.write("\n");
  stream.write("Copy a template git tag into a new project repository.\n");
  stream.write("\n");
  stream.write("Flags:\n");
  stream.write("  --template  Local git repository path or git URL (file:// allowed)\n");
  stream.write("  --target    Destination directory (must not exist or must be empty)\n");
  stream.write("  --tag       Template version: an existing git tag on that repository\n");
  stream.write("  --message   First-commit message (default: Initial commit)\n");
}

function assignFlag(flags: InitFlags, key: string, value: string): void {
  if (!FLAG_NAMES.has(key)) {
    throw new CliError(`Unknown flag --${key}.`, { showUsage: true });
  }
  if (key === "template") {
    flags.template = value;
    return;
  }
  if (key === "target") {
    flags.target = value;
    return;
  }
  if (key === "tag") {
    flags.tag = value;
    return;
  }
  flags.message = value;
}

export function parseInitFlags(args: string[]): InitFlags {
  const flags: InitFlags = { help: false };

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

function missingRequired(flags: InitFlags): string[] {
  const missing: string[] = [];
  if (flags.template === undefined || flags.template.length === 0) {
    missing.push("--template");
  }
  if (flags.target === undefined || flags.target.length === 0) {
    missing.push("--target");
  }
  if (flags.tag === undefined || flags.tag.length === 0) {
    missing.push("--tag");
  }
  return missing;
}

function isEmptyDirectory(path: string): boolean {
  return readdirSync(path).length === 0;
}

function assertTargetUsable(target: string): void {
  if (!existsSync(target)) {
    return;
  }

  const stat = statSync(target);
  if (!stat.isDirectory()) {
    throw new CliError(
      `Target ${target} exists and is not an empty directory.`,
    );
  }

  if (!isEmptyDirectory(target)) {
    throw new CliError(
      `Target ${target} exists and is not empty. Choose an empty directory or a path that does not exist.`,
    );
  }
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

function extractTagTree(repoPath: string, tag: string, target: string): void {
  const verify = runGit(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
    cwd: repoPath,
    allowFailure: true,
  });
  if (verify.status !== 0) {
    throw new CliError(
      `Tag '${tag}' was not found in the template. Pass an existing --tag.`,
    );
  }

  const archive = runGit(["archive", "--format=tar", tag], {
    cwd: repoPath,
    encoding: "buffer",
  });

  const tar = spawnSync("tar", ["-xf", "-", "-C", target], {
    input: archive.stdout,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (tar.error) {
    const code = (tar.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new CliError("tar was not found on PATH. Install tar and retry.");
    }
    throw new CliError(`Could not extract the template tag: ${tar.error.message}`);
  }

  if (tar.status !== 0) {
    const stderr = Buffer.isBuffer(tar.stderr)
      ? tar.stderr.toString("utf8").trim()
      : String(tar.stderr ?? "").trim();
    throw new CliError(
      stderr.length > 0
        ? `Could not extract the template tag: ${stderr}`
        : "Could not extract the template tag.",
    );
  }

  rmSync(join(target, ".git"), { recursive: true, force: true });
  rmSync(join(target, CONFIG_DIR), { recursive: true, force: true });
}

function withTemplateRepo(
  template: string,
  env: NodeJS.ProcessEnv,
  fn: (repoPath: string) => void,
): void {
  if (!isGitUrl(template)) {
    const repoPath = resolve(template);
    if (!existsSync(repoPath)) {
      throw new CliError(
        `Template path does not exist: ${template}. Pass a git repository path or a git URL (file:// is allowed).`,
      );
    }

    const gitDir = runGit(["rev-parse", "--git-dir"], {
      cwd: repoPath,
      env,
      allowFailure: true,
    });
    if (gitDir.status !== 0) {
      throw new CliError(
        `Template is not a git repository: ${template}. Pass a git repository path or a git URL (file:// is allowed).`,
      );
    }

    fn(repoPath);
    return;
  }

  const cloneDir = mkdtempSync(join(tmpdir(), "tembiter-template-"));
  try {
    try {
      runGit(["clone", "--quiet", "--bare", "--", template, cloneDir], { env });
    } catch (err) {
      if (err instanceof GitError) {
        throw new CliError(
          `Could not clone template ${template}. Pass a git repository path or a git URL (file:// is allowed). ${err.message}`,
        );
      }
      throw err;
    }
    fn(cloneDir);
  } finally {
    rmSync(cloneDir, { recursive: true, force: true });
  }
}

function initRepository(target: string, message: string, env: NodeJS.ProcessEnv): void {
  runGit(["init"], { cwd: target, env });
  requireGitIdentity(target, env);
  runGit(["add", "-A"], { cwd: target, env });
  runGit(["commit", "-m", message], { cwd: target, env });
}

export function initFromFlags(
  flags: InitFlags,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const missing = missingRequired(flags);
  if (missing.length > 0) {
    throw new CliError(`Missing required flags: ${missing.join(", ")}.`, {
      showUsage: true,
    });
  }

  const template = flags.template as string;
  const targetArg = flags.target as string;
  const tag = flags.tag as string;
  const message = flags.message ?? DEFAULT_COMMIT_MESSAGE;
  const target = resolve(targetArg);

  assertTargetUsable(target);
  mkdirSync(target, { recursive: true });

  withTemplateRepo(template, env, (repoPath) => {
    try {
      extractTagTree(repoPath, tag, target);
    } catch (err) {
      if (err instanceof GitError) {
        throw new CliError(
          `Could not read tag '${tag}' from the template. ${err.message}`,
        );
      }
      throw err;
    }
  });

  writeConfig(target, projectConfig(template, tag));
  initRepository(target, message, env);
}

export function runInit(
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): number {
  try {
    const flags = parseInitFlags(args);
    if (flags.help) {
      printInitUsage(process.stdout);
      return 0;
    }
    initFromFlags(flags, options.env ?? process.env);
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`);
      if (err.showUsage) {
        printInitUsage(process.stderr);
      }
      return err.exitCode;
    }
    if (err instanceof GitError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }
}
