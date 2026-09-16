import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SelectChoice } from "../ui/prompt.js";

export type SkillPurpose = "project" | "template";

export type CatalogEntry = {
  id: string;
  purpose: SkillPurpose;
};

export const CATALOG: readonly CatalogEntry[] = [
  { id: "tembiter-sync", purpose: "project" },
];

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}

export function knownSkillSummary(): string {
  return CATALOG.map((entry) => `${entry.id} (${entry.purpose})`).join(", ");
}

export function skillSelectChoices(): SelectChoice<string>[] {
  return CATALOG.map((entry) => ({
    label: entry.id,
    description: `${entry.purpose} skill for applying later template updates`,
    value: entry.id,
  }));
}

export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "skills"))) {
      return dir;
    }
    dir = join(dir, "..");
  }
  throw new Error("Could not locate the packaged skills directory.");
}

export function skillSourceDir(id: string): string {
  return join(packageRoot(), "skills", id);
}
