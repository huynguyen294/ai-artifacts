import * as vscode from "vscode";
import { CodexAppServerClient } from "./app-server-client";
import { PlanReviewProvider } from "./plan-review-provider";
import {
  checkGlobalIntegration,
  installGlobalIntegration,
} from "./workspace-integration";
import type { IntegrationCheck } from "./global-integration-status";

function integrationCwds(): string[] {
  const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  return workspaceRoots.length > 0 ? workspaceRoots : [process.cwd()];
}

async function showIntegrationStatus(status: IntegrationCheck, codexCommand: string): Promise<void> {
  if (status.status === "trusted") {
    void vscode.window.showInformationMessage(
      "Codex Artifacts hook and review MCP are installed. Restart the Codex extension, then start a new chat before creating a plan artifact.",
    );
    return;
  }
  if (status.status === "outdated") {
    void vscode.window.showWarningMessage(
      "Codex Artifacts global integration is older than this extension. Run Install Global Codex Integration, trust the updated hook if prompted, restart the Codex extension, and start a new chat.",
    );
    return;
  }
  if (status.status === "untrusted") {
    const choice = await vscode.window.showWarningMessage(
      "Codex Artifacts is installed globally, but Codex will skip its hook until you trust it. Open Codex, run /hooks, and trust Codex Artifacts; then run Verify Codex Integration.",
      "Open Codex terminal",
    );
    if (choice === "Open Codex terminal") {
      const terminalCwd = integrationCwds()[0] ?? process.cwd();
      const terminal = vscode.window.createTerminal({ name: "Codex Artifacts setup", cwd: terminalCwd });
      terminal.show();
      terminal.sendText(codexCommand, true);
      void vscode.window.showInformationMessage("In the Codex terminal, run /hooks and trust the Codex Artifacts hook.");
    }
    return;
  }
  const message = status.status === "disabled"
    ? "The Codex Artifacts hook is disabled. Open Codex, run /hooks, and enable it."
    : status.status === "missing"
      ? "Codex could not discover the global Codex Artifacts hook. Run the install command again and inspect Codex /hooks."
      : "Codex Artifacts was installed, but its trust status could not be verified. Inspect Codex /hooks before creating artifacts.";
  void vscode.window.showWarningMessage(message);
}

export function activate(context: vscode.ExtensionContext): void {
  const codexCommand = vscode.workspace.getConfiguration("agentPlus").get<string>("codexCommand", "codex");
  const extensionVersion = String(context.extension.packageJSON.version ?? "0.3.0");
  const appServer = new CodexAppServerClient(codexCommand, extensionVersion);
  const provider = new PlanReviewProvider(context);

  const artifactReadyWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.codex-artifacts/plans/**/comments.json",
    false,
    true,
    true,
  );
  artifactReadyWatcher.onDidCreate(async (commentsUri) => {
    const autoOpen = vscode.workspace.getConfiguration("agentPlus").get<boolean>("autoOpenPlanReview", true);
    if (!autoOpen) return;

    const planUri = vscode.Uri.joinPath(commentsUri, "..", "plan.md");
    try {
      await vscode.workspace.fs.stat(planUri);
      await vscode.commands.executeCommand("vscode.openWith", planUri, PlanReviewProvider.viewType);
    } catch (error) {
      console.error("Auto-opening plan review failed:", error);
    }
  });

  context.subscriptions.push(
    artifactReadyWatcher,
    vscode.window.registerCustomEditorProvider(PlanReviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("agentPlus.openPlanReview", async () => {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      const selected = activeUri?.fsPath.endsWith("plan.md")
        ? activeUri
        : (await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { "Codex plan": ["md"] },
            openLabel: "Open plan review",
          }))?.[0];
      if (selected) await vscode.commands.executeCommand("vscode.openWith", selected, PlanReviewProvider.viewType);
    }),
    vscode.commands.registerCommand("agentPlus.installWorkspaceIntegration", async () => {
      try {
        await showIntegrationStatus(await installGlobalIntegration(context, appServer), codexCommand);
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),
    vscode.commands.registerCommand("agentPlus.verifyGlobalIntegration", async () => {
      try {
        await showIntegrationStatus(
          await checkGlobalIntegration(context, appServer, integrationCwds()),
          codexCommand,
        );
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),
    { dispose: () => appServer.dispose() },
  );
}

export function deactivate(): void {}
