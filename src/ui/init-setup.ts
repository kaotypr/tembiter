import { dim, type TtyStream } from "./color.js";
import type { PromptInputResult, PromptIo } from "./prompt.js";

export type InitSetupResult =
  | { kind: "submit"; template: string; tag: string; target: string }
  | { kind: "back" };

type SetupField = {
  label: string;
  explanation: string;
};

const FIELDS = {
  template: {
    label: "Template path:",
    explanation: "Required. Local git repository path or git URL (file:// allowed).",
  },
  tag: {
    label: "Version tag:",
    explanation: "Required. An existing git tag on that repository.",
  },
  target: {
    label: "Project path:",
    explanation: "Required. Destination directory (must not exist or must be empty).",
  },
} as const satisfies Record<string, SetupField>;

async function readRequired(io: PromptIo, field: SetupField): Promise<PromptInputResult> {
  while (true) {
    io.write(`${dim(field.explanation)}\n`);
    const result = io.input === undefined
      ? { kind: "value" as const, value: await io.question(`${field.label} `) }
      : await io.input(`${field.label} `);
    if (result.kind === "back" || result.value.trim().length > 0) {
      return result.kind === "back"
        ? result
        : { kind: "value", value: result.value.trim() };
    }
  }
}

function clearSetupPage(io: PromptIo, renderedLines: number): void {
  io.write(`\x1b[${renderedLines}F`);
  for (let line = 0; line < renderedLines; line += 1) {
    io.write("\x1b[2K\n");
  }
}

function backFromSetup(io: PromptIo, renderedFields: number): InitSetupResult {
  clearSetupPage(io, 2 + renderedFields * 2);
  return { kind: "back" };
}

export async function promptInitSetup(io: PromptIo): Promise<InitSetupResult> {
  io.write("Set up a new project (Escape to go back)\n\n");
  const template = await readRequired(io, FIELDS.template);
  if (template.kind === "back") return backFromSetup(io, 1);
  const tag = await readRequired(io, FIELDS.tag);
  if (tag.kind === "back") return backFromSetup(io, 2);
  const target = await readRequired(io, FIELDS.target);
  if (target.kind === "back") return backFromSetup(io, 3);
  return {
    kind: "submit",
    template: template.value,
    tag: tag.value,
    target: target.value,
  };
}
