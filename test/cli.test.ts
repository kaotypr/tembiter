import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

function runCli(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | undefined;
} {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  return {
    status: result.status,
    stdout,
    stderr,
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

  it("--help exits 0 and lists init, template register, and adopt", () => {
    const result = runCli(["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /tembiter/);
    assert.match(result.stdout, /init/);
    assert.match(result.stdout, /template register/);
    assert.match(result.stdout, /adopt/);
    assert.doesNotMatch(result.stdout, /Setup commands are not implemented/);
  });

  it("init --help names the four flags", () => {
    const result = runCli(["init", "--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--template/);
    assert.match(result.stdout, /--target/);
    assert.match(result.stdout, /--tag/);
    assert.match(result.stdout, /--message/);
  });

  it("template register --help names --path and --message", () => {
    const result = runCli(["template", "register", "--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--path/);
    assert.match(result.stdout, /--message/);
  });

  it("adopt --help names the four flags", () => {
    const result = runCli(["adopt", "--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--template/);
    assert.match(result.stdout, /--tag/);
    assert.match(result.stdout, /--project/);
    assert.match(result.stdout, /--message/);
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
    assert.match(result.stderr, /Not implemented/);
  });

  it("skill install stays unimplemented", () => {
    const result = runCli(["skill", "install"]);
    assert.notEqual(result.status, 0);
    assert.notEqual(result.status, null);
    assert.match(result.stderr, /Not implemented/);
  });
});
