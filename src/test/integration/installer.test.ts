import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import https = require('https');
import { ClientRequest, IncomingMessage } from 'http';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import AdmZip from 'adm-zip';
import * as vscode from 'vscode';
import { findOrInstallChoral } from '../../installer';

describe('Choral installer download failures', () => {
	let storageDir: string;
	let context: vscode.ExtensionContext;
	let choralHome: string | undefined;
	const originalGet = https.get;

	beforeEach(() => {
		storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choral-installer-'));
		context = { globalStorageUri: vscode.Uri.file(storageDir) } as vscode.ExtensionContext;
		choralHome = process.env.CHORAL_HOME;
		delete process.env.CHORAL_HOME;
	});

	afterEach(() => {
		https.get = originalGet;
		if (choralHome === undefined) {
			delete process.env.CHORAL_HOME;
		} else {
			process.env.CHORAL_HOME = choralHome;
		}
		fs.rmSync(storageDir, { recursive: true, force: true });
	});

	function mockResponse(send: (response: PassThrough) => void): PassThrough {
		const response = new PassThrough();
		Object.assign(response, { statusCode: 200, headers: {} });
		https.get = ((_url: unknown, callback: (response: IncomingMessage) => void) => {
			const request = new EventEmitter();
			process.nextTick(() => {
				callback(response as unknown as IncomingMessage);
				send(response);
			});
			return request as ClientRequest;
		}) as typeof https.get;
		return response;
	}

	it('finishes writing the ZIP before extracting it', async () => {
		const zip = new AdmZip();
		const contents = Buffer.from('test JAR contents');
		zip.addFile('choral/dist/choral-standalone.jar', contents);
		mockResponse(response => response.end(zip.toBuffer()));

		const jarPath = await findOrInstallChoral(context);

		assert.deepStrictEqual(fs.readFileSync(jarPath), contents);
		assert.ok(!fs.existsSync(path.join(storageDir, 'choral.zip')));
	});

	it('rejects an interrupted response and removes the partial ZIP', async () => {
		const failure = new Error('Connection interrupted');
		const response = mockResponse(stream => {
			stream.write('partial ZIP');
			setImmediate(() => stream.destroy(failure));
		});

		await assert.rejects(findOrInstallChoral(context), error => error === failure);

		assert.ok(response.destroyed);
		assert.ok(!fs.existsSync(path.join(storageDir, 'choral.zip')));
	});

	it('preserves a destination-open error even when cleanup also fails', async () => {
		// Opening a directory as a file fails; unlinking that directory also fails.
		const zipPath = path.join(storageDir, 'choral.zip');
		fs.mkdirSync(zipPath);
		const response = mockResponse(stream => stream.write('partial ZIP'));

		await assert.rejects(findOrInstallChoral(context), error =>
			(error as NodeJS.ErrnoException).syscall === 'open');

		assert.ok(response.destroyed);
		assert.ok(fs.statSync(zipPath).isDirectory());
	});

	it('preserves a request error when there is no ZIP to clean up', async () => {
		const failure = new Error('Connection refused');
		https.get = (() => {
			const request = new EventEmitter();
			process.nextTick(() => request.emit('error', failure));
			return request as ClientRequest;
		}) as typeof https.get;

		await assert.rejects(findOrInstallChoral(context), error => error === failure);
		assert.ok(!fs.existsSync(path.join(storageDir, 'choral.zip')));
	});
});
