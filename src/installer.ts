import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as vscode from 'vscode';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import AdmZip from 'adm-zip';

const CHORAL_VERSION = '0.1.13';
const CHORAL_ZIP_URL = `https://github.com/choral-lang/choral/releases/download/v${CHORAL_VERSION}/choral-${CHORAL_VERSION}.zip`;

/**
 * Finds the Choral JAR, downloading it if necessary.
 * @param context The extension context
 * @returns The path to the choral-standalone.jar file
 */
export async function findOrInstallChoral(context: vscode.ExtensionContext): Promise<string> {
    // 1) Check if CHORAL_HOME is defined
    const choralHome = process.env.CHORAL_HOME;
    if (choralHome) {
        console.log('✓ CHORAL_HOME is defined:', choralHome);
        const candidate = path.join(choralHome, 'choral-standalone.jar');
        if (fs.existsSync(candidate)) {
            vscode.window.showInformationMessage(`Using LSP server defined in $CHORAL_HOME: ${choralHome}`);
            return candidate;
        }
        vscode.window.showErrorMessage(`$CHORAL_HOME is defined, but no JAR found at ${candidate}`);
    }

    // 2) Check if the JAR is already in VS Code storage
    const storageDir = context.globalStorageUri.fsPath;
    fs.mkdirSync(storageDir, { recursive: true });

    // Only this directory is published atomically.
    const installDir = path.join(storageDir, 'choral-server');
    const jarPath = path.join(installDir, 'dist', 'choral-standalone.jar');

    if (isInstalledJar(jarPath)) {
        console.log('✓ Choral JAR already exists at:', jarPath);
        return jarPath;
    }

    // 3) Download the latest release
    console.log('Downloading Choral from:', CHORAL_ZIP_URL);

    // Show progress notification
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Downloading Choral Language Server",
        cancellable: false
    }, async (progress) => {
        progress.report({ message: "Downloading..." });

        // Keep staging on the same filesystem as the final directory for rename.
        const stagingDir = fs.mkdtempSync(path.join(storageDir, '.choral-install-'));
        const zipPath = path.join(stagingDir, 'choral.zip');
        const stagedInstallDir = path.join(stagingDir, 'choral');
        const stagedJarPath = path.join(stagedInstallDir, 'dist', 'choral-standalone.jar');

        try {
            // Download the ZIP file
            await downloadFile(CHORAL_ZIP_URL, zipPath);
            console.log('✓ Downloaded ZIP to:', zipPath);

            progress.report({ message: "Extracting..." });

            // Extract the ZIP file
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(stagingDir, true);
            console.log('✓ Extracted ZIP to:', stagingDir);

            if (!isInstalledJar(stagedJarPath)) {
                throw new Error(`Non-empty JAR file not found at expected location: ${stagedJarPath}`);
            }

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
            }

            console.log('✓ Choral JAR ready at:', jarPath);
            return jarPath;

        } finally {
            try {
                fs.rmSync(stagingDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.warn('Failed to clean up Choral staging directory:', cleanupError);
            }
        }
    });

    return jarPath;
}

function isInstalledJar(jarPath: string): boolean {
    try {
        const stat = fs.lstatSync(jarPath);
        return stat.isFile() && stat.size > 0;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

/**
 * Downloads a file from a URL to a destination path
 */
function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        https.get(url, async (response) => {
            // Follow redirects
            if (response.statusCode === 302 || response.statusCode === 301) {
                if (response.headers.location) {
                    downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
                } else {
                    reject(new Error('Failed to download: Redirect without location header'));
                }
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: HTTP status code ${response.statusCode}`));
                return;
            }

            try {
                await pipeline(response, createWriteStream(destPath));
                resolve();
            } catch (error) {
                reject(error);
            }
        }).on('error', (err) => {
            reject(err);
        });
    });
}
