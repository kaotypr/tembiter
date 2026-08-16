# Tembiter

Tembiter is an arbiter: its own files, formats, and conventions; a setup CLI (`npx tembiter`); and skills. The CLI writes that format onto a template and a project. An AI agent using the skills and those files brings later template updates into the project.

This repository currently ships a stub CLI only. Setup commands are not implemented in this slice.

## Local run

Requires Node.js 20 or later.

```sh
npm install
npm run build
npx --package . tembiter --help
npx --package . tembiter --version
```

`npm test` compiles the package and runs the smoke tests.

## Product requirements

Product requirements live in the wrapper workspace `sources/prd.md`, not in this repository yet.
