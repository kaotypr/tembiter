import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveNpmDistTag } from "../scripts/npm-dist-tag.js";

const here = dirname(fileURLToPath(import.meta.url));
const helperPath = join(here, "..", "scripts", "npm-dist-tag.js");
const packageRoot = join(here, "..", "..");

function runHelper(env: NodeJS.ProcessEnv): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: packageRoot,
    encoding: "utf8",
    env,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

describe("resolveNpmDistTag", () => {
  it("maps v0.0.1-alpha.2 to alpha", () => {
    assert.equal(resolveNpmDistTag("v0.0.1-alpha.2", "0.0.1-alpha.2"), "alpha");
  });

  it("maps v1.0.0-beta.1 to beta", () => {
    assert.equal(resolveNpmDistTag("v1.0.0-beta.1", "1.0.0-beta.1"), "beta");
  });

  it("maps v0.1.0 to latest", () => {
    assert.equal(resolveNpmDistTag("v0.1.0", "0.1.0"), "latest");
  });

  it("fails when git tag and package version mismatch", () => {
    assert.throws(() => resolveNpmDistTag("v0.0.1-alpha.2", "0.1.0"));
  });

  it("fails when the git tag is missing the v prefix", () => {
    assert.throws(() => resolveNpmDistTag("0.0.1-alpha.2", "0.0.1-alpha.2"));
  });

  it("fails on an unsupported prerelease", () => {
    assert.throws(() => resolveNpmDistTag("v1.0.0-rc.1", "1.0.0-rc.1"));
  });
});

describe("npm-dist-tag CLI", () => {
  it("prints only the dist-tag for the matching package version", () => {
    const result = runHelper({ ...process.env, GITHUB_REF_NAME: "v0.1.0" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "latest\n");
  });

  it("exits non-zero with no dist-tag on stdout when the tag is missing v", () => {
    const result = runHelper({ ...process.env, GITHUB_REF_NAME: "0.0.1-alpha.2" });
    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.equal(result.stdout, "");
  });
});
