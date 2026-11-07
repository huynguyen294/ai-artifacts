import path from "node:path";
import * as vscode from "vscode";
import {
  ARTIFACT_MARKDOWN_FILE,
  CONVERSATION_METADATA_FILE,
  globalArtifactsRoot,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import {
  artifactConversationIdSchema,
  sessionWebviewToExtensionMessageSchema,
  type SessionExtensionToWebviewMessage,
} from "../shared/contracts";
import { listSessionTypes } from "../shared/session-type-registry";
import type { ArtifactReviewOpenCoordinator } from "./artifact-review-open";
import type { ConversationArtifactService } from "./conversation-artifact-service";
import { runSelectSessionTypeQuickPick, type SessionTypeQuickPickItem } from "./session-type-command";
import { getWebviewHtml } from "./webview-html";
import { resolveWorkSessionSupport } from "./work-session-support";

export class WorkSessionDocument implements vscode.CustomDocument {
  constructor(
    readonly uri: vscode.Uri,
    readonly sessionId: string,
  ) {}

  dispose(): void {}
}

export class WorkSessionProvider implements vscode.CustomReadonlyEditorProvider<WorkSessionDocument> {
  static readonly viewType = "agentPlus.workSession";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: ConversationArtifactService<any>,
    private readonly openCoordinator: ArtifactReviewOpenCoordinator<vscode.Uri>,
    private readonly rootOptions: GlobalArtifactsRootOptions = {},
  ) {}

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<WorkSessionDocument> {
    const filename = path.basename(uri.fsPath);
    if (filename !== CONVERSATION_METADATA_FILE) {
      throw new Error(`Invalid session document: expected ${CONVERSATION_METADATA_FILE}, got ${filename}`);
    }

    const sessionIdCandidate = path.basename(path.dirname(uri.fsPath));
    const parsed = artifactConversationIdSchema.safeParse(sessionIdCandidate);
    if (!parsed.success) {
      throw new Error(`Invalid session directory ID: ${sessionIdCandidate}`);
    }

    // Ensure session exists
    await this.service.getWorkSession(parsed.data);

    return new WorkSessionDocument(uri, parsed.data);
  }

  async resolveCustomEditor(
    document: WorkSessionDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview")],
    };

    webviewPanel.webview.html = getWebviewHtml({
      appName: "session",
      extensionUri: this.context.extensionUri,
      webview: webviewPanel.webview,
    });

    const panelKey = `workSessions.panelExpanded.${document.sessionId}`;
    const getPanelExpanded = (): boolean => this.context.globalState?.get<boolean>(panelKey, true) ?? true;

    const post = (msg: SessionExtensionToWebviewMessage) => webviewPanel.webview.postMessage(msg);

    const refreshFull = async (): Promise<void> => {
      try {
        const viewData = await this.service.resolveSessionViewData(document.sessionId);
        const panelExpanded = getPanelExpanded();
        void post({
          type: "workSessionState",
          state: { status: "ready", data: viewData },
          panelExpanded,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void post({
          type: "workSessionState",
          state: { status: "error", message },
        });
      }
    };

    const ensureSupport = async (action: string): Promise<boolean> => {
      const support = await resolveWorkSessionSupport(
        this.rootOptions.userHome ? { userHome: this.rootOptions.userHome } : {},
        this.context,
      );
      if (!support.supported) {
        void post({
          type: "actionError",
          action,
          message: support.reason ?? "Work Session management requires MCP server version 12 or higher.",
        });
        return false;
      }
      return true;
    };

    const disposables: vscode.Disposable[] = [
      this.service.onDidChange(async (changes) => {
        if (!changes || changes.length === 0) {
          await refreshFull();
          return;
        }

        const session = await this.service.getWorkSession(document.sessionId).catch(() => undefined);
        if (!session) return;

        const sessionArtifacts = new Set([...session.working, ...session.references, ...session.archived]);

        const affectsThisSession = changes.some((c) => {
          if (c.kind === "types" || c.kind === "support") return true;
          if ("sessionId" in c && c.sessionId === document.sessionId) return true;
          if (c.kind === "artifact" && sessionArtifacts.has(c.artifactId)) return true;
          return false;
        });

        if (!affectsThisSession) return;

        const onlyMetadataOrTypes = changes.every(
          (c) => (c.kind === "metadata" && c.sessionId === document.sessionId) || c.kind === "types",
        );

        const onlyArtifactsOrLayout = changes.every(
          (c) =>
            (c.kind === "layout" && c.sessionId === document.sessionId) ||
            (c.kind === "membership" && c.sessionId === document.sessionId) ||
            (c.kind === "artifact" && sessionArtifacts.has(c.artifactId)),
        );

        if (onlyMetadataOrTypes) {
          try {
            const types = await listSessionTypes(this.rootOptions);
            const typeMap = new Map(types.map((t) => [t.id, t.label]));
            const typeLabel = typeMap.get(session.typeId) ?? session.typeId;
            void post({
              type: "workSessionSummaryPatch",
              summary: {
                title: session.title,
                typeId: session.typeId,
                typeLabel,
                updatedAt: session.updatedAt,
              },
            });
          } catch {
            await refreshFull();
          }
        } else if (onlyArtifactsOrLayout) {
          try {
            const viewData = await this.service.resolveSessionViewData(document.sessionId);
            void post({
              type: "workSessionArtifactsPatch",
              working: viewData.working,
              references: viewData.references,
              archived: viewData.archived,
              updatedAt: viewData.updatedAt,
            });
          } catch {
            await refreshFull();
          }
        } else {
          await refreshFull();
        }
      }),
      webviewPanel.webview.onDidReceiveMessage(async (raw) => {
        const parsed = sessionWebviewToExtensionMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        const msg = parsed.data;

        if (msg.type === "ready") {
          await refreshFull();
        } else if (msg.type === "openArtifact") {
          try {
            const session = await this.service.getWorkSession(document.sessionId);
            const allArtifacts = new Set([...session.working, ...session.references, ...session.archived]);

            if (allArtifacts.has(msg.artifactId)) {
              const artifactFile = path.join(
                globalArtifactsRoot(this.rootOptions),
                msg.artifactId,
                ARTIFACT_MARKDOWN_FILE,
              );
              await this.openCoordinator.open(vscode.Uri.file(artifactFile));
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void post({ type: "error", message });
          }
        } else if (msg.type === "openExternal") {
          try {
            const uri = vscode.Uri.parse(msg.url, true);
            if (!new Set(["http", "https", "mailto"]).has(uri.scheme.toLowerCase())) {
              throw new Error("This link protocol is not allowed in Work Session.");
            }
            await vscode.env.openExternal(uri);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void post({ type: "error", message });
          }
        } else if (msg.type === "setSessionPanelExpanded") {
          try {
            await this.context.globalState?.update(panelKey, msg.expanded);
            void post({ type: "sessionPanelExpanded", expanded: msg.expanded });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void post({ type: "actionError", action: "setSessionPanelExpanded", message });
          }
        } else if (msg.type === "renameSession") {
          try {
            if (!(await ensureSupport("renameSession"))) return;
            const session = await this.service.getWorkSession(document.sessionId);
            const newTitle = await vscode.window.showInputBox({
              title: "Rename Session",
              prompt: "Enter a session name",
              value: session.title,
              validateInput: (value) => {
                const trimmed = value.trim();
                if (trimmed.length === 0) return "Session name cannot be empty";
                if (trimmed.length > 120) return "Session name cannot exceed 120 characters";
                return undefined;
              },
            });
            if (newTitle !== undefined && newTitle.trim().length > 0 && newTitle.trim() !== session.title) {
              await this.service.updateSessionDetails(document.sessionId, { title: newTitle.trim() });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void post({ type: "actionError", action: "renameSession", message });
          }
        } else if (msg.type === "saveSessionInstructions") {
          try {
            if (!(await ensureSupport("saveSessionInstructions"))) return;
            await this.service.updateSessionDetails(document.sessionId, { instructions: msg.instructions });
            void post({ type: "sessionInstructionsSaved", instructions: msg.instructions });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void post({ type: "actionError", action: "saveSessionInstructions", message });
          }
        } else if (msg.type === "selectSessionType") {
          try {
            if (!(await ensureSupport("selectSessionType"))) return;
            const session = await this.service.getWorkSession(document.sessionId);
            const selected = await runSelectSessionTypeQuickPick({
              createQuickPick: () => vscode.window.createQuickPick<SessionTypeQuickPickItem>(),
              currentTypeId: session.typeId,
              rootOptions: this.rootOptions,
            });
            if (selected?.typeId && selected.typeId !== session.typeId) {
              await this.service.setSessionType(document.sessionId, selected.typeId);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void post({ type: "actionError", action: "selectSessionType", message });
          }
        } else if (msg.type === "moveArtifact") {
          try {
            if (!(await ensureSupport("moveArtifact"))) return;
            const session = await this.service.getWorkSession(document.sessionId);
            const allArtifacts = new Set([...session.working, ...session.references, ...session.archived]);
            if (!allArtifacts.has(msg.artifactId)) {
              throw new Error(`Artifact "${msg.artifactId}" does not belong to session.`);
            }
            const targetList = session[msg.zone];
            const targetIndex = targetList.length;
            await this.service.moveArtifactInSession(document.sessionId, msg.artifactId, msg.zone, targetIndex);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void post({ type: "actionError", action: "moveArtifact", message });
          }
        } else if (msg.type === "reorderArtifact") {
          try {
            if (!(await ensureSupport("reorderArtifact"))) return;
            const session = await this.service.getWorkSession(document.sessionId);
            let currentZone: "working" | "references" | "archived" | undefined;
            if (session.working.includes(msg.artifactId)) currentZone = "working";
            else if (session.references.includes(msg.artifactId)) currentZone = "references";
            else if (session.archived.includes(msg.artifactId)) currentZone = "archived";
            if (!currentZone) {
              throw new Error(`Artifact "${msg.artifactId}" does not belong to session.`);
            }
            const list = session[currentZone];
            const currentIndex = list.indexOf(msg.artifactId);
            const targetIndex = msg.direction === "up" ? currentIndex - 1 : currentIndex + 1;
            if (targetIndex >= 0 && targetIndex < list.length) {
              await this.service.moveArtifactInSession(document.sessionId, msg.artifactId, currentZone, targetIndex);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void post({ type: "actionError", action: "reorderArtifact", message });
          }
        } else if (msg.type === "removeArtifact") {
          try {
            if (!(await ensureSupport("removeArtifact"))) return;
            await this.service.removeArtifactFromSession(document.sessionId, msg.artifactId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void post({ type: "actionError", action: "removeArtifact", message });
          }
        }
      }),
    ];

    webviewPanel.onDidDispose(() => {
      for (const d of disposables) d.dispose();
    });
  }
}
