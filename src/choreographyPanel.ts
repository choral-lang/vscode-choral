import * as crypto from 'crypto';
import * as vscode from 'vscode';

const MAXIMUM_HELPER_EXPANSION_DEPTH = 2_147_483_647;

export type PanelState =
	| { kind: 'empty'; message: string }
	| { kind: 'diagram'; mermaid: string; helperExpansionDepth: number }
	| { kind: 'error'; message: string };

export type PanelCommand =
	| { type: 'copyMermaid'; mermaid: string }
	| { type: 'exportSvg'; svg: string }
	| { type: 'setHelperExpansionDepth'; helperExpansionDepth: number };

export interface PanelCommandActions {
	copyMermaid(source: string): Thenable<void>;
	setHelperExpansionDepth(depth: number): Thenable<void>;
	chooseSvgFile(): Thenable<vscode.Uri | undefined>;
	writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>;
}

export type PanelCommandResult = 'copied' | 'exported' | 'updated' | 'cancelled' | 'ignored';

export function toPanelMessage(state: PanelState): object {
	if (state.kind === 'diagram') {
		return {
			type: 'diagram',
			mermaid: state.mermaid,
			title: 'Choral Choreography',
			helperExpansionDepth: state.helperExpansionDepth,
		};
	}
	return { type: state.kind, message: state.message };
}

export function toPanelCommand(value: unknown): PanelCommand | undefined {
	if (typeof value !== 'object' || value === null || !('type' in value)) {
		return undefined;
	}
	const message = value as Record<string, unknown>;
	if (message.type === 'copyMermaid' && typeof message.mermaid === 'string') {
		return { type: 'copyMermaid', mermaid: message.mermaid };
	}
	if (message.type === 'exportSvg' && typeof message.svg === 'string'
		&& /^\s*<svg(?:\s|>)/u.test(message.svg)) {
		return { type: 'exportSvg', svg: message.svg };
	}
	if (message.type === 'setHelperExpansionDepth'
		&& typeof message.helperExpansionDepth === 'number'
		&& Number.isSafeInteger(message.helperExpansionDepth)
		&& message.helperExpansionDepth >= 0
		&& message.helperExpansionDepth <= MAXIMUM_HELPER_EXPANSION_DEPTH) {
		return {
			type: 'setHelperExpansionDepth',
			helperExpansionDepth: message.helperExpansionDepth,
		};
	}
	return undefined;
}

export async function executePanelCommand(
	value: unknown,
	actions: PanelCommandActions
): Promise<PanelCommandResult> {
	const command = toPanelCommand(value);
	if (!command) {
		return 'ignored';
	}
	if (command.type === 'copyMermaid') {
		await actions.copyMermaid(command.mermaid);
		return 'copied';
	}
	if (command.type === 'setHelperExpansionDepth') {
		await actions.setHelperExpansionDepth(command.helperExpansionDepth);
		return 'updated';
	}
	const uri = await actions.chooseSvgFile();
	if (!uri) {
		return 'cancelled';
	}
	await actions.writeFile(uri, Buffer.from(command.svg, 'utf8'));
	return 'exported';
}

export class ChoreographyPanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();
	private readonly onDidChangeHelperExpansionDepthEmitter = new vscode.EventEmitter<number>();
	readonly onDidDispose = this.onDidDisposeEmitter.event;
	readonly onDidChangeHelperExpansionDepth =
		this.onDidChangeHelperExpansionDepthEmitter.event;

	constructor(private readonly extensionUri: vscode.Uri) { }

	reveal(): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Beside, true);
			return;
		}
		this.panel = vscode.window.createWebviewPanel(
			'choral.choreography',
			'Choral Choreography',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.extensionUri],
			}
		);
		this.panel.webview.html = this.html(this.panel.webview);
		this.panel.webview.onDidReceiveMessage(message => {
			void this.handleCommand(message);
		});
		this.panel.onDidDispose(() => {
			this.panel = undefined;
			this.onDidDisposeEmitter.fire();
		});
	}

	show(state: PanelState): void {
		if (!this.panel) {
			return;
		}
		void this.panel.webview.postMessage(toPanelMessage(state));
	}

	isVisible(): boolean {
		return this.panel?.visible === true;
	}

	dispose(): void {
		this.onDidDisposeEmitter.dispose();
		this.onDidChangeHelperExpansionDepthEmitter.dispose();
		this.panel?.dispose();
	}

	private async handleCommand(message: unknown): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		try {
			const result = await executePanelCommand(message, {
				copyMermaid: source => vscode.env.clipboard.writeText(source),
				setHelperExpansionDepth: async depth => {
					this.onDidChangeHelperExpansionDepthEmitter.fire(depth);
				},
				chooseSvgFile: () => vscode.window.showSaveDialog({
					defaultUri: folder
						? vscode.Uri.joinPath(folder.uri, 'choreography.svg')
						: undefined,
					filters: { 'SVG image': ['svg'] },
					saveLabel: 'Export SVG',
				}),
				writeFile: (uri, content) => vscode.workspace.fs.writeFile(uri, content),
			});
			if (result === 'copied') {
				void vscode.window.showInformationMessage('Mermaid source copied.');
			} else if (result === 'exported') {
				void vscode.window.showInformationMessage('Choreography diagram exported.');
			}
		} catch (error) {
			void vscode.window.showErrorMessage('Unable to complete choreography diagram action: '
				+ (error instanceof Error ? error.message : String(error)));
		}
	}

	private html(webview: vscode.Webview): string {
		const nonce = crypto.randomBytes(16).toString('base64');
		const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.extensionUri,
			'node_modules',
			'mermaid',
			'dist',
			'mermaid.esm.min.mjs'
		));
		return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
		<title>Choral Choreography</title>
		<style>
			html,
			body {
				height: 100%;
			}
			body {
				color: var(--vscode-foreground);
				background: var(--vscode-editor-background);
				font-family: var(--vscode-font-family);
				margin: 0;
				display: flex;
				flex-direction: column;
				overflow: hidden;
			}
			#toolbar {
				box-sizing: border-box;
				display: flex;
				align-items: center;
				flex-wrap: wrap;
				gap: 6px 12px;
				padding: 8px 12px;
				background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
				border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
			}
			.toolbar-group {
				display: flex;
				align-items: center;
				gap: 6px;
			}
			button {
				min-height: 26px;
				padding: 3px 9px;
				color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
				background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
				border: 1px solid var(--vscode-button-border, transparent);
				border-radius: 2px;
				font: inherit;
				cursor: pointer;
			}
			button:hover:not(:disabled) {
				background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
			}
			button:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
			}
			button:disabled {
				opacity: 0.5;
				cursor: default;
			}
			input[type="number"] {
				box-sizing: border-box;
				width: 4.5em;
				padding: 3px 5px;
				color: var(--vscode-input-foreground, var(--vscode-foreground));
				background: var(--vscode-input-background, var(--vscode-editor-background));
				border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
				font: inherit;
			}
			#zoom-value {
				box-sizing: border-box;
				min-width: 52px;
				padding: 0 4px;
				color: var(--vscode-descriptionForeground);
				text-align: center;
				font-variant-numeric: tabular-nums;
			}
			#status {
				flex: none;
				padding: 12px 16px;
				color: var(--vscode-descriptionForeground);
			}
			#status.error {
				color: var(--vscode-errorForeground);
			}
			#diagram {
				box-sizing: border-box;
				flex: 1;
				min-height: 0;
				overflow: auto;
				padding: 8px 16px 24px;
			}
			#diagram svg {
				display: block;
				width: auto;
				height: auto;
				max-width: none;
				max-height: none;
			}
		</style>
	</head>
	<body>
		<div id="toolbar" role="toolbar" aria-label="Choreography diagram controls">
			<div class="toolbar-group" role="group" aria-label="Copy and export">
				<button id="copy-source" type="button" disabled>Copy Mermaid</button>
				<button id="export-svg" type="button" disabled>Export SVG</button>
			</div>
			<div class="toolbar-group" role="group" aria-label="Zoom controls">
				<button id="fit-diagram" type="button" disabled>Fit</button>
				<button id="zoom-out" type="button" aria-label="Zoom out" disabled>−</button>
				<output id="zoom-value" aria-live="polite">100%</output>
				<button id="zoom-in" type="button" aria-label="Zoom in" disabled>+</button>
				<button id="reset-zoom" type="button" disabled>Reset</button>
			</div>
			<div class="toolbar-group" role="group" aria-label="Helper expansion">
				<label for="helper-depth">Helper depth</label>
				<input id="helper-depth" type="number" min="0"
					max="${MAXIMUM_HELPER_EXPANSION_DEPTH}" step="1" value="0">
			</div>
		</div>
		<div id="status" role="status" aria-live="polite">Select a Choral choreography to visualize.</div>
		<div id="diagram" tabindex="0" aria-label="Choreography sequence diagram"></div>
		<script nonce="${nonce}" type="module">
			import mermaid from '${mermaidUri}';

			const vscodeApi = acquireVsCodeApi();
			const status = document.getElementById('status');
			const container = document.getElementById('diagram');
			const copyButton = document.getElementById('copy-source');
			const exportButton = document.getElementById('export-svg');
			const fitButton = document.getElementById('fit-diagram');
			const zoomOutButton = document.getElementById('zoom-out');
			const zoomInButton = document.getElementById('zoom-in');
			const resetButton = document.getElementById('reset-zoom');
			const helperDepthInput = document.getElementById('helper-depth');
			const zoomValue = document.getElementById('zoom-value');
			const minimumZoom = 0.25;
			const maximumZoom = 3;
			const zoomFactor = 1.2;
			const maximumHelperExpansionDepth = ${MAXIMUM_HELPER_EXPANSION_DEPTH};
			const exportedThemeVariables = [
				'--vscode-foreground',
				'--vscode-editor-foreground',
				'--vscode-editor-background',
				'--vscode-editorWidget-border',
				'--vscode-editorWidget-background',
				'--vscode-editorWidget-foreground',
				'--vscode-focusBorder',
				'--vscode-charts-blue',
				'--vscode-descriptionForeground',
				'--vscode-editor-inactiveSelectionBackground',
			];
			let renderVersion = 0;
			let currentMermaid;
			let naturalWidth = 1;
			let naturalHeight = 1;
			let zoom = 1;
			let fitMode = false;
			let helperExpansionDepth = 0;
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: 'strict',
				theme: 'base',
				themeCSS: '.rect { stroke: var(--vscode-charts-blue, '
					+ 'var(--vscode-focusBorder, var(--vscode-editorWidget-border))) !important; '
					+ 'stroke-width: 1px; }',
				sequence: {
					useMaxWidth: false,
				},
				themeVariables: {
					actorBorder: 'var(--vscode-editorWidget-border, var(--vscode-editor-foreground))',
					actorBkg: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
					actorTextColor: 'var(--vscode-editor-foreground)',
					actorLineColor: 'var(--vscode-descriptionForeground)',
					signalColor: 'var(--vscode-editor-foreground)',
					signalTextColor: 'var(--vscode-editor-foreground)',
					labelBoxBorderColor: 'var(--vscode-editorWidget-border, var(--vscode-editor-foreground))',
					labelBoxBkgColor: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
					labelTextColor: 'var(--vscode-editor-foreground)',
					loopTextColor: 'var(--vscode-editor-foreground)',
					noteBorderColor: 'var(--vscode-editorWidget-border, var(--vscode-editor-foreground))',
					noteBkgColor: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
					noteTextColor: 'var(--vscode-editorWidget-foreground, var(--vscode-editor-foreground))',
					activationBorderColor: 'var(--vscode-editor-foreground)',
					activationBkgColor: 'var(--vscode-editor-inactiveSelectionBackground)',
					sequenceNumberColor: 'var(--vscode-editor-foreground)',
				},
			});

			function renderedSvg() {
				return container.querySelector('svg');
			}

			function setDiagramControlsAvailable(available) {
				for (const control of [copyButton, exportButton, fitButton, zoomOutButton,
					zoomInButton, resetButton]) {
					control.disabled = !available;
				}
			}

			function updateZoomControls() {
				zoomValue.textContent = Math.round(zoom * 100) + '%';
				zoomOutButton.disabled = zoom <= minimumZoom;
				zoomInButton.disabled = zoom >= maximumZoom;
			}

			function applyZoom(value, keepFitMode = false) {
				const svg = renderedSvg();
				if (!svg) {
					return;
				}
				zoom = Math.min(maximumZoom, Math.max(minimumZoom, value));
				fitMode = keepFitMode;
				svg.style.width = naturalWidth * zoom + 'px';
				svg.style.height = naturalHeight * zoom + 'px';
				updateZoomControls();
			}

			function fitDiagram() {
				const horizontalPadding = parseFloat(getComputedStyle(container).paddingLeft)
					+ parseFloat(getComputedStyle(container).paddingRight);
				const verticalPadding = parseFloat(getComputedStyle(container).paddingTop)
					+ parseFloat(getComputedStyle(container).paddingBottom);
				const availableWidth = Math.max(1, container.clientWidth - horizontalPadding);
				const availableHeight = Math.max(1, container.clientHeight - verticalPadding);
				applyZoom(Math.min(
					availableWidth / naturalWidth,
					availableHeight / naturalHeight
				), true);
			}

			function measureNaturalSize(svg) {
				const viewBox = svg.viewBox && svg.viewBox.baseVal;
				if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
					naturalWidth = viewBox.width;
					naturalHeight = viewBox.height;
					return;
				}
				const bounds = svg.getBBox();
				naturalWidth = Math.max(1, bounds.width);
				naturalHeight = Math.max(1, bounds.height);
			}

			function standaloneSvg() {
				const svg = renderedSvg();
				if (!svg) {
					return undefined;
				}
				const clone = svg.cloneNode(true);
				clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
				clone.setAttribute('width', String(naturalWidth));
				clone.setAttribute('height', String(naturalHeight));
				clone.style.width = '';
				clone.style.height = '';
				const theme = getComputedStyle(document.documentElement);
				for (const variable of exportedThemeVariables) {
					const value = theme.getPropertyValue(variable).trim();
					if (value) {
						clone.style.setProperty(variable, value);
					}
				}
				return new XMLSerializer().serializeToString(clone);
			}

			copyButton.addEventListener('click', () => {
				if (typeof currentMermaid === 'string') {
					vscodeApi.postMessage({ type: 'copyMermaid', mermaid: currentMermaid });
				}
			});
			exportButton.addEventListener('click', () => {
				const svg = standaloneSvg();
				if (svg) {
					vscodeApi.postMessage({ type: 'exportSvg', svg });
				}
			});
			fitButton.addEventListener('click', fitDiagram);
			zoomOutButton.addEventListener('click', () => applyZoom(zoom / zoomFactor));
			zoomInButton.addEventListener('click', () => applyZoom(zoom * zoomFactor));
			resetButton.addEventListener('click', () => applyZoom(1));
			helperDepthInput.addEventListener('change', () => {
				const value = Number(helperDepthInput.value);
				if (helperDepthInput.value.trim() === '' || !Number.isSafeInteger(value)
					|| value < 0 || value > maximumHelperExpansionDepth) {
					helperDepthInput.value = String(helperExpansionDepth);
					return;
				}
				helperExpansionDepth = value;
				vscodeApi.postMessage({
					type: 'setHelperExpansionDepth',
					helperExpansionDepth,
				});
			});
			window.addEventListener('resize', () => {
				if (fitMode) {
					fitDiagram();
				}
			});

			window.addEventListener('message', async (event) => {
				const message = event.data;
				if (message.type === 'empty' || message.type === 'error') {
					renderVersion++;
					currentMermaid = undefined;
					fitMode = false;
					container.replaceChildren();
					container.removeAttribute('aria-busy');
					setDiagramControlsAvailable(false);
					status.textContent = message.message;
					status.className = message.type === 'error' ? 'error' : '';
					return;
				}
				if (message.type !== 'diagram') {
					return;
				}

				status.textContent = message.title;
				status.className = '';
				if (Number.isSafeInteger(message.helperExpansionDepth)
					&& message.helperExpansionDepth >= 0
					&& message.helperExpansionDepth <= maximumHelperExpansionDepth) {
					helperExpansionDepth = message.helperExpansionDepth;
					helperDepthInput.value = String(helperExpansionDepth);
				}
				const currentRender = ++renderVersion;
				container.setAttribute('aria-busy', 'true');
				setDiagramControlsAvailable(false);
				try {
					const result = await mermaid.render(
						'choral-diagram-' + currentRender,
						message.mermaid
					);
					if (currentRender !== renderVersion) {
						return;
					}
					container.innerHTML = result.svg;
					const svg = renderedSvg();
					if (!svg) {
						throw new Error('Mermaid did not return an SVG element.');
					}
					measureNaturalSize(svg);
					currentMermaid = message.mermaid;
					if (fitMode) {
						fitDiagram();
					} else {
						applyZoom(zoom);
					}
					setDiagramControlsAvailable(true);
					container.removeAttribute('aria-busy');
				} catch (error) {
					if (currentRender !== renderVersion) {
						return;
					}
					currentMermaid = undefined;
					fitMode = false;
					container.replaceChildren();
					container.removeAttribute('aria-busy');
					setDiagramControlsAvailable(false);
					status.textContent = 'Unable to render choreography: '
						+ (error instanceof Error ? error.message : String(error));
					status.className = 'error';
				}
			});
		</script>
	</body>
</html>`;
	}
}
