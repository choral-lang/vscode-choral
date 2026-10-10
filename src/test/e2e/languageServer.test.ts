import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const fixturesPath = path.resolve(__dirname, '../../../test/fixtures');
const installProfile = process.env.CHORAL_TEST_INSTALL_PROFILE;
const installStorage = installProfile
	? path.join(installProfile, 'User', 'globalStorage', 'choral.vscode-choral')
	: undefined;

describe('Choral language server (end-to-end)', () => {
	it(installStorage
		? 'downloads and installs Choral, then reports a syntax error'
		: 'reports a syntax error in a Choral file', async () => {
		// VS Code can restore shell environment variables during startup.
		// Clear this in the extension host itself before activation as well.
		if (installStorage) {
			delete process.env.CHORAL_HOME;
		}
		const choralHome = process.env.CHORAL_HOME;
		if (installStorage) {
			assert.ok(!choralHome, 'The install test must not use CHORAL_HOME.');
			assert.ok(!fs.existsSync(installStorage), 'The install test requires fresh extension storage.');
		} else {
			assert.ok(choralHome, 'Set CHORAL_HOME to a Choral installation before running E2E tests.');
			assert.ok(fs.existsSync(path.join(choralHome, 'choral-standalone.jar')),
				'CHORAL_HOME must contain choral-standalone.jar.');
		}

		const extension = vscode.extensions.getExtension('choral.vscode-choral');
		assert.ok(extension, 'The Choral extension must be loaded in the test host.');
		const uri = vscode.Uri.file(path.join(fixturesPath, 'SyntaxError.ch'));
		await extension.activate();
		if (installStorage) {
			assert.ok(fs.existsSync(path.join(installStorage, 'choral', 'dist', 'choral-standalone.jar')),
				'The installer must extract the downloaded JAR into extension storage.');
			assert.ok(!fs.existsSync(path.join(installStorage, 'choral.zip')),
				'The installer must remove the downloaded ZIP after extraction.');
		}

		// Subscribe before opening the document so a fast server response is not missed.
		let subscription: vscode.Disposable | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const diagnosticReceived = new Promise<vscode.Diagnostic>((resolve, reject) => {
				const check = () => {
					const diagnostic = vscode.languages.getDiagnostics(uri).find(item =>
						item.source === 'choral-compiler' &&
						item.severity === vscode.DiagnosticSeverity.Error &&
						/mismatched input|extraneous input|missing /i.test(item.message) &&
						!item.message.startsWith('Internal compiler error:'));
					if (diagnostic) {
						resolve(diagnostic);
					}
				};
				subscription = vscode.languages.onDidChangeDiagnostics(event => {
					if (event.uris.some(changed => changed.toString() === uri.toString())) {
						check();
					}
				});
				timer = setTimeout(() => reject(new Error(
					'Timed out waiting for a syntax error from the Choral server. Diagnostics: ' +
					JSON.stringify(vscode.languages.getDiagnostics(uri).map(item => item.message))
				)), 30000);
				check();
			});
			// Attach a handler immediately, including if opening the document fails.
			await Promise.all([
				diagnosticReceived,
				vscode.workspace.openTextDocument(uri).then(async document => {
					assert.strictEqual(document.languageId, 'choral');
					await vscode.window.showTextDocument(document);
				})
			]);
		} finally {
			subscription?.dispose();
			clearTimeout(timer);
		}
	});
});
