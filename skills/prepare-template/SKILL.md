# Prepare template

Purpose: template

Keep a template repository recognizable to tembiter and tag versions so
projects can connect and later bump. You are helping a **template owner**.
Later bumps on connected projects are an AI-agent workflow using
`apply-template-update`; they are not a human CLI update.

## Template-side format

Keep template-side `.tembiter/config.json` with `kind: "template"`.
`tembiter template register` writes this file. Do not delete it, do not
change `kind` to `"project"`, and do not scatter new format files outside
`.tembiter/`.

This repository is a template, not a connected project. Do not run
`apply-template-update` here.

## Git tags are versions

Create git tags for versions. Tembiter records those tags as
`template.version` on connected projects. Tag names are the owner's git
tags (for example `v1.0.0`); never invent a tembiter-only version scheme
alongside git tags.

When an existing project needs `tembiter adopt` and the matching
historical commit is not tagged, create a git tag on that old commit so
adopt fallback can bind the project to a real version. Tagging an old
commit is a normal git operation (`git tag <name> <commit>`). Tembiter
does not create tags for you.

## Out of scope

- Do not tell anyone to run `npx tembiter` as the bump workflow for a
  connected project. The setup CLI marks the template, initializes or
  adopts a project, and installs skills. An agent using
  `apply-template-update` owns later bumps.
- Do not add a `location` field to the format in this workflow.
- Do not require GitHub or GitLab. Tags are local git objects; push them
  to a remote if the owner already uses one.
