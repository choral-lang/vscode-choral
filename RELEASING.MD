# Releasing

## 1. Update version files accordingly
In the `package.json` file, bump the version number displayed as `version`. 

In `src/installer.ts` change the hardcoded version number for `CHORAL_VERSION`. 

## 2. Triggering github actions.
This project uses github actions to publish the VSCode extension. 

To trigger them, create a tag with command `git tag <tag>`. (Please follow existing format i.e. `v1.x.x`) Then push the tag via `git push origin <tag>`. 