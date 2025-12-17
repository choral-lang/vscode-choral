import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as vscode from 'vscode';
import { createWriteStream, createReadStream } from 'fs';
import AdmZip from 'adm-zip';

const CHORAL_VERSION = '0.1.11';
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
        console.warn('✗ CHORAL_HOME is defined but JAR not found at:', candidate);
    }

    // 2) Check if the JAR is already in VS Code storage
    const storageDir = context.globalStorageUri.fsPath;

    // Ensure storage directory exists
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }

    const jarPath = path.join(storageDir, 'choral', 'dist', 'choral-standalone.jar');

    if (fs.existsSync(jarPath)) {
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

        const zipPath = path.join(storageDir, 'choral.zip');

        try {
            // Download the ZIP file
            await downloadFile(CHORAL_ZIP_URL, zipPath);
            console.log('✓ Downloaded ZIP to:', zipPath);

            progress.report({ message: "Extracting..." });

            // Extract the ZIP file
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(storageDir, true);
            console.log('✓ Extracted ZIP to:', storageDir);

            // Clean up ZIP file
            fs.unlinkSync(zipPath);

            if (!fs.existsSync(jarPath)) {
                throw new Error(`JAR file not found at expected location: ${jarPath}`);
            }

            console.log('✓ Choral JAR ready at:', jarPath);
            return jarPath;

        } catch (error) {
            // Clean up on error
            if (fs.existsSync(zipPath)) {
                fs.unlinkSync(zipPath);
            }
            throw error;
        }
    });

    return jarPath;
}

/**
 * Downloads a file from a URL to a destination path
 */
function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
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

            const file = createWriteStream(destPath);
            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });

            file.on('error', (err) => {
                file.close();
                fs.unlinkSync(destPath);
                reject(err);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}
