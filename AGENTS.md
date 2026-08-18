# tembiter

This directory is the tembiter product implementation.

- Default branch: `development/v0.1`
- Checks: `npm test` and `npx --package . tembiter --help`

Do not treat wrapper `.runtime/` or `plans/` as this repository's files.

Do not `npm publish` locally. After the version bump has merged to `development/v0.1`, a human must configure the npm trusted publisher on npmjs.com, then push the matching tag `v0.1.0`. The publish workflow maps this stable tag to npm `latest`; no local publication is authorized. `0.0.1-alpha.1` remains the historical name-claim release.
