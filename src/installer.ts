import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as vscode from 'vscode';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import AdmZip from 'adm-zip';

const CHORAL_LATEST_RELEASE_URL = 'https://api.github.com/repos/choral-lang/choral/releases/latest';
const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Finds the latest stable version published with an installable GitHub ZIP.
 * GitHub's latest-release endpoint excludes drafts and prereleases.
 */
export async function getLatestChoralVersion(signal: AbortSignal): Promise<string> {
    const response = await fetch(CHORAL_LATEST_RELEASE_URL, {
        signal,
        headers: {
            'User-Agent': 'vscode-choral',
            'Accept': 'application/vnd.github+json'
        }
    });
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Could not look up the latest Choral version: HTTP ${response.status}`);
    }
    const release: unknown = await response.json();
    if (!release || typeof release !== 'object' || !('tag_name' in release) ||
        typeof release.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
        throw new Error('The latest Choral release has an invalid version tag.');
    }
    const version = release.tag_name.slice(1);
    const assetName = `choral-${version}.zip`;
    if (!('assets' in release) || !Array.isArray(release.assets) ||
        !release.assets.some((asset: unknown) => asset !== null && typeof asset === 'object' &&
            'name' in asset && asset.name === assetName)) {
        throw new Error(`The latest Choral release does not contain ${assetName}.`);
    }
    return version;
}

/**
 * Finds the Choral JAR, downloading it if necessary.
 * @param context The extension context
 * @returns The path to the choral-standalone.jar file
 */
export async function findOrInstallChoral(context: vscode.ExtensionContext): Promise<string> {
    const output = vscode.window.createOutputChannel('Choral Installer', { log: true });
    context.subscriptions.push(output);
    while (true) {
        try {
            return await findOrInstallChoralOnce(context, output);
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                reportOutcome('Choral language server installation cancelled.', output);
                throw error;
            }
            const failure = error instanceof Error ? error : new Error(String(error));
            output.error(failure);
            const message = failure.message;
            let action: string | undefined;
            do {
                action = await vscode.window.showErrorMessage(
                    `Could not prepare Choral language server: ${message}`, 'Retry', 'View details'
                );
                if (action === 'View details') {
                    output.show(true);
                }
            } while (action === 'View details');
            if (action !== 'Retry') {
                output.info('Choral language server setup stopped without retrying.');
                throw error;
            }
            output.info('Retrying Choral language server setup.');
        }
    }
}

function reportOutcome(message: string, output: vscode.LogOutputChannel): void {
    output.info(message);
    // Start the server without waiting for the user to dismiss this notification.
    void vscode.window.showInformationMessage(message, 'View details').then(action => {
        if (action === 'View details') {
            output.show(true);
        }
    });
}

async function findOrInstallChoralOnce(
    context: vscode.ExtensionContext, output: vscode.LogOutputChannel
): Promise<string> {
    // 1) Check if CHORAL_HOME is defined
    const choralHome = process.env.CHORAL_HOME;
    if (choralHome) {
        const candidate = path.join(choralHome, 'choral-standalone.jar');
        output.info(`looking for choral-standalone.jar in CHORAL_HOME: ${candidate}`);
        if (!isInstalledJar(candidate)) {
            throw new Error('CHORAL_HOME does not contain choral-standalone.jar');
        }
        reportOutcome('Using Choral language server from CHORAL_HOME.', output);
        return candidate;
    }

    // 2) Check if the JAR is already in VS Code storage
    const storageDir = context.globalStorageUri.fsPath;
    output.info(`Managed storage directory: ${storageDir}`);
    fs.mkdirSync(storageDir, { recursive: true });

    // Only this directory is published atomically.
    const installDir = path.join(storageDir, 'choral-server');
    const jarPath = path.join(installDir, 'dist', 'choral-standalone.jar');
    output.info(`Managed server JAR: ${jarPath}`);

    if (isInstalledJar(jarPath)) {
        reportOutcome('Using installed Choral language server.', output);
        return jarPath;
    }

    // Show progress notification
    const outcome = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Downloading Choral Language Server",
        cancellable: true
    }, async (progress, token) => {
        throwIfCancelled(token);
        progress.report({ message: "Looking up the latest Choral release..." });

        // Keep staging on the same filesystem as the final directory for rename.
        const stagingDir = fs.mkdtempSync(path.join(storageDir, '.choral-install-'));
        const zipPath = path.join(stagingDir, 'choral.zip');
        const stagedInstallDir = path.join(stagingDir, 'choral');
        const stagedJarPath = path.join(stagedInstallDir, 'dist', 'choral-standalone.jar');
        output.info(`Staging directory: ${stagingDir}`);
        output.info(`Download destination: ${zipPath}`);
        output.info(`Expected extracted JAR: ${stagedJarPath}`);

        try {
            // Download the ZIP file
            await downloadWithDeadline(zipPath, token, output, progress);
            output.info(`Downloaded ZIP to: ${zipPath}`);

            throwIfCancelled(token);
            progress.report({ message: "Extracting..." });

            // Extract the ZIP file
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(stagingDir, true);
            output.info(`Extracted ZIP to: ${stagingDir}`);

            if (!isInstalledJar(stagedJarPath)) {
                throw new Error('Non-empty JAR file not found in the downloaded release.');
            }

            throwIfCancelled(token);
            try {
                fs.renameSync(stagedInstallDir, installDir);
            } catch (error) {
                // A completed, non-empty directory cannot be replaced by rename.
                // Another extension host may have published its install first.
                const code = (error as NodeJS.ErrnoException).code;
                const destinationExists = code === 'EEXIST' || code === 'ENOTEMPTY' ||
                    code === 'EPERM' || code === 'EACCES';
                if (!destinationExists || !isInstalledJar(jarPath)) {
                    throw error;
                }
                return 'Using Choral language server installed by another window.';
            }

            return 'Installed Choral language server.';

        } finally {
            try {
                fs.rmSync(stagingDir, { recursive: true, force: true });
            } catch (cleanupError) {
                output.warn(`Failed to clean up staging directory ${stagingDir}: ${String(cleanupError)}`);
            }
        }
    });

    reportOutcome(outcome, output);
    return jarPath;
}

function throwIfCancelled(token: vscode.CancellationToken): void {
    if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
}

async function downloadWithDeadline(
    destPath: string, token: vscode.CancellationToken, output: vscode.LogOutputChannel,
    progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {
    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => {
        controller.abort(new vscode.CancellationError());
    });
    if (token.isCancellationRequested) {
        controller.abort(new vscode.CancellationError());
    }
    // One budget covers release lookup, connection setup, redirects, and transfer.
    const timer = setTimeout(() => {
        controller.abort(new Error('Download timed out after 2 minutes. Check your connection and retry.'));
    }, DOWNLOAD_TIMEOUT_MS);
    try {
        const version = await getLatestChoralVersion(controller.signal);
        const url = `https://github.com/choral-lang/choral/releases/download/v${version}/choral-${version}.zip`;
        output.info(`Latest Choral version: ${version}`);
        output.info(`Downloading Choral from: ${url}`);
        progress.report({ message: `Downloading Choral ${version}...` });
        await downloadFile(url, destPath, controller.signal);
    } catch (error) {
        if (controller.signal.aborted) {
            throw controller.signal.reason;
        }
        throw error;
    } finally {
        clearTimeout(timer);
        subscription.dispose();
    }
}

function isInstalledJar(jarPath: string): boolean {
    try {
        const stat = fs.statSync(jarPath);
        return stat.isFile() && stat.size > 0;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return false;
        }
        throw error;
    }
}

/**
 * Downloads a file from a URL to a destination path
 */
async function downloadFile(url: string, destPath: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    let request: ReturnType<typeof https.get> | undefined;
    const abort = () => { request?.destroy(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        await new Promise<void>((resolve, reject) => {
            let receivedResponse = false;
            request = https.get(url, async (response) => {
                receivedResponse = true;
                if (signal.aborted) {
                    response.destroy();
                    reject(signal.reason);
                    return;
                }
                try {
                    // Follow redirects using the same deadline and cancellation signal.
                    if (response.statusCode === 302 || response.statusCode === 301) {
                        response.destroy();
                        if (!response.headers.location) {
                            throw new Error('Failed to download: Redirect without location header');
                        }
                        const redirectUrl = new URL(response.headers.location, url).href;
                        await downloadFile(redirectUrl, destPath, signal);
                        resolve();
                        return;
                    }

                    if (response.statusCode !== 200) {
                        response.destroy();
                        throw new Error(`Failed to download: HTTP status code ${response.statusCode}`);
                    }

                    await pipeline(response, createWriteStream(destPath), { signal });
                    resolve();
                } catch (error) {
                    reject(error);
                }
            }).on('error', (error) => {
                // After headers, wait for pipeline to close the streams before cleanup.
                if (!receivedResponse) {
                    reject(error);
                }
            });
            if (signal.aborted) {
                abort();
            }
        });
    } catch (error) {
        // Node's streams use AbortError; preserve our timeout/cancellation reason.
        if (signal.aborted) {
            throw signal.reason;
        }
        throw error;
    } finally {
        signal.removeEventListener('abort', abort);
    }
}
