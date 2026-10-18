import * as vscode from "vscode";
import { buildArtifactConnectPrompt } from "../shared/artifact-connect-prompt";
import {
  webviewToExtensionMessageSchema,
  type ConversationArtifactsViewState,
  type ExtensionToWebviewMessage,
} from "../shared/contracts";
import { ArtifactStore } from "./artifact-store";
import type { OpenConversationArtifactResult } from "./conversation-artifact-service";

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export type ConversationArtifactProviderController = {
  getConversationsViewState: (currentArtifactId: string) => Promise<ConversationArtifactsViewState>;
  openConversationArtifact: (artifactId: string) => Promise<OpenConversationArtifactResult>;
  onDidChange: (listener: () => void | Promise<void>) => { dispose: () => void };
};

export type ArtifactStoreController = Pick<
  ArtifactStore,
  "artifactDirectory" | "artifactId" | "load" | "addComment" | "removeComment" | "submitReview"
>;

export class ArtifactReviewProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = "agentPlus.artifactReview";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly conversationService?: ConversationArtifactProviderController,
    private readonly createStore: (artifactPath: string) => ArtifactStoreController = (artifactPath) =>
      new ArtifactStore(artifactPath),
  ) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const store = this.createStore(document.uri.fsPath);
    let sending = false;
    let disposed = false;
    let conversationRefreshSeq = 0;

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview")],
    };
    panel.webview.html = this.html(panel.webview);

    const post = (message: ExtensionToWebviewMessage): Thenable<boolean> => panel.webview.postMessage(message);
    const refresh = async (): Promise<void> => {
      if (disposed) return;
      try {
        const state = await store.load();
        if (disposed) return;
        await post({ type: "state", state });
      } catch (error) {
        if (disposed) return;
        await post({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
    };

    const refreshConversations = async (showLoading = false): Promise<void> => {
      if (disposed) return;
      const seq = ++conversationRefreshSeq;
      if (!this.conversationService) {
        await post({
          type: "conversationArtifactsState",
          state: { status: "ready", groups: [], skippedCount: 0 },
        });
        return;
      }
      if (showLoading) {
        await post({
          type: "conversationArtifactsState",
          state: { status: "loading" },
        });
      }
      try {
        const state = await this.conversationService.getConversationsViewState(store.artifactId);
        if (disposed || seq !== conversationRefreshSeq) return;
        await post({
          type: "conversationArtifactsState",
          state,
        });
      } catch (error) {
        if (disposed || seq !== conversationRefreshSeq) return;
        await post({
          type: "conversationArtifactsState",
          state: {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    };

    const messageSubscription = panel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
      try {
        const message = webviewToExtensionMessageSchema.parse(rawMessage);
        switch (message.type) {
          case "ready":
            await refresh();
            void refreshConversations(true);
            return;
          case "openConversationArtifact": {
            if (!this.conversationService) return;
            await this.conversationService.openConversationArtifact(message.artifactId);
            return;
          }
          case "addComment":
            await store.addComment(message);
            await refresh();
            return;
          case "removeComment":
            await store.removeComment(message.commentId);
            await refresh();
            return;
          case "copyArtifactConnectPrompt":
            await vscode.env.clipboard.writeText(buildArtifactConnectPrompt(store.artifactDirectory));
            await post({ type: "artifactConnectPromptCopied" });
            return;
          case "openExternal": {
            const uri = vscode.Uri.parse(message.url, true);
            if (!new Set(["http", "https", "mailto"]).has(uri.scheme.toLowerCase())) {
              throw new Error("This link protocol is not allowed in Artifact Review.");
            }
            await vscode.env.openExternal(uri);
            return;
          }
          case "submitReview":
            if (sending) return;
            sending = true;
            await post({
              type: "sendState",
              status: "submitting",
              message: "Returning this decision to the waiting AI turn…",
            });
            try {
              await store.submitReview(message.decision);
              await refresh();
              const text =
                message.decision === "revise"
                  ? "Review comments returned to the waiting AI turn."
                  : message.decision === "save"
                    ? undefined
                    : "Artifact approved. Return to the AI chat to continue.";
              await post({
                type: "sendState",
                status: "submitted",
                ...(text ? { message: text } : {}),
              });
            } catch (error) {
              await post({
                type: "sendState",
                status: "error",
                message: error instanceof Error ? error.message : String(error),
              });
            } finally {
              sending = false;
            }
            return;
        }
      } catch (error) {
        await post({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
    });

    const documentSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) void refresh();
    });
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        store.artifactDirectory,
        "{artifact.json,artifact.md,comments.json,review-submission.json}",
      ),
    );
    fileWatcher.onDidCreate(() => void refresh());
    fileWatcher.onDidChange(() => void refresh());
    fileWatcher.onDidDelete(() => void refresh());

    const conversationSubscription = this.conversationService?.onDidChange(() => {
      void refreshConversations(false);
    });

    panel.onDidDispose(() => {
      disposed = true;
      messageSubscription.dispose();
      documentSubscription.dispose();
      fileWatcher.dispose();
      conversationSubscription?.dispose();
    });
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "review.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "review.css"),
    );
    const shikiUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "shiki.js"),
    );
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "mermaid.js"),
    );
    const token = nonce();
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${webview.cspSource} 'nonce-${token}'; script-src 'nonce-${token}';" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Artifact Review</title>
  </head>
  <body>
    <div id="root" data-style-nonce="${token}" data-shiki-uri="${shikiUri}" data-mermaid-uri="${mermaidUri}"></div>
    <script nonce="${token}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
