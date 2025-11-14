// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { workspace, ExtensionContext } from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';
import * as path from 'path';

let client: LanguageClient;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, the extension "choral-syntax-extension" is now active!');

	// Refer to: https://github.com/tempo-lang/vscode-tempo/blob/main/src/extension.ts

	const serverModule: string = context.asAbsolutePath(path.join('server', 'out', 'server.js')); // this needs revising once proper path has been figured out

	const serverOptions: ServerOptions = { // these options need to be revisied to run a java program somehow
		// likely need to add actual options specific to the Choral LSP "server" once those have been implemented
		run: {
			command: "choral",
			args: ["lsp"], // this would be a command as those specified in `choral -h`
		},
		debug: {
			command: "choral",
			args: ["lsp", "--debug"] // for now this is the option stated in the Options section of `choral -h`
			// might need a dedicated option in future
		}
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'choral' }],
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher('**/*.ch')
		}
	};
	client = new LanguageClient(
		'choralLanguageServer',
		'Choral Language Server',
		serverOptions,
		clientOptions
	)

	//client.start();
}

// This method is called when your extension is deactivated
export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
