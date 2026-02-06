# Choral extension for Visual Studio Code

Support for the [Choral programming language](https://choral-lang.org) inside of Visual Studio Code. Enjoy!

## Features

- Syntax highlighting

- Error highlighting 

- Automatically installs Choral unless `$CHORAL_HOME` is set

## Development

To make changes to the extension, we recommend you use VS Code.
To set up your development environment, run `npm install`. To compile the extension,
use `npm run watch`. 

To debug the extension, press `F5` in VS Code or pick `Run > Start Debugging` 
from the VS Code menu. When you do that, VS Code looks for `.vscode/launch.json`
and runs it. A new window will pop up, but the extension won't load until you
open a `.ch` file.

When debugging, logs will be written to the VS Code Debug Console.