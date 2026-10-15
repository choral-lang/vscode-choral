# Releasing

## 1. Update version files

Bump the extension version in both `package.json` and `package-lock.json`.
Commit the changes and merge the pull request before releasing.

## 2. Publish a GitHub release

Create and publish a [GitHub release](https://github.com/choral-lang/vscode-choral/releases/new)
targeting the release commit. The tag must exactly match the version in
`package.json`, prefixed with `v` (e.g. `v1.0.5`).

Publishing the release triggers the [Publish workflow](https://github.com/choral-lang/vscode-choral/actions/workflows/publish.yml),
which validates the tag, runs tests, and publishes to the VS Code Marketplace
using the `VS_CODE_MARKETPLACE_PAT` repository secret. Pushing a tag alone does
not trigger publication. Check that the workflow succeeds.
