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

Let's call the new VS Code window "the client window" and the old VS Code 
window "the debugger window". There are three places to look for logs:

1. The *debug console* in the debugger window. Open it with `View > Debug Console`.
   This is where `console.log` messages from the LSP client will appear. 

2. The *output channel* in the client window. Open it with `View > Output`
   and then selecting `Choral Language Server` from the dropdown menu.
   This is where stdout from the LSP server will appear.

3. The *trace channel* in the client window. Open it with `View > Output`
   and then selecting `Choral LSP Trace`. This window logs JSON messages
   between the LSP client and LSP server. The verbosity of these logs
   is controlled in the debugger window by adjusting the VS Code setting
   `choral.trace.server`. You might need to restart your IDE for these
   settings to take effect.
