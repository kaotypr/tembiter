import { createInterface } from "node:readline/promises";
import { cyan, dim, type TtyStream } from "./color.js";
import { selectChoice, type SelectChoice } from "./select.js";

export class PromptCancelled extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "PromptCancelled";
  }
}

export type { SelectChoice };

export type PromptIo = {
  question(query: string): Promise<string>;
  select<T = string[]>(choices: readonly SelectChoice<T>[]): Promise<T>;
  write(text: string): void;
  close(): void;
};

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

export async function promptFlag(
  io: PromptIo,
  flag: string,
  options: PromptFlagOptions,
): Promise<string | undefined> {
  const query = `--${flag}: `;
  while (true) {
    writeFieldCopy(io, options);
    const answer = (await io.question(query)).trim();
    if (answer.length > 0) {
      return answer;
    }
    if (!options.required) {
      return undefined;
    }
  }
}
