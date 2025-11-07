import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    Hover,
    MarkupContent
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => {
    return {
        capabilities: {
            hoverProvider: true
        }
    };
});

connection.onHover((params): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const position = params.position;
    const text = document.getText();
    const offset = document.offsetAt(position);

    const typeInfo = analyzeType(text, offset);

    if (typeInfo) {
        return {
            contents: {
                kind: 'markdown',
                value: `\`\`\`python\n${typeInfo}\n\`\`\``
            }
        };
    }

    return null;
});

// needs implementation: access to choral parser, maybe symbol table?
function analyzeType(test: string, offest: number): string | null {
    return "";
}

documents.listen(connection);
connection.listen();