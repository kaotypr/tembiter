import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const GITIGNORE_FILE = ".gitignore";
export const SYNC_GITIGNORE_LINE = ".tembiter/sync/";

export function gitignorePath(repoRoot: string): string {
  return join(repoRoot, GITIGNORE_FILE);
}

function lineIgnoresSyncWorktree(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === ".tembiter/sync" || trimmed === ".tembiter/sync/";
}

export function ensureSyncGitignore(repoRoot: string): boolean {
  const path = gitignorePath(repoRoot);
  if (!existsSync(path)) {
    writeFileSync(path, `${SYNC_GITIGNORE_LINE}\n`, "utf8");
    return true;
  }

  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (lineIgnoresSyncWorktree(line)) {
      return false;
    }
  }

  let next: string;
  if (raw.length === 0) {
    next = `${SYNC_GITIGNORE_LINE}\n`;
  } else if (raw.endsWith("\n")) {
    next = `${raw}${SYNC_GITIGNORE_LINE}\n`;
  } else {
    next = `${raw}\n${SYNC_GITIGNORE_LINE}\n`;
  }
  writeFileSync(path, next, "utf8");
  return true;
}
