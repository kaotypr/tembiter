import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { rmSync } from "node:fs";
import {
  ConfigError,
  parseConfig,
  projectConfig,
  readConfig,
  serializeConfig,
  templateConfig,
  writeConfig,
} from "../../src/format/config.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tembiter-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe(".tembiter/config.json", () => {
  it("writes and reads project-side identity and version", () => {
    const root = tempDir();
    const config = projectConfig("/path/to/template", "v1.0.0");
    writeConfig(root, config);

    const raw = readFileSync(join(root, ".tembiter", "config.json"), "utf8");
    assert.equal(
      raw,
      `${JSON.stringify(
        {
          formatVersion: 1,
          kind: "project",
          template: {
            identity: "/path/to/template",
            version: "v1.0.0",
          },
        },
        null,
        2,
      )}\n`,
    );

    const read = readConfig(root);
    assert.deepEqual(read, config);
    assert.equal(read.kind, "project");
    if (read.kind === "project") {
      assert.equal(read.template.identity, "/path/to/template");
      assert.equal(read.template.version, "v1.0.0");
    }
  });

  it("writes and reads template-side config", () => {
    const root = tempDir();
    const config = templateConfig();
    writeConfig(root, config);

    const raw = readFileSync(join(root, ".tembiter", "config.json"), "utf8");
    assert.equal(
      raw,
      `${JSON.stringify({ formatVersion: 1, kind: "template" }, null, 2)}\n`,
    );
    assert.deepEqual(readConfig(root), config);
  });

  it("creates .tembiter/ when writing", () => {
    const root = tempDir();
    writeConfig(root, templateConfig());
    assert.equal(readConfig(root).kind, "template");
  });

  it("rejects invalid JSON with ConfigError", () => {
    const root = tempDir();
    mkdirSync(join(root, ".tembiter"));
    writeFileSync(join(root, ".tembiter", "config.json"), "{not json", "utf8");

    assert.throws(
      () => readConfig(root),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "invalid_json");
        return true;
      },
    );
  });

  it("rejects unknown kind with ConfigError", () => {
    assert.throws(
      () => parseConfig({ formatVersion: 1, kind: "other" }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "unknown_kind");
        return true;
      },
    );
  });

  it("rejects project config missing identity", () => {
    assert.throws(
      () =>
        parseConfig({
          formatVersion: 1,
          kind: "project",
          template: { version: "v1.0.0" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "missing_field");
        return true;
      },
    );
  });

  it("rejects project config missing version", () => {
    assert.throws(
      () =>
        parseConfig({
          formatVersion: 1,
          kind: "project",
          template: { identity: "tmpl" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.code, "missing_field");
        return true;
      },
    );
  });

  it("serializeConfig uses two-space indent and a trailing newline", () => {
    const serialized = serializeConfig(templateConfig());
    assert.ok(serialized.endsWith("\n"));
    assert.ok(serialized.includes("\n  \"kind\": \"template\"\n"));
  });
});
