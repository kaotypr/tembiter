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

### Install a packaged skill

Skills ship in this package. They are not scraped from a template. Stub `SKILL.md` files are installable placeholders; the full agent update procedure is filled in later (plan 0008).

```sh
npx --package . tembiter skill install \
  --skill apply-template-update \
  --path /path/to/project
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--skill` | yes | Catalog id |
| `--path` | yes | Template or project repository root (no default) |

| Skill id | Purpose |
| --- | --- |
| `apply-template-update` | project |
| `prepare-template` | template |

Installing a skill onto the other kind of repository fails. Canonical files go under `<path>/.agents/skills/<id>/`, not under `.tembiter/`.

If `<path>/.claude` already exists, tembiter creates `.claude/skills/` when needed and adds a symlink `.claude/skills/<id>` → `../../.agents/skills/<id>`. If `.claude` is absent, host linking is skipped and `.claude` is not created. A regular file already at the host skill path is an error.

`npm test` compiles the package and runs the tests.

## Product requirements

Product requirements live in the wrapper workspace `sources/prd.md`, not in this repository yet.
