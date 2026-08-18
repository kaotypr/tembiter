import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CONFIG_DIR,
  ConfigError,
  configPath,
  projectConfig,
  readConfig,
  writeConfig,
  type TembiterConfig,
} from "../format/config.js";
import { ensureSyncGitignore, GITIGNORE_FILE } from "../format/gitignore.js";
import { GitError, gitConfigGet, gitText, isGitUrl, runGit } from "../git.js";
import { createProgressReporter, type ProgressReporter } from "../ui/progress.js";
import { CliError } from "./init.js";

export function defaultAdoptMessage(identity: string, tag: string): string {
  return `Connect tembiter to ${identity}@${tag}`;
}

export type AdoptFlags = {
  help: boolean;
  template?: string;
  tag?: string;
  project?: string;
  message?: string;
};

const FLAG_NAMES = new Set(["template", "tag", "project", "message"]);

export function printAdoptUsage(stream: NodeJS.WritableStream): void {
  stream.write("Usage:\n");
  stream.write(
    "  tembiter adopt --template <path-or-url> --tag <git-tag> [--project <dir>] [--message <text>]\n",
  );
  stream.write(
    "  tembiter adopt --template <path-or-url> [--project <dir>]\n",
  );
  stream.write("\n");
  stream.write(
    "Bind an existing project git repository to a tagged template without copying template files.\n",
  );
  stream.write(
    "When the template has no tags, omit --tag. adopt prints first-commit-date assistance and a suggested git tag command; it does not write .tembiter/ or create the tag.\n",
  );
  stream.write("\n");
  stream.write("Flags:\n");
  stream.write("  --template  Local git repository path or git URL (file:// allowed)\n");
  stream.write(
    "  --tag       Existing git tag (required when the template has tags; omit when it has none)\n",
  );
  stream.write("  --project   Project git repository (default: current working directory)\n");
  stream.write(
    "  --message   Commit message (default: Connect tembiter to <identity>@<tag>)\n",
  );
}

function assignFlag(flags: AdoptFlags, key: string, value: string): void {
  if (!FLAG_NAMES.has(key)) {
    throw new CliError(`Unknown flag --${key}.`, { showUsage: true });
  }
  if (key === "template") {
    flags.template = value;
    return;
  }
  if (key === "tag") {
    flags.tag = value;
    return;
  }
  if (key === "project") {
    flags.project = value;
    return;
  }
  flags.message = value;
}

export function parseAdoptFlags(args: string[]): AdoptFlags {
  const flags: AdoptFlags = { help: false };

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

function listTags(repoPath: string): string[] {
  const text = gitText(["tag", "--list"], { cwd: repoPath });
  if (text.length === 0) {
    return [];
  }
  return text.split("\n").filter((line) => line.length > 0);
}

function tagExists(repoPath: string, tag: string): boolean {
  const verify = runGit(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
    cwd: repoPath,
    allowFailure: true,
  });
  return verify.status === 0;
}

function formatTagList(tags: string[]): string {
  return tags.map((tag) => `  ${tag}`).join("\n");
}

function unknownTagOnUntaggedError(tag: string): CliError {
  return new CliError(
    `Tag '${tag}' was not found in the template. Template has no version tags. This command does not invent a version or create tags. Omit --tag to print first-commit-date assistance.`,
  );
}

function missingOrUnknownTagError(tag: string | undefined, tags: string[]): CliError {
  const list = formatTagList(tags);
  if (tag === undefined || tag.length === 0) {
    return new CliError(
      `--tag is required when the template already has tags. Existing tags:\n${list}\nPass --tag with one of these tags. This command does not pick a tag or run the no-tags fallback.`,
    );
  }
  return new CliError(
    `Tag '${tag}' was not found in the template. Existing tags:\n${list}\nPass --tag with one of these tags.`,
  );
}

function calendarDayFromCommitterIso(iso: string): string {
  if (iso.length < 10) {
    throw new CliError(`Could not read committer calendar day from: ${iso}`);
  }
  return iso.slice(0, 10);
}

function compactDay(day: string): string {
  return day.replaceAll("-", "");
}

function projectRootCommits(projectRoot: string, env: NodeJS.ProcessEnv): string[] {
  try {
    const text = gitText(["rev-list", "--max-parents=0", "HEAD"], {
      cwd: projectRoot,
      env,
    });
    if (text.length === 0) {
      return [];
    }
    return text.split("\n").filter((line) => line.length > 0);
  } catch (err) {
    if (err instanceof GitError) {
      throw new CliError(
        `Could not read the project's first commit. The project must have git history. ${err.message}`,
      );
    }
    throw err;
  }
}

type TemplateCommit = {
  sha: string;
  unix: number;
  day: string;
  subject: string;
};

function listTemplateCommits(repoPath: string, env: NodeJS.ProcessEnv): TemplateCommit[] {
  const text = gitText(["log", "--all", "--format=%H%x00%ct%x00%ci%x00%s"], {
    cwd: repoPath,
    env,
  });
  if (text.length === 0) {
    return [];
  }

  const commits: TemplateCommit[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const parts = line.split("\0");
    const sha = parts[0];
    const unixText = parts[1];
    const iso = parts[2];
    if (sha === undefined || unixText === undefined || iso === undefined) {
      continue;
    }
    const unix = Number(unixText);
    if (sha.length === 0 || !Number.isFinite(unix)) {
      continue;
    }
    commits.push({
      sha,
      unix,
      day: calendarDayFromCommitterIso(iso),
      subject: parts.slice(3).join("\0"),
    });
  }
  return commits;
}

function printNoTagsAssistance(
  stream: NodeJS.WritableStream,
  projectRoot: string,
  template: string,
  repoPath: string,
  env: NodeJS.ProcessEnv,
): void {
  const roots = projectRootCommits(projectRoot, env);
  if (roots.length === 0) {
    throw new CliError(
      "Project has no commits. tembiter adopt needs a single first commit to compute the first-commit date.",
    );
  }
  if (roots.length > 1) {
    const list = roots.map((sha) => `  ${sha}`).join("\n");
    throw new CliError(
      `Project has more than one root commit. tembiter adopt needs a single first commit to compute the first-commit date. Do not guess among:\n${list}`,
    );
  }

  const firstSha = roots[0];
  if (firstSha === undefined) {
    throw new CliError(
      "Project has no commits. tembiter adopt needs a single first commit to compute the first-commit date.",
    );
  }

  let firstIso: string;
  try {
    firstIso = gitText(["log", "-1", "--format=%ci", firstSha], {
      cwd: projectRoot,
      env,
    });
  } catch (err) {
    if (err instanceof GitError) {
      throw new CliError(`Could not read the first commit's committer date. ${err.message}`);
    }
    throw err;
  }

  const day = calendarDayFromCommitterIso(firstIso);

  let commits: TemplateCommit[];
  try {
    commits = listTemplateCommits(repoPath, env);
  } catch (err) {
    if (err instanceof GitError) {
      throw new CliError(`Could not list template commits. ${err.message}`);
    }
    throw err;
  }

  const matches = commits.filter((commit) => commit.day === day);
  if (matches.length === 0) {
    throw new CliError(
      `No template commit has committer calendar day ${day} (the project's first-commit date). Nothing was written under .tembiter/.`,
    );
  }

  matches.sort((a, b) => {
    if (b.unix !== a.unix) {
      return b.unix - a.unix;
    }
    return a.sha.localeCompare(b.sha);
  });
  const candidate = matches[0];
  if (candidate === undefined) {
    throw new CliError(
      `No template commit has committer calendar day ${day} (the project's first-commit date). Nothing was written under .tembiter/.`,
    );
  }

  const yyyymmdd = compactDay(day);
  stream.write(
    "Template has no version tags. This is assistance only; tembiter will not create a tag or write .tembiter/.\n",
  );
  stream.write("\n");
  stream.write(`Project first-commit date: ${day}\n`);
  stream.write(`Candidate commit: ${candidate.sha}\n`);
  stream.write(`Subject: ${candidate.subject}\n`);
  stream.write("\n");
  stream.write("Suggested tag command (choose any tag name):\n");
  stream.write(
    `  git -C ${template} tag v0.0.0-tembiter-${yyyymmdd} ${candidate.sha}\n`,
  );
  stream.write("\n");
  stream.write("After the template owner creates a tag, re-run:\n");
  stream.write(
    `  tembiter adopt --template ${template} --tag <tag> [--project <dir>]\n`,
  );
}

function withTemplateRepo(
  template: string,
  env: NodeJS.ProcessEnv,
  progress: ProgressReporter,
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

  progress.step("Cloning template…");
  const cloneDir = mkdtempSync(join(tmpdir(), "tembiter-adopt-template-"));
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

function resolveProjectRoot(projectArg: string, env: NodeJS.ProcessEnv): string {
  const project = resolve(projectArg);
  if (!existsSync(project)) {
    throw new CliError(
      `Project path does not exist: ${projectArg}. Pass --project with a git working tree.`,
    );
  }

  const toplevel = runGit(["rev-parse", "--show-toplevel"], {
    cwd: project,
    env,
    allowFailure: true,
  });
  if (toplevel.status !== 0) {
    throw new CliError(
      `Project is not a git repository: ${projectArg}. Pass --project with a git working tree.`,
    );
  }

  return toplevel.stdout.toString("utf8").trim();
}

function tembiterIsDirty(projectRoot: string, env: NodeJS.ProcessEnv): boolean {
  const status = gitText(["status", "--porcelain", "--untracked-files=all", "--", CONFIG_DIR], {
    cwd: projectRoot,
    env,
  });
  return status.length > 0;
}

function commitTembiter(
  projectRoot: string,
  message: string,
  env: NodeJS.ProcessEnv,
  gitignoreChanged: boolean,
): void {
  requireGitIdentity(projectRoot, env);
  const paths = gitignoreChanged ? [CONFIG_DIR, GITIGNORE_FILE] : [CONFIG_DIR];
  runGit(["add", "--", ...paths], { cwd: projectRoot, env });
  runGit(["commit", "--only", "-m", message, "--", ...paths], {
    cwd: projectRoot,
    env,
  });
}

function assertCompatibleConfig(
  projectRoot: string,
  identity: string,
  tag: string,
): boolean {
  if (!existsSync(configPath(projectRoot))) {
    return false;
  }

  let existing: TembiterConfig;
  try {
    existing = readConfig(projectRoot);
  } catch (err) {
    if (err instanceof ConfigError) {
      throw new CliError(err.message);
    }
    throw err;
  }

  if (existing.kind !== "project") {
    throw new CliError(
      `Project ${CONFIG_DIR}/config.json is kind "${existing.kind}", not a project. adopt cannot overwrite it.`,
    );
  }

  if (existing.template.identity !== identity || existing.template.version !== tag) {
    throw new CliError(
      `Project is already connected to ${existing.template.identity}@${existing.template.version}. Requested ${identity}@${tag}. adopt does not change an existing template binding.`,
    );
  }

  return true;
}

export function adoptFromFlags(
  flags: AdoptFlags,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  stdout: NodeJS.WritableStream = process.stdout,
  progress: ProgressReporter = createProgressReporter(process.stdout),
): void {
  if (flags.template === undefined || flags.template.length === 0) {
    throw new CliError("Missing required flags: --template.", {
      showUsage: true,
    });
  }

  const template = flags.template;
  const tag = flags.tag;
  const projectArg = flags.project !== undefined && flags.project.length > 0
    ? flags.project
    : cwd;
  const projectRoot = resolveProjectRoot(projectArg, env);

  withTemplateRepo(template, env, progress, (repoPath) => {
    let tags: string[];
    try {
      tags = listTags(repoPath);
    } catch (err) {
      if (err instanceof GitError) {
        throw new CliError(`Could not list tags from the template. ${err.message}`);
      }
      throw err;
    }

    if (tags.length === 0) {
      if (tag !== undefined && tag.length > 0) {
        throw unknownTagOnUntaggedError(tag);
      }
      printNoTagsAssistance(stdout, projectRoot, template, repoPath, env);
      throw new CliError(
        "Did not bind the project. Create a tag on the candidate commit, then re-run adopt with --tag.",
      );
    }

    if (tag === undefined || tag.length === 0 || !tagExists(repoPath, tag)) {
      throw missingOrUnknownTagError(tag, tags);
    }
  });

  const resolvedTag = tag as string;
  const matched = assertCompatibleConfig(projectRoot, template, resolvedTag);
  if (!matched) {
    progress.step("Writing .tembiter/…");
    writeConfig(projectRoot, projectConfig(template, resolvedTag));
  }

  if (tembiterIsDirty(projectRoot, env)) {
    const message = flags.message ?? defaultAdoptMessage(template, resolvedTag);
    progress.step("Creating commit…");
    const gitignoreChanged = ensureSyncGitignore(projectRoot);
    commitTembiter(projectRoot, message, env, gitignoreChanged);
  }
  progress.done(`Connected ${projectRoot} to ${template}@${resolvedTag}.`);
}

export function runAdopt(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    progress?: ProgressReporter;
  } = {},
): number {
  const progress = options.progress ?? createProgressReporter(process.stdout);
  try {
    const flags = parseAdoptFlags(args);
    if (flags.help) {
      printAdoptUsage(process.stdout);
      return 0;
    }
    adoptFromFlags(
      flags,
      options.env ?? process.env,
      options.cwd ?? process.cwd(),
      process.stdout,
      progress,
    );
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`);
      if (err.showUsage) {
        printAdoptUsage(process.stderr);
      }
      progress.fail();
      return err.exitCode;
    }
    if (err instanceof GitError) {
      process.stderr.write(`${err.message}\n`);
      progress.fail();
      return 1;
    }
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      progress.fail();
      return 1;
    }
    throw err;
  }
}
