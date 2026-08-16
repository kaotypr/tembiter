import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

function runCli(args: string[]): {
  status: number | null;
  stdout: string;
  error: Error | undefined;
} {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  return {
    status: result.status,
    stdout,
    error: result.error,
  };
}

describe("tembiter CLI", () => {
  it("the CLI entry runs", () => {
    const result = runCli([]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.length > 0);
  });

  it("--help exits 0 and mentions tembiter", () => {
    const result = runCli(["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /tembiter/);
  });

  it("--version prints 0.0.1-alpha.2", () => {
    const result = runCli(["--version"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout.trim(), /^0\.0\.1-alpha\.2$/);
  });

  it("an unknown subcommand exits non-zero", () => {
    const result = runCli(["not-a-command"]);
    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
  });
});
