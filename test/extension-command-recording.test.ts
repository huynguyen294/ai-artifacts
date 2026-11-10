import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
  MCP_VERSION,
  WORK_SESSION_SKILL_VERSION,
} from "../src/shared/contracts";
import type { AutomaticIntegrationUpgradeDeps } from "../src/extension/upgrade-notification";
import { INSTALLATION_GUIDE_URL } from "../src/extension/upgrade-notification";

const {
  registeredCommands,
  mockExecuteCommand,
  mockOpenExternal,
  mockShowInformationMessage,
  mockShowWarningMessage,
  mockShowErrorMessage,
  mockClipboardWriteText,
  mockRunAutomaticIntegrationUpgrade,
  sidebarSpies,
  conversationServiceSpies,
  workspaceIntegrationSpies,
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
    mockShowInformationMessage: vi.fn(async () => undefined),
    mockShowWarningMessage: vi.fn(async () => undefined),
    mockShowErrorMessage: vi.fn(async () => undefined),
    mockClipboardWriteText: vi.fn(async () => undefined),
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
      installAllDetectedIntegrations: vi.fn(async () => ({ installedClients: ["Codex"] })),
      installCopilotIntegration: vi.fn(async () => ({ userConfigPath: "/tmp/mcp.json" })),
      installCodexIntegration: vi.fn(async () => undefined),
      installCursorIntegration: vi.fn(async () => undefined),
      installClaudeIntegration: vi.fn(async () => undefined),
      installWindsurfIntegration: vi.fn(async () => undefined),
      installClineIntegration: vi.fn(async () => undefined),
      installAntigravityIntegration: vi.fn(async () => undefined),
      uninstallAllDetectedIntegrations: vi.fn(async () => ({ uninstalledClients: ["Codex"] })),
      uninstallCopilotIntegration: vi.fn(async () => true),
      uninstallCodexIntegration: vi.fn(async () => true),
      uninstallCursorIntegration: vi.fn(async () => true),
      uninstallClaudeIntegration: vi.fn(async () => true),
      uninstallWindsurfIntegration: vi.fn(async () => true),
      uninstallClineIntegration: vi.fn(async () => true),
      uninstallAntigravityIntegration: vi.fn(async () => true),
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
    createQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showOpenDialog: vi.fn(),
    withProgress: vi.fn(),
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
vi.mock("../src/extension/upgrade-notification", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/extension/upgrade-notification")>();
  return {
    ...original,
    runAutomaticIntegrationUpgrade: mockRunAutomaticIntegrationUpgrade,
  };
});
vi.mock("../src/extension/workspace-integration", () => workspaceIntegrationSpies);

import { activate } from "../src/extension/extension";

describe("Extension activation auto-upgrade wiring & manual command recording", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    registeredCommands.clear();
  });

  it("triggers automatic upgrade non-blockingly at activation regardless of legacy notification globalState and wires real callbacks", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-ext-act-"));
    try {
      vi.spyOn(os, "homedir").mockReturnValue(tempRoot);

      let releaseUpgrade!: () => void;
      const pendingUpgrade = new Promise<void>((resolve) => {
        releaseUpgrade = resolve;
      });
      mockRunAutomaticIntegrationUpgrade.mockReturnValueOnce(pendingUpgrade);

      const globalStateGet = vi.fn((key: string) => {
        if (key === "upgradeNotification.lastNotifiedIntegrationState") {
          return {
            mcpVersion: MCP_VERSION,
            skillVersion: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
            sessionSkillVersion: WORK_SESSION_SKILL_VERSION,
            staleAssets: ["mcp", "skill:agents", "session-skill:agents"],
          };
        }
        return undefined;
      });
      const globalStateUpdate = vi.fn(async () => undefined);

      const context = {
        extensionUri: { fsPath: tempRoot },
        globalStorageUri: { fsPath: path.join(tempRoot, "storage") },
        globalState: { get: globalStateGet, update: globalStateUpdate },
        subscriptions: [] as Array<{ dispose: () => void }>,
      } as any;

      // activate(context) must resolve even while the upgrade promise is still pending
      await activate(context);

      expect(mockRunAutomaticIntegrationUpgrade).toHaveBeenCalledTimes(1);
      expect(registeredCommands.has("agentPlus.installAllIntegrations")).toBe(true);
      expect(globalStateGet).not.toHaveBeenCalledWith("upgradeNotification.lastNotifiedIntegrationState");
      expect(globalStateUpdate).not.toHaveBeenCalled();

      // Captured controller deps wire through to real manager/UI/support callbacks
      const capturedDeps = mockRunAutomaticIntegrationUpgrade.mock.calls[0]![0];
      expect(capturedDeps.bundledVersions).toEqual({
        mcpVersion: MCP_VERSION,
        skillVersion: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
        sessionSkillVersion: WORK_SESSION_SKILL_VERSION,
      });

      const report = await capturedDeps.upgradeIntegrations();
      expect(workspaceIntegrationSpies.upgradeDetectedIntegrations).toHaveBeenCalledWith(context);
      expect(report.clientIds).toEqual(["codex"]);
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).not.toHaveBeenCalled();

      await capturedDeps.getInstalledIntegrationVersion();
      expect(workspaceIntegrationSpies.readInstalledIntegrationVersion).toHaveBeenCalledTimes(1);

      capturedDeps.refreshIntegrationSupport();
      expect(sidebarSpies.sessionsRefresh).toHaveBeenCalledTimes(1);
      expect(sidebarSpies.recentRefresh).toHaveBeenCalledTimes(1);
      expect(conversationServiceSpies.notifyChanged).toHaveBeenCalledWith([{ kind: "support" }]);

      await capturedDeps.showWarningMessage("warn", "View Installation Guide");
      expect(mockShowWarningMessage).toHaveBeenCalledWith("warn", "View Installation Guide");

      await capturedDeps.showErrorMessage("err", "View Installation Guide");
      expect(mockShowErrorMessage).toHaveBeenCalledWith("err", "View Installation Guide");

      await capturedDeps.openInstallationGuide();
      expect(mockOpenExternal).toHaveBeenCalledWith({ value: INSTALLATION_GUIDE_URL });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const err = new Error("diag detail");
      capturedDeps.reportDiagnostic("failed check", err);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "AI Artifacts automatic integration upgrade: failed check",
        err,
      );

      releaseUpgrade();
      await pendingUpgrade;
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("passes recordClientSelection: true on all 16 manual install/uninstall commands, keeps aliases single-recorded, and avoids recording in Verify/Copy", async () => {
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

      // Context-bearing install commands
      await registeredCommands.get("agentPlus.installAllIntegrations")!();
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).toHaveBeenCalledWith(context, {
        recordClientSelection: true,
      });
      expect(workspaceIntegrationSpies.checkAllIntegrations).toHaveBeenCalledWith(context);
      expect(mockShowInformationMessage).toHaveBeenCalledTimes(1);

      const installWithContextCommands: Array<[string, keyof typeof workspaceIntegrationSpies]> = [
        ["agentPlus.installCopilotIntegration", "installCopilotIntegration"],
        ["agentPlus.installCodexIntegration", "installCodexIntegration"],
        ["agentPlus.installCursorIntegration", "installCursorIntegration"],
        ["agentPlus.installClaudeIntegration", "installClaudeIntegration"],
        ["agentPlus.installWindsurfIntegration", "installWindsurfIntegration"],
        ["agentPlus.installClineIntegration", "installClineIntegration"],
        ["agentPlus.installAntigravityIntegration", "installAntigravityIntegration"],
      ];
      for (const [cmdId, spyKey] of installWithContextCommands) {
        await registeredCommands.get(cmdId)!();
        expect(workspaceIntegrationSpies[spyKey]).toHaveBeenCalledWith(context, {
          recordClientSelection: true,
        });
      }

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

      // Aliases delegate through agentPlus.installAllIntegrations once
      workspaceIntegrationSpies.installAllDetectedIntegrations.mockClear();
      await registeredCommands.get("agentPlus.reinstallIntegration")!();
      await registeredCommands.get("agentPlus.installWorkspaceIntegration")!();
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).toHaveBeenCalledTimes(2);
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).toHaveBeenNthCalledWith(1, context, {
        recordClientSelection: true,
      });
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).toHaveBeenNthCalledWith(2, context, {
        recordClientSelection: true,
      });

      // Verify / Copy commands do not trigger install/uninstall recording
      workspaceIntegrationSpies.installAllDetectedIntegrations.mockClear();
      await registeredCommands.get("agentPlus.verifyGlobalIntegration")!();
      await registeredCommands.get("agentPlus.copyMcpConfig")!();
      await registeredCommands.get("agentPlus.copyReviewSkill")!();
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });
});
