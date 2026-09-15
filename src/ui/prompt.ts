import { createInterface } from "node:readline/promises";
import { cyan, dim, type TtyStream } from "./color.js";
import { selectChoice, type SelectChoice } from "./select.js";

export class PromptCancelled extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "PromptCancelled";
  }
}

export class PromptBack extends Error {
  constructor() {
    super("Back");
    this.name = "PromptBack";
  }
}

export type { SelectChoice };

export type PromptIo = {
  question(query: string): Promise<string>;
  input?(query: string): Promise<PromptInputResult>;
  select<T = string[]>(choices: readonly SelectChoice<T>[]): Promise<T>;
  write(text: string): void;
  close(): void;
};

export type PromptInputResult =
  | { kind: "value"; value: string }
  | { kind: "back" };

export type TtyLike = {
  isTTY?: boolean;
};

export function detectInteractive(
  argv: readonly string[],
  stdin: TtyLike = process.stdin,
  stdout: TtyLike = process.stdout,
): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY && !argv.includes("--non-interactive"));
}

export function createReadlinePrompt(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream & TtyStream = process.stdout,
): PromptIo {
  let rl: ReturnType<typeof createInterface> | undefined;
  let closed = false;

  const cancel = (): void => {
    closed = true;
    rl?.close();
  };

  const getRl = (): ReturnType<typeof createInterface> => {
    if (rl === undefined) {
      rl = createInterface({ input, output });
      rl.on("SIGINT", cancel);
    }
    return rl;
  };

  const prompt: PromptIo = {
    write(text: string) {
      output.write(text);
    },
    async question(query: string): Promise<string> {
      if (closed) {
        throw new PromptCancelled();
      }
      try {
        return await getRl().question(cyan(query, { stream: output }));
      } catch (err) {
        if (closed || (err instanceof Error && err.name === "AbortError")) {
          throw new PromptCancelled();
        }
        throw err;
      }
    },
    async input(query: string): Promise<PromptInputResult> {
      const stream = input as NodeJS.ReadStream;
      if (stream.isTTY !== true || typeof stream.setRawMode !== "function") {
        const value = await prompt.question(query);
        return value === "\x1b" ? { kind: "back" } : { kind: "value", value };
      }

      const previousRaw = Boolean(stream.isRaw);
      let value = "";
      output.write(cyan(query, { stream: output }));
      stream.setRawMode(true);
      stream.resume();
      stream.setEncoding("utf8");

      return new Promise<PromptInputResult>((resolve, reject) => {
        const cleanup = (): void => {
          stream.off("data", onData);
          stream.setRawMode(previousRaw);
        };
        const finish = (result: PromptInputResult): void => {
          cleanup();
          output.write("\n");
          resolve(result);
        };
        const onData = (chunk: string | Buffer): void => {
          for (const key of String(chunk)) {
            if (key === "\x03") {
              cleanup();
              reject(new PromptCancelled());
              return;
            }
            if (key === "\x1b") {
              finish({ kind: "back" });
              return;
            }
            if (key === "\r" || key === "\n") {
              finish({ kind: "value", value });
              return;
            }
            if (key === "\x7f" || key === "\b") {
              if (value.length > 0) {
                value = value.slice(0, -1);
                output.write("\b \b");
              }
              continue;
            }
            if (key >= " ") {
              value += key;
              output.write(key);
            }
          }
        };
        stream.on("data", onData);
      });
    },
    async select<T = string[]>(choices: readonly SelectChoice<T>[]): Promise<T> {
      if (closed) {
        throw new PromptCancelled();
      }
      return selectChoice(choices, {
        stdin: input,
        stdout: output,
        question: (query) => prompt.question(query),
      });
    },
    close() {
      if (!closed) {
        closed = true;
        rl?.close();
      }
    },
  };

  return prompt;
}

export type PromptFlagOptions = {
  title: string;
  description: string;
  required: boolean;
  defaultLabel?: string;
};

function fieldHint(options: PromptFlagOptions): string {
  if (options.required) {
    return "required";
  }
  if (options.defaultLabel !== undefined) {
    return `optional, Enter for "${options.defaultLabel}"`;
  }
  return "optional";
}

function writeFieldCopy(io: PromptIo, options: PromptFlagOptions): void {
  io.write(`${cyan(`${options.title}  (${fieldHint(options)})`)}\n`);
  io.write(`${dim(`  ${options.description}`)}\n`);
}

function clearFieldCopy(io: PromptIo): void {
  const renderedLines = 3;
  io.write(`\x1b[${renderedLines}F`);
  for (let line = 0; line < renderedLines; line += 1) {
    io.write("\x1b[2K\n");
  }
  io.write(`\x1b[${renderedLines}F`);
}

export async function promptFlag(
  io: PromptIo,
  flag: string,
  options: PromptFlagOptions,
): Promise<string | undefined> {
  const query = `${options.title}: `;
  while (true) {
    writeFieldCopy(io, options);
    const result = io.input === undefined
      ? { kind: "value" as const, value: await io.question(query) }
      : await io.input(query);
    if (result.kind === "back") {
      clearFieldCopy(io);
      throw new PromptBack();
    }
    const answer = result.value.trim();
    if (answer.length > 0) {
      return answer;
    }
    if (!options.required) {
      return undefined;
    }
  }
}
