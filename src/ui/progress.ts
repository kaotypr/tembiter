export type ProgressStream = {
  isTTY?: boolean;
  write?: (chunk: string) => unknown;
};

export type ProgressReporter = {
  step(message: string): void;
  done(message: string): void;
  fail(): void;
};

const silent: ProgressReporter = {
  step() {},
  done() {},
  fail() {},
};

export function createProgressReporter(
  stdout: ProgressStream = process.stdout,
): ProgressReporter {
  if (!stdout.isTTY) {
    return silent;
  }

  const writeLine = (text: string): void => {
    const line = `${text}\n`;
    if (typeof stdout.write === "function") {
      stdout.write(line);
      return;
    }
    process.stdout.write(line);
  };

  return {
    step(message: string) {
      writeLine(message);
    },
    done(message: string) {
      writeLine(`Done. ${message}`);
    },
    fail() {
      writeLine("Failed.");
    },
  };
}
