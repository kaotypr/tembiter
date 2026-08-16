# tembiter

This directory is the tembiter product implementation.

- Default branch: `development/v0.1`
- Checks: `npm test` and `npx --package . tembiter --help`

Do not treat wrapper `.runtime/` or `plans/` as this repository's files.

Do not `npm publish` without an explicit human publication gate. After the version-bump commit has landed on `development/v0.1`, the human publishes from a clean checkout of that commit with `npm publish`. The default dist-tag is `latest`. Do not pass a token on the command line. `0.0.1-alpha.1` is historical name-claim only.
