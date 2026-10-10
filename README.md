# Choral extension for Visual Studio Code

Support for the [Choral programming language](https://choral-lang.org) inside of Visual Studio Code. Enjoy!

## Features

- Syntax highlighting

- Error highlighting 

- Automatically installs Choral unless `$CHORAL_HOME` is set

## Development

To make changes to the extension, we recommend you use VS Code.
To set up your development environment, run `npm install`. 
To compile the extension (and recompile whenever you make a change) use 
`npm run watch`. 

To debug the extension, press `F5` in VS Code or pick `Run > Start Debugging` 
from the VS Code menu. When you do that, VS Code looks for `.vscode/launch.json`
and runs it. A new window will pop up, but the extension won't load until you
open a `.ch` or `.chh` file. 

Let's call the new VS Code window "the host window" and the old VS Code 
window "the debugger window". There are three places to look for logs:

1. The *debug console* in the debugger window. Open it with `View > Debug Console`.
   This is where `console.log` messages from the LSP client will appear. 

2. The *output channel* in the host window. Open it with `View > Output`
   and then selecting `Choral Language Server` from the dropdown menu.
   This is where stdout from the LSP server will appear.

3. The *trace channel* in the host window. This window logs JSON messages
   between the LSP client and LSP server. To enable it, run 
   `Developer: Set Log Level...` from the Command Palette, select 
   `Choral LSP Trace`, and select `Trace`. Open it with `View > Output`
   and then selecting `Choral LSP Trace`. The verbosity of these logs
   is controlled in the host window by adjusting the VS Code setting
   `choral.trace.server`.

### Tests

Run `npm run test:unit`, `npm run test:integration`, or `npm run test:e2e`
to select a group. `npm test` runs unit and integration tests; end-to-end tests
are opt-in. All commands compile the tests before running them.

Run `npm install` to install the test dependencies. Integration and end-to-end
tests launch VS Code; the runner downloads it when needed. On headless Linux,
run these commands under `xvfb-run -a`.
End-to-end tests require Java on `PATH` and `CHORAL_HOME` pointing to a directory
containing `choral-standalone.jar`.

`npm run test:e2e:install` tests a fresh installation instead. It clears
`CHORAL_HOME` in the test host and uses a new profile under `.vscode-test/install`,
which is removed when the runner exits, whether the tests pass or fail.
It requires Java and network access to GitHub to download Choral.

## Releasing

1. Bump the `version` number in `package.json`.
2. Create a [new GitHub release](https://github.com/choral-lang/vscode-choral/releases/new). The tag needs to be in `v#.#.#` format (note the leading `v`) e.g. `v1.1.13`.
3. Publishing the release triggers a [GitHub workflow](https://github.com/choral-lang/choral-vscode/actions/workflows/publish.yml) that validates the tag and pushes to the VS Code Marketplace.
