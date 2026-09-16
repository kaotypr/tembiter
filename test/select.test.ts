import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PromptBack } from "../src/ui/errors.js";
import { pickerSelectChoices } from "../src/ui/picker.js";
import { selectChoice } from "../src/ui/select.js";

function fakeRawStdin(): NodeJS.ReadStream & { emitData: (chunk: string) => void } {
  const listeners = new Map<string, Set<(chunk: string) => void>>();
  const stdin = {
    isTTY: true,
    isRaw: false,
    setRawMode(mode: boolean) {
      stdin.isRaw = mode;
      return stdin;
    },
    resume() {
      return stdin;
    },
    setEncoding() {
      return stdin;
    },
    on(event: string, fn: (chunk: string) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
      return stdin;
    },
    off(event: string, fn: (chunk: string) => void) {
      listeners.get(event)?.delete(fn);
      return stdin;
    },
    emitData(chunk: string) {
      for (const fn of listeners.get("data") ?? []) {
        fn(chunk);
      }
    },
  };
  return stdin as unknown as NodeJS.ReadStream & { emitData: (chunk: string) => void };
}

function withTimeout<T>(promise: Promise<T>, ms = 1000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("select timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

describe("raw selector cancellation", () => {
  for (const [label, choices] of [
    ["setup picker", pickerSelectChoices()],
    ["skill picker", pickerSelectChoices().slice(2)],
  ] as const) {
    it(`Escape clears the ${label} and returns back`, async () => {
      const stdin = fakeRawStdin();
      const writes: string[] = [];
      const pending = selectChoice(choices, {
        stdin,
        stdout: {
          isTTY: true,
          write(chunk: string) {
            writes.push(chunk);
            return true;
          },
        } as unknown as NodeJS.WritableStream & { isTTY?: boolean },
      });

      queueMicrotask(() => stdin.emitData("\x1b"));

      await assert.rejects(withTimeout(pending), (err: unknown) => err instanceof PromptBack);
      assert.equal(stdin.isRaw, false);
      assert.match(writes.join(""), /\x1b\[2K\n/);
    });
  }
});
