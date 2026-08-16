import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_DIR = ".tembiter";
export const CONFIG_FILE = "config.json";
export const CONFIG_RELATIVE_PATH = `${CONFIG_DIR}/${CONFIG_FILE}`;

export type ConfigErrorCode =
  | "invalid_json"
  | "invalid_shape"
  | "unknown_kind"
  | "missing_field";

export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(message: string, code: ConfigErrorCode) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }
}

export type ProjectTemplateRef = {
  identity: string;
  version: string;
};

export type ProjectConfig = {
  formatVersion: 1;
  kind: "project";
  template: ProjectTemplateRef;
};

export type TemplateConfig = {
  formatVersion: 1;
  kind: "template";
};

export type TembiterConfig = ProjectConfig | TemplateConfig;

export function projectConfig(identity: string, version: string): ProjectConfig {
  return {
    formatVersion: 1,
    kind: "project",
    template: {
      identity,
      version,
    },
  };
}

export function templateConfig(): TemplateConfig {
  return {
    formatVersion: 1,
    kind: "template",
  };
}

export function configPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_DIR, CONFIG_FILE);
}

export function serializeConfig(config: TembiterConfig): string {
  if (config.kind === "project") {
    return `${JSON.stringify(
      {
        formatVersion: 1,
        kind: "project",
        template: {
          identity: config.template.identity,
          version: config.template.version,
        },
      },
      null,
      2,
    )}\n`;
  }

  return `${JSON.stringify(
    {
      formatVersion: 1,
      kind: "template",
    },
    null,
    2,
  )}\n`;
}

export function parseConfig(value: unknown): TembiterConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(
      `${CONFIG_RELATIVE_PATH} must be a JSON object.`,
      "invalid_shape",
    );
  }

  const record = value as Record<string, unknown>;

  if (record.formatVersion !== 1) {
    throw new ConfigError(
      `${CONFIG_RELATIVE_PATH} formatVersion must be 1.`,
      "invalid_shape",
    );
  }

  if (record.kind === "template") {
    return templateConfig();
  }

  if (record.kind === "project") {
    const template = record.template;
    if (template === null || typeof template !== "object" || Array.isArray(template)) {
      throw new ConfigError(
        `${CONFIG_RELATIVE_PATH} project template must be an object with identity and version.`,
        "missing_field",
      );
    }

    const ref = template as Record<string, unknown>;
    const identity = ref.identity;
    const version = ref.version;

    if (typeof identity !== "string" || identity.length === 0) {
      throw new ConfigError(
        `${CONFIG_RELATIVE_PATH} project template.identity is required.`,
        "missing_field",
      );
    }

    if (typeof version !== "string" || version.length === 0) {
      throw new ConfigError(
        `${CONFIG_RELATIVE_PATH} project template.version is required.`,
        "missing_field",
      );
    }

    return projectConfig(identity, version);
  }

  throw new ConfigError(
    `${CONFIG_RELATIVE_PATH} kind must be "project" or "template".`,
    "unknown_kind",
  );
}

export function writeConfig(repoRoot: string, config: TembiterConfig): void {
  mkdirSync(join(repoRoot, CONFIG_DIR), { recursive: true });
  writeFileSync(configPath(repoRoot), serializeConfig(config), "utf8");
}

export function readConfig(repoRoot: string): TembiterConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath(repoRoot), "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Could not read ${CONFIG_RELATIVE_PATH}: ${detail}`,
      "invalid_json",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(
      `${CONFIG_RELATIVE_PATH} is not valid JSON.`,
      "invalid_json",
    );
  }

  return parseConfig(parsed);
}
