# Choral extension for Visual Studio Code

Support for the [Choral programming language](https://choral-lang.org) inside of Visual Studio Code. Enjoy!

## Features

- Syntax highlighting.

- Run task.

- Error highlighting 

## Requirements

- [Choral](https://choral-lang.org). The environment variable `CHORAL_HOME` must be set correctly.

## Other notes
Please note that at the moment the extension does not use the version of the choral compiler located at `CHORAL_HOME` for error highlighting. Instead it uses a local jar. This is done for development purposes and will be changed in the future. 