import { PromptCancelled, type PromptIo, type SelectChoice } from "./prompt.js";

export type PickerChoice = {
  key: string;
  label: string;
  argv: readonly string[];
};

export const PICKER_COMMANDS: readonly PickerChoice[] = [
  { key: "1", label: "init", argv: ["init"] },
  { key: "2", label: "template register", argv: ["template", "register"] },
  { key: "3", label: "adopt", argv: ["adopt"] },
  { key: "4", label: "skill install", argv: ["skill", "install"] },
];

export function formatPickerMenu(
  commands: readonly PickerChoice[] = PICKER_COMMANDS,
): string {
  const lines = ["Select a setup command:", ""];
  for (const command of commands) {
    lines.push(`  ${command.key}) ${command.label}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function pickerLabels(
  commands: readonly PickerChoice[] = PICKER_COMMANDS,
): string[] {
  return commands.map((command) => command.label);
}

export function pickerSelectChoices(
  commands: readonly PickerChoice[] = PICKER_COMMANDS,
): SelectChoice<string[]>[] {
  return commands.map((command) => ({
    key: command.key,
    label: command.label,
    value: [...command.argv],
  }));
}

export async function pickSetupCommand(io: PromptIo): Promise<string[]> {
  const selected = await io.select(pickerSelectChoices());
  if (selected.length === 0) {
    throw new PromptCancelled();
  }
  return selected;
}
