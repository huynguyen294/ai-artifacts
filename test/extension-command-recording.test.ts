import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  registeredCommands,
  mockExecuteCommand,
  mockShowInformationMessage,
  mockShowWarningMessage,
  mockShowErrorMessage,
  mockClipboardWriteText,
  mockUpgradeNotification,
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
    mockShowInformationMessage: vi.fn(async () => undefined),
    mockShowWarningMessage: vi.fn(async () => undefined),
    mockShowErrorMessage: vi.fn(async () => undefined),
    mockClipboardWriteText: vi.fn(async () => undefined),
    mockUpgradeNotification: vi.fn(async () => undefined),
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
      getDetectedSkillTargets: vi.fn(() => ["agents"]),
      readInstalledIntegrationVersion: vi.fn(async () => ({ status: "missing" })),
      upgradeDetectedIntegrations: vi.fn(async () => {
        throw new Error("upgradeDetectedIntegrations must not be called in Phase 1 activation");
      }),
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
    openExternal: vi.fn(async () => true),
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
    refresh = vi.fn();
    getKindFilter = () => undefined;
  },
  WorkSessionsTreeDataProvider: class {
    onDidChangeTreeData = () => ({ dispose: () => {} });
    refresh = vi.fn();
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
    notifyChanged = vi.fn();
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
    maybeShowUpgradeNotification: mockUpgradeNotification,
  };
});
vi.mock("../src/extension/workspace-integration", () => workspaceIntegrationSpies);

import { activate } from "../src/extension/extension";

describe("Extension manual command recording & Phase 1 activation boundary", () => {
  afterEach(() => {
    vi.clearAllMocks();
    registeredCommands.clear();
  });

  it("passes recordClientSelection: true on all 16 manual install/uninstall commands, keeps aliases single-recorded, avoids recording in non-mutating commands, and keeps existing activation notification", async () => {
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

      // Phase 1 keeps existing activation notification and does NOT invoke upgradeDetectedIntegrations
      expect(mockUpgradeNotification).toHaveBeenCalledTimes(1);
      expect(workspaceIntegrationSpies.upgradeDetectedIntegrations).not.toHaveBeenCalled();

      // Context-bearing install commands
      await registeredCommands.get("agentPlus.installAllIntegrations")!();
      expect(workspaceIntegrationSpies.installAllDetectedIntegrations).toHaveBeenCalledWith(context, {
        recordClientSelection: true,
      });

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

