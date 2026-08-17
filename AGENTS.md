# tembiter

This directory is the tembiter product implementation.

- Default branch: `development/v0.1`
- Checks: `npm test` and `npx --package . tembiter --help`

Do not treat wrapper `.runtime/` or `plans/` as this repository's files.

Do not `npm publish` locally. After the publish workflow has landed on `development/v0.1`, publication is: configure the npm trusted publisher (human, npmjs.com), then push a tag `v<package.json version>`. First intended tag: `v0.0.1-alpha.2` → dist-tag `alpha`. `0.0.1-alpha.1` remains historical name-claim.
