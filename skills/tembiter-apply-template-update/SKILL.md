---
name: tembiter-apply-template-update
description: Bring a later template git tag into a connected project.
---

# Apply template update

Purpose: project

Bring a later template git tag into a connected project that has already
diverged. You (an AI agent) own this bump end to end: branch, apply,
which-side judgment, format refresh, and local merge. The human CLI is
setup only. Do not tell the human to run `npx tembiter` for this bump.

## Preconditions

Confirm all of the following before changing files:

- The working directory is a git repository with git available
  (`git rev-parse --show-toplevel` succeeds).
- `.tembiter/config.json` exists at the repository root and has
  `kind: "project"`. If `kind` is `"template"` or the file is missing,
  stop. This skill is for a connected project, not a template.
- A later template tag is known (the human named it) or discoverable
  from identity: `template.identity` plus git tags newer than
  `template.version`.

### Fetch a later tag

Treat `template.identity` as a local filesystem path or a git URL. Fetch
tags from that location (for example `git fetch <identity> --tags`, or
add a remote that points at identity and fetch). Compare tags to the
recorded `template.version` and choose a later tag.

If identity is not a usable path or git URL, or fetch fails, ask the
human where the template repository is. Do not add a tembiter `location`
field (T11) to `.tembiter/config.json`. Do not invent a parallel version
scheme; versions are git tags on the template.

## Read format

Parse `.tembiter/config.json` only. Record:

- `kind` (must be `"project"`)
- `template.identity`
- `template.version` (the git tag the project is currently bound to)

Do not scatter new format files outside `.tembiter/`. Identifier and
version writes stay in `.tembiter/config.json`. Template **source** you
apply into the project is an intentional project change, not format
scatter.

## Branch

Create a reviewable branch from the current project HEAD before applying
the bump (for example `tembiter/update-<new-tag>`). Do not work on the
default branch as the only copy of the bump. The default branch may
receive the result later, in Finish, by merging this branch.

## Apply

Bring the later tag's tree into the project **without** replacing the
project with a fresh copy and without `git clone` over the project.

Prefer:

1. Merge or rebase of template changes onto project history when the
   project still shares history with the template; or
2. A structured checkout of changed paths: fetch the recorded tag and
   the later tag from identity, diff those two tags, and apply the
   template-side path changes onto the project (checkout or patch).

Init copies a tag's files; it does not clone the template as the project
repository. If histories are unrelated, do not force a blind
`--allow-unrelated-histories` merge that would bury project work. Diff
the old tag against the new tag and apply that delta.

Forbid deleting project-specific work to "make it look like the
template". Do not `rm -rf` the project and recopy the tag. Do not reset
the project to the template tag.

## Which-side / conflicts

For a case a plain three-way merge cannot judge, produce change context
and choose template vs project-specific:

1. What the template changed between the recorded tag and the later tag.
2. What the project changed on those same paths since it was connected.
3. A which-side decision per conflict: take the template change, keep
   the project-specific work, or combine them.

Ownership lists, if absent, are not an excuse to skip judgment. If a
list exists, treat it as a hint, not as a substitute for this decision.
Changelogs and diffs are tools for this judgment, not the outcome.

## Refresh tembiter files

After the source bump is applied:

- Set `template.version` in `.tembiter/config.json` to the new tag.
  Keep `kind: "project"` and `template.identity`. Do not write format
  files outside `.tembiter/`.
- If shipped skills changed with the bump, refresh `.agents/skills`
  (overwrite the installed skill bodies) and refresh host symlinks
  under `.claude/skills` when that host directory already exists. Do
  not create `.claude` if it is absent. Do not skip this because a
  human could run a CLI command.

## Finish

Merge the branch locally into the project's current integration branch
(v0.1 default). Local git only is enough.

Optionally open an MR/PR if a host is already configured (GitHub,
GitLab, or another remote the project already uses). Do not fail v0.1
if no host is configured. Do not require a GitHub or GitLab API. Do not
choose a host as a product requirement.

## Out of scope for the agent

- Do not tell the human to run `npx tembiter` for this bump. There is
  no human `tembiter update` command. Setup CLI (`init`,
  `template register`, `adopt`, `skill install`) is not the bump
  workflow.
- Do not treat a changelog, diff listing, or generated notes as done.
  Done means the later tag is applied on a reviewable branch, format
  version is refreshed, and the branch is merged locally (or an optional
  MR/PR was opened when a host already existed).
- Do not replace the project with a fresh template copy.
- Do not add a `location` field to the format in this workflow.
