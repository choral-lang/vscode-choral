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

### Debugging a fresh installation

In VS Code's Run and Debug view, select **Run Extension — Fresh install** and press
F5. This clears `CHORAL_HOME` for the Extension Development Host, resets the
dedicated `~/.choral-installer-debug` user-data directory, and compiles the
extension before opening a new window. Open a `.ch` file there to activate Choral
and exercise the download, Cancel, Retry, and **View details** notifications.

The entire debug profile is deleted before each launch, including its settings
and extension storage. Close any previous fresh-install debug window before
launching again; do not use this profile for normal work. Your regular VS Code
profile and `CHORAL_HOME` environment variable are unchanged. Java must be on
`PATH` to start the downloaded server.

Select **Run Extension** instead to retain the existing debugging behavior.

### Tests

- `npm test` runs unit and integration tests
- `npm run test:unit` runs unit tests
- `npm run test:integration` runs integration tests
- `npm run test:e2e` runs end-to-end tests, assuming `CHORAL_HOME` is set
- `npm run test:e2e:install` runs end-to-end tests, downloading Choral automatically

Integration tests and end-to-end tests launch VS Code. End-to-end tests require Java on `PATH`.

## Releasing

See [RELEASING.MD](RELEASING.MD) for release instructions.
