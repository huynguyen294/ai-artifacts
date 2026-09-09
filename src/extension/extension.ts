import * as vscode from "vscode";
import { ArtifactReviewProvider } from "./artifact-review-provider";
import {
  checkAllIntegrations,
  getMcpConfigSnippet,
  installAllDetectedIntegrations,
  installClaudeIntegration,
  installCodexIntegration,
  installCopilotIntegration,
  installCursorIntegration,
  installWindsurfIntegration,
} from "./workspace-integration-v4";
import { WorkspaceRegistryPublisher } from "./workspace-registry-publisher";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ArtifactReviewProvider(context);
  const workspaceRegistryPublisher = new WorkspaceRegistryPublisher();

  const artifactReadyWatcher = vscode.workspace.createFileSystemWatcher(
    "**/{.ai-artifacts,.codex-artifacts}/artifacts/**/comments.json",
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
            filters: { "AI Artifact": ["md"] },
            openLabel: "Open artifact review",
          }))?.[0];
      if (selected) await vscode.commands.executeCommand("vscode.openWith", selected, ArtifactReviewProvider.viewType);
    }),

    // 1. All Detected
    vscode.commands.registerCommand("agentPlus.installAllIntegrations", async () => {
      try {
        const result = await installAllDetectedIntegrations(context);
        if (result.installedClients.length > 0) {
          void vscode.window.showInformationMessage(
            `AI Artifacts MCP installed for detected clients: ${result.installedClients.join(", ")}. Please restart your AI client(s) to activate.`,
          );
        } else {
          void vscode.window.showInformationMessage(
            "AI Artifacts base MCP server was set up in ~/.vscode/ai-artifacts/. No additional external clients were detected.",
          );
        }
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 2. Copilot (base setup + Code/User/mcp.json)
    vscode.commands.registerCommand("agentPlus.installCopilotIntegration", async () => {
      try {
        const result = await installCopilotIntegration(context);
        void vscode.window.showInformationMessage(
          `AI Artifacts MCP installed for GitHub Copilot in VS Code User configuration (${result.userConfigPath}).`,
        );
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 3. Codex
    vscode.commands.registerCommand("agentPlus.installCodexIntegration", async () => {
      try {
        await installCodexIntegration(context);
        void vscode.window.showInformationMessage(
          "AI Artifacts MCP installed for Codex (~/.codex/config.toml). Please restart Codex to activate.",
        );
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 4. Cursor
    vscode.commands.registerCommand("agentPlus.installCursorIntegration", async () => {
      try {
        await installCursorIntegration(context);
        void vscode.window.showInformationMessage(
          "AI Artifacts MCP installed for Cursor (~/.cursor/mcp.json). Please restart Cursor to activate.",
        );
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 5. Claude
    vscode.commands.registerCommand("agentPlus.installClaudeIntegration", async () => {
      try {
        await installClaudeIntegration(context);
        void vscode.window.showInformationMessage(
          "AI Artifacts MCP installed for Claude (~/.claude.json). Please restart Claude to activate.",
        );
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 6. Windsurf
    vscode.commands.registerCommand("agentPlus.installWindsurfIntegration", async () => {
      try {
        await installWindsurfIntegration(context);
        void vscode.window.showInformationMessage(
          "AI Artifacts MCP installed for Windsurf (~/.codeium/windsurf/mcp_config.json). Please restart Windsurf to activate.",
        );
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 7. Copy MCP Configuration JSON
    vscode.commands.registerCommand("agentPlus.copyMcpConfig", async () => {
      try {
        const snippet = getMcpConfigSnippet(context);
        await vscode.env.clipboard.writeText(snippet);
        void vscode.window.showInformationMessage(
          "AI Artifacts MCP configuration copied to clipboard! You can paste it into any MCP client config.",
        );
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 8. Verify All Integrations
    vscode.commands.registerCommand("agentPlus.verifyGlobalIntegration", async () => {
      try {
        const report = await checkAllIntegrations(context);
        const baseStatus = report.baseCurrent ? "Ready" : "Outdated / Missing";
        const clientSummaries = report.clients.map((c) => `${c.name}: ${c.status}${c.isDetected ? " (detected)" : ""}`);
        void vscode.window.showInformationMessage(
          `AI Artifacts Base (.vscode): ${baseStatus}. Clients: [${clientSummaries.join("; ")}]`,
        );
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // Backward-compatible alias
    vscode.commands.registerCommand("agentPlus.installWorkspaceIntegration", async () => {
      await vscode.commands.executeCommand("agentPlus.installAllIntegrations");
    }),
  );
}

export function deactivate(): void {}
