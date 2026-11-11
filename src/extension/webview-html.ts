import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

export function generateWebviewNonce(): string {
  return randomBytes(16).toString("base64");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  const contentMediaBaseUri =
    appName === "whats-new"
      ? webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "whats-new")).toString()
      : undefined;
  const imgSrc = appName === "whats-new" ? `data: ${webview.cspSource}` : "data:";
  const mediaBaseAttr =
    contentMediaBaseUri !== undefined
      ? ` data-content-media-base-uri="${escapeHtmlAttribute(contentMediaBaseUri)}"`
      : "";
  const token = generateWebviewNonce();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src ${webview.cspSource} 'nonce-${token}'; script-src 'nonce-${token}';" />
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div id="root" data-app="${appName}" data-style-nonce="${token}" data-shiki-uri="${shikiUri}" data-mermaid-uri="${mermaidUri}"${mediaBaseAttr}></div>
    <script nonce="${token}" src="${scriptUri}"></script>
  </body>
</html>`;
}

