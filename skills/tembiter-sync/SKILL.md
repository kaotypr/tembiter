---
name: tembiter-sync
description: Bring a later template git tag into a connected project.
---

# Apply template update

Purpose: project

Bring a later template git tag into a connected project that has already
diverged. You (an AI agent) own this bump end to end: isolate it in a git
worktree, apply, which-side judgment, and format refresh. The human CLI is
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
- `.gitignore` ignores `.tembiter/sync/`. If it does not, stop and tell
  the human to run a setup command (`tembiter skill install` is enough
  to write the line). Do not edit `.gitignore` on the current checkout.
- The later template tag is a single path segment matching
  `^[A-Za-z0-9._-]+$`. Stop otherwise. Do not invent encoding for tags
  that contain slashes.

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

Resolve the project default/base branch: `origin/HEAD` if set, otherwise
the default branch git reports. Never use the user's current checkout as
the base. Stop if the default/base branch cannot be resolved.

Create or reuse a git worktree from that default/base branch. Do not
`git checkout` in the primary worktree. Do not change the user's currently
checked-out branch.

```text
git worktree add -b tembiter/sync-<tag> \
  .tembiter/sync/<tag> \
  <base-branch>
```

If that worktree or branch already exists for this tag, reuse it.

## Apply

Bring the later tag's tree into the project **only inside that worktree**,
**without** replacing the project with a fresh copy and without `git clone`
over the project. Do not apply the bump on the user's current checkout.
Do not `git checkout`, merge, or commit in the primary worktree.

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
the project to the template tag. Apply, which-side judgment, and tembiter
file refresh only inside that worktree.

## Which-side / conflicts

Judge conflicts **only inside that worktree**. For a case a plain
three-way merge cannot judge, produce change context and choose template
vs project-specific:

1. What the template changed between the recorded tag and the later tag.
2. What the project changed on those same paths since it was connected.
3. A which-side decision per conflict: take the template change, keep
   the project-specific work, or combine them.

Ownership lists, if absent, are not an excuse to skip judgment. If a
list exists, treat it as a hint, not as a substitute for this decision.
Changelogs and diffs are tools for this judgment, not the outcome.

## Refresh tembiter files

After the source bump is applied **only inside that worktree**:

- Set `template.version` in `.tembiter/config.json` to the new tag.
  Keep `kind: "project"` and `template.identity`. Do not write format
  files outside `.tembiter/`.
- If shipped skills changed with the bump, refresh `.agents/skills`
  (overwrite the installed skill bodies) and refresh host symlinks
  under `.claude/skills` when that host directory already exists. Do
  not create `.claude` if it is absent. Do not skip this because a
  human could run a CLI command.

## Finish

Finish without touching the user's current branch. Leave the worktree and
`tembiter/sync-<tag>` as the reviewable result. Do not merge into the
primary checkout. Do not checkout, merge, or commit in the primary
worktree. Do not change the user's currently checked-out branch.

Optionally open an MR/PR from that branch if a host is already configured
(GitHub, GitLab, or another remote the project already uses). Do not fail
v0.1 if no host is configured. Do not require a GitHub or GitLab API. Do
not choose a host as a product requirement.

## Out of scope for the agent

- Do not tell the human to run `npx tembiter` for this bump. There is
  no human `tembiter update` command. Setup CLI (`init`,
  `template register`, `adopt`, `skill install`) is not the bump
  workflow.
- Do not treat a changelog, diff listing, or generated notes as done.
  Done means the later tag is applied in the git worktree on
  `tembiter/sync-<tag>` at `.tembiter/sync/<tag>`, format version is
  refreshed there, and that branch is the reviewable result (or an
  optional MR/PR was opened from it when a host already existed).
- Do not replace the project with a fresh template copy.
- Do not add a `location` field to the format in this workflow.
- Do not edit `.gitignore` on the current checkout.
