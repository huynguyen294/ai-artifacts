import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import { buildArtifactConnectPrompt } from "../shared/artifact-connect-prompt";
import { ARTIFACT_UI_STATE_FILE, type GlobalArtifactsRootOptions } from "../shared/artifact-files";
import {
  conversationNameSchema,
  webviewToExtensionMessageSchema,
  type ArtifactSessionTarget,
  type ExtensionToWebviewMessage,
  type WorkSession,
  type WorkSessionDataChange,
} from "../shared/contracts";
import { removeConversation } from "../shared/conversation-artifact-registry";
import { buildSessionConnectPrompt } from "../shared/session-connect-prompt";
import { validateArtifactReviewTarget } from "./artifact-review-open";
import { ArtifactStore } from "./artifact-store";
import { getArtifactUiState, patchArtifactUiState } from "./artifact-ui-state";
import { runSingleMigration } from "./session-migration-command";
import { resolveWorkSessionSupport } from "./work-session-support";

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export type ConversationArtifactProviderController = {
  getArtifactSessions: (artifactId: string) => Promise<ArtifactSessionTarget[]>;
  createSession?: (input: { title: string; typeId?: string; instructions?: string }) => Promise<WorkSession>;
  registerArtifactInSession?: (sessionId: string, artifactId: string) => Promise<void>;
  onDidChange: (listener: (changes?: readonly WorkSessionDataChange[]) => void | Promise<void>) => { dispose: () => void };
};

export type ArtifactStoreController = Pick<
  ArtifactStore,
  "artifactDirectory" | "artifactId" | "load" | "addComment" | "removeComment" | "submitReview"
> & { artifactPath?: string };

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
        try {
          await fs.access(store.artifactDirectory);
        } catch (accessErr: any) {
          if (accessErr && (accessErr.code === "ENOENT" || accessErr.code === "ENOTDIR")) {
            await post({ type: "artifactDeleted", artifactId: store.artifactId });
            return;
          }
        }
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
          case "restoreArtifact": {
            try {
              const updated = await patchArtifactUiState(store.artifactId, { archivedAt: null }, this.rootOptions);
              (this.conversationService as any)?.scheduleChangeNotification?.([{ kind: "artifactUiState", artifactId: store.artifactId }]);
              await post({
                type: "artifactUiStatePatch",
                artifactId: store.artifactId,
                uiState: {
                  pinned: Boolean(updated.pinned),
                  ...(updated.archivedAt ? { archivedAt: updated.archivedAt } : {}),
                },
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              void vscode.window.showErrorMessage(`Failed to restore artifact: ${message}`);
              await post({ type: "error", message: `Failed to restore artifact: ${message}` });
            }
            return;
          }
          case "copyArtifactConnectPrompt": {
            const prompt = buildArtifactConnectPrompt(store.artifactDirectory);
            await vscode.env.clipboard.writeText(prompt);
            await post({ type: "artifactConnectPromptCopied" });
            return;
          }
          case "startWorkSession": {
            const support = await resolveWorkSessionSupport(this.rootOptions, this.context);
            if (
              !support.supported
              || !this.conversationService?.createSession
              || !this.conversationService?.registerArtifactInSession
            ) {
              void vscode.window.showInformationMessage("Sessions require MCP server version 12 or higher.");
              return;
            }

            const artifactFilePath = store.artifactPath ?? document.uri.fsPath;
            let targetTitle = store.artifactId;
            try {
              const target = await validateArtifactReviewTarget(artifactFilePath, this.rootOptions);
              targetTitle = target.manifest.title;
            } catch {
              void vscode.window.showErrorMessage(
                `Artifact "${store.artifactId}" is no longer valid or has been removed.`,
              );
              return;
            }

            const rawTitle = await vscode.window.showInputBox({
              title: "Start a work session",
              prompt: "Enter a name for the new work session",
              placeHolder: "Work session name",
              value: targetTitle,
              validateInput: (value) => {
                const parsed = conversationNameSchema.safeParse(value?.trim());
                if (!parsed.success) {
                  return "Work session name must be between 1 and 200 characters.";
                }
                return undefined;
              },
            });

            if (rawTitle === undefined) {
              return;
            }

            const title = rawTitle.trim();
            const parsedTitle = conversationNameSchema.safeParse(title);
            if (!parsedTitle.success) {
              void vscode.window.showErrorMessage("Work session name must be between 1 and 200 characters.");
              return;
            }

            let session: WorkSession;
            try {
              session = await this.conversationService.createSession({ title: parsedTitle.data });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              void vscode.window.showErrorMessage(`Failed to create work session: ${message}`);
              return;
            }

            try {
              await this.conversationService.registerArtifactInSession(session.sessionId, store.artifactId);
            } catch (error) {
              await removeConversation(session.sessionId, this.rootOptions).catch(() => undefined);
              const message = error instanceof Error ? error.message : String(error);
              void vscode.window.showErrorMessage(`Failed to register artifact in session: ${message}`);
              return;
            }

            void refreshSessions();

            let openSucceeded = false;
            try {
              await vscode.commands.executeCommand("agentPlus.openWorkSession", session.sessionId);
              openSucceeded = true;
            } catch {
              openSucceeded = false;
            }

            let copySucceeded = false;
            try {
              const prompt = buildSessionConnectPrompt({ sessionId: session.sessionId, title: parsedTitle.data });
              await vscode.env.clipboard.writeText(prompt);
              copySucceeded = true;
            } catch {
              copySucceeded = false;
            }

            if (openSucceeded && copySucceeded) {
              void vscode.window.showInformationMessage(
                "Work session created. Connect prompt copied. Paste it into your AI chat to connect.",
              );
            } else if (openSucceeded && !copySucceeded) {
              void vscode.window.showWarningMessage(
                "Work session created, but the Connect prompt could not be copied. Open the session and use Connect to try again.",
              );
            } else if (!openSucceeded && copySucceeded) {
              void vscode.window.showWarningMessage(
                "Work session created and Connect prompt copied, but the session could not be opened. Paste the prompt into your AI chat to connect.",
              );
            } else {
              void vscode.window.showErrorMessage(
                "Work session created, but it could not be opened and the Connect prompt could not be copied. Open it from Sessions to continue.",
              );
            }
            return;
          }
          case "openArtifactSessions": {
            const support = await resolveWorkSessionSupport(this.rootOptions, this.context);
            if (!support.supported || !this.conversationService) {
              void vscode.window.showInformationMessage("Sessions require MCP server version 12 or higher.");
              return;
            }

            const sessions = await this.conversationService.getArtifactSessions(store.artifactId);
            if (sessions.length === 0) {
              void vscode.window.showInformationMessage("This artifact does not belong to any session.");
              return;
            }

            if (sessions.length === 1) {
              const target = sessions[0]!;
              if (target.version === 2) {
                await vscode.commands.executeCommand("agentPlus.openWorkSession", target.sessionId);
              } else {
                const choice = await vscode.window.showInformationMessage(
                  `This artifact belongs to conversation "${target.title}". Do you want to migrate it to Session v2 to open?`,
                  "Migrate",
                  "Cancel",
                );
                if (choice === "Migrate") {
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
              description: s.version === 2 ? `Session · ${s.typeLabel ?? "conversation"}` : "Legacy conversation · Migration required",
              target: s,
            }));

            const selected = await vscode.window.showQuickPick(items, {
              title: "Select Artifact Session to Open",
            });

            if (!selected) return;

            if (selected.target.version === 2) {
              await vscode.commands.executeCommand("agentPlus.openWorkSession", selected.target.sessionId);
            } else {
              const choice = await vscode.window.showInformationMessage(
                `Migrate conversation "${selected.target.title}" to Session v2 to open?`,
                "Migrate",
                "Cancel",
              );
              if (choice === "Migrate") {
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
              void vscode.window.showInformationMessage("Sessions require MCP server version 12 or higher.");
              return;
            }

            const sessions = await this.conversationService.getArtifactSessions(store.artifactId);
            const targetCandidate = sessions.find((s) => s.sessionId === message.sessionId);
            if (!targetCandidate || targetCandidate.version !== 1) {
              void vscode.window.showErrorMessage(
                `Conversation "${message.sessionId}" is no longer in a state requiring migration.`,
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

    const uiStateWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(store.artifactDirectory, ARTIFACT_UI_STATE_FILE),
    );
    const handleUiStateChange = async () => {
      if (disposed) return;
      try {
        const uiState = await getArtifactUiState(store.artifactId, this.rootOptions);
        if (disposed) return;
        await post({
          type: "artifactUiStatePatch",
          artifactId: store.artifactId,
          uiState: {
            pinned: Boolean(uiState.pinned),
            ...(uiState.archivedAt ? { archivedAt: uiState.archivedAt } : {}),
          },
        });
      } catch (error) {
        if (disposed) return;
        console.warn(`[ArtifactReviewProvider] Failed to read UI state for ${store.artifactId}:`, error);
      }
    };
    uiStateWatcher.onDidCreate(() => void handleUiStateChange());
    uiStateWatcher.onDidChange(() => void handleUiStateChange());
    uiStateWatcher.onDidDelete(() => void handleUiStateChange());

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
      const hasUiState = changes.some(
        (c) => c.kind === "artifactUiState" && c.artifactId === store.artifactId,
      );
      if (hasUiState) {
        void handleUiStateChange();
      }
      const hasArtifact = changes.some(
        (c) => c.kind === "artifact" && c.artifactId === store.artifactId,
      );
      if (hasArtifact) {
        void refresh();
      }
    });

    panel.onDidDispose(() => {
      disposed = true;
      messageSubscription.dispose();
      documentSubscription.dispose();
      fileWatcher.dispose();
      uiStateWatcher.dispose();
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
