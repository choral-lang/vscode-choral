import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const fixturesPath = path.resolve(__dirname, '../../../test/fixtures');
const installProfile = process.env.CHORAL_TEST_INSTALL_PROFILE;
const installStorage = installProfile
	? path.join(installProfile, 'User', 'globalStorage', 'choral.vscode-choral')
	: undefined;

function hasSyntaxError(diagnostics: readonly vscode.Diagnostic[]): boolean {
	return diagnostics.some(item => item.source === 'choral-compiler' &&
		item.severity === vscode.DiagnosticSeverity.Error &&
		/mismatched input|extraneous input|missing /i.test(item.message) &&
		!item.message.startsWith('Internal compiler error:'));
}

function hasNoErrors(diagnostics: readonly vscode.Diagnostic[]): boolean {
  return diagnostics.every(item =>
    item.severity !== vscode.DiagnosticSeverity.Error);
}

async function expectDiagnostics(
	uri: vscode.Uri,
	predicate: (diagnostics: readonly vscode.Diagnostic[]) => boolean,
	action: () => PromiseLike<unknown>,
	description: string
): Promise<void> {
	let subscription: vscode.Disposable | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const received = new Promise<void>((resolve, reject) => {
			subscription = vscode.languages.onDidChangeDiagnostics(event => {
				if (event.uris.some(changed => changed.toString() === uri.toString()) &&
					predicate(vscode.languages.getDiagnostics(uri))) {
					resolve();
				}
			});
			timer = setTimeout(() => reject(new Error(
				`Timed out waiting for ${description}. Diagnostics: ` +
				JSON.stringify(vscode.languages.getDiagnostics(uri).map(item => item.message))
			)), 30000);
		});
		await Promise.all([received, Promise.resolve().then(action)]);
	} finally {
		subscription?.dispose();
		clearTimeout(timer);
	}
}

describe('Choral language server (end-to-end)', () => {
	let documentsPath: string;

	before(async () => {
		// VS Code can restore shell variables; clear this inside the host as well.
		if (installStorage) {
			delete process.env.CHORAL_HOME;
			assert.ok(!fs.existsSync(installStorage), 'The install test requires fresh extension storage.');
		} else {
			const choralHome = process.env.CHORAL_HOME;
			assert.ok(choralHome, 'Set CHORAL_HOME to a Choral installation before running E2E tests.');
			assert.ok(fs.existsSync(path.join(choralHome, 'choral-standalone.jar')),
				'CHORAL_HOME must contain choral-standalone.jar.');
		}

		const extension = vscode.extensions.getExtension('choral.vscode-choral');
		assert.ok(extension, 'The Choral extension must be loaded in the test host.');
		await extension.activate();
		if (installStorage) {
			assert.ok(fs.existsSync(path.join(installStorage, 'choral', 'dist', 'choral-standalone.jar')),
				'The installer must extract the downloaded JAR into extension storage.');
			assert.ok(!fs.existsSync(path.join(installStorage, 'choral.zip')),
				'The installer must remove the downloaded ZIP after extraction.');
		}
	});

	beforeEach(() => {
		// Edit disposable copies, never the checked-in fixtures.
		documentsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'choral-e2e-'));
	});

	afterEach(async () => {
		try {
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		} finally {
			fs.rmSync(documentsPath, { recursive: true, force: true });
		}
	});

	function fixtureUri(name: string): vscode.Uri {
		const destination = path.join(documentsPath, name);
		fs.copyFileSync(path.join(fixturesPath, name), destination);
		return vscode.Uri.file(destination);
	}

	async function open(uri: vscode.Uri): Promise<vscode.TextEditor> {
		const document = await vscode.workspace.openTextDocument(uri);
		assert.strictEqual(document.languageId, 'choral');
		return vscode.window.showTextDocument(document);
	}

	it('reports a syntax error in a Choral file', async () => {
		const uri = fixtureUri('SyntaxError.ch');
		await expectDiagnostics(uri, hasSyntaxError, () => open(uri), 'a syntax error');
	});

	it('accepts a valid Choral file without errors', async () => {
		const uri = fixtureUri('Valid.ch');
		await expectDiagnostics(uri, hasNoErrors, () => open(uri), 'diagnostics for a valid file');
	});

	it('clears the syntax error after the document is corrected', async () => {
		const uri = fixtureUri('SyntaxError.ch');
		await expectDiagnostics(uri, hasSyntaxError, () => open(uri), 'the initial syntax error');
		const editor = vscode.window.activeTextEditor!;
		const validSource = fs.readFileSync(path.join(fixturesPath, 'Valid.ch'), 'utf8');
		await expectDiagnostics(uri, hasNoErrors, async () => {
			const applied = await editor.edit(edit => edit.replace(
				new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)),
				validSource
			));
			assert.ok(applied, 'The correction must be applied to the document.');
		}, 'the syntax error to clear after editing');
	});

	it('inserts the missing communication into the active document', async () => {
		// Confirm server readiness even when this test is run on its own.
		const validUri = fixtureUri('Valid.ch');
		await expectDiagnostics(validUri, hasNoErrors, () => open(validUri), 'the server to become ready');
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		const uri = fixtureUri('MissingCommunications.ch');
		const editor = await open(uri);
		const expected = fs.readFileSync(path.join(fixturesPath, 'MissingCommunications.expected.ch'), 'utf8');
		await vscode.commands.executeCommand('choral.insertComms');
		assert.strictEqual(editor.document.getText().replace(/\r\n/g, '\n').trimEnd(), expected.trimEnd());
	});
});
