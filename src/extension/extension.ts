import path from "node:path";
import * as vscode from "vscode";
import { ArtifactReviewProvider } from "./artifact-review-provider";
import { ArtifactReviewOpenCoordinator, setupGlobalArtifactConnectionWatcher } from "./artifact-review-open";
import { discoverSearchableArtifacts } from "./artifact-search";
import {
  aiArtifactsRoot,
  artifactDirectory,
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  ARTIFACT_UI_STATE_FILE,
  CONVERSATION_METADATA_FILE,
  conversationDirectory,
  SESSION_TYPES_FILE,
} from "../shared/artifact-files";
import {
  RecentArtifactsTreeDataProvider,
  WorkSessionsTreeDataProvider,
} from "./work-session-sidebar";
import { WorkSessionProvider } from "./work-session-provider";
import {
  runManageSessionTypesCommand,
  type SessionTypeQuickPickItem,
} from "./session-type-command";
import { runSessionFilterCommand } from "./session-filter-command";
import { runSessionSearchCommand } from "./session-search-command";
import { runCreateSessionCommand } from "./session-create-command";
import {
  isArtifactKindFilter,
  runArtifactKindFilterCommand,
  type ArtifactKindFilterQuickPickItem,
} from "./artifact-kind-filter-command";
import { formatArtifactKindLabel } from "../shared/artifact-kinds";
import { listSessionTypes } from "../shared/session-type-registry";
import { resolveWorkSessionSupport } from "./work-session-support";
import {
  runArtifactSearchCommand,
  type ArtifactQuickPickItem,
} from "./artifact-search-command";
import {
  runIntegrationInstallCommand,
  type InstallerClientQuickPickItem,
} from "./integration-install-command";
import {
  runIntegrationUninstallCommand,
  type UninstallClientQuickPickItem,
} from "./integration-uninstall-command";
import { runBulkMigration } from "./session-migration-command";
import { migrateConversationToSession } from "../shared/conversation-artifact-registry";
import { ensureSafeGlobalArtifactsRoot } from "../shared/artifact-validation";
import {
  checkAllIntegrations,
  getMcpConfigSnippet,
  getReviewSkillMarkdown,
  installAllDetectedIntegrations,
  installAntigravityIntegration,
  installClaudeIntegration,
  installCodexIntegration,
  installCopilotIntegration,
  installCursorIntegration,
  installSelectedIntegrations,
  installWindsurfIntegration,
  installClineIntegration,
  listInstallableClients,
  listInstallerClients,
  readInstalledIntegrationVersion,
  uninstallAllDetectedIntegrations,
  uninstallAntigravityIntegration,
  uninstallClaudeIntegration,
  uninstallCodexIntegration,
  uninstallCopilotIntegration,
  uninstallCursorIntegration,
  uninstallSelectedIntegrations,
  uninstallWindsurfIntegration,
  uninstallClineIntegration,
  upgradeDetectedIntegrations,
} from "./workspace-integration";
import { WorkspaceRegistryPublisher } from "./workspace-registry-publisher";
import { executeArtifactRetentionCleanup } from "./artifact-retention";
import { executeWorkSessionArchiveCleanup } from "./work-session-retention";
import {
  WorkSessionManagementCoordinator,
  extractSessionId,
  extractArtifactId,
} from "./work-session-management-command";
import { summarizeIntegrationVerification } from "./integration-verification";
import {
  INSTALLER_ONBOARDING_ACCEPTED_KEY,
  runIntegrationActivation,
} from "./integration-activation";
import {
  notifyInstallationError,
  notifyInstallationResult,
  type InstallationNotificationDeps,
} from "./install-notification";
import {
  INSTALLATION_GUIDE_URL,
  runAutomaticIntegrationUpgrade,
} from "./upgrade-notification";
import { artifactIdSchema } from "../shared/contracts";
import {
  ConversationArtifactService,
  setupConversationRegistryWatcher,
} from "./conversation-artifact-service";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
// Initialize extension services
  const workspaceRegistryPublisher = new WorkspaceRegistryPublisher();
  const artifactReviewOpenCoordinator = new ArtifactReviewOpenCoordinator<vscode.Uri>({
    uriFromFilePath: (filePath) => vscode.Uri.file(filePath),
    openWith: async (artifactUri, openOptions) => {
      if (openOptions?.preview !== undefined) {
        await vscode.commands.executeCommand(
          "vscode.openWith",
          artifactUri,
          ArtifactReviewProvider.viewType,
          { preview: openOptions.preview },
        );
      } else {
        await vscode.commands.executeCommand("vscode.openWith", artifactUri, ArtifactReviewProvider.viewType);
      }
    },
  });
  const conversationArtifactService = new ConversationArtifactService<vscode.Uri>({
    uriFromFilePath: (filePath) => vscode.Uri.file(filePath),
    openArtifactReview: (artifactUri, openOptions) =>
      artifactReviewOpenCoordinator.open(artifactUri, openOptions),
    reportError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
  });
  const provider = new ArtifactReviewProvider(context, conversationArtifactService);
  const workSessionProvider = new WorkSessionProvider(
    context,
    conversationArtifactService,
    artifactReviewOpenCoordinator,
  );
  const recentArtifactsProvider = new RecentArtifactsTreeDataProvider(conversationArtifactService);
  const workSessionsProvider = new WorkSessionsTreeDataProvider(
    conversationArtifactService,
    context,
  );

  const refreshViewsAndService = (): void => {
    workSessionsProvider.refresh();
    recentArtifactsProvider.refresh();
    conversationArtifactService.notifyChanged([{ kind: "support" }]);
  };

  const installNotificationDeps: InstallationNotificationDeps = {
    showInformationMessage: (message, ...actions) =>
      vscode.window.showInformationMessage(message, ...actions),
    showWarningMessage: (message, ...actions) =>
      vscode.window.showWarningMessage(message, ...actions),
    showErrorMessage: (message, ...actions) =>
      vscode.window.showErrorMessage(message, ...actions),
    reloadWindow: () => vscode.commands.executeCommand("workbench.action.reloadWindow"),
    reportDiagnostic: (message, error) => {
      console.error(`AI Artifacts installer: ${message}`, error);
    },
  };

  const refreshViewsSafelyForInstall = (contextLabel: string): void => {
    try {
      refreshViewsAndService();
    } catch (refreshError) {
      try {
        installNotificationDeps.reportDiagnostic(contextLabel, refreshError);
      } catch {
        // Diagnostics must never affect install notification flow.
      }
    }
  };

  const installAllDetectedIntegrationsAndNotify = async (): Promise<void> => {
    let result: {
      installedClients: string[];
      failedClients: Array<{ name: string; error: string }>;
    };
    try {
      result = await installAllDetectedIntegrations(context, { recordClientSelection: true });
    } catch (error) {
      await notifyInstallationError(installNotificationDeps, error);
      return;
    }

    if (result.installedClients.length > 0) {
      refreshViewsSafelyForInstall(
        "Could not refresh integration support after installing all detected clients.",
      );
    }

    await notifyInstallationResult(
      installNotificationDeps,
      result,
      "AI Artifacts: No supported AI clients were detected for installation.",
    );
  };

  const installSingleClientAndNotify = async (
    clientName: string,
    installOperation: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      await installOperation();
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      await notifyInstallationResult(installNotificationDeps, {
        installedClients: [],
        failedClients: [{ name: clientName, error: errorText }],
      });
      return;
    }

    refreshViewsSafelyForInstall(
      `Could not refresh integration support after installing ${clientName}.`,
    );

    await notifyInstallationResult(installNotificationDeps, {
      installedClients: [clientName],
      failedClients: [],
    });
  };

  const sessionsTreeView = vscode.window.createTreeView("agentPlus.sessions", {
    treeDataProvider: workSessionsProvider,
  });

  const recentArtifactsTreeView = vscode.window.createTreeView("agentPlus.recentArtifacts", {
    treeDataProvider: recentArtifactsProvider,
  });

  const updateSessionsFilterDescription = async (): Promise<void> => {
    const filterId = workSessionsProvider.getTypeFilter();
    if (!filterId) {
      sessionsTreeView.description = "";
      return;
    }
    try {
      const types = await listSessionTypes();
      const matched = types.find((t) => t.id === filterId);
      if (!matched) {
        workSessionsProvider.setTypeFilter(undefined);
        sessionsTreeView.description = "";
      } else {
        sessionsTreeView.description = `Type: ${matched.label}`;
      }
    } catch {
      sessionsTreeView.description = "";
    }
  };

  const updateRecentFilterDescription = (): void => {
    const filterKind = recentArtifactsProvider.getKindFilter();
    if (!filterKind) {
      recentArtifactsTreeView.description = "";
      return;
    }
    if (filterKind === "other") {
      recentArtifactsTreeView.description = "Type: Other";
    } else {
      recentArtifactsTreeView.description = `Type: ${formatArtifactKindLabel(filterKind)}`;
    }
  };

  const managementCoordinator = new WorkSessionManagementCoordinator({
    service: conversationArtifactService,
  });

  context.subscriptions.push(
    workspaceRegistryPublisher,
    conversationArtifactService,
    recentArtifactsProvider,
    workSessionsProvider,
    sessionsTreeView,
    recentArtifactsTreeView,
    workSessionsProvider.onDidChangeTreeData(() => {
      void updateSessionsFilterDescription();
    }),
    recentArtifactsProvider.onDidChangeTreeData(() => {
      updateRecentFilterDescription();
    }),
    vscode.window.registerCustomEditorProvider(ArtifactReviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.window.registerCustomEditorProvider(WorkSessionProvider.viewType, workSessionProvider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("agentPlus.pinArtifact", async (el) => {
      await managementCoordinator.pinArtifact(el);
    }),
    vscode.commands.registerCommand("agentPlus.unpinArtifact", async (el) => {
      await managementCoordinator.unpinArtifact(el);
    }),
    vscode.commands.registerCommand("agentPlus.archiveArtifact", async (el) => {
      await managementCoordinator.archiveArtifact(el);
    }),
    vscode.commands.registerCommand("agentPlus.restoreArtifact", async (el) => {
      await managementCoordinator.restoreArtifact(el);
    }),
    vscode.commands.registerCommand("agentPlus.deleteArtifactPermanently", async (el) => {
      await managementCoordinator.deleteArtifactPermanently(el);
    }),
    vscode.commands.registerCommand("agentPlus.copyArtifactConnectPromptFromTree", async (el) => {
      await managementCoordinator.copyArtifactConnectPrompt(el);
    }),
    vscode.commands.registerCommand("agentPlus.pinSession", async (el) => {
      await managementCoordinator.pinSession(el);
    }),
    vscode.commands.registerCommand("agentPlus.unpinSession", async (el) => {
      await managementCoordinator.unpinSession(el);
    }),
    vscode.commands.registerCommand("agentPlus.archiveSession", async (el) => {
      await managementCoordinator.archiveSession(el);
    }),
    vscode.commands.registerCommand("agentPlus.restoreSession", async (el) => {
      await managementCoordinator.restoreSession(el);
    }),
    vscode.commands.registerCommand("agentPlus.deleteSessionPermanently", async (el) => {
      await managementCoordinator.deleteSessionPermanently(el);
    }),
    vscode.commands.registerCommand("agentPlus.copySessionConnectPromptFromTree", async (el) => {
      await managementCoordinator.copySessionConnectPrompt(el);
    }),
    vscode.commands.registerCommand("agentPlus.openSessionInstructionsFileFromTree", async (el) => {
      await managementCoordinator.openSessionInstructionsFile(el);
    }),
    vscode.commands.registerCommand("agentPlus.copySessionInstructionsFilePathFromTree", async (el) => {
      await managementCoordinator.copySessionInstructionsFilePath(el);
    }),
    vscode.commands.registerCommand("agentPlus.renameSessionFromTree", async (el) => {
      await managementCoordinator.renameSession(el);
    }),
    vscode.commands.registerCommand("agentPlus.changeSessionTypeFromTree", async (el) => {
      await managementCoordinator.changeSessionType(el);
    }),
    vscode.commands.registerCommand("agentPlus.createSession", async () => {
      await runCreateSessionCommand({
        service: conversationArtifactService,
        context,
      });
    }),
    vscode.commands.registerCommand("agentPlus.openWorkSession", async (sessionIdCandidate?: unknown) => {
      try {
        let sessionId = extractSessionId(sessionIdCandidate);
        if (!sessionId) {
          const sessions = await conversationArtifactService.listWorkSessions();
          if (sessions.length === 0) {
            void vscode.window.showInformationMessage("No sessions found.");
            return;
          }
          const selected = await vscode.window.showQuickPick(
            sessions.map((s) => ({ label: s.title, description: s.sessionId })),
            { title: "Select Session to Open" },
          );
          if (!selected) return;
          sessionId = selected.description;
        }

        const session = await conversationArtifactService.getWorkSession(sessionId);
        const sessionDir = conversationDirectory(session.sessionId);
        const metadataUri = vscode.Uri.file(path.join(sessionDir, CONVERSATION_METADATA_FILE));
        await vscode.commands.executeCommand("vscode.openWith", metadataUri, WorkSessionProvider.viewType);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to open session: ${msg}`);
      }
    }),
    vscode.commands.registerCommand("agentPlus.manageSessionTypes", async () => {
      await runManageSessionTypesCommand({
        createQuickPick: () => vscode.window.createQuickPick<SessionTypeQuickPickItem>(),
        showInputBox: (options) => vscode.window.showInputBox(options),
        showWarningMessage: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
        showErrorMessage: (message) => vscode.window.showErrorMessage(message),
        onDidUpdate: () => {
          workSessionsProvider.refresh();
          conversationArtifactService.notifyChanged([{ kind: "types" }]);
        },
      });
    }),
    vscode.commands.registerCommand("agentPlus.filterSessions", async () => {
      const support = await resolveWorkSessionSupport({}, context);
      if (!support.supported) {
        void vscode.window.showWarningMessage(
          support.reason ?? "Filtering sessions requires MCP server version 12 or higher.",
        );
        return;
      }
      await runSessionFilterCommand({
        createQuickPick: () => vscode.window.createQuickPick(),
        currentTypeId: workSessionsProvider.getTypeFilter(),
        onFilterChanged: (selectedTypeId) => {
          workSessionsProvider.setTypeFilter(selectedTypeId);
          void updateSessionsFilterDescription();
        },
      });
    }),
    vscode.commands.registerCommand("agentPlus.searchSessions", async () => {
      const support = await resolveWorkSessionSupport({}, context);
      if (!support.supported) {
        void vscode.window.showWarningMessage(
          support.reason ?? "Searching sessions requires MCP server version 12 or higher.",
        );
        return;
      }
      await runSessionSearchCommand({
        createQuickPick: () => vscode.window.createQuickPick(),
        listSessions: () => conversationArtifactService.listWorkSessions(),
        listTypes: () => listSessionTypes(),
        openSession: async (sessionId) => {
          await vscode.commands.executeCommand("agentPlus.openWorkSession", sessionId);
        },
      });
    }),
    vscode.commands.registerCommand("agentPlus.openArtifact", async (resource?: unknown) => {
      let uri: vscode.Uri | undefined;
      if (resource instanceof vscode.Uri) {
        uri = resource;
      } else if (resource && typeof resource === "object") {
        if ("resourceUri" in resource && (resource as any).resourceUri instanceof vscode.Uri) {
          uri = (resource as any).resourceUri;
        } else if ("artifact" in resource && typeof (resource as any).artifact?.artifactPath === "string") {
          uri = vscode.Uri.file((resource as any).artifact.artifactPath);
        } else {
          const artifactId = extractArtifactId(resource);
          if (artifactId) {
            const artDir = artifactDirectory(artifactId);
            uri = vscode.Uri.file(path.join(artDir, ARTIFACT_MARKDOWN_FILE));
          }
        }
      }
      if (uri) {
        await vscode.commands.executeCommand("agentPlus.openArtifactReview", uri);
      }
    }),
    vscode.commands.registerCommand("agentPlus.reinstallIntegration", async () => {
      await vscode.commands.executeCommand("agentPlus.installAllIntegrations");
    }),
    vscode.commands.registerCommand("agentPlus.migrateConversations", async () => {
      await runBulkMigration({
        listCandidates: () => conversationArtifactService.listCandidates(),
        migrateCandidate: (sessionId) => migrateConversationToSession(sessionId),
        showWarningMessage: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
        showInformationMessage: (message) => vscode.window.showInformationMessage(message),
        withProgress: async (title, task) => {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title,
              cancellable: false,
            },
            (progress) => task((update) => progress.report(update)),
          );
        },
        onDidMigrate: () => {
          workSessionsProvider.refresh();
          conversationArtifactService.notifyChanged();
        },
      });
    }),
    vscode.commands.registerCommand("agentPlus.openArtifactReview", async (resource?: unknown) => {
      if (resource instanceof vscode.Uri) {
        await artifactReviewOpenCoordinator.open(resource);
        return;
      }
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
    vscode.commands.registerCommand("agentPlus.filterRecentArtifacts", async () => {
      await runArtifactKindFilterCommand({
        createQuickPick: () => vscode.window.createQuickPick<ArtifactKindFilterQuickPickItem>(),
        currentKindFilter: recentArtifactsProvider.getKindFilter(),
        onFilterChanged: (selectedKind) => {
          recentArtifactsProvider.setKindFilter(selectedKind);
        },
      });
    }),
    vscode.commands.registerCommand("agentPlus.searchArtifact", async (options?: { kindFilter?: string }) => {
      await runArtifactSearchCommand(
        {
          createQuickPick: () => vscode.window.createQuickPick<ArtifactQuickPickItem>(),
          discoverArtifacts: () => discoverSearchableArtifacts(),
          openArtifact: async (artifactPath) => {
            await artifactReviewOpenCoordinator.open(vscode.Uri.file(artifactPath));
          },
          showErrorMessage: (message) => {
            void vscode.window.showErrorMessage(message);
          },
        },
        typeof options === "object" && options !== null && isArtifactKindFilter(options.kindFilter)
          ? { kindFilter: options.kindFilter }
          : undefined,
      );
    }),

    // Interactive multi-client installer
    vscode.commands.registerCommand("agentPlus.installer", async () => {
      await runIntegrationInstallCommand({
        ...installNotificationDeps,
        createQuickPick: () => vscode.window.createQuickPick<InstallerClientQuickPickItem>(),
        listClients: () => listInstallableClients(context),
        installClients: (clientIds) =>
          installSelectedIntegrations(context, clientIds, { recordClientSelection: true }),
        withProgress: (title, task) =>
          Promise.resolve(
            vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: false,
              },
              () => task(),
            ),
          ),
        onDidInstall: refreshViewsAndService,
      });
    }),

    // 1. All Detected
    vscode.commands.registerCommand(
      "agentPlus.installAllIntegrations",
      installAllDetectedIntegrationsAndNotify,
    ),

    // 2. Copilot (base setup + Code/User/mcp.json)
    vscode.commands.registerCommand("agentPlus.installCopilotIntegration", async () => {
      await installSingleClientAndNotify("GitHub Copilot (VS Code)", () =>
        installCopilotIntegration(context, { recordClientSelection: true }),
      );
    }),

    // 3. Codex
    vscode.commands.registerCommand("agentPlus.installCodexIntegration", async () => {
      await installSingleClientAndNotify("Codex", () =>
        installCodexIntegration(context, { recordClientSelection: true }),
      );
    }),

    // 4. Cursor
    vscode.commands.registerCommand("agentPlus.installCursorIntegration", async () => {
      await installSingleClientAndNotify("Cursor", () =>
        installCursorIntegration(context, { recordClientSelection: true }),
      );
    }),

    // 5. Claude
    vscode.commands.registerCommand("agentPlus.installClaudeIntegration", async () => {
      await installSingleClientAndNotify("Claude", () =>
        installClaudeIntegration(context, { recordClientSelection: true }),
      );
    }),

    // 6. Windsurf
    vscode.commands.registerCommand("agentPlus.installWindsurfIntegration", async () => {
      await installSingleClientAndNotify("Windsurf", () =>
        installWindsurfIntegration(context, { recordClientSelection: true }),
      );
    }),

    // 7. Cline
    vscode.commands.registerCommand("agentPlus.installClineIntegration", async () => {
      await installSingleClientAndNotify("Cline", () =>
        installClineIntegration(context, { recordClientSelection: true }),
      );
    }),

    // Antigravity
    vscode.commands.registerCommand("agentPlus.installAntigravityIntegration", async () => {
      await installSingleClientAndNotify("Antigravity", () =>
        installAntigravityIntegration(context, { recordClientSelection: true }),
      );
    }),

    // 8. Copy MCP Configuration JSON
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
        const summary = summarizeIntegrationVerification(report);
        if (summary.severity === "warning") {
          void vscode.window.showWarningMessage(summary.message);
        } else {
          void vscode.window.showInformationMessage(summary.message);
        }
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // Interactive multi-client uninstall
    vscode.commands.registerCommand("agentPlus.uninstall", async () => {
      await runIntegrationUninstallCommand({
        createQuickPick: () => vscode.window.createQuickPick<UninstallClientQuickPickItem>(),
        listClients: () => listInstallerClients(context),
        uninstallClients: (clientIds) =>
          uninstallSelectedIntegrations(context, clientIds, {
            recordClientSelection: true,
            cleanupBase: true,
          }),
        withProgress: (title, task) =>
          Promise.resolve(
            vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: false,
              },
              () => task(),
            ),
          ),
        showInformationMessage: (message) => vscode.window.showInformationMessage(message),
        showWarningMessage: (message) => vscode.window.showWarningMessage(message),
        showErrorMessage: (message) => vscode.window.showErrorMessage(message),
        onDidUninstall: refreshViewsAndService,
      });
    }),

    // 10. Uninstall all detected integrations
    vscode.commands.registerCommand("agentPlus.uninstallAllIntegrations", async () => {
      try {
        const result = await uninstallAllDetectedIntegrations(context, { recordClientSelection: true });
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
        const removed = await uninstallCopilotIntegration(context, { recordClientSelection: true });
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
        const removed = await uninstallCodexIntegration({ recordClientSelection: true });
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
        const removed = await uninstallCursorIntegration({ recordClientSelection: true });
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
        const removed = await uninstallClaudeIntegration({ recordClientSelection: true });
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
        const removed = await uninstallWindsurfIntegration({ recordClientSelection: true });
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

    // 16. Uninstall Cline
    vscode.commands.registerCommand("agentPlus.uninstallClineIntegration", async () => {
      try {
        const removed = await uninstallClineIntegration(context, { recordClientSelection: true });
        if (removed) {
          void vscode.window.showInformationMessage(
            "AI Artifacts MCP uninstalled for Cline (cline_mcp_settings.json). Please reload Cline or window to apply changes.",
          );
        } else {
          void vscode.window.showInformationMessage("AI Artifacts MCP was not found in Cline configuration.");
        }
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),

    // Uninstall Antigravity
    vscode.commands.registerCommand("agentPlus.uninstallAntigravityIntegration", async () => {
      try {
        const removed = await uninstallAntigravityIntegration({ recordClientSelection: true });
        if (removed) {
          void vscode.window.showInformationMessage(
            "AI Artifacts MCP and skills uninstalled for Antigravity (~/.gemini/config/mcp_config.json). Please restart Antigravity to apply changes.",
          );
        } else {
          void vscode.window.showInformationMessage(
            "AI Artifacts integration was not found in Antigravity configuration.",
          );
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

  void runIntegrationActivation({
    getInstalledIntegrationVersion: () => readInstalledIntegrationVersion(),
    isOnboardingAccepted: () =>
      context.globalState.get<boolean>(INSTALLER_ONBOARDING_ACCEPTED_KEY, false),
    acceptOnboarding: () =>
      context.globalState.update(INSTALLER_ONBOARDING_ACCEPTED_KEY, true),
    runInstaller: () => vscode.commands.executeCommand("agentPlus.installer"),
    runUpgrade: (installedVersion) =>
      runAutomaticIntegrationUpgrade({
        upgradeIntegrations: () => upgradeDetectedIntegrations(context, installedVersion),
        refreshIntegrationSupport: refreshViewsAndService,
        showErrorMessage: (message, ...actions) =>
          vscode.window.showErrorMessage(message, ...actions),
        openInstallationGuide: () =>
          vscode.env.openExternal(vscode.Uri.parse(INSTALLATION_GUIDE_URL)),
        reportDiagnostic: (message, error) => {
          console.error(`AI Artifacts automatic integration upgrade: ${message}`, error);
        },
      }),
    showInformationMessage: (message, ...actions) =>
      vscode.window.showInformationMessage(message, ...actions),
    showErrorMessage: (message, ...actions) =>
      vscode.window.showErrorMessage(message, ...actions),
    reportDiagnostic: (message, error) => {
      console.error(`AI Artifacts integration activation: ${message}`, error);
    },
  });

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

  try {
    const conversationWatcher = await setupConversationRegistryWatcher<vscode.Uri, vscode.FileSystemWatcher>({
      service: conversationArtifactService,
      createWatcher: (registryRoot, pattern) =>
        vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(registryRoot), pattern),
          false,
          false,
          false,
        ),
    });
    context.subscriptions.push(conversationWatcher);
  } catch (error) {
    console.error("Starting the conversation registry watcher failed:", error);
  }

  try {
    const globalRoot = await ensureSafeGlobalArtifactsRoot();
    const manifestWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(globalRoot),
        `*/{${ARTIFACT_MANIFEST_FILE},${ARTIFACT_UI_STATE_FILE}}`,
      ),
      false,
      false,
      false,
    );
    const onManifestChange = (uri: vscode.Uri) => {
      recentArtifactsProvider.refresh();
      const artifactId = path.basename(path.dirname(uri.fsPath));
      if (artifactIdSchema.safeParse(artifactId).success) {
        if (uri.fsPath.endsWith(ARTIFACT_UI_STATE_FILE)) {
          conversationArtifactService.notifyChanged([{ kind: "artifactUiState", artifactId }]);
        } else {
          conversationArtifactService.notifyChanged([{ kind: "artifact", artifactId }]);
        }
      } else {
        conversationArtifactService.notifyChanged();
      }
    };
    manifestWatcher.onDidCreate(onManifestChange);
    manifestWatcher.onDidChange(onManifestChange);
    manifestWatcher.onDidDelete(onManifestChange);
    context.subscriptions.push(manifestWatcher);
  } catch (error) {
    console.error("Starting manifest watcher failed:", error);
  }

  try {
    const productRoot = aiArtifactsRoot();
    const sessionTypesWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(productRoot), SESSION_TYPES_FILE),
      false,
      false,
      false,
    );
    const onTypesChange = () => {
      workSessionsProvider.refresh();
      conversationArtifactService.notifyChanged([{ kind: "types" }]);
    };
    sessionTypesWatcher.onDidCreate(onTypesChange);
    sessionTypesWatcher.onDidChange(onTypesChange);
    sessionTypesWatcher.onDidDelete(onTypesChange);
    context.subscriptions.push(sessionTypesWatcher);
  } catch (error) {
    console.error("Starting session types watcher failed:", error);
  }

  // Best-effort asynchronous retention cleanup (does not block extension activation)
  const retentionDays = vscode.workspace
    .getConfiguration("agentPlus")
    .get<unknown>("artifactRetentionDays");
  void executeArtifactRetentionCleanup({ retentionDays })
    .then(() => executeWorkSessionArchiveCleanup())
    .catch((error) => {
      console.error("AI Artifacts retention cleanup failed:", error);
    });
}

export function deactivate(): void {}
