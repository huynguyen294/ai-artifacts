import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
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
import type { WhatsNewNotificationDeps } from "../src/extension/whats-new-notification";
import { whatsNewReleases } from "../src/shared/whats-new-releases";
import type {
  ExistingInstalledIntegrationVersionReadResult,
  InstalledIntegrationVersionReadResult,
} from "../src/extension/workspace-integration";

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
  mockRunWhatsNewNotification,
  mockClaimWhatsNewUpgradeNotification,
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
    mockRunWhatsNewNotification: vi.fn(
      async (_deps: WhatsNewNotificationDeps): Promise<void> => undefined,
    ),
    mockClaimWhatsNewUpgradeNotification: vi.fn(
      async (
        _storageDirectory: string,
        _currentVersion: string,
        _notifyEnabled: boolean,
        _existingIntegration: boolean,
      ): Promise<boolean> => false,
    ),
    sidebarSpies: {
      recentRefresh: vi.fn(),
      sessionsRefresh: vi.fn(),
    },
    conversationServiceSpies: {
      notifyChanged: vi.fn(),
    },
    workspaceIntegrationSpies: {
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
      readInstalledIntegrationVersion: vi.fn(async (): Promise<InstalledIntegrationVersionReadResult> => ({ status: "missing" })),
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
      showVersion: vi.fn(),
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
    showVersion = whatsNewSpies.showVersion;
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
vi.mock("../src/extension/whats-new-notification", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/extension/whats-new-notification")>();
  return {
    ...original,
    runWhatsNewNotification: mockRunWhatsNewNotification,
  };
});
vi.mock("../src/extension/whats-new-notification-state", () => ({
  claimWhatsNewUpgradeNotification: mockClaimWhatsNewUpgradeNotification,
}));
vi.mock("../src/extension/workspace-integration", () => workspaceIntegrationSpies);

import { activate } from "../src/extension/extension";
import { executeArtifactRetentionCleanup } from "../src/extension/artifact-retention";
import { executeWorkSessionArchiveCleanup } from "../src/extension/work-session-retention";

describe("Extension activation wiring & manual command recording", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    registeredCommands.clear();
  });

  it("passes the same retention setting to artifact and Work Session cleanup on activation", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-ext-retention-"));
    try {
      vi.spyOn(os, "homedir").mockReturnValue(tempRoot);
      vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (key: string, defaultValue?: unknown) => key === "artifactRetentionDays" ? 14 : defaultValue,
      } as vscode.WorkspaceConfiguration);
      const context = {
        extensionUri: { fsPath: tempRoot },
        globalStorageUri: { fsPath: path.join(tempRoot, "storage") },
        globalState: { get: vi.fn(), update: vi.fn(async () => undefined) },
        subscriptions: [] as Array<{ dispose: () => void }>,
      } as any;

      await activate(context);

      expect(executeArtifactRetentionCleanup).toHaveBeenCalledWith({ retentionDays: 14 });
      await vi.waitFor(() => {
        expect(executeWorkSessionArchiveCleanup).toHaveBeenCalledWith({ retentionDays: 14 });
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
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
      expect(workspaceIntegrationSpies.installSelectedIntegrations).not.toHaveBeenCalled();

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

  it("registers only grouped Installer/Uninstall integration commands, passes recordClientSelection: true, and keeps Verify/Copy independent", async () => {
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

      const removedLegacyCommands = [
        "agentPlus.reinstallIntegration",
        "agentPlus.installWorkspaceIntegration",
        ...["All", "Copilot", "Codex", "Cursor", "Claude", "Windsurf", "Cline", "Antigravity"].flatMap((client) => [
          `agentPlus.install${client}Integration${client === "All" ? "s" : ""}`,
          `agentPlus.uninstall${client}Integration${client === "All" ? "s" : ""}`,
        ]),
      ];
      for (const commandId of removedLegacyCommands) {
        expect(registeredCommands.has(commandId)).toBe(false);
      }
      expect(registeredCommands.has("agentPlus.installer")).toBe(true);
      expect(registeredCommands.has("agentPlus.uninstall")).toBe(true);

      // Verify / Copy commands work independently and never trigger install recording
      workspaceIntegrationSpies.installSelectedIntegrations.mockClear();
      workspaceIntegrationSpies.checkAllIntegrations.mockClear();
      mockShowInformationMessage.mockClear();
      await registeredCommands.get("agentPlus.verifyGlobalIntegration")!();
      expect(workspaceIntegrationSpies.checkAllIntegrations).toHaveBeenCalledWith(context);
      expect(mockShowInformationMessage).toHaveBeenCalledTimes(1);
      await registeredCommands.get("agentPlus.copyMcpConfig")!();
      await registeredCommands.get("agentPlus.copyReviewSkill")!();
      expect(workspaceIntegrationSpies.installSelectedIntegrations).not.toHaveBeenCalled();

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
      expect(workspaceIntegrationSpies.installSelectedIntegrations).not.toHaveBeenCalled();
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

  it.each<InstalledIntegrationVersionReadResult>([
    { status: "missing" },
    { status: "invalid", error: new Error("legacy receipt") },
    {
      status: "valid",
      manifest: {
        schemaVersion: 1,
        mcpVersion: MCP_VERSION - 1,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
        updatedAt: "2026-11-11T00:00:00.000Z",
      },
    },
  ])("uses the same pre-upgrade $status receipt snapshot for notification bootstrap", async (snapshot) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-ext-wn-snapshot-"));
    try {
      vi.spyOn(os, "homedir").mockReturnValue(tempRoot);
      workspaceIntegrationSpies.readInstalledIntegrationVersion.mockResolvedValueOnce(snapshot);
      const context = {
        extensionUri: { fsPath: tempRoot },
        globalStorageUri: { scheme: "file", fsPath: path.join(tempRoot, "storage") },
        globalState: { get: vi.fn(), update: vi.fn(async () => undefined) },
        subscriptions: [] as Array<{ dispose: () => void }>,
      } as any;
      await activate(context);

      const activationDeps = mockRunIntegrationActivation.mock.calls[0]![0];
      expect(await activationDeps.getInstalledIntegrationVersion()).toBe(snapshot);
      if (snapshot.status !== "missing") {
        // Upgrade runs before notification; it must not cause another receipt read.
        await activationDeps.runUpgrade(snapshot);
      }
      const notificationDeps = mockRunWhatsNewNotification.mock.calls[0]![0];
      await notificationDeps.claimUpgradeNotification("1.2.0", true);
      expect(await activationDeps.getInstalledIntegrationVersion()).toBe(snapshot);
      expect(workspaceIntegrationSpies.readInstalledIntegrationVersion).toHaveBeenCalledTimes(1);
      expect(mockClaimWhatsNewUpgradeNotification).toHaveBeenCalledWith(
        path.join(tempRoot, "storage", "whats-new-notification"),
        "1.2.0",
        true,
        snapshot.status !== "missing",
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("keeps notification state usable when the shared integration snapshot cannot be read", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-ext-wn-read-error-"));
    try {
      vi.spyOn(os, "homedir").mockReturnValue(tempRoot);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const readError = new Error("receipt read failed");
      workspaceIntegrationSpies.readInstalledIntegrationVersion.mockRejectedValueOnce(readError);
      const context = {
        extensionUri: { fsPath: tempRoot },
        globalStorageUri: { scheme: "file", fsPath: path.join(tempRoot, "storage") },
        globalState: { get: vi.fn(), update: vi.fn(async () => undefined) },
        subscriptions: [] as Array<{ dispose: () => void }>,
      } as any;
      await activate(context);
      const activationDeps = mockRunIntegrationActivation.mock.calls[0]![0];
      await expect(activationDeps.getInstalledIntegrationVersion()).rejects.toBe(readError);
      const notificationDeps = mockRunWhatsNewNotification.mock.calls[0]![0];
      await expect(notificationDeps.claimUpgradeNotification("1.2.0", true)).resolves.toBe(false);
      expect(workspaceIntegrationSpies.readInstalledIntegrationVersion).toHaveBeenCalledTimes(1);
      expect(mockClaimWhatsNewUpgradeNotification).toHaveBeenCalledWith(
        path.join(tempRoot, "storage", "whats-new-notification"), "1.2.0", true, false,
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "AI Artifacts What's New notification: Could not determine whether integration was previously installed.",
        readError,
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("wires What's New notification non-blockingly and independently of integration activation", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-ext-wn-wiring-"));
    try {
      vi.spyOn(os, "homedir").mockReturnValue(tempRoot);

      let releaseActivation!: () => void;
      const pendingActivation = new Promise<void>((resolve) => {
        releaseActivation = resolve;
      });
      mockRunIntegrationActivation.mockReturnValueOnce(pendingActivation);

      let releaseWhatsNew!: () => void;
      const pendingWhatsNew = new Promise<void>((resolve) => {
        releaseWhatsNew = resolve;
      });
      mockRunWhatsNewNotification.mockReturnValueOnce(pendingWhatsNew);

      const storagePath = path.join(tempRoot, "storage");
      const context = {
        extension: { packageJSON: { version: "1.2.0" } },
        extensionUri: { fsPath: tempRoot },
        globalStorageUri: { scheme: "file", fsPath: storagePath },
        globalState: { get: vi.fn(), update: vi.fn(async () => undefined) },
        subscriptions: [] as Array<{ dispose: () => void }>,
      } as any;

      // activate(context) resolves cleanly even while both notification controllers remain pending
      await activate(context);

      expect(mockRunIntegrationActivation).toHaveBeenCalledTimes(1);
      expect(mockRunWhatsNewNotification).toHaveBeenCalledTimes(1);
      expect(registeredCommands.has("agentPlus.openWhatsNew")).toBe(true);
      expect(registeredCommands.has("agentPlus.installer")).toBe(true);
      expect(whatsNewSpies.show).not.toHaveBeenCalled();
      expect(whatsNewSpies.showVersion).not.toHaveBeenCalled();

      const capturedDeps = mockRunWhatsNewNotification.mock.calls[0]![0];
      expect(capturedDeps.getCurrentVersion()).toBe("1.2.0");
      expect(capturedDeps.releases).toBe(whatsNewReleases);

      mockClaimWhatsNewUpgradeNotification.mockResolvedValueOnce(true);
      await expect(capturedDeps.claimUpgradeNotification("1.2.0", true)).resolves.toBe(true);
      expect(mockClaimWhatsNewUpgradeNotification).toHaveBeenCalledTimes(1);
      expect(mockClaimWhatsNewUpgradeNotification).toHaveBeenCalledWith(
        path.join(storagePath, "whats-new-notification"),
        "1.2.0",
        true,
        false,
      );

      await capturedDeps.showInformationMessage(
        "AI Artifacts 1.2.0: Work Sessions",
        "View what's new",
      );
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        "AI Artifacts 1.2.0: Work Sessions",
        "View what's new",
      );

      await capturedDeps.openVersion("1.2.0");
      expect(whatsNewSpies.showVersion).toHaveBeenCalledTimes(1);
      expect(whatsNewSpies.showVersion).toHaveBeenCalledWith("1.2.0");
      expect(whatsNewSpies.show).not.toHaveBeenCalled();

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const wnErr = new Error("notification boom");
      capturedDeps.reportDiagnostic("ui check", wnErr);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "AI Artifacts What's New notification: ui check",
        wnErr,
      );

      releaseWhatsNew();
      await pendingWhatsNew;
      releaseActivation();
      await pendingActivation;

      // Non-file globalStorageUri scheme skips local filesystem state safely with diagnostic
      vi.clearAllMocks();
      registeredCommands.clear();
      const virtualContext = {
        extensionUri: { fsPath: tempRoot },
        globalStorageUri: { scheme: "vscode-userdata", fsPath: storagePath },
        globalState: { get: vi.fn(), update: vi.fn(async () => undefined) },
        subscriptions: [] as Array<{ dispose: () => void }>,
      } as any;

      await activate(virtualContext);
      const virtualDeps = mockRunWhatsNewNotification.mock.calls[0]![0];
      expect(virtualDeps.getCurrentVersion()).toBeUndefined();
      await expect(virtualDeps.claimUpgradeNotification("1.2.0", true)).resolves.toBe(false);
      expect(mockClaimWhatsNewUpgradeNotification).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "AI Artifacts What's New notification: Skipping upgrade notification state because globalStorageUri is not a local file URI.",
        { scheme: "vscode-userdata" },
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });
});
