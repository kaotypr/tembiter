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

export async function promptInitSetup(io: PromptIo): Promise<InitSetupResult> {
  io.write("Set up a new project (Escape to go back)\n\n");
  const template = await readRequired(io, FIELDS.template);
  if (template.kind === "back") return template;
  const tag = await readRequired(io, FIELDS.tag);
  if (tag.kind === "back") return tag;
  const target = await readRequired(io, FIELDS.target);
  if (target.kind === "back") return target;
  return {
    kind: "submit",
    template: template.value,
    tag: tag.value,
    target: target.value,
  };
}
