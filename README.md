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

### Interactive setup

On a terminal, `npx tembiter` with no arguments shows a Tembiter welcome banner and an arrow-key list of the four setup commands (`init`, `template register`, `adopt`, `skill install`). Move with Up/Down or `j`/`k`, press Enter to confirm the highlight, or press `1`–`4` to select that command immediately. Then tembiter prompts for that command's options. Prompt labels match the flag names (`--template`, `--target`, `--tag`, `--message`, `--path`, `--project`, `--skill`). Optional flags can be left empty to keep the same defaults as the flags path.

Running a setup subcommand on a terminal without its required flags continues in those prompts instead of only printing usage. It does not reprint the welcome banner. If every required flag is already present, tembiter does not prompt.

Scripts, CI, and pipes should not wait at a prompt. Use flags or `--non-interactive`. When stdin is not a TTY, or when `--non-interactive` is passed, missing flags stay a non-zero usage error. No-args in that mode prints usage and exits 0.

```sh
npx tembiter --non-interactive init \
  --template /path/to/template \
  --target /path/to/new-project \
  --tag v1.0.0
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

### Connect an existing project

Use `adopt` when the project already exists. If the template already has version tags, pass `--tag`. It writes `.tembiter/config.json` and creates one new commit of `.tembiter/` only. It does not copy template files and does not rewrite project history.

```sh
npx --package . tembiter adopt \
  --template /path/to/template \
  --tag v1.0.0 \
  --project /path/to/existing-project
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--template` | yes | Local git repository path or git URL (`file://` allowed) |
| `--tag` | when the template has tags | Template version: an existing git tag on that repository |
| `--project` | no | Project git repository; default current working directory |
| `--message` | no | Commit message; default `Connect tembiter to <identity>@<tag>` |

`--tag` is required when the template already has tags. If `--tag` is omitted or unknown, adopt fails and lists the tags. It does not pick a tag silently.

If the template has no tags, omit `--tag`. adopt prints the project's first-commit date, the latest template commit from that calendar day, and a suggested `git tag` command. This is assistance only: tembiter does not create the tag and does not write `.tembiter/`. After the template owner creates a tag (any name they choose) on that commit, re-run adopt with `--tag`.

### Install a packaged skill

Skills ship in this package. They are not scraped from a template. Install them with `tembiter skill install` onto a template or a connected project.

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

### Later template updates

After setup, later bumps are an **AI agent** workflow using the skills installed by `tembiter skill install`. The agent works on a reviewable branch, judges template vs project-specific changes, refreshes `.tembiter/config.json`, and **merges locally** by default. Optionally it may open an MR/PR if a git host is already configured.

The CLI is **setup only** (`init`, `template register`, `adopt`, `skill install`). Do not run the CLI for a later bump. There is no human update command.

Install `apply-template-update` on a connected project before asking an agent to apply a later template tag. Install `prepare-template` on a template so the owner keeps `.tembiter/config.json` and git tags.

`npm test` compiles the package and runs the tests.

## Product requirements

Product requirements live in the wrapper workspace `sources/prd.md`, not in this repository yet.
