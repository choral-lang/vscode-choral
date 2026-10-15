import { defineConfig } from '@vscode/test-cli';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const installProfile = fileURLToPath(
  new URL(`.vscode-test/install/${randomUUID().slice(0, 8)}/`, import.meta.url)
);

process.once('exit', () => {
  rmSync(installProfile, {
    recursive: true, force: true, maxRetries: 5, retryDelay: 200
  });
});

export default defineConfig([
	{
		label: 'integration',
		files: 'out/test/integration/**/*.test.js',
		version: 'stable',
		mocha: { ui: 'bdd', timeout: 20000 }
	},
	{
		label: 'e2e',
		files: 'out/test/e2e/**/*.test.js',
		version: 'stable',
		mocha: { ui: 'bdd', timeout: 60000 }
	},
	{
		label: 'e2e-install',
		files: 'out/test/e2e/languageServer.test.js',
		version: 'stable',
		launchArgs: [`--user-data-dir=${installProfile}`],
		env: { CHORAL_HOME: '', CHORAL_TEST_INSTALL_PROFILE: installProfile },
		mocha: { ui: 'bdd', timeout: 180000 }
	}
]);
