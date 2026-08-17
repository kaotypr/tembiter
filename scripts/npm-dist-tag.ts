import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NUMERIC = "(?:0|[1-9]\\d*)";
const STABLE = new RegExp(`^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}$`);
const ALPHA = new RegExp(`^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}-alpha\\.${NUMERIC}$`);
const BETA = new RegExp(`^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}-beta\\.${NUMERIC}$`);

export function resolveNpmDistTag(gitTag: string, packageVersion: string): string {
  if (!gitTag.startsWith("v")) {
    throw new Error("git tag must start with v");
  }
  const versionFromTag = gitTag.slice(1);
  if (versionFromTag !== packageVersion) {
    throw new Error("git tag does not match package.json version");
  }
  if (ALPHA.test(packageVersion)) {
    return "alpha";
  }
  if (BETA.test(packageVersion)) {
    return "beta";
  }
  if (STABLE.test(packageVersion)) {
    return "latest";
  }
  throw new Error("unsupported version shape");
}

function readPackageVersion(): string {
  const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(`package.json is missing a version at ${packageJsonPath}`);
  }
  return pkg.version;
}

function runCli(): void {
  try {
    const gitTag = process.env.GITHUB_REF_NAME;
    if (gitTag === undefined || gitTag.length === 0) {
      throw new Error("GITHUB_REF_NAME is not set");
    }
    const distTag = resolveNpmDistTag(gitTag, readPackageVersion());
    process.stdout.write(`${distTag}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)) {
  runCli();
}
