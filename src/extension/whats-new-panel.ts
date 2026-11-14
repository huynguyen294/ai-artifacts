import * as vscode from "vscode";
import {
  whatsNewVersionSchema,
  whatsNewWebviewToExtensionMessageSchema,
  type WhatsNewOpenVersionMessage,
} from "../shared/whats-new-protocol";
import { getWebviewHtml } from "./webview-html";

const ALLOWED_EXTERNAL_SCHEMES = new Set(["http", "https", "mailto"]);

export class WhatsNewPanelController implements vscode.Disposable {
  static readonly viewType = "agentPlus.whatsNew";

  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private nextRequestId = 0;
  private pendingNavigation: WhatsNewOpenVersionMessage | undefined;
  private hasReadySignal = false;
  private flushEpoch = 0;

  constructor(private readonly extensionUri: vscode.Uri) {}

  show(): void {
    if (this.panel) {
      const flushEpochBeforeReveal = this.flushEpoch;
      this.panel.reveal(this.panel.viewColumn);
      if (this.panel && this.flushEpoch === flushEpochBeforeReveal) {
        this.flushPendingNavigation();
      }
      return;
    }

    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    let panel: vscode.WebviewPanel;
    try {
      panel = vscode.window.createWebviewPanel(
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
    } catch (error) {
      this.clearPanelResources();
      throw error;
    }

    this.panel = panel;
    this.hasReadySignal = false;
    this.panelDisposables.push(
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.clearPanelResources();
        }
      }),
      panel.onDidChangeViewState((event) => {
        if (this.panel !== panel) {
          return;
        }
        if (event.webviewPanel.visible) {
          this.flushPendingNavigation();
        }
      }),
      panel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
        if (this.panel !== panel) {
          return;
        }
        await this.handleWebviewMessage(panel, rawMessage);
      }),
    );

    try {
      panel.webview.html = getWebviewHtml({
        appName: "whats-new",
        extensionUri: this.extensionUri,
        webview: panel.webview,
      });
    } catch (error) {
      if (this.panel === panel) {
        this.clearPanelResources();
      }
      panel.dispose();
      throw error;
    }
  }

  showVersion(version: string): void {
    const parsedVersion = whatsNewVersionSchema.safeParse(version);
    if (!parsedVersion.success) {
      return;
    }

    this.nextRequestId += 1;
    this.pendingNavigation = {
      type: "whatsNewOpenVersion",
      requestId: this.nextRequestId,
      version: parsedVersion.data,
    };

    try {
      this.show();
    } catch (error) {
      this.pendingNavigation = undefined;
      throw error;
    }
  }

  dispose(): void {
    const currentPanel = this.panel;
    this.clearPanelResources();
    currentPanel?.dispose();
  }

  private flushPendingNavigation(): void {
    const targetPanel = this.panel;
    const request = this.pendingNavigation;
    if (!targetPanel || !request || !this.hasReadySignal || !targetPanel.visible) {
      return;
    }

    this.flushEpoch += 1;

    try {
      const delivery = targetPanel.webview.postMessage(request);
      void Promise.resolve(delivery).then(
        () => undefined,
        (error: unknown) => {
          console.error(
            `What's New: failed to deliver navigation request ${request.requestId} for version ${request.version}.`,
            error,
          );
        },
      );
    } catch (error) {
      console.error(
        `What's New: failed to post navigation request ${request.requestId} for version ${request.version}.`,
        error,
      );
    }
  }

  private async handleWebviewMessage(
    sourcePanel: vscode.WebviewPanel,
    rawMessage: unknown,
  ): Promise<void> {
    if (this.panel !== sourcePanel) {
      return;
    }

    const parsed = whatsNewWebviewToExtensionMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      return;
    }

    const message = parsed.data;
    if (message.type === "whatsNewReady") {
      this.hasReadySignal = true;
      this.flushPendingNavigation();
      return;
    }

    if (message.type === "whatsNewNavigationApplied") {
      if (
        this.pendingNavigation &&
        this.pendingNavigation.requestId === message.requestId &&
        this.pendingNavigation.version === message.version
      ) {
        this.pendingNavigation = undefined;
      }
      return;
    }

    if (message.type === "openExternal") {
      try {
        const uri = vscode.Uri.parse(message.url, true);
        if (!ALLOWED_EXTERNAL_SCHEMES.has(uri.scheme.toLowerCase())) {
          throw new Error("This link protocol is not allowed in What's New.");
        }
        const opened = await vscode.env.openExternal(uri);
        if (opened === false) {
          throw new Error("Unable to open the external link.");
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to open link: ${errorMessage}`);
      }
    }
  }

  private clearPanelResources(): void {
    this.panel = undefined;
    this.pendingNavigation = undefined;
    this.hasReadySignal = false;
    const disposables = this.panelDisposables;
    this.panelDisposables = [];
    for (const disposable of disposables) {
      disposable.dispose();
    }
  }
}

