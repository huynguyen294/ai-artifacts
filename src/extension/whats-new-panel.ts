import * as vscode from "vscode";
import { webviewToExtensionMessageSchema } from "../shared/contracts";
import { getWebviewHtml } from "./webview-html";

const ALLOWED_EXTERNAL_SCHEMES = new Set(["http", "https", "mailto"]);

export class WhatsNewPanelController implements vscode.Disposable {
  static readonly viewType = "agentPlus.whatsNew";

  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn);
      return;
    }

    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const panel = vscode.window.createWebviewPanel(
      WhatsNewPanelController.viewType,
      "What's New & Tips",
      column,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
          vscode.Uri.joinPath(this.extensionUri, "media", "whats-new"),
        ],
      },
    );

    this.panel = panel;
    this.panelDisposables.push(
      panel.onDidDispose(() => {
        this.clearPanelResources();
      }),
      panel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
        const parsed = webviewToExtensionMessageSchema.safeParse(rawMessage);
        if (!parsed.success || parsed.data.type !== "openExternal") {
          return;
        }

        try {
          const uri = vscode.Uri.parse(parsed.data.url, true);
          if (!ALLOWED_EXTERNAL_SCHEMES.has(uri.scheme.toLowerCase())) {
            throw new Error("This link protocol is not allowed in What's New.");
          }
          const opened = await vscode.env.openExternal(uri);
          if (opened === false) {
            throw new Error("Unable to open the external link.");
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`Failed to open link: ${message}`);
        }
      }),
    );

    try {
      panel.webview.html = getWebviewHtml({
        appName: "whats-new",
        extensionUri: this.extensionUri,
        webview: panel.webview,
      });
    } catch (error) {
      this.clearPanelResources();
      panel.dispose();
      throw error;
    }
  }

  dispose(): void {
    const currentPanel = this.panel;
    this.clearPanelResources();
    currentPanel?.dispose();
  }

  private clearPanelResources(): void {
    this.panel = undefined;
    const disposables = this.panelDisposables;
    this.panelDisposables = [];
    for (const disposable of disposables) {
      disposable.dispose();
    }
  }
}

