import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

export function generateWebviewNonce(): string {
  return randomBytes(16).toString("base64");
}

export type WebviewHtmlOptions = {
  appName: "review" | "session" | "whats-new";
  extensionUri: vscode.Uri;
  webview: vscode.Webview;
};

export function getWebviewHtml(options: WebviewHtmlOptions): string {
  const { appName, extensionUri, webview } = options;
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "review.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "review.css"),
  );
  const shikiUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "shiki.js"),
  );
  const mermaidUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "mermaid.js"),
  );
  const token = generateWebviewNonce();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${webview.cspSource} 'nonce-${token}'; script-src 'nonce-${token}';" />
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div id="root" data-app="${appName}" data-style-nonce="${token}" data-shiki-uri="${shikiUri}" data-mermaid-uri="${mermaidUri}"></div>
    <script nonce="${token}" src="${scriptUri}"></script>
  </body>
</html>`;
}

