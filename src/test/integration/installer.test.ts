import * as assert from 'assert';
import fs = require('fs');
import * as os from 'os';
import * as path from 'path';
import https = require('https');
import { ClientRequest, IncomingMessage } from 'http';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { execFile } from 'child_process';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import * as vscode from 'vscode';
import { findOrInstallChoral, getLatestChoralVersion } from '../../installer';

describe('Choral installer', () => {
	let storageDir: string;
	let context: vscode.ExtensionContext;
	let choralHome: string | undefined;
	let cancellation: vscode.CancellationTokenSource;
	let requests: ClientRequest[];
	let errorMessages: string[];
	let errorActions: string[][];
	let infoMessages: string[];
	let logMessages: string[];
	let detailsShown: number;
	let lookupCount: number;
	const originalGet = https.get;
	const originalFetch = global.fetch;
	const originalRmSync = fs.rmSync;
	const originalWithProgress = vscode.window.withProgress;
	const originalShowErrorMessage = vscode.window.showErrorMessage;
	const originalShowInformationMessage = vscode.window.showInformationMessage;
	const originalCreateOutputChannel = vscode.window.createOutputChannel;
	const originalSetTimeout = global.setTimeout;

	beforeEach(() => {
		storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'choral-installer-'));
		context = {
			globalStorageUri: vscode.Uri.file(storageDir), subscriptions: []
		} as unknown as vscode.ExtensionContext;
		choralHome = process.env.CHORAL_HOME;
		delete process.env.CHORAL_HOME;
		cancellation = new vscode.CancellationTokenSource();
		requests = [];
		errorMessages = [];
		errorActions = [];
		infoMessages = [];
		logMessages = [];
		detailsShown = 0;
		lookupCount = 0;
		global.fetch = async (_url, options) => {
			lookupCount++;
			options?.signal?.throwIfAborted();
			return new Response(JSON.stringify({
				tag_name: 'v9.8.7',
				assets: [{ name: 'choral-9.8.7.zip' }]
			}));
		};
		vscode.window.createOutputChannel = ((name: string) => {
			assert.strictEqual(name, 'Choral Installer');
			return {
				info: (message: string) => logMessages.push(message),
				warn: (message: string) => logMessages.push(message),
				error: (message: string | Error) => logMessages.push(String(message)),
				show: () => { detailsShown++; },
				dispose: () => {}
			} as unknown as vscode.LogOutputChannel;
		}) as typeof vscode.window.createOutputChannel;
		vscode.window.showInformationMessage = (async (message: string, action: string) => {
			infoMessages.push(message);
			assert.strictEqual(action, 'View details');
			return undefined;
		}) as unknown as typeof vscode.window.showInformationMessage;
		vscode.window.withProgress = (options, task) => {
			assert.strictEqual(options.cancellable, true);
			return Promise.resolve(task({ report: () => {} }, cancellation.token));
		};
		vscode.window.showErrorMessage = (async (message: string, ...actions: string[]) => {
			errorMessages.push(message);
			errorActions.push(actions);
			return undefined;
		}) as unknown as typeof vscode.window.showErrorMessage;
	});

	afterEach(() => {
		https.get = originalGet;
		global.fetch = originalFetch;
		fs.rmSync = originalRmSync;
		vscode.window.withProgress = originalWithProgress;
		vscode.window.showErrorMessage = originalShowErrorMessage;
		vscode.window.showInformationMessage = originalShowInformationMessage;
		vscode.window.createOutputChannel = originalCreateOutputChannel;
		for (const disposable of context.subscriptions) {
			disposable.dispose();
		}
		global.setTimeout = originalSetTimeout;
		cancellation.dispose();
		if (choralHome === undefined) {
			delete process.env.CHORAL_HOME;
		} else {
			process.env.CHORAL_HOME = choralHome;
		}
		fs.rmSync(storageDir, { recursive: true, force: true });
	});

	function mockRequest(): ClientRequest {
		const request = new EventEmitter() as ClientRequest;
		request.destroyed = false;
		request.destroy = (error?: Error) => {
			if (!request.destroyed) {
				request.destroyed = true;
				process.nextTick(() => {
					if (error) {
						request.emit('error', error);
					}
					request.emit('close');
				});
			}
			return request;
		};
		requests.push(request);
		return request;
	}

	it('looks up the latest stable version using GitHub release metadata', async () => {
		global.fetch = async (url, options) => {
			assert.strictEqual(url, 'https://api.github.com/repos/choral-lang/choral/releases/latest');
			assert.ok(new Headers(options?.headers).get('User-Agent'));
			assert.ok(options?.signal);
			return new Response(JSON.stringify({
				tag_name: 'v2.3.4', assets: [{ name: 'choral-2.3.4.zip' }]
			}));
		};
		assert.strictEqual(await getLatestChoralVersion(new AbortController().signal), '2.3.4');
	});

	it('rejects HTTP failures, invalid metadata, and releases without a matching ZIP', async () => {
		for (const response of [
			new Response('rate limit', { status: 403 }),
			new Response('not JSON'),
			new Response(JSON.stringify({ tag_name: 'unexpected', assets: [] })),
			new Response(JSON.stringify({ tag_name: 'v2.3.4', assets: [] }))
		]) {
			global.fetch = async () => response;
			await assert.rejects(getLatestChoralVersion(new AbortController().signal));
		}
	});

	it('uses the discovered version for the archive download', async () => {
		mockResponse(response => response.end(archive()));
		const get = https.get;
		https.get = ((url: string, callback: (response: IncomingMessage) => void) => {
			assert.strictEqual(url, 'https://github.com/choral-lang/choral/releases/download/v9.8.7/choral-9.8.7.zip');
			return get(url, callback);
		}) as typeof https.get;

		await findOrInstallChoral(context);

		assert.strictEqual(lookupCount, 1);
		assert.ok(logMessages.includes('Latest Choral version: 9.8.7'));
	});

	it('cancels a stalled version lookup without downloading', async () => {
		global.fetch = (_url, options) => new Promise((_resolve, reject) => {
			const signal = options!.signal!;
			signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			setImmediate(() => cancellation.cancel());
		});

		await assert.rejects(findOrInstallChoral(context), vscode.CancellationError);
		assert.strictEqual(requests.length, 0);
		assertNoStagingDirectories();
	});

	it('applies the overall deadline to a stalled version lookup', async () => {
		const expire = captureDeadline();
		global.fetch = (_url, options) => new Promise((_resolve, reject) => {
			const signal = options!.signal!;
			signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			setImmediate(expire);
		});

		await assert.rejects(findOrInstallChoral(context), /Download timed out/);
		assert.strictEqual(requests.length, 0);
		assertNoStagingDirectories();
	});

	function captureDeadline(): () => void {
		let expire: (() => void) | undefined;
		global.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
			if (delay === 120_000) {
				assert.strictEqual(expire, undefined, 'Redirects must not reset the deadline.');
				expire = () => callback(...args);
			}
			return originalSetTimeout(callback, delay, ...args);
		}) as typeof setTimeout;
		return () => {
			assert.ok(expire, 'The download must have an overall deadline.');
			expire();
		};
	}

	function assertNoStagingDirectories(): void {
		assert.ok(!fs.readdirSync(storageDir).some(name => name.startsWith('.choral-install-')));
	}

	function archive(contents = 'test JAR contents'): Buffer {
		const zip = new AdmZip();
		zip.addFile('choral/dist/choral-standalone.jar', Buffer.from(contents));
		return zip.toBuffer();
	}

	function mockResponse(send: (response: PassThrough) => void, prepare?: () => void): PassThrough {
		const response = new PassThrough();
		Object.assign(response, { statusCode: 200, headers: {} });
		https.get = ((_url: unknown, callback: (response: IncomingMessage) => void) => {
			const request = mockRequest();
			process.nextTick(() => {
				prepare?.();
				callback(response as unknown as IncomingMessage);
				send(response);
			});
			return request;
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
		assert.strictEqual(jarPath, path.join(storageDir, 'choral-server', 'dist', 'choral-standalone.jar'));
		assert.deepStrictEqual(infoMessages, ['Installed Choral language server.']);
		assert.ok(logMessages.some(message => message.includes(jarPath)));
		assertNoStagingDirectories();
	});

	it('rejects an interrupted response and removes the partial ZIP', async () => {
		const failure = new Error('Connection interrupted');
		const response = mockResponse(stream => {
			stream.write('partial ZIP');
			setImmediate(() => stream.destroy(failure));
		});

		await assert.rejects(findOrInstallChoral(context), error => error === failure);

		assert.ok(response.destroyed);
		assertNoStagingDirectories();
		assert.ok(!fs.existsSync(path.join(storageDir, 'choral-server')));
	});

	it('rejects destination-open errors and cleans its staging directory', async () => {
		const response = mockResponse(stream => stream.write('partial ZIP'), () => {
			const stagingDir = fs.readdirSync(storageDir).find(name => name.startsWith('.choral-install-'))!;
			fs.mkdirSync(path.join(storageDir, stagingDir, 'choral.zip'));
		});

		await assert.rejects(findOrInstallChoral(context), error =>
			(error as NodeJS.ErrnoException).syscall === 'open');

		assert.ok(response.destroyed);
		assertNoStagingDirectories();
	});

	it('preserves a request error when there is no ZIP to clean up', async () => {
		const failure = new Error('Connection refused');
		https.get = (() => {
			const request = mockRequest();
			process.nextTick(() => request.emit('error', failure));
			return request;
		}) as typeof https.get;

		await assert.rejects(findOrInstallChoral(context), error => error === failure);
		assertNoStagingDirectories();
	});

	it('does not mask a download error when staging cleanup fails', async () => {
		const failure = new Error('Connection interrupted');
		mockResponse(stream => setImmediate(() => stream.destroy(failure)));
		fs.rmSync = () => {
			throw new Error('Cleanup failed');
		};

		await assert.rejects(findOrInstallChoral(context), error => error === failure);
	});

	it('rejects a missing, empty, or directory JAR without publishing it, then retries', async () => {
		for (const entry of ['other.txt', 'choral/dist/choral-standalone.jar', 'choral/dist/choral-standalone.jar/']) {
			const zip = new AdmZip();
			zip.addFile(entry, Buffer.alloc(0));
			mockResponse(response => response.end(zip.toBuffer()));

			await assert.rejects(findOrInstallChoral(context), /Non-empty JAR file not found/);
			assert.ok(!fs.existsSync(path.join(storageDir, 'choral-server')));
			assertNoStagingDirectories();
		}

		mockResponse(response => response.end(archive()));
		const jarPath = await findOrInstallChoral(context);
		assert.strictEqual(fs.readFileSync(jarPath, 'utf8'), 'test JAR contents');
		assertNoStagingDirectories();
	});

	it('rejects an invalid ZIP without publishing it and can retry', async () => {
		mockResponse(response => response.end('not a ZIP'));

		await assert.rejects(findOrInstallChoral(context));
		assert.ok(!fs.existsSync(path.join(storageDir, 'choral-server')));
		assertNoStagingDirectories();

		mockResponse(response => response.end(archive('complete JAR')));
		const jarPath = await findOrInstallChoral(context);
		assert.strictEqual(fs.readFileSync(jarPath, 'utf8'), 'complete JAR');
		assertNoStagingDirectories();
	});

	it('does not reuse a potentially partial legacy installation', async () => {
		const legacyDir = path.join(storageDir, 'choral', 'dist');
		fs.mkdirSync(legacyDir, { recursive: true });
		fs.writeFileSync(path.join(legacyDir, 'choral-standalone.jar'), 'partial legacy JAR');
		mockResponse(response => response.end(archive('fresh JAR')));

		const jarPath = await findOrInstallChoral(context);

		assert.strictEqual(fs.readFileSync(jarPath, 'utf8'), 'fresh JAR');
		assertNoStagingDirectories();
	});

	it('reuses a published installation without downloading again', async () => {
		mockResponse(response => response.end(archive()));
		const jarPath = await findOrInstallChoral(context);
		https.get = (() => {
			throw new Error('Unexpected download');
		}) as typeof https.get;

		assert.strictEqual(await findOrInstallChoral(context), jarPath);
		assert.strictEqual(infoMessages.at(-1), 'Using installed Choral language server.');
		assert.strictEqual(lookupCount, 1, 'Reusing the cached server must not perform another lookup.');
	});

	it('isolates concurrent downloads and reuses the first published installation', async () => {
		const responses: PassThrough[] = [];
		let downloadsReady!: () => void;
		const ready = new Promise<void>(resolve => { downloadsReady = resolve; });
		https.get = ((_url: unknown, callback: (response: IncomingMessage) => void) => {
			const response = new PassThrough();
			Object.assign(response, { statusCode: 200, headers: {} });
			process.nextTick(() => {
				callback(response as unknown as IncomingMessage);
				responses.push(response);
				if (responses.length === 2) {
					downloadsReady();
				}
			});
			return mockRequest();
		}) as typeof https.get;

		const first = findOrInstallChoral(context);
		const second = findOrInstallChoral(context);
		const installs = Promise.all([first, second]);
		await ready;
		try {
			assert.strictEqual(fs.readdirSync(storageDir).filter(name => name.startsWith('.choral-install-')).length, 2);
			assert.ok(!fs.existsSync(path.join(storageDir, 'choral-server')));
		} finally {
			responses[0].end(archive('winner'));
			responses[1].end(archive('loser'));
		}
		const [firstJar, secondJar] = await installs;

		assert.strictEqual(firstJar, secondJar);
		// Either download may finish first, but both callers see the same complete file.
		assert.ok(['winner', 'loser'].includes(fs.readFileSync(firstJar, 'utf8')));
		assertNoStagingDirectories();
	});

	it('reuses an installation published by another process while downloading', async () => {
		let downloadStarted!: () => void;
		const started = new Promise<void>(resolve => { downloadStarted = resolve; });
		const response = mockResponse(() => downloadStarted());
		const installing = findOrInstallChoral(context);
		await started;
		try {
			await promisify(execFile)(process.execPath, ['-e', `
				const fs = require('fs');
				const path = require('path');
				const storage = process.argv[1];
				const staging = fs.mkdtempSync(path.join(storage, '.other-process-'));
				fs.mkdirSync(path.join(staging, 'dist'));
				fs.writeFileSync(path.join(staging, 'dist', 'choral-standalone.jar'), 'other process');
				fs.renameSync(staging, path.join(storage, 'choral-server'));
			`, storageDir], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
		} finally {
			response.end(archive('this process'));
			await installing;
		}

		const jarPath = await installing;
		assert.strictEqual(fs.readFileSync(jarPath, 'utf8'), 'other process');
		assert.deepStrictEqual(infoMessages, ['Using Choral language server installed by another window.']);
		assertNoStagingDirectories();
	});

	it('cancels before starting a download without offering retry', async () => {
		cancellation.cancel();

		await assert.rejects(findOrInstallChoral(context), vscode.CancellationError);

		assert.strictEqual(requests.length, 0);
		assert.deepStrictEqual(errorMessages, []);
		assert.deepStrictEqual(infoMessages, ['Choral language server installation cancelled.']);
		assertNoStagingDirectories();
	});

	it('destroys a request cancelled before response headers arrive', async () => {
		https.get = (() => {
			const request = mockRequest();
			setImmediate(() => cancellation.cancel());
			return request;
		}) as typeof https.get;

		await assert.rejects(findOrInstallChoral(context), vscode.CancellationError);

		assert.ok(requests[0].destroyed);
		assert.deepStrictEqual(errorMessages, []);
		assertNoStagingDirectories();
	});

	it('cancels a partial transfer and closes the streams before cleanup', async () => {
		const response = mockResponse(stream => {
			stream.write('partial ZIP');
			setImmediate(() => cancellation.cancel());
		});
		let responseClosed = false;
		response.on('close', () => { responseClosed = true; });

		await assert.rejects(findOrInstallChoral(context), vscode.CancellationError);

		assert.ok(requests[0].destroyed);
		assert.ok(responseClosed);
		assert.deepStrictEqual(errorMessages, []);
		assertNoStagingDirectories();
		assert.ok(!fs.existsSync(path.join(storageDir, 'choral-server')));
	});

	it('times out before headers arrive and preserves the timeout explanation', async () => {
		const expire = captureDeadline();
		https.get = (() => {
			const request = mockRequest();
			setImmediate(expire);
			return request;
		}) as typeof https.get;

		await assert.rejects(findOrInstallChoral(context), /Download timed out after 2 minutes/);

		assert.ok(requests[0].destroyed);
		assert.strictEqual(errorMessages.length, 1);
		assert.match(errorMessages[0], /Download timed out after 2 minutes/);
		assertNoStagingDirectories();
	});

	it('times out a stalled partial transfer and removes its staging directory', async () => {
		const expire = captureDeadline();
		const response = mockResponse(stream => {
			stream.write('partial ZIP');
			setImmediate(expire);
		});

		await assert.rejects(findOrInstallChoral(context), /Download timed out/);

		assert.ok(requests[0].destroyed);
		assert.ok(response.destroyed);
		assertNoStagingDirectories();
	});

	it('shares the deadline across redirects and aborts the redirected request', async () => {
		const expire = captureDeadline();
		const redirect = new PassThrough();
		Object.assign(redirect, { statusCode: 302, headers: { location: '/redirected.zip' } });
		https.get = ((_url: unknown, callback: (response: IncomingMessage) => void) => {
			const request = mockRequest();
			if (requests.length === 1) {
				process.nextTick(() => callback(redirect as unknown as IncomingMessage));
			} else {
				setImmediate(expire);
			}
			return request;
		}) as typeof https.get;

		await assert.rejects(findOrInstallChoral(context), /Download timed out/);

		assert.strictEqual(requests.length, 2);
		assert.ok(requests.every(request => request.destroyed));
		assert.ok(redirect.destroyed);
		assertNoStagingDirectories();
	});

	it('retries from a clean staging directory when the user chooses Retry', async () => {
		const failure = new Error('Connection interrupted');
		mockResponse(stream => setImmediate(() => stream.destroy(failure)));
		let prompts = 0;
		vscode.window.showErrorMessage = (async (message: string, action: string) => {
			prompts++;
			assert.strictEqual(prompts, 1);
			assert.match(message, /Connection interrupted/);
			assert.strictEqual(action, 'Retry');
			assertNoStagingDirectories();
			mockResponse(response => response.end(archive('retried JAR')));
			return 'Retry';
		}) as unknown as typeof vscode.window.showErrorMessage;

		const jarPath = await findOrInstallChoral(context);

		assert.strictEqual(fs.readFileSync(jarPath, 'utf8'), 'retried JAR');
		assert.strictEqual(prompts, 1);
		assertNoStagingDirectories();
	});

	it('uses a valid CHORAL_HOME and reports its JAR in details', async () => {
		const home = path.join(storageDir, 'override');
		fs.mkdirSync(home);
		const jarPath = path.join(home, 'choral-standalone.jar');
		fs.writeFileSync(jarPath, 'override JAR');
		process.env.CHORAL_HOME = home;

		assert.strictEqual(await findOrInstallChoral(context), jarPath);

		assert.strictEqual(requests.length, 0);
		assert.deepStrictEqual(infoMessages, ['Using Choral language server from CHORAL_HOME.']);
		assert.strictEqual(lookupCount, 0);
		assert.ok(logMessages.some(message => message.includes(jarPath)));
		assert.ok(!infoMessages.some(message => message.includes(home)));
		assert.ok(!fs.existsSync(path.join(storageDir, 'choral-server')));
	});

	it('rejects invalid CHORAL_HOME even when a managed server is available', async () => {
		const managedDist = path.join(storageDir, 'choral-server', 'dist');
		fs.mkdirSync(managedDist, { recursive: true });
		fs.writeFileSync(path.join(managedDist, 'choral-standalone.jar'), 'managed JAR');

		for (const fixture of ['missing', 'empty', 'directory', 'not-a-directory']) {
			const home = path.join(storageDir, fixture);
			if (fixture === 'not-a-directory') {
				fs.writeFileSync(home, 'not a directory');
			} else {
				fs.mkdirSync(home);
				if (fixture === 'empty') {
					fs.writeFileSync(path.join(home, 'choral-standalone.jar'), '');
				} else if (fixture === 'directory') {
					fs.mkdirSync(path.join(home, 'choral-standalone.jar'));
				}
			}
			process.env.CHORAL_HOME = home;

			await assert.rejects(findOrInstallChoral(context), /CHORAL_HOME does not contain choral-standalone.jar/);
			assert.ok(logMessages.some(message => message.includes(path.join(home, 'choral-standalone.jar'))));
		}

		assert.strictEqual(requests.length, 0);
		assert.deepStrictEqual(infoMessages, []);
		assert.strictEqual(errorMessages.length, 4);
		assert.ok(errorActions.every(actions => actions.includes('Retry') && actions.includes('View details')));
		assertNoStagingDirectories();
	});

	it('keeps Retry available after viewing an invalid override diagnostic', async () => {
		const home = path.join(storageDir, 'override');
		fs.mkdirSync(home);
		process.env.CHORAL_HOME = home;
		let prompts = 0;
		vscode.window.showErrorMessage = (async (_message: string, ...actions: string[]) => {
			assert.deepStrictEqual(actions, ['Retry', 'View details']);
			prompts++;
			if (prompts === 1) {
				return 'View details';
			}
			assert.strictEqual(prompts, 2);
			assert.strictEqual(detailsShown, 1);
			fs.writeFileSync(path.join(home, 'choral-standalone.jar'), 'repaired JAR');
			return 'Retry';
		}) as unknown as typeof vscode.window.showErrorMessage;

		const jarPath = await findOrInstallChoral(context);

		assert.strictEqual(fs.readFileSync(jarPath, 'utf8'), 'repaired JAR');
		assert.strictEqual(prompts, 2);
		assert.strictEqual(requests.length, 0);
		assert.deepStrictEqual(infoMessages, ['Using Choral language server from CHORAL_HOME.']);
	});

	it('opens the installer output when View details is selected on success', async () => {
		mockResponse(response => response.end(archive()));
		vscode.window.showInformationMessage = (async (_message: string, action: string) => {
			assert.strictEqual(action, 'View details');
			return 'View details';
		}) as unknown as typeof vscode.window.showInformationMessage;

		const jarPath = await findOrInstallChoral(context);
		await Promise.resolve();

		assert.strictEqual(detailsShown, 1);
		assert.ok(logMessages.some(message => message.includes(jarPath)));
		assert.ok(logMessages.some(message => message.includes('Download destination:')));
		assert.ok(logMessages.some(message => message.includes('Expected extracted JAR:')));
	});
});
