import * as vscode from "vscode";
import {
  buildArtifactConnectPrompt,
  type ArtifactConnectPromptOptions,
} from "../shared/artifact-connect-prompt";
import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";
import {
  webviewToExtensionMessageSchema,
  type ArtifactSessionTarget,
  type ExtensionToWebviewMessage,
  type WorkSessionDataChange,
} from "../shared/contracts";
import { ArtifactStore } from "./artifact-store";
import { runSingleMigration } from "./session-migration-command";
import { resolveWorkSessionSupport } from "./work-session-support";

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export type ConversationArtifactProviderController = {
  getArtifactSessions: (artifactId: string) => Promise<ArtifactSessionTarget[]>;
  onDidChange: (listener: (changes?: readonly WorkSessionDataChange[]) => void | Promise<void>) => { dispose: () => void };
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
    private readonly rootOptions: GlobalArtifactsRootOptions = {},
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

    const refreshSessions = async (): Promise<void> => {
      if (disposed) return;
      const seq = ++conversationRefreshSeq;
      try {
        const support = await resolveWorkSessionSupport(this.rootOptions, this.context);
        if (!support.supported || !this.conversationService) {
          if (disposed || seq !== conversationRefreshSeq) return;
          await post({
            type: "artifactSessionsState",
            supported: false,
            sessions: [],
          });
          return;
        }

        const sessions = await this.conversationService.getArtifactSessions(store.artifactId);
        if (disposed || seq !== conversationRefreshSeq) return;
        await post({
          type: "artifactSessionsState",
          supported: true,
          sessions,
        });
      } catch {
        if (disposed || seq !== conversationRefreshSeq) return;
        await post({
          type: "artifactSessionsState",
          supported: false,
          sessions: [],
        });
      }
    };

    const messageSubscription = panel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
      try {
        const message = webviewToExtensionMessageSchema.parse(rawMessage);
        switch (message.type) {
          case "ready":
            await refresh();
            void refreshSessions();
            return;
          case "openConversationArtifact":
            return;
          case "addComment":
            await store.addComment(message);
            await refresh();
            return;
          case "removeComment":
            await store.removeComment(message.commentId);
            await refresh();
            return;
          case "copyArtifactConnectPrompt": {
            const support = await resolveWorkSessionSupport(this.rootOptions, this.context);
            let promptOptions: ArtifactConnectPromptOptions | undefined;

            if (!support.supported || !this.conversationService) {
              promptOptions = undefined;
            } else if (message.mode === "join") {
              if (!message.sessionId) {
                void vscode.window.showErrorMessage("Thiếu Session ID để tham gia.");
                return;
              }
              const sessions = await this.conversationService.getArtifactSessions(store.artifactId);
              const targetSession = sessions.find((s) => s.sessionId === message.sessionId);
              if (!targetSession || targetSession.version !== 2) {
                void vscode.window.showErrorMessage(
                  `Session "${message.sessionId}" không hợp lệ hoặc cần chuyển đổi sang v2 trước khi tham gia.`,
                );
                void refreshSessions();
                return;
              }
              promptOptions = { mode: "join", sessionId: message.sessionId };
            } else if (message.mode === "new") {
              promptOptions = { mode: "new" };
            }

            const prompt = buildArtifactConnectPrompt(store.artifactDirectory, promptOptions);
            await vscode.env.clipboard.writeText(prompt);
            await post({ type: "artifactConnectPromptCopied" });
            return;
          }
          case "openArtifactSessions": {
            const support = await resolveWorkSessionSupport(this.rootOptions, this.context);
            if (!support.supported || !this.conversationService) {
              void vscode.window.showInformationMessage("Sessions yêu cầu MCP server phiên bản 12 trở lên.");
              return;
            }

            const sessions = await this.conversationService.getArtifactSessions(store.artifactId);
            if (sessions.length === 0) {
              void vscode.window.showInformationMessage("Artifact chưa thuộc Session nào.");
              return;
            }

            if (sessions.length === 1) {
              const target = sessions[0]!;
              if (target.version === 2) {
                await vscode.commands.executeCommand("agentPlus.openWorkSession", target.sessionId);
              } else {
                const choice = await vscode.window.showInformationMessage(
                  `Artifact này thuộc conversation "${target.title}". Bạn có muốn chuyển đổi sang Session v2 để mở?`,
                  "Chuyển đổi",
                  "Huỷ",
                );
                if (choice === "Chuyển đổi") {
                  await runSingleMigration({
                    sessionId: target.sessionId,
                    rootOptions: this.rootOptions,
                    openWorkSession: async (id) => {
                      await vscode.commands.executeCommand("agentPlus.openWorkSession", id);
                    },
                    showErrorMessage: (msg) => vscode.window.showErrorMessage(msg),
                    onDidMigrate: () => {
                      void refreshSessions();
                    },
                  });
                }
              }
              return;
            }

            // Multiple sessions: show QuickPick
            const items = sessions.map((s) => ({
              label: s.title,
              description: s.version === 2 ? `Session · ${s.typeLabel ?? "conversation"}` : "Conversation cũ · Cần chuyển đổi",
              target: s,
            }));

            const selected = await vscode.window.showQuickPick(items, {
              title: "Chọn Session của Artifact để mở",
            });

            if (!selected) return;

            if (selected.target.version === 2) {
              await vscode.commands.executeCommand("agentPlus.openWorkSession", selected.target.sessionId);
            } else {
              const choice = await vscode.window.showInformationMessage(
                `Chuyển đổi conversation "${selected.target.title}" sang Session v2 để mở?`,
                "Chuyển đổi",
                "Huỷ",
              );
              if (choice === "Chuyển đổi") {
                await runSingleMigration({
                  sessionId: selected.target.sessionId,
                  rootOptions: this.rootOptions,
                  openWorkSession: async (id) => {
                    await vscode.commands.executeCommand("agentPlus.openWorkSession", id);
                  },
                  showErrorMessage: (msg) => vscode.window.showErrorMessage(msg),
                  onDidMigrate: () => {
                    void refreshSessions();
                  },
                });
              }
            }
            return;
          }
          case "migrateSelectedConversation": {
            const support = await resolveWorkSessionSupport(this.rootOptions, this.context);
            if (!support.supported || !this.conversationService) {
              void vscode.window.showInformationMessage("Sessions yêu cầu MCP server phiên bản 12 trở lên.");
              return;
            }

            const sessions = await this.conversationService.getArtifactSessions(store.artifactId);
            const targetCandidate = sessions.find((s) => s.sessionId === message.sessionId);
            if (!targetCandidate || targetCandidate.version !== 1) {
              void vscode.window.showErrorMessage(
                `Conversation "${message.sessionId}" không còn ở trạng thái cần chuyển đổi.`,
              );
              void refreshSessions();
              return;
            }

            await runSingleMigration({
              sessionId: message.sessionId,
              rootOptions: this.rootOptions,
              openWorkSession: async (id) => {
                await vscode.commands.executeCommand("agentPlus.openWorkSession", id);
              },
              showErrorMessage: (msg) => vscode.window.showErrorMessage(msg),
              onDidMigrate: () => {
                void refreshSessions();
              },
            });
            return;
          }
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

    const conversationSubscription = this.conversationService?.onDidChange((changes) => {
      if (!changes || changes.length === 0) {
        void refreshSessions();
        return;
      }
      const relevant = changes.some((c) => {
        if (c.kind === "types" || c.kind === "support") return true;
        if (c.kind === "membership" && c.artifactId === store.artifactId) return true;
        if (c.kind === "metadata") return true;
        return false;
      });
      if (relevant) {
        void refreshSessions();
      }
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
    <div id="root" data-app="review" data-style-nonce="${token}" data-shiki-uri="${shikiUri}" data-mermaid-uri="${mermaidUri}"></div>
    <script nonce="${token}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
