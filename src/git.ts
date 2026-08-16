import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";

export class GitError extends Error {
  readonly args: string[];
  readonly stderr: string;
  readonly status: number | null;

  constructor(
    message: string,
    args: string[],
    stderr: string,
    status: number | null,
  ) {
    super(message);
    this.name = "GitError";
    this.args = args;
    this.stderr = stderr;
    this.status = status;
  }
}

export type GitRunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: Buffer;
  encoding?: "utf8" | "buffer";
  allowFailure?: boolean;
};

function gitEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...(env ?? process.env),
    GIT_TERMINAL_PROMPT: "0",
  };
}

function formatStderr(result: SpawnSyncReturns<string | Buffer>): string {
  if (typeof result.stderr === "string") {
    return result.stderr.trim();
  }
  return Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8").trim() : "";
}

export function runGit(
  args: string[],
  options: GitRunOptions = {},
): { stdout: Buffer; stderr: string; status: number | null } {
  const encoding = options.encoding ?? "utf8";
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    env: gitEnv(options.env),
    encoding: encoding === "utf8" ? "utf8" : "buffer",
    maxBuffer: 64 * 1024 * 1024,
    input: options.input,
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new GitError(
        "git was not found on PATH. Install git and retry.",
        args,
        result.error.message,
        result.status,
      );
    }
    throw new GitError(result.error.message, args, result.error.message, result.status);
  }

  const stderr = formatStderr(result);
  const stdout = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout ?? "", "utf8");

  if (!options.allowFailure && result.status !== 0) {
    throw new GitError(
      stderr.length > 0 ? stderr : `git ${args.join(" ")} failed.`,
      args,
      stderr,
      result.status,
    );
  }

  return { stdout, stderr, status: result.status };
}

export function gitText(
  args: string[],
  options: Omit<GitRunOptions, "encoding"> = {},
): string {
  return runGit(args, options).stdout.toString("utf8").trim();
}

export function gitConfigGet(
  cwd: string,
  key: string,
  env?: NodeJS.ProcessEnv,
): string | undefined {
  const result = runGit(["config", "--get", key], {
    cwd,
    env,
    allowFailure: true,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const value = result.stdout.toString("utf8").trim();
  return value.length > 0 ? value : undefined;
}

export function isGitUrl(template: string): boolean {
  return (
    template.startsWith("file://")
    || template.startsWith("http://")
    || template.startsWith("https://")
    || template.startsWith("git://")
    || template.startsWith("ssh://")
    || template.startsWith("git@")
  );
}
