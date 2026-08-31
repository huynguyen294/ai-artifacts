import * as vscode from "vscode";
import { ArtifactReviewProvider } from "./artifact-review-provider";
import {
  checkGlobalIntegration,
  installGlobalIntegration,
} from "./workspace-integration-v4";
import type { IntegrationCheck } from "./global-integration-status";
import { WorkspaceRegistryPublisher } from "./workspace-registry-publisher";

async function showIntegrationStatus(status: IntegrationCheck): Promise<void> {
  if (status.status === "ready") {
    void vscode.window.showInformationMessage(
      "Codex Artifacts MCP and skill are installed and current.",
    );
    return;
  }
  if (status.status === "restart-required") {
    void vscode.window.showInformationMessage(
      "Codex Artifacts MCP and skill were installed. Restart the Codex extension, then start a new chat to load the integration.",
    );
    return;
  }
  if (status.status === "outdated") {
    void vscode.window.showWarningMessage(
      "Codex Artifacts global integration is older than this extension. Run Install Global Codex Integration, then restart Codex.",
    );
    return;
  }
  if (status.status === "configuration-conflict") {
    void vscode.window.showErrorMessage(
      status.detail ?? "Codex config.toml contains a conflicting codex_artifacts MCP definition.",
    );
    return;
  }
  void vscode.window.showWarningMessage(
    "Codex Artifacts MCP is not installed. Run Codex Artifacts: Install Global Codex Integration.",
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ArtifactReviewProvider(context);
  const workspaceRegistryPublisher = new WorkspaceRegistryPublisher();

  const artifactReadyWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.codex-artifacts/artifacts/**/comments.json",
    false,
    true,
    true,
  );
  artifactReadyWatcher.onDidCreate(async (commentsUri) => {
    const autoOpen = vscode.workspace.getConfiguration("agentPlus").get<boolean>("autoOpenArtifactReview", true);
    if (!autoOpen) return;

    const artifactUri = vscode.Uri.joinPath(commentsUri, "..", "artifact.md");
    try {
      await vscode.workspace.fs.stat(artifactUri);
      await vscode.commands.executeCommand("vscode.openWith", artifactUri, ArtifactReviewProvider.viewType);
    } catch (error) {
      console.error("Auto-opening artifact review failed:", error);
    }
  });

  context.subscriptions.push(
    artifactReadyWatcher,
    workspaceRegistryPublisher,
    vscode.window.registerCustomEditorProvider(ArtifactReviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("agentPlus.openArtifactReview", async () => {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      const selected = activeUri?.fsPath.endsWith("artifact.md")
        ? activeUri
        : (await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { "Codex artifact": ["md"] },
            openLabel: "Open artifact review",
          }))?.[0];
      if (selected) await vscode.commands.executeCommand("vscode.openWith", selected, ArtifactReviewProvider.viewType);
    }),
    vscode.commands.registerCommand("agentPlus.installWorkspaceIntegration", async () => {
      try {
        await showIntegrationStatus(await installGlobalIntegration(context));
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),
    vscode.commands.registerCommand("agentPlus.verifyGlobalIntegration", async () => {
      try {
        await showIntegrationStatus(await checkGlobalIntegration(context));
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),
  );
}

export function deactivate(): void {}
