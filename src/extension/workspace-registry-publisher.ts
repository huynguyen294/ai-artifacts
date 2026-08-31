import * as vscode from "vscode";
import {
  WORKSPACE_REGISTRY_HEARTBEAT_MS,
  WORKSPACE_REGISTRY_SCHEMA_VERSION,
  WORKSPACE_REGISTRY_TTL_MS,
  canonicalWorkspaceFolder,
  createWorkspaceInstanceId,
  publishWorkspaceSnapshot,
  removeWorkspaceSnapshot,
} from "../shared/workspace-registry";

export class WorkspaceRegistryPublisher implements vscode.Disposable {
  private readonly instanceId = createWorkspaceInstanceId();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly heartbeat: NodeJS.Timeout;
  private disposed = false;
  private publishing: Promise<void> = Promise.resolve();

  constructor() {
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeWindowState(() => this.refresh()),
    );
    this.heartbeat = setInterval(() => this.refresh(), WORKSPACE_REGISTRY_HEARTBEAT_MS);
    this.heartbeat.unref?.();
    this.refresh();
  }

  refresh(): void {
    if (this.disposed) return;
    this.publishing = this.publishing
      .catch(() => {})
      .then(async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const folders = await Promise.all(
          workspaceFolders.map((folder) => canonicalWorkspaceFolder(folder.uri.fsPath)),
        );
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        const activeWorkspaceFolder = activeUri?.scheme === "file"
          ? vscode.workspace.getWorkspaceFolder(activeUri)
          : undefined;
        const activeFolderIndex = activeWorkspaceFolder
          ? workspaceFolders.findIndex((folder) => folder.uri.toString() === activeWorkspaceFolder.uri.toString())
          : -1;
        const activeRoot = activeFolderIndex >= 0 ? folders[activeFolderIndex] : undefined;
        const now = Date.now();
        await publishWorkspaceSnapshot({
          schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION,
          instanceId: this.instanceId,
          processId: process.pid,
          workspaceFile: vscode.workspace.workspaceFile?.fsPath ?? null,
          focused: vscode.window.state.focused,
          folders,
          activeFile: activeUri?.scheme === "file" && activeRoot
            ? { path: activeUri.fsPath, workspaceRoot: activeRoot.realPath }
            : null,
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + WORKSPACE_REGISTRY_TTL_MS).toISOString(),
        });
      })
      .catch((error) => console.error("Publishing the Codex Artifacts workspace registry failed:", error));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.heartbeat);
    for (const subscription of this.subscriptions) subscription.dispose();
    void this.publishing.finally(() => removeWorkspaceSnapshot(this.instanceId).catch(() => {}));
  }
}
