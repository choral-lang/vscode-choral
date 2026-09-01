import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';
import {
	executePanelCommand,
	PanelCommandActions,
	toPanelCommand,
	toPanelMessage,
} from '../choreographyPanel';
import { choreographyDiagramParams, diagramPanelState } from '../choreography';


describe('Choral Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	after(() => { vscode.window.showInformationMessage('All tests run'); });

	it('Choral Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});
});

describe('Choreography diagram response', () => {
	it('includes helper expansion depth in diagram requests', () => {
		const position = new vscode.Position(4, 7);

		assert.deepStrictEqual(choreographyDiagramParams({
			textDocument: { uri: 'file:///Example.ch' },
			position,
		}, 3), {
			textDocument: { uri: 'file:///Example.ch' },
			position,
			helperExpansionDepth: 3,
		});
	});

	it('maps a missing diagram to the empty panel state', () => {
		assert.deepStrictEqual(diagramPanelState(null), {
			kind: 'empty',
			message: 'Select a Choral choreography to visualize.',
		});
	});

	it('maps Mermaid source to a diagram panel state without changing it', () => {
		const source = 'sequenceDiagram\np_A->>p_B: value';

		assert.deepStrictEqual(diagramPanelState(source), {
			kind: 'diagram',
			mermaid: source,
			helperExpansionDepth: 0,
		});
	});

	it('passes the compiler-rendered Mermaid source to the panel unchanged', () => {
		const source = 'sequenceDiagram\np_Buyer->>p_Seller: order: {Item};';

		assert.deepStrictEqual(toPanelMessage({
			kind: 'diagram', mermaid: source, helperExpansionDepth: 2,
		}), {
			type: 'diagram',
			mermaid: source,
			title: 'Choral Choreography',
			helperExpansionDepth: 2,
		});
	});
});

describe('Choreography panel commands', () => {
	it('accepts non-negative integer helper expansion depths', () => {
		assert.deepStrictEqual(toPanelCommand({
			type: 'setHelperExpansionDepth', helperExpansionDepth: 0,
		}), { type: 'setHelperExpansionDepth', helperExpansionDepth: 0 });
		assert.deepStrictEqual(toPanelCommand({
			type: 'setHelperExpansionDepth', helperExpansionDepth: 3,
		}), { type: 'setHelperExpansionDepth', helperExpansionDepth: 3 });
		assert.deepStrictEqual(toPanelCommand({
			type: 'setHelperExpansionDepth', helperExpansionDepth: 2_147_483_647,
		}), { type: 'setHelperExpansionDepth', helperExpansionDepth: 2_147_483_647 });
	});

	it('rejects invalid helper expansion depths', () => {
		for (const helperExpansionDepth of [-1, 1.5, 2_147_483_648, '2', undefined]) {
			assert.strictEqual(toPanelCommand({
				type: 'setHelperExpansionDepth', helperExpansionDepth,
			}), undefined);
		}
	});

	it('dispatches helper expansion depth changes', async () => {
		let selectedDepth: number | undefined;
		const result = await executePanelCommand(
			{ type: 'setHelperExpansionDepth', helperExpansionDepth: 4 },
			actions({
				setHelperExpansionDepth: async depth => { selectedDepth = depth; },
			})
		);

		assert.strictEqual(result, 'updated');
		assert.strictEqual(selectedDepth, 4);
	});

	it('copies Mermaid source without modifying it', async () => {
		const source = 'sequenceDiagram\n  p_A->>p_B: value: {exact};\n';
		let copied: string | undefined;
		const result = await executePanelCommand(
			{ type: 'copyMermaid', mermaid: source },
			actions({ copyMermaid: async value => { copied = value; } })
		);

		assert.strictEqual(result, 'copied');
		assert.strictEqual(copied, source);
	});

	it('writes the rendered SVG as unchanged UTF-8', async () => {
		const uri = vscode.Uri.file('/tmp/choreography.svg');
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Æ</text></svg>';
		let writtenUri: vscode.Uri | undefined;
		let writtenContent: Uint8Array | undefined;
		const result = await executePanelCommand(
			{ type: 'exportSvg', svg },
			actions({
				chooseSvgFile: async () => uri,
				writeFile: async (target, content) => {
					writtenUri = target;
					writtenContent = content;
				},
			})
		);

		assert.strictEqual(result, 'exported');
		assert.strictEqual(writtenUri?.toString(), uri.toString());
		assert.strictEqual(Buffer.from(writtenContent ?? []).toString('utf8'), svg);
	});

	it('does not write a file when export is cancelled', async () => {
		let writes = 0;
		const result = await executePanelCommand(
			{ type: 'exportSvg', svg: '<svg></svg>' },
			actions({ writeFile: async () => { writes++; } })
		);

		assert.strictEqual(result, 'cancelled');
		assert.strictEqual(writes, 0);
	});

	it('ignores malformed or non-SVG webview messages', async () => {
		assert.strictEqual(toPanelCommand({ type: 'copyMermaid', mermaid: 42 }), undefined);
		assert.strictEqual(toPanelCommand({ type: 'exportSvg', svg: '<html></html>' }), undefined);
		assert.strictEqual(
			await executePanelCommand({ type: 'unknown' }, actions()),
			'ignored'
		);
	});
});

function actions(overrides: Partial<PanelCommandActions> = {}): PanelCommandActions {
	return {
		copyMermaid: async () => undefined,
		setHelperExpansionDepth: async () => undefined,
		chooseSvgFile: async () => undefined,
		writeFile: async () => undefined,
		...overrides,
	};
}
