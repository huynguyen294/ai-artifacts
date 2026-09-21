import * as vscode from "vscode";
import { ArtifactReviewProvider } from "./artifact-review-provider";
import { ArtifactReviewOpenCoordinator, setupGlobalArtifactConnectionWatcher } from "./artifact-review-open";
import { discoverSearchableArtifacts } from "./artifact-search";
import {
  runArtifactSearchCommand,
  type ArtifactQuickPickItem,
} from "./artifact-search-command";
import { ensureSafeGlobalArtifactsRoot } from "../shared/artifact-validation";
import {
  checkAllIntegrations,
  getMcpConfigSnippet,
  getReviewSkillMarkdown,
  installAllDetectedIntegrations,
  installClaudeIntegration,
  installCodexIntegration,
  installCopilotIntegration,
  installCursorIntegration,
  installWindsurfIntegration,
  uninstallAllDetectedIntegrations,
  uninstallClaudeIntegration,
  uninstallCodexIntegration,
  uninstallCopilotIntegration,
  uninstallCursorIntegration,
  uninstallWindsurfIntegration,
} from "./workspace-integration";
import { WorkspaceRegistryPublisher } from "./workspace-registry-publisher";
import { executeArtifactRetentionCleanup } from "./artifact-retention";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const provider = new ArtifactReviewProvider(context);
  const workspaceRegistryPublisher = new WorkspaceRegistryPublisher();
  const artifactReviewOpenCoordinator = new ArtifactReviewOpenCoordinator<vscode.Uri>({
    uriFromFilePath: (filePath) => vscode.Uri.file(filePath),
    openWith: async (artifactUri) => {
      await vscode.commands.executeCommand("vscode.openWith", artifactUri, ArtifactReviewProvider.viewType);
    },
  });

  context.subscriptions.push(
    workspaceRegistryPublisher,
    vscode.window.registerCustomEditorProvider(ArtifactReviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("agentPlus.openArtifactReview", async () => {
      const activeTextUri = vscode.window.activeTextEditor?.document.uri;
      const activeTabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      const activeCustomUri =
        activeTabInput instanceof vscode.TabInputCustom && activeTabInput.viewType === ArtifactReviewProvider.viewType
          ? activeTabInput.uri
          : undefined;
      const selected = activeTextUri?.fsPath.endsWith("artifact.md")
        ? activeTextUri
        : (activeCustomUri ??
          (
            await vscode.window.showOpenDialog({
              canSelectMany: false,
              defaultUri: vscode.Uri.file(await ensureSafeGlobalArtifactsRoot()),
              filters: { "AI Artifact": ["md"] },
              openLabel: "Open artifact review",
            })
          )?.[0]);
      if (selected) await artifactReviewOpenCoordinator.open(selected);
    }),
    vscode.commands.registerCommand("agentPlus.searchArtifact", async () => {
      await runArtifactSearchCommand({
        createQuickPick: () => vscode.window.createQuickPick<ArtifactQuickPickItem>(),
        discoverArtifacts: () => discoverSearchableArtifacts(),
        openArtifact: async (artifactPath) => {
          await artifactReviewOpenCoordinator.open(vscode.Uri.file(artifactPath));
        },
        showErrorMessage: (message) => {
          void vscode.window.showErrorMessage(message);
        },
      });
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
            "AI Artifacts base MCP server was set up in ~/.ai-artifacts/managed/runtime/. No additional external clients were detected.",
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

    // 8. Copy create-review-artifact Skill Markdown
    vscode.commands.registerCommand("agentPlus.copyReviewSkill", async () => {
      try {
        const skillMarkdown = await getReviewSkillMarkdown(context);
        await vscode.env.clipboard.writeText(skillMarkdown);
        void vscode.window.showInformationMessage(
          "AI Artifacts 'create-review-artifact' skill copied to clipboard! You can paste it into your agent's customization, rules, or system instructions.",
        );
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 9. Verify All Integrations
    vscode.commands.registerCommand("agentPlus.verifyGlobalIntegration", async () => {
      try {
        const report = await checkAllIntegrations(context);
        const skillStatus = report.skillCurrent ? "Ready" : "Outdated / Missing";
        const baseStatus = report.baseCurrent ? "Ready" : "Outdated / Missing";
        const clientSummaries = report.clients.map((c) => `${c.name}: ${c.status}${c.isDetected ? " (detected)" : ""}`);
        void vscode.window.showInformationMessage(
          `AI Artifacts Skill (.agents): ${skillStatus}. Base (.vscode): ${baseStatus}. Clients: [${clientSummaries.join("; ")}]`,
        );
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 10. Uninstall all detected integrations
    vscode.commands.registerCommand("agentPlus.uninstallAllIntegrations", async () => {
      try {
        const result = await uninstallAllDetectedIntegrations(context);
        const count = result.uninstalledClients.length;
        const msg =
          count > 0
            ? `AI Artifacts: Uninstalled integrations from ${result.uninstalledClients.join(", ")} and cleaned up base assets.`
            : "AI Artifacts: Cleaned up base assets. No configured client integrations found.";
        void vscode.window.showInformationMessage(msg);
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 11. Uninstall Copilot
    vscode.commands.registerCommand("agentPlus.uninstallCopilotIntegration", async () => {
      try {
        const removed = await uninstallCopilotIntegration(context);
        if (removed) {
          void vscode.window.showInformationMessage(
            "AI Artifacts MCP uninstalled for GitHub Copilot. Please restart VS Code or reload window to apply changes.",
          );
        } else {
          void vscode.window.showInformationMessage("AI Artifacts MCP was not found in GitHub Copilot configuration.");
        }
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 12. Uninstall Codex
    vscode.commands.registerCommand("agentPlus.uninstallCodexIntegration", async () => {
      try {
        const removed = await uninstallCodexIntegration();
        if (removed) {
          void vscode.window.showInformationMessage(
            "AI Artifacts MCP uninstalled for Codex (~/.codex/config.toml). Please restart Codex to apply changes.",
          );
        } else {
          void vscode.window.showInformationMessage("AI Artifacts MCP was not found in Codex configuration.");
        }
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 13. Uninstall Cursor
    vscode.commands.registerCommand("agentPlus.uninstallCursorIntegration", async () => {
      try {
        const removed = await uninstallCursorIntegration();
        if (removed) {
          void vscode.window.showInformationMessage(
            "AI Artifacts MCP uninstalled for Cursor (~/.cursor/mcp.json). Please restart Cursor to apply changes.",
          );
        } else {
          void vscode.window.showInformationMessage("AI Artifacts MCP was not found in Cursor configuration.");
        }
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 14. Uninstall Claude
    vscode.commands.registerCommand("agentPlus.uninstallClaudeIntegration", async () => {
      try {
        const removed = await uninstallClaudeIntegration();
        if (removed) {
          void vscode.window.showInformationMessage(
            "AI Artifacts MCP uninstalled for Claude (~/.claude.json). Please restart Claude to apply changes.",
          );
        } else {
          void vscode.window.showInformationMessage("AI Artifacts MCP was not found in Claude configuration.");
        }
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // 15. Uninstall Windsurf
    vscode.commands.registerCommand("agentPlus.uninstallWindsurfIntegration", async () => {
      try {
        const removed = await uninstallWindsurfIntegration();
        if (removed) {
          void vscode.window.showInformationMessage(
            "AI Artifacts MCP uninstalled for Windsurf (~/.codeium/windsurf/mcp_config.json). Please restart Windsurf to apply changes.",
          );
        } else {
          void vscode.window.showInformationMessage("AI Artifacts MCP was not found in Windsurf configuration.");
        }
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // Backward-compatible alias
    vscode.commands.registerCommand("agentPlus.installWorkspaceIntegration", async () => {
      await vscode.commands.executeCommand("agentPlus.installAllIntegrations");
    }),
  );

  try {
    const artifactConnectionWatcher = await setupGlobalArtifactConnectionWatcher<vscode.Uri, vscode.FileSystemWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot(),
      createWatcher: (collectionRoot, pattern) =>
        vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(collectionRoot), pattern),
          false,
          false,
          true,
        ),
      localWindowInstanceId: () => workspaceRegistryPublisher.currentInstanceId,
      isAutoOpenEnabled: () =>
        vscode.workspace.getConfiguration("agentPlus").get<boolean>("autoOpenArtifactReview", true),
      artifactUriFromConnection: (connectionUri) => vscode.Uri.joinPath(connectionUri, "..", "artifact.md"),
      openArtifactReview: async (artifactUri) => {
        await artifactReviewOpenCoordinator.open(artifactUri);
      },
      reportError: (error) => console.error("Targeted auto-opening artifact review failed:", error),
    });
    context.subscriptions.push(artifactConnectionWatcher);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Starting the global artifact watcher failed:", error);
    void vscode.window.showErrorMessage(`AI Artifacts could not watch global artifact storage: ${message}`);
  }

  // Best-effort asynchronous retention cleanup (does not block extension activation)
  const retentionDays = vscode.workspace
    .getConfiguration("agentPlus")
    .get<unknown>("artifactRetentionDays");
  void executeArtifactRetentionCleanup({ retentionDays }).catch((error) => {
    console.error("AI Artifacts retention cleanup failed:", error);
  });
}

export function deactivate(): void {}
