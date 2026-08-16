#!/usr/bin/env node

const PACKAGE_NAME = "tembiter";
const PACKAGE_VERSION = "0.0.1-alpha.2";
const NOT_IMPLEMENTED =
  "Setup commands are not implemented in this slice.";

function printUsage(stream: NodeJS.WritableStream): void {
  stream.write(`${PACKAGE_NAME} ${PACKAGE_VERSION}\n`);
  stream.write(`${NOT_IMPLEMENTED}\n`);
}

function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    printUsage(process.stdout);
    return 0;
  }

  if (args[0] === "--version") {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return 0;
  }

  printUsage(process.stderr);
  return 1;
}

process.exit(main(process.argv));
