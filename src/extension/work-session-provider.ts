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
import type { ArtifactReviewOpenCoordinator } from "./artifact-review-open";
import type { ConversationArtifactService } from "./conversation-artifact-service";
import { getWebviewHtml } from "./webview-html";

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

    const post = (msg: SessionExtensionToWebviewMessage) => webviewPanel.webview.postMessage(msg);

    const refresh = async (): Promise<void> => {
      try {
        const viewData = await this.service.resolveSessionViewData(document.sessionId);
        void post({
          type: "workSessionState",
          state: { status: "ready", data: viewData },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void post({
          type: "workSessionState",
          state: { status: "error", message },
        });
      }
    };

    const disposables: vscode.Disposable[] = [
      this.service.onDidChange(() => {
        void refresh();
      }),
      webviewPanel.webview.onDidReceiveMessage(async (raw) => {
        const parsed = sessionWebviewToExtensionMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        const msg = parsed.data;

        if (msg.type === "ready") {
          await refresh();
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
        }
      }),
    ];

    webviewPanel.onDidDispose(() => {
      for (const d of disposables) d.dispose();
    });
  }
}
