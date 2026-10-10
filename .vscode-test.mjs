import { defineConfig } from '@vscode/test-cli';

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
	}
]);
