export type TtyStream = {
  isTTY?: boolean;
  encoding?: BufferEncoding | null;
};

export type ColorContext = {
  stream?: TtyStream;
  env?: NodeJS.ProcessEnv;
};

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const INVERSE = "\x1b[7m";
export const CYAN = "\x1b[36m";
export const MAGENTA = "\x1b[35m";

export function colorEnabled(ctx: ColorContext = {}): boolean {
  const env = ctx.env ?? process.env;
  if (env.NO_COLOR) {
    return false;
  }
  const stream = ctx.stream ?? process.stdout;
  return Boolean(stream.isTTY);
}

export function supportsUtf8(stream: TtyStream = process.stdout): boolean {
  const encoding = stream.encoding;
  if (encoding === undefined || encoding === null) {
    return true;
  }
  const normalized = encoding.toLowerCase();
  return normalized === "utf8" || normalized === "utf-8";
}

function paint(text: string, open: string, ctx: ColorContext = {}): string {
  if (!colorEnabled(ctx)) {
    return text;
  }
  return `${open}${text}${RESET}`;
}

export function cyan(text: string, ctx: ColorContext = {}): string {
  return paint(text, CYAN, ctx);
}

export function magenta(text: string, ctx: ColorContext = {}): string {
  return paint(text, MAGENTA, ctx);
}

export function dim(text: string, ctx: ColorContext = {}): string {
  return paint(text, DIM, ctx);
}

export function inverse(text: string, ctx: ColorContext = {}): string {
  return paint(text, INVERSE, ctx);
}

export function bold(text: string, ctx: ColorContext = {}): string {
  return paint(text, BOLD, ctx);
}

export function reset(text: string): string {
  return `${text}${RESET}`;
}
