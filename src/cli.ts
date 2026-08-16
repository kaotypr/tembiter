#!/usr/bin/env node

import { printInitUsage, runInit } from "./commands/init.js";

const PACKAGE_NAME = "tembiter";
const PACKAGE_VERSION = "0.0.1-alpha.2";

function printUsage(stream: NodeJS.WritableStream): void {
  stream.write(`${PACKAGE_NAME} ${PACKAGE_VERSION}\n`);
  stream.write("\n");
  stream.write("Usage:\n");
  stream.write(
    "  tembiter init --template <path-or-url> --target <dir> --tag <git-tag> [--message <text>]\n",
  );
  stream.write("  tembiter --help\n");
  stream.write("  tembiter --version\n");
}

function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage(process.stdout);
    return 0;
  }

  if (args[0] === "--version") {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return 0;
  }

  if (args[0] === "init") {
    if (args.length === 2 && (args[1] === "--help" || args[1] === "-h")) {
      printInitUsage(process.stdout);
      return 0;
    }
    return runInit(args.slice(1));
  }

  process.stderr.write(`Not implemented: ${args[0]}\n`);
  printUsage(process.stderr);
  return 1;
}

process.exit(main(process.argv));
