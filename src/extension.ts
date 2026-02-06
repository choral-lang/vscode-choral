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
	Trace,
} from 'vscode-languageclient/node';
import { findOrInstallChoral } from './installer';

let client: LanguageClient;

// This method is called when extension is activated.
// Extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	console.log('Activating the Choral VS Code extension...');

	// Refer to: https://github.com/tempo-lang/vscode-tempo/blob/main/src/extension.ts
	try {
		// Ensure the Choral JAR is available, downloading if necessary
		const serverJarPath: string = await findOrInstallChoral(context);
		console.log('Using JAR at:', serverJarPath);

		const serverOptions: ServerOptions = {
			command: 'java',
			args: ['-jar', serverJarPath, 'lsp'],
		};

		const clientOptions: LanguageClientOptions = {
			documentSelector: [{ scheme: 'file', language: 'choral' }],
			synchronize: {
				fileEvents: workspace.createFileSystemWatcher('**/*.{ch,chh}')
			},
			outputChannel: vscode.window.createOutputChannel('Choral Language Server'),
			traceOutputChannel: vscode.window.createOutputChannel('Choral LSP Trace'),
		};
		client = new LanguageClient(
			'choral', // Make sure this matches package.json! Settings like `choral.languageServer.trace` depend on it.
			'Choral Language Server',
			serverOptions,
			clientOptions
		);

		console.log('Starting LSP client...');
		client.start().then(
			() => {
				console.log('✓ LSP client started successfully');
				vscode.window.showInformationMessage('Choral LSP started!');
			},
			(error) => {
				console.error('✗ LSP client failed to start:', error);
				vscode.window.showErrorMessage('Choral LSP failed to start: ' + error);
			}
		);
	} catch (error) {
		console.error('ERROR activating Choral extension:', error);
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
