import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
  MCP_VERSION,
  WORK_SESSION_SKILL_VERSION,
} from "../src/shared/contracts";
import { RELOAD_WINDOW_ACTION } from "../src/extension/install-notification";
import {
  INSTALLER_ONBOARDING_ACCEPTED_KEY,
  type IntegrationActivationDeps,
} from "../src/extension/integration-activation";
import type { AutomaticIntegrationUpgradeDeps } from "../src/extension/upgrade-notification";
import { INSTALLATION_GUIDE_URL } from "../src/extension/upgrade-notification";
import type { ExistingInstalledIntegrationVersionReadResult } from "../src/extension/workspace-integration";

const {
  registeredCommands,
  mockExecuteCommand,
  mockOpenExternal,
  mockShowInformationMessage,
  mockShowWarningMessage,
  mockShowErrorMessage,
  mockCreateQuickPick,
  mockWithProgress,
  mockClipboardWriteText,
  mockRunIntegrationActivation,
  mockRunAutomaticIntegrationUpgrade,
  sidebarSpies,
  conversationServiceSpies,
  workspaceIntegrationSpies,
  whatsNewSpies,
} = vi.hoisted(() => {
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  return {
    registeredCommands: commands,
    mockExecuteCommand: vi.fn(async (id: string, ...args: unknown[]) => {
      const handler = commands.get(id);
      if (handler) return handler(...args);
      return undefined;
    }),
    mockOpenExternal: vi.fn(async () => true),
    mockShowInformationMessage: vi.fn(async (_message: string, ..._items: unknown[]) => undefined as string | undefined),
    mockShowWarningMessage: vi.fn(async (_message: string, ..._items: unknown[]) => undefined as string | undefined),
    mockShowErrorMessage: vi.fn(async (_message: string, ..._items: unknown[]) => undefined as string | undefined),
    mockCreateQuickPick: vi.fn(),
    mockWithProgress: vi.fn(async (_opts: unknown, task: () => Promise<unknown>) => task()),
    mockClipboardWriteText: vi.fn(async () => undefined),
    mockRunIntegrationActivation: vi.fn(
      async (_deps: IntegrationActivationDeps): Promise<void> => undefined,
    ),
    mockRunAutomaticIntegrationUpgrade: vi.fn(
      async (_deps: AutomaticIntegrationUpgradeDeps): Promise<void> => undefined,
    ),
    sidebarSpies: {
      recentRefresh: vi.fn(),
      sessionsRefresh: vi.fn(),
    },
    conversationServiceSpies: {
      notifyChanged: vi.fn(),
    },
    workspaceIntegrationSpies: {
      installAllDetectedIntegrations: vi.fn(async () => ({
        installedClients: ["Codex"],
        failedClients: [] as Array<{ id: string; name: string; error: string }>,
      })),
      installCopilotIntegration: vi.fn(async () => ({ userConfigPath: "/tmp/mcp.json" })),
      installCodexIntegration: vi.fn(async () => undefined),
      installCursorIntegration: vi.fn(async () => undefined),
      installClaudeIntegration: vi.fn(async () => undefined),
      installWindsurfIntegration: vi.fn(async () => undefined),
      installClineIntegration: vi.fn(async () => undefined),
      installAntigravityIntegration: vi.fn(async () => undefined),
      installSelectedIntegrations: vi.fn(async () => ({
        installedClients: [{ id: "codex" as const, name: "Codex" }],
        failedClients: [],
      })),
      listInstallableClients: vi.fn(async () => ({
        clients: [
          {
            id: "codex" as const,
            name: "Codex",
            configPath: "/tmp/.codex/config.toml",
            isDetected: true,
            isSaved: false,
          },
        ],
      })),
      listInstallerClients: vi.fn(async () => ({
        skillCurrent: true,
        sessionSkillCurrent: true,
        baseCurrent: true,
        clients: [
          {
            id: "codex" as const,
            name: "Codex",
            configPath: "/tmp/.codex/config.toml",
            isDetected: true,
            isSaved: false,
            status: "missing" as const,
          },
        ],
      })),
      uninstallAllDetectedIntegrations: vi.fn(async () => ({ uninstalledClients: ["Codex"] })),
      uninstallCopilotIntegration: vi.fn(async () => true),
      uninstallCodexIntegration: vi.fn(async () => true),
      uninstallCursorIntegration: vi.fn(async () => true),
      uninstallClaudeIntegration: vi.fn(async () => true),
      uninstallWindsurfIntegration: vi.fn(async () => true),
      uninstallClineIntegration: vi.fn(async () => true),
      uninstallAntigravityIntegration: vi.fn(async () => true),
      uninstallSelectedIntegrations: vi.fn(async () => ({
        uninstalledClients: [{ id: "codex" as const, name: "Codex" }],
        notConfiguredClients: [],
        failedClients: [],
      })),
      checkAllIntegrations: vi.fn(async () => ({
        skillCurrent: true,
        sessionSkillCurrent: true,
        baseCurrent: true,
        clients: [],
      })),
      getMcpConfigSnippet: vi.fn(() => "{}"),
      getReviewSkillMarkdown: vi.fn(async () => "# Review"),
      readInstalledIntegrationVersion: vi.fn(async () => ({ status: "missing" as const })),
      upgradeDetectedIntegrations: vi.fn(async () => ({
        clientIds: ["codex" as const],
        skillTargets: ["agents" as const],
        updatedAssets: ["mcp" as const],
        clients: [{ id: "codex" as const, name: "Codex", status: "updated" as const }],
      })),
    },
    whatsNewSpies: {
      constructorSpy: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    },
  };
});

vi.mock("vscode", () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
    parse: (value: string) => ({ value }),
  },
  RelativePattern: class {
    constructor(readonly base: unknown, readonly pattern: string) {}
  },
  ProgressLocation: { Notification: 15 },
  ThemeIcon: class {
    constructor(readonly id: string) {}
  },
  TabInputCustom: class {
    constructor(readonly viewType: string, readonly uri: unknown) {}
  },
  env: {
    clipboard: { writeText: mockClipboardWriteText },
    openExternal: mockOpenExternal,
  },
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      registeredCommands.set(id, handler);
      return { dispose: () => {} };
    },
    executeCommand: mockExecuteCommand,
  },
  window: {
    registerCustomEditorProvider: () => ({ dispose: () => {} }),
    createTreeView: () => ({ description: "", dispose: () => {} }),
    showInformationMessage: mockShowInformationMessage,
    showWarningMessage: mockShowWarningMessage,
    showErrorMessage: mockShowErrorMessage,
    createQuickPick: mockCreateQuickPick,
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showOpenDialog: vi.fn(),
    withProgress: mockWithProgress,
  },
  workspace: {
    createFileSystemWatcher: () => ({
      onDidCreate: () => ({ dispose: () => {} }),
      onDidChange: () => ({ dispose: () => {} }),
      onDidDelete: () => ({ dispose: () => {} }),
      dispose: () => {},
    }),
    getConfiguration: () => ({ get: (_k: string, def?: unknown) => def }),
  },
}));

vi.mock("../src/extension/artifact-review-provider", () => ({
  ArtifactReviewProvider: Object.assign(class {}, { viewType: "agentPlus.artifactReview" }),
}));
vi.mock("../src/extension/work-session-provider", () => ({
  WorkSessionProvider: Object.assign(class {}, { viewType: "agentPlus.workSession" }),
}));
vi.mock("../src/extension/whats-new-panel", () => ({
  WhatsNewPanelController: class {
    constructor(extensionUri: unknown) {
      whatsNewSpies.constructorSpy(extensionUri);
    }
    show = whatsNewSpies.show;
    dispose = whatsNewSpies.dispose;
  },
}));
vi.mock("../src/extension/work-session-sidebar", () => ({
  RecentArtifactsTreeDataProvider: class {
    onDidChangeTreeData = () => ({ dispose: () => {} });
    refresh = sidebarSpies.recentRefresh;
    getKindFilter = () => undefined;
  },
  WorkSessionsTreeDataProvider: class {
    onDidChangeTreeData = () => ({ dispose: () => {} });
    refresh = sidebarSpies.sessionsRefresh;
    getTypeFilter = () => undefined;
    setTypeFilter = vi.fn();
  },
}));
vi.mock("../src/extension/workspace-registry-publisher", () => ({
  WorkspaceRegistryPublisher: class {
    currentInstanceId = "test-instance";
    dispose = () => {};
  },
}));
vi.mock("../src/extension/artifact-review-open", () => ({
  ArtifactReviewOpenCoordinator: class {
    open = vi.fn(async () => undefined);
  },
  setupGlobalArtifactConnectionWatcher: vi.fn(async () => ({ dispose: () => {} })),
}));
vi.mock("../src/extension/conversation-artifact-service", () => ({
  ConversationArtifactService: class {
    notifyChanged = conversationServiceSpies.notifyChanged;
    dispose = () => {};
  },
  setupConversationRegistryWatcher: vi.fn(async () => ({ dispose: () => {} })),
}));
vi.mock("../src/extension/artifact-retention", () => ({
  executeArtifactRetentionCleanup: vi.fn(async () => undefined),
}));
vi.mock("../src/extension/work-session-retention", () => ({
  executeWorkSessionArchiveCleanup: vi.fn(async () => undefined),
}));
vi.mock("../src/extension/work-session-management-command", () => ({
  WorkSessionManagementCoordinator: class {},
  extractSessionId: vi.fn(),
  extractArtifactId: vi.fn(),
}));
vi.mock("../src/extension/integration-activation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/extension/integration-activation")>();
  return {
    ...original,
    runIntegrationActivation: mockRunIntegrationActivation,
  };
});
vi.mock("../src/extension/upgrade-notification", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/extension/upgrade-notification")>();
  return {
    ...original,
    runAutomaticIntegrationUpgrade: mockRunAutomaticIntegrationUpgrade,
  };
});
vi.mock("../src/extension/workspace-integration", () => workspaceIntegrationSpies);

import { activate } from "../src/extension/extension";

describe("Extension activation wiring & manual command recording", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    registeredCommands.clear();
  });

  it("triggers activation controller non-blockingly regardless of legacy notification globalState and wires onboarding/upgrade callbacks", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-ext-act-"));
    try {
      vi.spyOn(os, "homedir").mockReturnValue(tempRoot);

      let releaseActivation!: () => void;
      const pendingActivation = new Promise<void>((resolve) => {
        releaseActivation = resolve;
      });
      mockRunIntegrationActivation.mockReturnValueOnce(pendingActivation);

      const globalStateGet = vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "upgradeNotification.lastNotifiedIntegrationState") {
          return {
            mcpVersion: MCP_VERSION,
            skillVersion: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
            sessionSkillVersion: WORK_SESSION_SKILL_VERSION,
            staleAssets: ["mcp", "skill:agents", "session-skill:agents"],
          };
        }
        return defaultValue;
      });
      const globalStateUpdate = vi.fn(async () => undefined);

      const context = {
        extensionUri: { fsPath: tempRoot },
        globalStorageUri: { fsPath: path.join(tempRoot, "storage") },
        globalState: { get: globalStateGet, update: globalStateUpdate },
        subscriptions: [] as Array<{ dispose: () => void }>,
      } as any;

      // activate(context) must resolve even while the activation controller promise is pending
      await activate(context);

      expect(mockRunIntegrationActivation).toHaveBeenCalledTimes(1);
      expect(mockRunAutomaticIntegrationUpgrade).not.toHaveBeenCalled();
      expect(registeredCommands.has("agentPlus.installer")).toBe(true);
      expect(globalStateGet).not.toHaveBeenCalledWith("upgradeNotification.lastNotifiedIntegrationState");
      expect(globalStateUpdate).not.toHaveBeenCalled();

      // Captured activation deps wire version read, onboarding state, and Installer execution cleanly
      const capturedActivationDeps = mockRunIntegrationActivation.mock.calls[0]![0];
      await capturedActivationDeps.getInstalledIntegrationVersion();
      expect(workspaceIntegrationSpies.readInstalledIntegrationVersion).toHaveBeenCalledTimes(1);

      expect(capturedActivationDeps.isOnboardingAccepted()).toBe(false);
      expect(globalStateGet).toHaveBeenCalledWith(INSTALLER_ONBOARDING_ACCEPTED_KEY, false);
      expect(globalStateUpdate).not.toHaveBeenCalled();

      await capturedActivationDeps.acceptOnboarding();
      expect(globalStateUpdate).toHaveBeenCalledWith(INSTALLER_ONBOARDING_ACCEPTED_KEY, true);

      mockExecuteCommand.mockClear();
      registeredCommands.set("agentPlus.installer", vi.fn(async () => "opened-installer"));
      await capturedActivationDeps.runInstaller();
      expect(mockExecuteCommand).toHaveBeenCalledWith("agentPlus.installer");

      await capturedActivationDeps.showInformationMessage("setup prompt", "Run Installer");
      expect(mockShowInformationMessage).toHaveBeenCalledWith("setup prompt", "Run Installer");
      await capturedActivationDeps.showErrorMessage("activation err");
      expect(mockShowErrorMessage).toHaveBeenCalledWith("activation err");

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const activationErr = new Error("activation diag");
      capturedActivationDeps.reportDiagnostic("act check", activationErr);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "AI Artifacts integration activation: act check",
        activationErr,
      );

      // Captured runUpgrade forwards the exact snapshot to upgradeDetectedIntegrations via upgrade controller
      const validSnapshot: ExistingInstalledIntegrationVersionReadResult = {
        status: "valid",
        manifest: {
          schemaVersion: 1,
          mcpVersion: MCP_VERSION - 1,
          skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
          sessionSkills: { agents: WORK_SESSION_SKILL_VERSION },
          updatedAt: "2026-11-11T00:00:00.000Z",
        },
      };
      await capturedActivationDeps.runUpgrade(validSnapshot);
      expect(mockRunAutomaticIntegrationUpgrade).toHaveBeenCalledTimes(1);

      const capturedUpgradeDeps = mockRunAutomaticIntegrationUpgrade.mock.calls[0]![0];
      expect("bundledVersions" in capturedUpgradeDeps).toBe(false);
      expect("getInstalledIntegrationVersion" in capturedUpgradeDeps).toBe(false);
      expect("showWarningMessage" in capturedUpgradeDeps).toBe(false);

      const report = await capturedUpgradeDeps.upgradeIntegrations();
      expect(workspaceIntegrationSpies.upgradeDetectedIntegrations).toHaveBeenCalledWith(
        context,
        validSnapshot,
      );
      expect(report.clientIds).toEqual(["codex"]);
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).not.toHaveBeenCalled();

      capturedUpgradeDeps.refreshIntegrationSupport();
      expect(sidebarSpies.sessionsRefresh).toHaveBeenCalledTimes(1);
      expect(sidebarSpies.recentRefresh).toHaveBeenCalledTimes(1);
      expect(conversationServiceSpies.notifyChanged).toHaveBeenCalledWith([{ kind: "support" }]);

      await capturedUpgradeDeps.showErrorMessage("err", "View Installation Guide");
      expect(mockShowErrorMessage).toHaveBeenCalledWith("err", "View Installation Guide");

      await capturedUpgradeDeps.openInstallationGuide();
      expect(mockOpenExternal).toHaveBeenCalledWith({ value: INSTALLATION_GUIDE_URL });

      const upgradeErr = new Error("diag detail");
      capturedUpgradeDeps.reportDiagnostic("failed check", upgradeErr);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "AI Artifacts automatic integration upgrade: failed check",
        upgradeErr,
      );

      releaseActivation();
      await pendingActivation;
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("passes recordClientSelection: true on all manual commands, unifies single/batch install notifications with Reload Window, keeps aliases single, and keeps Verify/Uninstall independent", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-ext-cmd-"));
    try {
      vi.spyOn(os, "homedir").mockReturnValue(tempRoot);
      const context = {
        extensionUri: { fsPath: tempRoot },
        globalStorageUri: { fsPath: path.join(tempRoot, "storage") },
        globalState: { get: vi.fn(), update: vi.fn(async () => undefined) },
        subscriptions: [] as Array<{ dispose: () => void }>,
      } as any;

      await activate(context);

      // Context-bearing Install All command
      await registeredCommands.get("agentPlus.installAllIntegrations")!();
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).toHaveBeenCalledWith(context, {
        recordClientSelection: true,
      });
      expect(workspaceIntegrationSpies.checkAllIntegrations).not.toHaveBeenCalled();
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        "AI Artifacts installed for Codex. Reload this window to apply changes. For AI clients running outside this window, restart the client and start a new chat.",
        RELOAD_WINDOW_ACTION,
      );

      // All 7 individual install commands use unified notifier (Info + Reload on success, Error with client name on reject)
      const installWithContextCommands: Array<[string, keyof typeof workspaceIntegrationSpies, string]> = [
        ["agentPlus.installCopilotIntegration", "installCopilotIntegration", "GitHub Copilot (VS Code)"],
        ["agentPlus.installCodexIntegration", "installCodexIntegration", "Codex"],
        ["agentPlus.installCursorIntegration", "installCursorIntegration", "Cursor"],
        ["agentPlus.installClaudeIntegration", "installClaudeIntegration", "Claude"],
        ["agentPlus.installWindsurfIntegration", "installWindsurfIntegration", "Windsurf"],
        ["agentPlus.installClineIntegration", "installClineIntegration", "Cline"],
        ["agentPlus.installAntigravityIntegration", "installAntigravityIntegration", "Antigravity"],
      ];
      for (const [cmdId, spyKey, clientName] of installWithContextCommands) {
        mockShowInformationMessage.mockClear();
        mockShowErrorMessage.mockClear();
        sidebarSpies.sessionsRefresh.mockClear();
        sidebarSpies.recentRefresh.mockClear();
        conversationServiceSpies.notifyChanged.mockClear();

        await registeredCommands.get(cmdId)!();
        expect(workspaceIntegrationSpies[spyKey]).toHaveBeenCalledWith(context, {
          recordClientSelection: true,
        });
        expect(mockShowInformationMessage).toHaveBeenCalledWith(
          `AI Artifacts installed for ${clientName}. Reload this window to apply changes. For AI clients running outside this window, restart the client and start a new chat.`,
          RELOAD_WINDOW_ACTION,
        );
        expect(sidebarSpies.sessionsRefresh).toHaveBeenCalledTimes(1);
        expect(sidebarSpies.recentRefresh).toHaveBeenCalledTimes(1);
        expect(conversationServiceSpies.notifyChanged).toHaveBeenCalledWith([{ kind: "support" }]);

        // Single command reject reports 1 Error with client name and no Reload
        mockShowInformationMessage.mockClear();
        (workspaceIntegrationSpies[spyKey] as any).mockRejectedValueOnce(new Error(`${clientName} boom`));
        await registeredCommands.get(cmdId)!();
        expect(mockShowInformationMessage).not.toHaveBeenCalled();
        expect(mockShowErrorMessage).toHaveBeenCalledWith(
          `AI Artifacts installation failed: ${clientName} (${clientName} boom)`,
        );
      }

      // Clicking Reload Window executes workbench.action.reloadWindow
      mockExecuteCommand.mockClear();
      mockShowInformationMessage.mockResolvedValueOnce(RELOAD_WINDOW_ACTION);
      await registeredCommands.get("agentPlus.installCodexIntegration")!();
      expect(mockExecuteCommand).toHaveBeenCalledWith("workbench.action.reloadWindow");

      // Context-bearing & non-context uninstall commands
      await registeredCommands.get("agentPlus.uninstallAllIntegrations")!();
      expect(workspaceIntegrationSpies.uninstallAllDetectedIntegrations).toHaveBeenCalledWith(context, {
        recordClientSelection: true,
      });

      await registeredCommands.get("agentPlus.uninstallCopilotIntegration")!();
      expect(workspaceIntegrationSpies.uninstallCopilotIntegration).toHaveBeenCalledWith(context, {
        recordClientSelection: true,
      });
      await registeredCommands.get("agentPlus.uninstallClineIntegration")!();
      expect(workspaceIntegrationSpies.uninstallClineIntegration).toHaveBeenCalledWith(context, {
        recordClientSelection: true,
      });

      const uninstallNoContextCommands: Array<[string, keyof typeof workspaceIntegrationSpies]> = [
        ["agentPlus.uninstallCodexIntegration", "uninstallCodexIntegration"],
        ["agentPlus.uninstallCursorIntegration", "uninstallCursorIntegration"],
        ["agentPlus.uninstallClaudeIntegration", "uninstallClaudeIntegration"],
        ["agentPlus.uninstallWindsurfIntegration", "uninstallWindsurfIntegration"],
        ["agentPlus.uninstallAntigravityIntegration", "uninstallAntigravityIntegration"],
      ];
      for (const [cmdId, spyKey] of uninstallNoContextCommands) {
        await registeredCommands.get(cmdId)!();
        expect(workspaceIntegrationSpies[spyKey]).toHaveBeenCalledWith({
          recordClientSelection: true,
        });
      }

      // Aliases delegate through agentPlus.installAllIntegrations once without duplicate popups
      workspaceIntegrationSpies.installAllDetectedIntegrations.mockClear();
      mockShowInformationMessage.mockClear();
      await registeredCommands.get("agentPlus.reinstallIntegration")!();
      await registeredCommands.get("agentPlus.installWorkspaceIntegration")!();
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).toHaveBeenCalledTimes(2);
      expect(mockShowInformationMessage).toHaveBeenCalledTimes(2);
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).toHaveBeenNthCalledWith(1, context, {
        recordClientSelection: true,
      });
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).toHaveBeenNthCalledWith(2, context, {
        recordClientSelection: true,
      });

      // Verify / Copy commands work independently and never trigger install recording
      workspaceIntegrationSpies.installAllDetectedIntegrations.mockClear();
      workspaceIntegrationSpies.checkAllIntegrations.mockClear();
      mockShowInformationMessage.mockClear();
      await registeredCommands.get("agentPlus.verifyGlobalIntegration")!();
      expect(workspaceIntegrationSpies.checkAllIntegrations).toHaveBeenCalledWith(context);
      expect(mockShowInformationMessage).toHaveBeenCalledTimes(1);
      await registeredCommands.get("agentPlus.copyMcpConfig")!();
      await registeredCommands.get("agentPlus.copyReviewSkill")!();
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).not.toHaveBeenCalled();

      // Interactive Installer command wires recordClientSelection: true, refreshes views, and supports Reload Window
      const acceptListeners: Array<() => void> = [];
      const hideListeners: Array<() => void> = [];
      const qp = {
        title: "",
        placeholder: "",
        canSelectMany: false,
        matchOnDescription: false,
        matchOnDetail: false,
        busy: false,
        buttons: [] as unknown[],
        items: [] as Array<{ clientId: string }>,
        selectedItems: [] as Array<{ clientId: string }>,
        onDidAccept: (fn: () => void) => {
          acceptListeners.push(fn);
          return { dispose: () => {} };
        },
        onDidTriggerButton: () => ({ dispose: () => {} }),
        onDidHide: (fn: () => void) => {
          hideListeners.push(fn);
          return { dispose: () => {} };
        },
        show: vi.fn(),
        hide: vi.fn(() => {
          for (const fn of hideListeners) fn();
        }),
        dispose: vi.fn(),
      };
      mockCreateQuickPick.mockReturnValueOnce(qp);
      sidebarSpies.recentRefresh.mockClear();
      sidebarSpies.sessionsRefresh.mockClear();
      conversationServiceSpies.notifyChanged.mockClear();
      mockShowInformationMessage.mockClear();
      mockExecuteCommand.mockClear();
      mockShowInformationMessage.mockResolvedValueOnce(RELOAD_WINDOW_ACTION);

      const installerPromise = registeredCommands.get("agentPlus.installer")!();
      await vi.waitFor(() => {
        expect(qp.busy).toBe(false);
      });
      for (const fn of acceptListeners) fn();
      await installerPromise;

      expect(workspaceIntegrationSpies.listInstallableClients).toHaveBeenCalledWith(context);
      expect(workspaceIntegrationSpies.listInstallerClients).not.toHaveBeenCalled();
      expect(workspaceIntegrationSpies.installSelectedIntegrations).toHaveBeenCalledWith(
        context,
        ["codex"],
        { recordClientSelection: true },
      );
      expect(sidebarSpies.sessionsRefresh).toHaveBeenCalledTimes(1);
      expect(sidebarSpies.recentRefresh).toHaveBeenCalledTimes(1);
      expect(conversationServiceSpies.notifyChanged).toHaveBeenCalledWith([{ kind: "support" }]);
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        "AI Artifacts installed for Codex. Reload this window to apply changes. For AI clients running outside this window, restart the client and start a new chat.",
        RELOAD_WINDOW_ACTION,
      );
      expect(mockExecuteCommand).toHaveBeenCalledWith("workbench.action.reloadWindow");

      // Interactive Uninstall command wires recordClientSelection: true and refreshes views
      const uninstallAcceptListeners: Array<() => void> = [];
      const uninstallHideListeners: Array<() => void> = [];
      const uninstallQp = {
        title: "",
        placeholder: "",
        canSelectMany: false,
        matchOnDescription: false,
        matchOnDetail: false,
        busy: false,
        items: [] as Array<{ clientId: string }>,
        selectedItems: [] as Array<{ clientId: string }>,
        onDidAccept: (fn: () => void) => {
          uninstallAcceptListeners.push(fn);
          return { dispose: () => {} };
        },
        onDidHide: (fn: () => void) => {
          uninstallHideListeners.push(fn);
          return { dispose: () => {} };
        },
        show: vi.fn(),
        hide: vi.fn(() => {
          for (const fn of uninstallHideListeners) fn();
        }),
        dispose: vi.fn(),
      };
      mockCreateQuickPick.mockReturnValueOnce(uninstallQp);
      sidebarSpies.recentRefresh.mockClear();
      sidebarSpies.sessionsRefresh.mockClear();
      conversationServiceSpies.notifyChanged.mockClear();

      const uninstallPromise = registeredCommands.get("agentPlus.uninstall")!();
      await vi.waitFor(() => {
        expect(uninstallQp.busy).toBe(false);
      });
      expect(uninstallQp.selectedItems).toEqual([]);
      uninstallQp.selectedItems = uninstallQp.items;
      for (const fn of uninstallAcceptListeners) fn();
      await uninstallPromise;

      expect(workspaceIntegrationSpies.listInstallerClients).toHaveBeenCalledWith(context);
      expect(workspaceIntegrationSpies.uninstallSelectedIntegrations).toHaveBeenCalledWith(
        context,
        ["codex"],
        { recordClientSelection: true, cleanupBase: true },
      );
      expect(sidebarSpies.sessionsRefresh).toHaveBeenCalledTimes(1);
      expect(sidebarSpies.recentRefresh).toHaveBeenCalledTimes(1);
      expect(conversationServiceSpies.notifyChanged).toHaveBeenCalledWith([{ kind: "support" }]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("reports Install All outcomes with Reload Window, isolates refresh errors, and avoids post-verification", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-ext-install-all-"));
    try {
      vi.spyOn(os, "homedir").mockReturnValue(tempRoot);
      const context = {
        extensionUri: { fsPath: tempRoot },
        globalStorageUri: { fsPath: path.join(tempRoot, "storage") },
        globalState: { get: vi.fn(), update: vi.fn(async () => undefined) },
        subscriptions: [] as Array<{ dispose: () => void }>,
      } as any;

      await activate(context);

      const resetCommandSpies = (): void => {
        workspaceIntegrationSpies.installAllDetectedIntegrations.mockClear();
        workspaceIntegrationSpies.checkAllIntegrations.mockClear();
        mockShowInformationMessage.mockClear();
        mockShowWarningMessage.mockClear();
        mockShowErrorMessage.mockClear();
        mockExecuteCommand.mockClear();
        sidebarSpies.sessionsRefresh.mockClear();
        sidebarSpies.recentRefresh.mockClear();
        conversationServiceSpies.notifyChanged.mockClear();
      };

      // 1. Success only
      resetCommandSpies();
      workspaceIntegrationSpies.installAllDetectedIntegrations.mockResolvedValueOnce({
        installedClients: ["Codex", "Cursor"],
        failedClients: [],
      });
      mockShowInformationMessage.mockResolvedValueOnce(RELOAD_WINDOW_ACTION);
      await registeredCommands.get("agentPlus.installAllIntegrations")!();
      expect(workspaceIntegrationSpies.checkAllIntegrations).not.toHaveBeenCalled();
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        "AI Artifacts installed for Codex, Cursor. Reload this window to apply changes. For AI clients running outside this window, restart the client and start a new chat.",
        RELOAD_WINDOW_ACTION,
      );
      expect(mockExecuteCommand).toHaveBeenCalledWith("workbench.action.reloadWindow");
      expect(mockShowWarningMessage).not.toHaveBeenCalled();
      expect(mockShowErrorMessage).not.toHaveBeenCalled();
      expect(sidebarSpies.sessionsRefresh).toHaveBeenCalledTimes(1);
      expect(sidebarSpies.recentRefresh).toHaveBeenCalledTimes(1);
      expect(conversationServiceSpies.notifyChanged).toHaveBeenCalledWith([{ kind: "support" }]);

      // 2. Partial (success + failures)
      resetCommandSpies();
      workspaceIntegrationSpies.installAllDetectedIntegrations.mockResolvedValueOnce({
        installedClients: ["Codex"],
        failedClients: [{ id: "cursor", name: "Cursor", error: "EACCES permission denied" }],
      });
      await registeredCommands.get("agentPlus.installAllIntegrations")!();
      expect(workspaceIntegrationSpies.checkAllIntegrations).not.toHaveBeenCalled();
      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        "AI Artifacts installed for Codex. Failed for: Cursor (EACCES permission denied). Reload this window to apply successful installations. For AI clients running outside this window, restart the client and start a new chat.",
        RELOAD_WINDOW_ACTION,
      );
      expect(mockShowInformationMessage).not.toHaveBeenCalled();
      expect(mockShowErrorMessage).not.toHaveBeenCalled();
      expect(mockExecuteCommand).not.toHaveBeenCalled();
      expect(sidebarSpies.sessionsRefresh).toHaveBeenCalledTimes(1);
      expect(sidebarSpies.recentRefresh).toHaveBeenCalledTimes(1);
      expect(conversationServiceSpies.notifyChanged).toHaveBeenCalledTimes(1);

      // 3. All failed (no success + failures)
      resetCommandSpies();
      workspaceIntegrationSpies.installAllDetectedIntegrations.mockResolvedValueOnce({
        installedClients: [],
        failedClients: [{ id: "codex", name: "Codex", error: "unmanaged conflict" }],
      });
      await registeredCommands.get("agentPlus.installAllIntegrations")!();
      expect(workspaceIntegrationSpies.checkAllIntegrations).not.toHaveBeenCalled();
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        "AI Artifacts installation failed: Codex (unmanaged conflict)",
      );
      expect(mockShowInformationMessage).not.toHaveBeenCalled();
      expect(mockShowWarningMessage).not.toHaveBeenCalled();
      expect(sidebarSpies.sessionsRefresh).not.toHaveBeenCalled();
      expect(sidebarSpies.recentRefresh).not.toHaveBeenCalled();
      expect(conversationServiceSpies.notifyChanged).not.toHaveBeenCalled();

      // 4. Empty (neither detected success nor failures)
      resetCommandSpies();
      workspaceIntegrationSpies.installAllDetectedIntegrations.mockResolvedValueOnce({
        installedClients: [],
        failedClients: [],
      });
      await registeredCommands.get("agentPlus.installAllIntegrations")!();
      expect(workspaceIntegrationSpies.checkAllIntegrations).not.toHaveBeenCalled();
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        "AI Artifacts: No supported AI clients were detected for installation.",
      );
      expect(mockShowWarningMessage).not.toHaveBeenCalled();
      expect(mockShowErrorMessage).not.toHaveBeenCalled();
      expect(sidebarSpies.sessionsRefresh).not.toHaveBeenCalled();
      expect(sidebarSpies.recentRefresh).not.toHaveBeenCalled();
      expect(conversationServiceSpies.notifyChanged).not.toHaveBeenCalled();

      // 5. Reject due to shared setup exception
      resetCommandSpies();
      workspaceIntegrationSpies.installAllDetectedIntegrations.mockRejectedValueOnce(
        new Error("packaged runtime missing"),
      );
      await registeredCommands.get("agentPlus.installAllIntegrations")!();
      expect(workspaceIntegrationSpies.checkAllIntegrations).not.toHaveBeenCalled();
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        "AI Artifacts installation could not complete: packaged runtime missing",
      );
      expect(mockShowInformationMessage).not.toHaveBeenCalled();
      expect(mockShowWarningMessage).not.toHaveBeenCalled();
      expect(sidebarSpies.sessionsRefresh).not.toHaveBeenCalled();
      expect(sidebarSpies.recentRefresh).not.toHaveBeenCalled();
      expect(conversationServiceSpies.notifyChanged).not.toHaveBeenCalled();

      // 6. Refresh view error does not convert a successful Install All into a failure popup
      resetCommandSpies();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      workspaceIntegrationSpies.installAllDetectedIntegrations.mockResolvedValueOnce({
        installedClients: ["Codex"],
        failedClients: [],
      });
      sidebarSpies.recentRefresh.mockImplementationOnce(() => {
        throw new Error("tree refresh failed");
      });
      await registeredCommands.get("agentPlus.installAllIntegrations")!();
      expect(mockShowInformationMessage).toHaveBeenCalledTimes(1);
      expect(mockShowErrorMessage).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("registers agentPlus.openWhatsNew without opening panel on activation and calls controller.show on command execution", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-ext-whats-new-"));
    try {
      vi.spyOn(os, "homedir").mockReturnValue(tempRoot);
      const context = {
        extensionUri: { fsPath: tempRoot },
        globalStorageUri: { fsPath: path.join(tempRoot, "storage") },
        globalState: { get: vi.fn(), update: vi.fn(async () => undefined) },
        subscriptions: [] as Array<{ dispose: () => void }>,
      } as any;

      await activate(context);

      expect(whatsNewSpies.constructorSpy).toHaveBeenCalledTimes(1);
      expect(whatsNewSpies.constructorSpy).toHaveBeenCalledWith(context.extensionUri);
      expect(whatsNewSpies.show).not.toHaveBeenCalled();
      expect(registeredCommands.has("agentPlus.openWhatsNew")).toBe(true);
      expect(
        context.subscriptions.some(
          (item: { dispose?: unknown }) => item.dispose === whatsNewSpies.dispose,
        ),
      ).toBe(true);

      registeredCommands.get("agentPlus.openWhatsNew")!();
      expect(whatsNewSpies.show).toHaveBeenCalledTimes(1);
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).not.toHaveBeenCalled();
      expect(workspaceIntegrationSpies.checkAllIntegrations).not.toHaveBeenCalled();

      whatsNewSpies.show.mockImplementationOnce(() => {
        throw new Error("panel failure");
      });
      registeredCommands.get("agentPlus.openWhatsNew")!();
      expect(mockShowErrorMessage).toHaveBeenCalledWith("Failed to open What's New: panel failure");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });
});
