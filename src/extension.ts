// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from 'path';
import * as vscode from 'vscode';
import { workspace } from 'vscode';
import {
	Executable,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';

let client: LanguageClient;

// This method is called when extension is activated
// extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, the extension "choral-syntax-extension" is now running! testing');

	// Refer to: https://github.com/tempo-lang/vscode-tempo/blob/main/src/extension.ts

	try {
		// For testing purposes this is how the compiler is found. 
		// In future it would probably be ideal to use CHORAL_HOME instead. 
		const serverJarPath: string = context.asAbsolutePath(path.join('server', 'choral-standalone.jar'));
		console.log('Looking for JAR at:', serverJarPath);

		const fs = require('fs');
		if (fs.existsSync(serverJarPath)) {
			console.log('✓ JAR file exists');
		} else {
			console.error('✗ JAR file NOT FOUND at:', serverJarPath);
			vscode.window.showErrorMessage('Choral LSP JAR not found at: ' + serverJarPath);
			return;
		}

		const serverOptions: ServerOptions = {
			run: {
				command: 'java',
				args: ['-jar', serverJarPath, 'lsp'], // this would be a command as those specified in `choral -h`
			} as Executable,
			debug: {
				command: 'java',
				args: ['-jar', serverJarPath, 'lsp', '--lsp-debug']
				// This currently doesn't do anything
			} as Executable
		};

		const clientOptions: LanguageClientOptions = {
			documentSelector: [{ scheme: 'file', language: 'choral' }],
			synchronize: {
				fileEvents: workspace.createFileSystemWatcher('**/*.ch')
			},
			outputChannel: vscode.window.createOutputChannel('Choral Language Server'),
		};
		client = new LanguageClient(
			'choralLanguageServer',
			'Choral Language Server',
			serverOptions,
			clientOptions
		)

		client.onDidChangeState((event) => {
			console.log('LSP Client state changed:', event);
		});

		console.log('Starting LSP client...');
		client.start().then(
			() => {
				console.log('✓ LSP client started successfully');
				vscode.window.showInformationMessage('Choral LSP started');
			},
			(error) => {
				console.error('✗ LSP client failed to start:', error);
				vscode.window.showErrorMessage('Choral LSP failed to start: ' + error);
			}
		);
	} catch (error) {
		console.error('ERROR in activate():', error);
		vscode.window.showErrorMessage('Choral extension error: ' + error);
	}


}

// This method is called when extension is deactivated
export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
