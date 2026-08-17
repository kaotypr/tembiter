import {
  bold,
  cyan,
  dim,
  magenta,
  supportsUtf8,
  type ColorContext,
  type TtyStream,
} from "./color.js";

export const TITLE = "Tembiter";

export const DESCRIPTION = "Arbiter for template format, setup CLI, and skills.";

const WORDMARK_LINES = [
  "  _____          _    _ _",
  " |_   _|__ _ __ | |__(_) |_ ___ _ _",
  "   | |/ -_) '  \\| '_ \\ |  _/ -_) '_|",
  "   |_|\\___|_|_|_|_.__/_|\\__\\___|_|",
] as const;

const T_BLOCK_WIDTH = 8;
const HINGE_PAD = "    ";
const BAR = "─";
const BAR_FALLBACK = "-";
const DIAMOND = "◆";
const DIAMOND_FALLBACK = "+";
const BAR_RUN = 5;

function colorWordmarkLine(line: string, ctx: ColorContext): string {
  const tWidth = Math.min(T_BLOCK_WIDTH, line.length);
  const tBlock = line.slice(0, tWidth);
  const rest = line.slice(tWidth);
  return `${bold(cyan(tBlock, ctx), ctx)}${cyan(rest, ctx)}`;
}

function hingeLine(ctx: ColorContext, utf8: boolean): string {
  const barChar = utf8 ? BAR : BAR_FALLBACK;
  const diamondChar = utf8 ? DIAMOND : DIAMOND_FALLBACK;
  const bars = barChar.repeat(BAR_RUN);
  return [
    HINGE_PAD,
    dim("template", ctx),
    " ",
    dim(bars, ctx),
    magenta(diamondChar, ctx),
    dim(bars, ctx),
    " ",
    dim("project", ctx),
  ].join("");
}

export function formatBanner(ctx: ColorContext = {}, utf8 = true): string {
  const wordmark = WORDMARK_LINES.map((line) => colorWordmarkLine(line, ctx)).join("\n");
  const hinge = hingeLine(ctx, utf8);
  const description = dim(`  ${DESCRIPTION}`, ctx);
  return `${wordmark}\n\n${hinge}\n${description}`;
}

export function printBanner(
  stdout: NodeJS.WritableStream & TtyStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const ctx: ColorContext = { stream: stdout, env };
  stdout.write(`${formatBanner(ctx, supportsUtf8(stdout))}\n\n`);
}
