# Tembiter

Tembiter is an arbiter: its own files, formats, and conventions; a setup CLI (`npx tembiter`); and skills. The CLI writes that format onto a template and a project. An AI agent using the skills and those files brings later template updates into the project.

## Local run

Requires Node.js 20 or later and git.

```sh
npm install
npm run build
npx --package . tembiter --help
npx --package . tembiter --version
```

### Start a new project

```sh
npx --package . tembiter init \
  --template /path/to/template \
  --target /path/to/new-project \
  --tag v1.0.0
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--template` | yes | Local git repository path or git URL (`file://` allowed) |
| `--target` | yes | Destination directory (must not exist, or must be empty) |
| `--tag` | yes | Template version: an existing git tag on that repository |
| `--message` | no | First-commit message; default exactly `Initial commit` |

`tembiter init` copies that tag's file tree into `--target` (it does not clone the template as the project repository), writes `.tembiter/config.json` with the template identity and tag, runs `git init`, and creates one commit.

### Register a template

```sh
npx --package . tembiter template register --path /path/to/template
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--path` | no | Git repository to mark; default current working directory |
| `--message` | no | Commit message; default `Register tembiter template` |

`tembiter template register` writes `.tembiter/config.json` with `kind: "template"` and creates one new commit of `.tembiter/` only. It does not create git tags. Tagging template versions is the repository owner's git operation (`git tag`).

`npm test` compiles the package and runs the tests.

## Product requirements

Product requirements live in the wrapper workspace `sources/prd.md`, not in this repository yet.
