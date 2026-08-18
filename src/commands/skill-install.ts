import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { ConfigError, readConfig } from "../format/config.js";
import { ensureSyncGitignore } from "../format/gitignore.js";
import { GitError, runGit } from "../git.js";
import {
  getCatalogEntry,
  knownSkillSummary,
  skillSourceDir,
  type CatalogEntry,
} from "../skills/catalog.js";
import { createProgressReporter, type ProgressReporter } from "../ui/progress.js";
import { CliError } from "./init.js";

export type SkillInstallFlags = {
  help: boolean;
  skill?: string;
  path?: string;
};

const FLAG_NAMES = new Set(["skill", "path"]);
const AGENTS_SKILLS_DIR = join(".agents", "skills");
const CLAUDE_DIR = ".claude";
const CLAUDE_SKILLS_DIR = join(CLAUDE_DIR, "skills");
const RELATIVE_SKILL_LINK_TARGET = join("..", "..", ".agents", "skills");

export function printSkillInstallUsage(stream: NodeJS.WritableStream): void {
  stream.write("Usage:\n");
  stream.write("  tembiter skill install --skill <id> --path <dir>\n");
  stream.write("\n");
  stream.write("Install a packaged skill into a template or project repository.\n");
  stream.write("\n");
  stream.write("Flags:\n");
  stream.write(`  --skill  Catalog id (${knownSkillSummary()})\n`);
  stream.write("  --path   Template or project repository root\n");
}

function assignFlag(flags: SkillInstallFlags, key: string, value: string): void {
  if (!FLAG_NAMES.has(key)) {
    throw new CliError(`Unknown flag --${key}.`, { showUsage: true });
  }
  if (key === "skill") {
    flags.skill = value;
    return;
  }
  flags.path = value;
}

export function parseSkillInstallFlags(args: string[]): SkillInstallFlags {
  const flags: SkillInstallFlags = { help: false };

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

function missingRequired(flags: SkillInstallFlags): string[] {
  const missing: string[] = [];
  if (flags.skill === undefined || flags.skill.length === 0) {
    missing.push("--skill");
  }
  if (flags.path === undefined || flags.path.length === 0) {
    missing.push("--path");
  }
  return missing;
}

function assertGitRepository(path: string): void {
  const gitDir = runGit(["rev-parse", "--git-dir"], {
    cwd: path,
    allowFailure: true,
  });
  if (gitDir.status !== 0) {
    throw new CliError(
      `Path is not a git repository: ${path}. Run git init in that directory, or pass a repository root.`,
    );
  }
}

function resolveSkill(id: string): CatalogEntry {
  const entry = getCatalogEntry(id);
  if (entry === undefined) {
    throw new CliError(
      `Unknown skill '${id}'. Known skills: ${knownSkillSummary()}.`,
    );
  }

  const source = skillSourceDir(entry.id);
  if (!existsSync(join(source, "SKILL.md"))) {
    throw new CliError(
      `Packaged skill '${entry.id}' is missing SKILL.md at ${source}.`,
    );
  }
  return entry;
}

function resolveTargetDir(pathArg: string): string {
  const target = resolve(pathArg);
  if (!existsSync(target)) {
    throw new CliError(
      `Path does not exist: ${pathArg}. Pass an existing template or project directory.`,
    );
  }
  const stat = lstatSync(target);
  if (!stat.isDirectory()) {
    throw new CliError(
      `Path is not a directory: ${pathArg}. Pass a template or project repository root.`,
    );
  }
  return target;
}

function assertPurposeMatches(target: string, entry: CatalogEntry): void {
  let kind: string;
  try {
    kind = readConfig(target).kind;
  } catch (err) {
    if (err instanceof ConfigError) {
      throw new CliError(
        `Could not read .tembiter/config.json at ${target}: ${err.message} Known skills: ${knownSkillSummary()}.`,
      );
    }
    throw err;
  }

  if (kind !== entry.purpose) {
    throw new CliError(
      `Skill '${entry.id}' is for a ${entry.purpose} repository, but ${target} is a ${kind}. Known skills: ${knownSkillSummary()}.`,
    );
  }
}

function copySkill(entry: CatalogEntry, target: string): void {
  const source = skillSourceDir(entry.id);
  const dest = join(target, AGENTS_SKILLS_DIR, entry.id);
  mkdirSync(join(target, AGENTS_SKILLS_DIR), { recursive: true });
  cpSync(source, dest, { recursive: true, force: true });
}

function linkExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function linkClaudeSkill(entry: CatalogEntry, target: string): boolean {
  const claudeRoot = join(target, CLAUDE_DIR);
  if (!existsSync(claudeRoot)) {
    return false;
  }

  const claudeStat = lstatSync(claudeRoot);
  if (!claudeStat.isDirectory()) {
    throw new CliError(
      `${join(target, CLAUDE_DIR)} exists and is not a directory. Remove or rename it and retry.`,
    );
  }

  const hostSkillsDir = join(target, CLAUDE_SKILLS_DIR);
  mkdirSync(hostSkillsDir, { recursive: true });

  const linkPath = join(hostSkillsDir, entry.id);
  if (linkExists(linkPath)) {
    const existing = lstatSync(linkPath);
    if (!existing.isSymbolicLink()) {
      throw new CliError(
        `${join(CLAUDE_SKILLS_DIR, entry.id)} exists and is not a symlink. Remove or rename that file and retry.`,
      );
    }
    unlinkSync(linkPath);
  }

  const linkTarget = join(RELATIVE_SKILL_LINK_TARGET, entry.id);
  try {
    symlinkSync(linkTarget, linkPath);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CliError(
      `Could not create symlink at ${join(CLAUDE_SKILLS_DIR, entry.id)} -> ${linkTarget}. This platform could not create a symlink. ${detail}`,
    );
  }
  return true;
}

export function installSkillFromFlags(
  flags: SkillInstallFlags,
  progress: ProgressReporter = createProgressReporter(process.stdout),
): void {
  const missing = missingRequired(flags);
  if (missing.length > 0) {
    throw new CliError(`Missing required flags: ${missing.join(", ")}.`, {
      showUsage: true,
    });
  }

  const entry = resolveSkill(flags.skill as string);
  const target = resolveTargetDir(flags.path as string);
  assertGitRepository(target);
  assertPurposeMatches(target, entry);
  ensureSyncGitignore(target);
  progress.step(`Installing ${entry.id} into ${target}…`);
  copySkill(entry, target);
  if (existsSync(join(target, CLAUDE_DIR))) {
    progress.step(`Linking .claude/skills/${entry.id}…`);
  }
  linkClaudeSkill(entry, target);
  progress.done(`Installed ${entry.id} at ${join(target, AGENTS_SKILLS_DIR, entry.id)}.`);
}

export function runSkillInstall(
  args: string[],
  options: { progress?: ProgressReporter } = {},
): number {
  const progress = options.progress ?? createProgressReporter(process.stdout);
  try {
    const flags = parseSkillInstallFlags(args);
    if (flags.help) {
      printSkillInstallUsage(process.stdout);
      return 0;
    }
    installSkillFromFlags(flags, progress);
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`);
      if (err.showUsage) {
        printSkillInstallUsage(process.stderr);
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
