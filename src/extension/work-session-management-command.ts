import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import {
  globalArtifactsRoot,
  workSessionInstructionsPath,
  OWNER_ONLY_FILE_MODE,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import { buildArtifactConnectPrompt } from "../shared/artifact-connect-prompt";
import { buildSessionConnectPrompt } from "../shared/session-connect-prompt";
import { deleteSession } from "../shared/conversation-artifact-registry";
import { deleteArtifactAndCleanup } from "./artifact-deletion";
import {
  patchArtifactUiState,
  patchSessionUiState,
  getArtifactUiState,
  getSessionUiState,
} from "./artifact-ui-state";
import type { ConversationArtifactService } from "./conversation-artifact-service";
import { runSelectSessionTypeQuickPick, type SessionTypeQuickPickItem } from "./session-type-command";

export function extractArtifactId(elementOrId: unknown): string | undefined {
  if (typeof elementOrId === "string") return elementOrId;
  if (elementOrId && typeof elementOrId === "object") {
    if ("artifact" in elementOrId && (elementOrId as any).artifact?.artifactId) {
      return (elementOrId as any).artifact.artifactId;
    }
    if ("artifactId" in elementOrId && typeof (elementOrId as any).artifactId === "string") {
      return (elementOrId as any).artifactId;
    }
  }
  return undefined;
}

export function extractSessionId(elementOrId: unknown): string | undefined {
  if (typeof elementOrId === "string") return elementOrId;
  if (elementOrId && typeof elementOrId === "object") {
    if ("sessionId" in elementOrId && typeof (elementOrId as any).sessionId === "string") {
      return (elementOrId as any).sessionId;
    }
    if ("session" in elementOrId && (elementOrId as any).session?.sessionId) {
      return (elementOrId as any).session.sessionId;
    }
  }
  return undefined;
}

export interface ManagementCommandDeps {
  service: ConversationArtifactService<any>;
  rootOptions?: GlobalArtifactsRootOptions;
  openTextDocument?: (uri: vscode.Uri) => Thenable<unknown>;
}

export class WorkSessionManagementCoordinator {
  constructor(private readonly deps: ManagementCommandDeps) {}

  private get rootOptions(): GlobalArtifactsRootOptions {
    return this.deps.rootOptions ?? {};
  }

  async pinArtifact(elementOrId: unknown): Promise<void> {
    const artifactId = extractArtifactId(elementOrId);
    if (!artifactId) return;
    try {
      await patchArtifactUiState(artifactId, { pinned: true }, this.rootOptions);
      this.deps.service.scheduleChangeNotification([{ kind: "artifactUiState", artifactId }]);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async unpinArtifact(elementOrId: unknown): Promise<void> {
    const artifactId = extractArtifactId(elementOrId);
    if (!artifactId) return;
    try {
      await patchArtifactUiState(artifactId, { pinned: false }, this.rootOptions);
      this.deps.service.scheduleChangeNotification([{ kind: "artifactUiState", artifactId }]);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async archiveArtifact(elementOrId: unknown): Promise<void> {
    const artifactId = extractArtifactId(elementOrId);
    if (!artifactId) return;
    try {
      await patchArtifactUiState(artifactId, { archivedAt: new Date().toISOString() }, this.rootOptions);
      this.deps.service.scheduleChangeNotification([{ kind: "artifactUiState", artifactId }]);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async restoreArtifact(elementOrId: unknown): Promise<void> {
    const artifactId = extractArtifactId(elementOrId);
    if (!artifactId) return;
    try {
      await patchArtifactUiState(artifactId, { archivedAt: null }, this.rootOptions);
      this.deps.service.scheduleChangeNotification([{ kind: "artifactUiState", artifactId }]);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async deleteArtifactPermanently(elementOrId: unknown): Promise<void> {
    const artifactId = extractArtifactId(elementOrId);
    if (!artifactId) return;

    const confirm = await vscode.window.showWarningMessage(
      "Delete this artifact permanently from all sessions?",
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") return;

    try {
      const result = await deleteArtifactAndCleanup(artifactId, this.rootOptions);
      if (!result.deleted) {
        void vscode.window.showErrorMessage(
          `Failed to delete artifact: ${result.error ?? "artifact not found."}`,
        );
        return;
      }
      this.deps.service.scheduleChangeNotification([{ kind: "artifact", artifactId }]);
      if (result.cleanupError || (result.conversationCleanup && result.conversationCleanup.skippedCount > 0)) {
        void vscode.window.showWarningMessage(
          "Artifact deleted permanently, but some session reference cleanups encountered issues.",
        );
      } else {
        void vscode.window.showInformationMessage("Artifact deleted permanently.");
      }
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async copyArtifactConnectPrompt(elementOrId: unknown): Promise<void> {
    const artifactId = extractArtifactId(elementOrId);
    if (!artifactId) return;
    try {
      const artifactDir = path.join(globalArtifactsRoot(this.rootOptions), artifactId);
      const prompt = buildArtifactConnectPrompt(artifactDir);
      await vscode.env.clipboard.writeText(prompt);
      void vscode.window.showInformationMessage("Connect prompt copied. Paste it into your AI chat to connect.");
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async pinSession(elementOrId: unknown): Promise<void> {
    const sessionId = extractSessionId(elementOrId);
    if (!sessionId) return;
    try {
      await patchSessionUiState(sessionId, { pinned: true }, this.rootOptions);
      this.deps.service.scheduleChangeNotification([{ kind: "sessionUiState", sessionId }]);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async unpinSession(elementOrId: unknown): Promise<void> {
    const sessionId = extractSessionId(elementOrId);
    if (!sessionId) return;
    try {
      await patchSessionUiState(sessionId, { pinned: false }, this.rootOptions);
      this.deps.service.scheduleChangeNotification([{ kind: "sessionUiState", sessionId }]);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async archiveSession(elementOrId: unknown): Promise<void> {
    const sessionId = extractSessionId(elementOrId);
    if (!sessionId) return;
    try {
      await patchSessionUiState(sessionId, { archivedAt: new Date().toISOString() }, this.rootOptions);
      this.deps.service.scheduleChangeNotification([{ kind: "sessionUiState", sessionId }]);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async restoreSession(elementOrId: unknown): Promise<void> {
    const sessionId = extractSessionId(elementOrId);
    if (!sessionId) return;
    try {
      await patchSessionUiState(sessionId, { archivedAt: null }, this.rootOptions);
      this.deps.service.scheduleChangeNotification([{ kind: "sessionUiState", sessionId }]);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async deleteSessionPermanently(elementOrId: unknown): Promise<void> {
    const sessionId = extractSessionId(elementOrId);
    if (!sessionId) return;

    const confirm = await vscode.window.showWarningMessage(
      "Delete this session permanently? Its artifacts will be kept.",
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") return;

    try {
      const deleted = await deleteSession(sessionId, this.rootOptions);
      if (!deleted) {
        void vscode.window.showErrorMessage("Failed to delete session: session not found.");
        return;
      }
      this.deps.service.scheduleChangeNotification([{ kind: "metadata", sessionId }]);
      void vscode.window.showInformationMessage("Session deleted permanently.");
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async copySessionConnectPrompt(elementOrId: unknown): Promise<void> {
    const sessionId = extractSessionId(elementOrId);
    if (!sessionId) return;
    try {
      const session = await this.deps.service.getWorkSession(sessionId);
      const prompt = buildSessionConnectPrompt({
        sessionId: session.sessionId,
        title: session.title,
      });
      await vscode.env.clipboard.writeText(prompt);
      void vscode.window.showInformationMessage("Session connect prompt copied. Paste it into your AI chat to connect.");
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async openSessionInstructionsFile(elementOrId: unknown): Promise<void> {
    const sessionId = extractSessionId(elementOrId);
    if (!sessionId) return;
    try {
      await this.deps.service.getWorkSession(sessionId);
      const instructionsPath = workSessionInstructionsPath(sessionId, this.rootOptions);
      try {
        const stat = await fs.lstat(instructionsPath);
        if (stat.isSymbolicLink()) {
          throw new Error("Instructions file cannot be a symbolic link");
        }
      } catch (err: any) {
        if (err && err.code === "ENOENT") {
          await fs.mkdir(path.dirname(instructionsPath), { recursive: true });
          try {
            await fs.writeFile(instructionsPath, "", {
              encoding: "utf8",
              mode: OWNER_ONLY_FILE_MODE,
              flag: "wx",
            });
          } catch (writeErr: any) {
            if (!writeErr || writeErr.code !== "EEXIST") {
              throw writeErr;
            }
          }
        } else {
          throw err;
        }
      }

      const opener = this.deps.openTextDocument ?? ((uri) => vscode.window.showTextDocument(uri, { preview: false }));
      await opener(vscode.Uri.file(instructionsPath));
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async copySessionInstructionsFilePath(elementOrId: unknown): Promise<void> {
    const sessionId = extractSessionId(elementOrId);
    if (!sessionId) return;
    try {
      await this.deps.service.getWorkSession(sessionId);
      const instructionsPath = workSessionInstructionsPath(sessionId, this.rootOptions);
      await vscode.env.clipboard.writeText(instructionsPath);
      void vscode.window.showInformationMessage("Instructions file path copied to clipboard.");
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async renameSession(elementOrId: unknown): Promise<void> {
    const sessionId = extractSessionId(elementOrId);
    if (!sessionId) return;
    try {
      const session = await this.deps.service.getWorkSession(sessionId);
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
        await this.deps.service.updateSessionDetails(sessionId, { title: newTitle.trim() });
      }
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async changeSessionType(elementOrId: unknown): Promise<void> {
    const sessionId = extractSessionId(elementOrId);
    if (!sessionId) return;
    try {
      const session = await this.deps.service.getWorkSession(sessionId);
      const selected = await runSelectSessionTypeQuickPick({
        createQuickPick: () => vscode.window.createQuickPick<SessionTypeQuickPickItem>(),
        currentTypeId: session.typeId,
        rootOptions: this.rootOptions,
      });
      if (selected?.typeId && selected.typeId !== session.typeId) {
        await this.deps.service.setSessionType(sessionId, selected.typeId);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }
}
