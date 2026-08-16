import { createInterface } from "node:readline/promises";

export class PromptCancelled extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "PromptCancelled";
  }
}

export type PromptIo = {
  question(query: string): Promise<string>;
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
  output: NodeJS.WritableStream = process.stdout,
): PromptIo {
  const rl = createInterface({ input, output });
  let closed = false;

  const cancel = (): void => {
    closed = true;
    rl.close();
  };

  rl.on("SIGINT", cancel);

  return {
    write(text: string) {
      output.write(text);
    },
    async question(query: string): Promise<string> {
      if (closed) {
        throw new PromptCancelled();
      }
      try {
        return await rl.question(query);
      } catch (err) {
        if (closed || (err instanceof Error && err.name === "AbortError")) {
          throw new PromptCancelled();
        }
        throw err;
      }
    },
    close() {
      if (!closed) {
        closed = true;
        rl.close();
      }
    },
  };
}

export async function promptFlag(
  io: PromptIo,
  flag: string,
  options: { required: boolean },
): Promise<string | undefined> {
  const query = `--${flag}: `;
  while (true) {
    const answer = (await io.question(query)).trim();
    if (answer.length > 0) {
      return answer;
    }
    if (!options.required) {
      return undefined;
    }
  }
}
