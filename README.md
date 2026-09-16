# Tembiter

Tembiter is an arbiter: its own files, formats, and conventions; a setup CLI (`npx tembiter`); and skills. The CLI writes that format onto a template and a project. An AI agent using the skills and those files brings later template updates into the project.

```sh
npx tembiter
npx tembiter --help
npx tembiter --version
```

`npx tembiter` tracks npm `latest`, which is the stable release line.

## Local development

Requires Node.js 20 or later and git.

```sh
npm install
npm run build
npx --package . tembiter
```

### Interactive setup

On a terminal, `npx tembiter` with no arguments shows a Tembiter welcome banner and an arrow-key list of the three setup commands (`init`, `adopt`, `skill install`). Each command has a one-line description. Move with Up/Down or `j`/`k`, press Enter to confirm the highlight, or press `1`–`3` to select that command immediately.

Choosing `init` opens a dedicated setup page that asks for `Template path:`, `Version tag:`, and `Project path:` in that order. All three values are required. Press Escape before init begins to return to the picker without creating files or running git. Picker-based init uses the default first-commit message, exactly `Initial commit`.

The other picker choices and setup subcommands prompt for missing options. Each field shows a short title, a description, whether it is required or optional, and a prompt label that matches the flag name. The `adopt` flow explains that a tag is required when the template has tags and may be omitted only for the no-tag assistance flow. The `skill install` flow identifies the packaged catalog skill and its project purpose. Optional fields accept Enter to keep the documented default.

A TTY run introduces the selected operation with a heading, asks for confirmation before `init` or `adopt` writes setup files or creates a commit, and prints progress for meaningful steps, including `.gitignore` updates and optional `.claude` skill linking, then `Done.` or `Failed.` before exit. Declining confirmation cancels without applying the setup changes. Running a setup subcommand on a terminal without its required flags continues in those prompts instead of only printing usage. It does not reprint the welcome banner. If every required flag is already present, tembiter does not prompt for its flags, but an interactive `init` or `adopt` still confirms before making changes.

Scripts, CI, and pipes should not wait at a prompt. Use flags or `--non-interactive`. When stdin is not a TTY, or when `--non-interactive` is passed, missing flags stay a non-zero usage error. Successful non-TTY runs stay silent except adopt-fallback assistance. No-args in that mode prints usage and exits 0.

```sh
npx tembiter --non-interactive init \
  --template /path/to/template \
  --target /path/to/new-project \
  --tag v1.0.0
```

### Start a new project

```sh
npx tembiter init \
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

`tembiter init` copies that tag's file tree into `--target` (it does not clone the template as the project repository), writes `.tembiter/config.json` with the template identity and tag, adds `.tembiter/sync/` to `.gitignore` so nested sync worktrees stay untracked, runs `git init`, and creates one commit. `.tembiter/config.json` stays tracked.

### Connect an existing project

Use `adopt` when the project already exists. If the template already has version tags, pass `--tag`. It writes `.tembiter/config.json` and creates one new commit of `.tembiter/` (and `.gitignore` when the ignore line `.tembiter/sync/` is added). `.tembiter/config.json` stays tracked. It does not copy template files and does not rewrite project history.

```sh
npx tembiter adopt \
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

Skills ship in this package. They are not scraped from a template. Install them with `tembiter skill install` onto a connected project.

```sh
npx tembiter skill install \
  --skill tembiter-sync \
  --path /path/to/project
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--skill` | yes | Catalog id |
| `--path` | yes | Connected project repository root (no default) |

| Skill id | Purpose |
| --- | --- |
| `tembiter-sync` | project |

Installing the project skill onto a template repository fails. Canonical files go under `<path>/.agents/skills/<id>/`, not under `.tembiter/`.

If `<path>/.claude` already exists, tembiter creates `.claude/skills/` when needed and adds a symlink `.claude/skills/<id>` → `../../.agents/skills/<id>`. If `.claude` is absent, host linking is skipped and `.claude` is not created. A regular file already at the host skill path is an error.

### Later template updates

After setup, later bumps are an **AI agent** workflow using the skills installed by `tembiter skill install`. The agent creates a git worktree at `.tembiter/sync/<tag>` on branch `tembiter/sync-<tag>` from the project default/base branch, judges template vs project-specific changes there, and refreshes `.tembiter/config.json` inside that worktree. It does not merge into the user's current checkout. Optionally it may open an MR/PR from that branch if a git host is already configured.

The CLI is **setup only** (`init`, `adopt`, `skill install`). Setup commands ignore nested sync worktrees by adding `.tembiter/sync/` to `.gitignore`. The picker has no update command. Do not run the CLI for a later bump. There is no human update command.

Install `tembiter-sync` on a connected project before asking an agent to apply a later template tag.

`npm test` compiles the package and runs the tests.

## Product requirements

Product requirements live in the wrapper workspace `sources/prd.md`, not in this repository yet.
