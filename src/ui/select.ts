import { dim, inverse, type TtyStream } from "./color.js";
import { PromptCancelled } from "./prompt.js";

export type SelectChoice<T = string[]> = {
  key?: string;
  label: string;
  description?: string;
  value: T;
};

export type SelectOptions = {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream & TtyStream;
  question?: (query: string) => Promise<string>;
};

const UP = new Set(["\x1b[A", "\x1bOA"]);
const DOWN = new Set(["\x1b[B", "\x1bOB"]);
const ENTER = new Set(["\r", "\n"]);
const CTRL_C = "\x03";

export function canUseRawMode(stdin: NodeJS.ReadableStream): stdin is NodeJS.ReadStream {
  const stream = stdin as NodeJS.ReadStream;
  return stream.isTTY === true && typeof stream.setRawMode === "function";
}

function formatChoiceRows(
  choice: SelectChoice<unknown>,
  highlighted: boolean,
  stdout: TtyStream,
): string[] {
  const prefix = highlighted ? ">" : " ";
  const label = highlighted ? inverse(choice.label, { stream: stdout }) : choice.label;
  const rows = [`${prefix} ${label}`];
  if (choice.description !== undefined && choice.description.length > 0) {
    rows.push(`    ${dim(choice.description, { stream: stdout })}`);
  }
  return rows;
}

function listLines(
  choices: readonly SelectChoice<unknown>[],
  index: number,
  stdout: TtyStream,
): string[] {
  return [
    "Select a setup command:",
    "",
    ...choices.flatMap((choice, i) => formatChoiceRows(choice, i === index, stdout)),
  ];
}

function writeList(
  stdout: NodeJS.WritableStream & TtyStream,
  lines: readonly string[],
  redraw: boolean,
): void {
  if (redraw) {
    stdout.write(`\x1b[${lines.length}F`);
  }
  for (const line of lines) {
    stdout.write(`\x1b[2K${line}\n`);
  }
}

function consumeKey(buffer: string): { key: string; rest: string } | undefined {
  if (buffer.length === 0) {
    return undefined;
  }
  if (buffer[0] === "\x1b") {
    if (buffer.length === 1) {
      return undefined;
    }
    if (buffer[1] === "[" || buffer[1] === "O") {
      if (buffer.length < 3) {
        return undefined;
      }
      return { key: buffer.slice(0, 3), rest: buffer.slice(3) };
    }
    return { key: "\x1b", rest: buffer.slice(1) };
  }
  return { key: buffer[0] ?? "", rest: buffer.slice(1) };
}

function choiceByDigit<T>(
  choices: readonly SelectChoice<T>[],
  key: string,
): SelectChoice<T> | undefined {
  if (!/^[1-9]$/.test(key)) {
    return undefined;
  }
  const byKey = choices.find((choice) => choice.key === key);
  if (byKey !== undefined) {
    return byKey;
  }
  return choices[Number(key) - 1];
}

async function selectNumbered<T>(
  choices: readonly SelectChoice<T>[],
  stdout: NodeJS.WritableStream & TtyStream,
  question: (query: string) => Promise<string>,
): Promise<T> {
  const lines = ["Select a setup command:", ""];
  for (const [i, choice] of choices.entries()) {
    const key = choice.key ?? String(i + 1);
    lines.push(`  ${key}) ${choice.label}`);
    if (choice.description !== undefined && choice.description.length > 0) {
      lines.push(`      ${dim(choice.description, { stream: stdout })}`);
    }
  }
  lines.push("");
  stdout.write(`${lines.join("\n")}\n`);

  const answer = (await question("Command: ")).trim();
  if (answer.length === 0) {
    throw new PromptCancelled();
  }

  const match = choices.find(
    (choice, i) =>
      choice.key === answer || choice.label === answer || String(i + 1) === answer,
  );
  if (match === undefined) {
    stdout.write(
      `Unknown choice '${answer}'. Enter 1-${choices.length} or a setup command name.\n`,
    );
    throw new PromptCancelled();
  }
  return match.value;
}

async function selectRaw<T>(
  choices: readonly SelectChoice<T>[],
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WritableStream & TtyStream,
): Promise<T> {
  let index = 0;
  let buffer = "";
  const previousRaw = Boolean(stdin.isRaw);

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  writeList(stdout, listLines(choices, index, stdout), false);

  try {
    return await new Promise<T>((resolve, reject) => {
      const onData = (chunk: string | Buffer): void => {
        buffer += String(chunk);
        while (true) {
          const parsed = consumeKey(buffer);
          if (parsed === undefined) {
            return;
          }
          buffer = parsed.rest;
          const key = parsed.key;

          if (key === CTRL_C) {
            cleanup();
            reject(new PromptCancelled());
            return;
          }
          if (ENTER.has(key)) {
            const selected = choices[index];
            if (selected === undefined) {
              cleanup();
              reject(new PromptCancelled());
              return;
            }
            cleanup();
            resolve(selected.value);
            return;
          }

          const digit = choiceByDigit(choices, key);
          if (digit !== undefined) {
            cleanup();
            resolve(digit.value);
            return;
          }

          if (UP.has(key) || key === "k") {
            index = (index - 1 + choices.length) % choices.length;
            writeList(stdout, listLines(choices, index, stdout), true);
            continue;
          }
          if (DOWN.has(key) || key === "j") {
            index = (index + 1) % choices.length;
            writeList(stdout, listLines(choices, index, stdout), true);
          }
        }
      };

      const cleanup = (): void => {
        stdin.off("data", onData);
        if (typeof stdin.setRawMode === "function") {
          stdin.setRawMode(previousRaw);
        }
      };

      stdin.on("data", onData);
    });
  } catch (err) {
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(previousRaw);
    }
    throw err;
  }
}

export async function selectChoice<T>(
  choices: readonly SelectChoice<T>[],
  options: SelectOptions,
): Promise<T> {
  if (choices.length === 0) {
    throw new PromptCancelled("select requires at least one choice");
  }
  if (canUseRawMode(options.stdin)) {
    return selectRaw(choices, options.stdin, options.stdout);
  }
  if (options.question !== undefined) {
    return selectNumbered(choices, options.stdout, options.question);
  }
  throw new PromptCancelled("Interactive select requires a TTY");
}
