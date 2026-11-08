import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  INSTALLATION_GUIDE_URL,
  LAST_NOTIFIED_INTEGRATION_STATE_KEY,
  LATER_ACTION,
  RUN_INSTALLER_ACTION,
  VIEW_INSTALLATION_GUIDE_ACTION,
  buildUpgradeNotificationMessage,
  maybeShowUpgradeNotification,
  type InstalledIntegrationVersionState,
  type IntegrationNotificationState,
  type UpgradeNotificationDeps,
} from "../src/extension/upgrade-notification";
import type { IntegrationVersionManifest, InstalledSkillVersions } from "../src/shared/contracts";

function manifest(
  mcpVersion: number | undefined,
  skills: InstalledSkillVersions,
  sessionSkills?: InstalledSkillVersions,
): IntegrationVersionManifest {
  return {
    schemaVersion: 1,
    ...(mcpVersion === undefined ? {} : { mcpVersion }),
    skills,
    ...(sessionSkills ? { sessionSkills } : {}),
    updatedAt: "2026-11-02T00:00:00.000Z",
  };
}

function missingInstalledState(): InstalledIntegrationVersionState {
  return { status: "missing" };
}

function validInstalledState(
  value: IntegrationVersionManifest,
): InstalledIntegrationVersionState {
  return { status: "valid", manifest: value };
}

function invalidInstalledState(error: unknown): InstalledIntegrationVersionState {
  return { status: "invalid", error };
}

function makeDeps(
  overrides: Partial<UpgradeNotificationDeps> = {},
): UpgradeNotificationDeps {
  return {
    bundledVersions: { mcpVersion: 10, skillVersion: 2 },
    skillTargets: ["agents"],
    getInstalledIntegrationVersion: vi.fn(() => missingInstalledState()),
    getLastNotifiedIntegrationState: vi.fn(() => undefined),
    setLastNotifiedIntegrationState: vi.fn(async () => undefined),
    showInformationMessage: vi.fn(async () => undefined),
    runInstaller: vi.fn(async () => undefined),
    openInstallationGuide: vi.fn(async () => undefined),
    reportDiagnostic: vi.fn(),
    ...overrides,
  };
}

describe("upgrade notification", () => {
  it("treats a missing receipt as stale and persists the fingerprint before showing", async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      skillTargets: ["agents", "claude"],
      setLastNotifiedIntegrationState: vi.fn(async () => {
        callOrder.push("persist");
      }),
      showInformationMessage: vi.fn(async () => {
        callOrder.push("show");
        return undefined;
      }),
    });

    await maybeShowUpgradeNotification(deps);

    const expectedState: IntegrationNotificationState = {
      mcpVersion: 10,
      skillVersion: 2,
      staleAssets: ["mcp", "skill:agents", "skill:claude"],
    };
    expect(deps.setLastNotifiedIntegrationState).toHaveBeenCalledWith(expectedState);
    expect(deps.showInformationMessage).toHaveBeenCalledWith(
      buildUpgradeNotificationMessage(expectedState.staleAssets),
      RUN_INSTALLER_ACTION,
      VIEW_INSTALLATION_GUIDE_ACTION,
      LATER_ACTION,
    );
    expect(callOrder).toEqual(["persist", "show"]);
  });

  it("treats an invalid receipt as stale and records a diagnostic", async () => {
    const receiptError = new Error("invalid integration-version.json");
    const deps = makeDeps({
      getInstalledIntegrationVersion: vi.fn(() => invalidInstalledState(receiptError)),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.reportDiagnostic).toHaveBeenCalledWith(
      "Installed integration version receipt is invalid; treating all required assets as stale.",
      receiptError,
    );
    expect(deps.setLastNotifiedIntegrationState).toHaveBeenCalledWith({
      mcpVersion: 10,
      skillVersion: 2,
      staleAssets: ["mcp", "skill:agents"],
    });
    expect(deps.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it("syncs an all-current fingerprint without showing a notification", async () => {
    const deps = makeDeps({
      getInstalledIntegrationVersion: vi.fn(() =>
        validInstalledState(manifest(10, { agents: 2 }))),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.setLastNotifiedIntegrationState).toHaveBeenCalledWith({
      mcpVersion: 10,
      skillVersion: 2,
      staleAssets: [],
    });
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
  });

  it("reports only the Claude skill when shared assets are current", async () => {
    const deps = makeDeps({
      skillTargets: ["agents", "claude"],
      getInstalledIntegrationVersion: vi.fn(() =>
        validInstalledState(manifest(10, { agents: 2 }))),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.setLastNotifiedIntegrationState).toHaveBeenCalledWith({
      mcpVersion: 10,
      skillVersion: 2,
      staleAssets: ["skill:claude"],
    });
    const message = vi.mocked(deps.showInformationMessage).mock.calls[0]?.[0];
    expect(message).toContain("Claude skill (.claude)");
    expect(message).not.toContain("MCP runtime");
    expect(message).not.toContain("shared agent skill (.agents)");
  });

  it("suppresses only the same fingerprint after Later", async () => {
    let storedState: IntegrationNotificationState | undefined;
    const showInformationMessage = vi.fn(async () => LATER_ACTION);
    const deps = makeDeps({
      getLastNotifiedIntegrationState: () => storedState,
      setLastNotifiedIntegrationState: async (state) => {
        storedState = state;
      },
      showInformationMessage,
    });

    await maybeShowUpgradeNotification(deps);
    await maybeShowUpgradeNotification(deps);

    expect(showInformationMessage).toHaveBeenCalledTimes(1);
    expect(storedState).toEqual({
      mcpVersion: 10,
      skillVersion: 2,
      staleAssets: ["mcp", "skill:agents"],
    });
  });

  it("shows again when a partial install changes the remaining stale assets", async () => {
    let installed: InstalledIntegrationVersionState = missingInstalledState();
    let storedState: IntegrationNotificationState | undefined;
    const showInformationMessage = vi.fn(async () => LATER_ACTION);
    const deps = makeDeps({
      skillTargets: ["agents", "claude"],
      getInstalledIntegrationVersion: () => installed,
      getLastNotifiedIntegrationState: () => storedState,
      setLastNotifiedIntegrationState: async (state) => {
        storedState = state;
      },
      showInformationMessage,
    });

    await maybeShowUpgradeNotification(deps);
    installed = validInstalledState(manifest(10, { agents: 2 }));
    await maybeShowUpgradeNotification(deps);

    expect(showInformationMessage).toHaveBeenCalledTimes(2);
    expect(storedState?.staleAssets).toEqual(["skill:claude"]);
  });

  it.each([
    ["MCP", { mcpVersion: 11, skillVersion: 2 }, ["mcp"]],
    ["skill", { mcpVersion: 10, skillVersion: 3 }, ["skill:agents"]],
  ] as const)("shows a new fingerprint after a bundled %s version bump", async (
    _label,
    bundledVersions,
    staleAssets,
  ) => {
    const deps = makeDeps({
      bundledVersions,
      getInstalledIntegrationVersion: () =>
        validInstalledState(manifest(10, { agents: 2 })),
      getLastNotifiedIntegrationState: () => ({
        mcpVersion: 10,
        skillVersion: 2,
        staleAssets: [],
      }),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.setLastNotifiedIntegrationState).toHaveBeenCalledWith({
      ...bundledVersions,
      staleAssets,
    });
    expect(deps.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it("detects stale session skills when receipt lacks sessionSkills", async () => {
    const deps = makeDeps({
      bundledVersions: { mcpVersion: 10, skillVersion: 2, sessionSkillVersion: 1 },
      skillTargets: ["agents", "claude"],
      getInstalledIntegrationVersion: vi.fn(() =>
        validInstalledState(manifest(10, { agents: 2, claude: 2 }))),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.setLastNotifiedIntegrationState).toHaveBeenCalledWith({
      mcpVersion: 10,
      skillVersion: 2,
      sessionSkillVersion: 1,
      staleAssets: ["session-skill:agents", "session-skill:claude"],
    });
    const message = vi.mocked(deps.showInformationMessage).mock.calls[0]?.[0];
    expect(message).toContain("shared work session skill (.agents)");
    expect(message).toContain("Claude work session skill (.claude)");
    expect(message).not.toContain("MCP runtime");
  });

  it("syncs all-current when both review skills and session skills match", async () => {
    const deps = makeDeps({
      bundledVersions: { mcpVersion: 10, skillVersion: 2, sessionSkillVersion: 1 },
      skillTargets: ["agents", "claude"],
      getInstalledIntegrationVersion: vi.fn(() =>
        validInstalledState(
          manifest(10, { agents: 2, claude: 2 }, { agents: 1, claude: 1 }),
        )),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.setLastNotifiedIntegrationState).toHaveBeenCalledWith({
      mcpVersion: 10,
      skillVersion: 2,
      sessionSkillVersion: 1,
      staleAssets: [],
    });
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
  });

  it("does not include the extension package version in the fingerprint", async () => {
    const currentFingerprint: IntegrationNotificationState = {
      mcpVersion: 10,
      skillVersion: 2,
      staleAssets: ["mcp", "skill:agents"],
    };
    const deps = makeDeps({
      getLastNotifiedIntegrationState: () => currentFingerprint,
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.setLastNotifiedIntegrationState).not.toHaveBeenCalled();
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
  });

  it.each([
    [RUN_INSTALLER_ACTION, "runInstaller"],
    [VIEW_INSTALLATION_GUIDE_ACTION, "openInstallationGuide"],
  ] as const)("executes only the %s action", async (selectedAction, expectedAction) => {
    const deps = makeDeps({
      showInformationMessage: vi.fn(async () => selectedAction),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps[expectedAction]).toHaveBeenCalledTimes(1);
    const otherAction = expectedAction === "runInstaller" ? "openInstallationGuide" : "runInstaller";
    expect(deps[otherAction]).not.toHaveBeenCalled();
  });

  it("contains receipt, global-state, notification, and action failures", async () => {
    const receiptError = new Error("receipt read failed");
    const receiptDeps = makeDeps({
      getInstalledIntegrationVersion: vi.fn(async () => {
        throw receiptError;
      }),
    });
    await expect(maybeShowUpgradeNotification(receiptDeps)).resolves.toBeUndefined();
    expect(receiptDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not read installed integration versions.",
      receiptError,
    );
    expect(receiptDeps.showInformationMessage).toHaveBeenCalledTimes(1);

    const stateReadError = new Error("state read failed");
    const stateReadDeps = makeDeps({
      getLastNotifiedIntegrationState: () => {
        throw stateReadError;
      },
    });
    await expect(maybeShowUpgradeNotification(stateReadDeps)).resolves.toBeUndefined();
    expect(stateReadDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not read notification state.",
      stateReadError,
    );

    const stateWriteError = new Error("state write failed");
    const stateWriteDeps = makeDeps({
      setLastNotifiedIntegrationState: vi.fn(async () => {
        throw stateWriteError;
      }),
    });
    await expect(maybeShowUpgradeNotification(stateWriteDeps)).resolves.toBeUndefined();
    expect(stateWriteDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not persist notification state.",
      stateWriteError,
    );
    expect(stateWriteDeps.showInformationMessage).not.toHaveBeenCalled();

    const notificationError = new Error("notification failed");
    const notificationDeps = makeDeps({
      showInformationMessage: vi.fn(async () => {
        throw notificationError;
      }),
    });
    await expect(maybeShowUpgradeNotification(notificationDeps)).resolves.toBeUndefined();
    expect(notificationDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not show the upgrade notification.",
      notificationError,
    );

    const actionError = new Error("installer failed");
    const actionDeps = makeDeps({
      showInformationMessage: vi.fn(async () => RUN_INSTALLER_ACTION),
      runInstaller: vi.fn(async () => {
        throw actionError;
      }),
    });
    await expect(maybeShowUpgradeNotification(actionDeps)).resolves.toBeUndefined();
    expect(actionDeps.reportDiagnostic).toHaveBeenCalledWith(
      "The selected upgrade notification action failed.",
      actionError,
    );
  });

  it("names stale assets, customization preservation, and restart guidance", () => {
    const message = buildUpgradeNotificationMessage([
      "mcp",
      "skill:agents",
      "skill:claude",
    ]);
    expect(message).toContain("MCP runtime");
    expect(message).toContain("shared agent skill (.agents)");
    expect(message).toContain("Claude skill (.claude)");
    expect(message).toContain("customizations will be preserved");
    expect(message).toContain("restart your AI client");
  });

  it("keeps the integration-state key and installation guide target", () => {
    expect(LAST_NOTIFIED_INTEGRATION_STATE_KEY).toBe(
      "upgradeNotification.lastNotifiedIntegrationState",
    );
    expect(INSTALLATION_GUIDE_URL).toBe(
      "https://github.com/huynguyen294/ai-artifacts#getting-started",
    );
  });
});

describe("extension activation wiring", () => {
  it("uses receipts, bundled versions, detected targets, and the install-and-verify flow", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    const extensionSource = await readFile(
      path.join(repositoryRoot, "src/extension/extension.ts"),
      "utf8",
    );

    expect(extensionSource).toContain("void maybeShowUpgradeNotification({");
    expect(extensionSource).toContain("mcpVersion: MCP_VERSION");
    expect(extensionSource).toContain("skillVersion: SKILL_VERSION");
    expect(extensionSource).toContain("sessionSkillVersion: WORK_SESSION_SKILL_VERSION");
    expect(extensionSource).toContain("skillTargets: getDetectedSkillTargets()");
    expect(extensionSource).toContain("readInstalledIntegrationVersion()");
    expect(extensionSource).toContain("LAST_NOTIFIED_INTEGRATION_STATE_KEY");
    expect(extensionSource).not.toContain("context.extension.packageJSON.version");
    expect(extensionSource).not.toContain("LAST_NOTIFIED_VERSION_KEY");
    expect(extensionSource).toContain("const installAllDetectedIntegrationsAndNotify");
    expect(extensionSource).toContain("await checkAllIntegrations(context);");
    expect(extensionSource).toContain(
      "runInstaller: installAllDetectedIntegrationsAndNotify",
    );
    expect(extensionSource).toContain(
      "vscode.env.openExternal(vscode.Uri.parse(INSTALLATION_GUIDE_URL))",
    );
  });
});
