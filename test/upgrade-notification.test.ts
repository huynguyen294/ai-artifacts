import { describe, expect, it, vi } from "vitest";
import {
  computeStaleIntegrationAssets,
  INSTALLATION_GUIDE_URL,
  runAutomaticIntegrationUpgrade,
  VIEW_INSTALLATION_GUIDE_ACTION,
  type AutomaticIntegrationUpgradeDeps,
  type InstalledIntegrationVersionState,
} from "../src/extension/upgrade-notification";
import type { IntegrationUpgradeReport } from "../src/extension/workspace-integration";
import type {
  IntegrationVersionManifest,
  InstalledSkillVersions,
  McpClientId,
} from "../src/shared/contracts";

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
    updatedAt: "2026-11-10T00:00:00.000Z",
  };
}

function emptyReport(): IntegrationUpgradeReport {
  return {
    clientIds: [],
    skillTargets: [],
    updatedAssets: [],
    clients: [],
  };
}

function makeDeps(
  overrides: Partial<AutomaticIntegrationUpgradeDeps> = {},
): AutomaticIntegrationUpgradeDeps {
  return {
    bundledVersions: { mcpVersion: 12, skillVersion: 4, sessionSkillVersion: 1 },
    upgradeIntegrations: vi.fn(async (): Promise<IntegrationUpgradeReport> => ({
      clientIds: ["codex"],
      skillTargets: ["agents"],
      updatedAssets: ["mcp"],
      clients: [{ id: "codex", name: "Codex", status: "updated" }],
    })),
    getInstalledIntegrationVersion: vi.fn<() => InstalledIntegrationVersionState>(() => ({
      status: "missing",
    })),
    refreshIntegrationSupport: vi.fn(),
    showWarningMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined),
    openInstallationGuide: vi.fn(async () => undefined),
    reportDiagnostic: vi.fn(),
    ...overrides,
  };
}

describe("automatic integration upgrade controller", () => {
  it("runs coordinator first and stays silent on successful asset and client upgrades while refreshing once", async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      upgradeIntegrations: vi.fn(async (): Promise<IntegrationUpgradeReport> => {
        callOrder.push("upgrade");
        return {
          clientIds: ["codex", "antigravity"],
          skillTargets: ["agents", "antigravity"],
          updatedAssets: ["mcp", "skill:agents", "skill:antigravity", "session-skill:antigravity"],
          clients: [
            { id: "codex", name: "Codex", status: "updated" },
            { id: "antigravity", name: "Antigravity", status: "updated" },
          ],
        };
      }),
      refreshIntegrationSupport: vi.fn(() => {
        callOrder.push("refresh");
      }),
    });

    await runAutomaticIntegrationUpgrade(deps);

    expect(callOrder).toEqual(["upgrade", "refresh"]);
    expect(deps.getInstalledIntegrationVersion).not.toHaveBeenCalled();
    expect(deps.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
    expect(deps.openInstallationGuide).not.toHaveBeenCalled();
    expect(deps.reportDiagnostic).not.toHaveBeenCalled();
  });

  it("stays silent for all-unchanged and definition-only updates without reading extra receipts or suppressing repeat runs", async () => {
    const deps = makeDeps({
      upgradeIntegrations: vi.fn(async (): Promise<IntegrationUpgradeReport> => ({
        clientIds: ["cursor", "codex"],
        skillTargets: ["agents"],
        updatedAssets: [],
        clients: [
          { id: "cursor", name: "Cursor", status: "unchanged" },
          { id: "codex", name: "Codex", status: "updated" },
        ],
      })),
    });

    await runAutomaticIntegrationUpgrade(deps);
    await runAutomaticIntegrationUpgrade(deps);

    expect(deps.upgradeIntegrations).toHaveBeenCalledTimes(2);
    expect(deps.refreshIntegrationSupport).toHaveBeenCalledTimes(2);
    expect(deps.getInstalledIntegrationVersion).not.toHaveBeenCalled();
    expect(deps.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });

  it("shows a single warning with exact per-client install commands for setup-required clients including saved-only and Antigravity", async () => {
    const allSetupClients: Array<[McpClientId, string, string]> = [
      ["copilot", "GitHub Copilot", "AI Artifacts: Install Integration for GitHub Copilot"],
      ["cursor", "Cursor", "AI Artifacts: Install Integration for Cursor"],
      ["codex", "Codex", "AI Artifacts: Install Integration for Codex"],
      ["claude", "Claude", "AI Artifacts: Install Integration for Claude"],
      ["windsurf", "Windsurf", "AI Artifacts: Install Integration for Windsurf"],
      ["cline", "Cline", "AI Artifacts: Install Integration for Cline"],
      ["antigravity", "Antigravity", "AI Artifacts: Install Integration for Antigravity"],
    ];

    const deps = makeDeps({
      upgradeIntegrations: vi.fn(async (): Promise<IntegrationUpgradeReport> => ({
        clientIds: allSetupClients.map(([id]) => id),
        skillTargets: ["agents", "claude", "antigravity"],
        updatedAssets: ["mcp"],
        clients: allSetupClients.map(([id, name], index) => ({
          id,
          name,
          status: index === 1 ? ("unchanged" as const) : ("setup-required" as const),
          ...(index === 1 ? {} : { detail: `  Missing entry for ${name}  ` }),
        })),
      })),
    });

    await runAutomaticIntegrationUpgrade(deps);

    expect(deps.refreshIntegrationSupport).toHaveBeenCalledTimes(1);
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
    expect(deps.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(deps.reportDiagnostic).toHaveBeenCalledTimes(1);

    const [message, ...actions] = vi.mocked(deps.showWarningMessage).mock.calls[0]!;
    expect(actions).toEqual([VIEW_INSTALLATION_GUIDE_ACTION]);
    expect(message).not.toContain("Run Installer");
    expect(message).not.toContain("Install All Detected Integrations");
    expect(message).not.toContain("Cursor (unchanged)");

    let previousPos = -1;
    for (const [id, name, commandTitle] of allSetupClients) {
      if (id === "cursor") continue;
      const expectedSegment = `${name} (setup-required): Missing entry for ${name}. Run "${commandTitle}"`;
      const idx = message.indexOf(expectedSegment);
      expect(idx).toBeGreaterThan(previousPos);
      previousPos = idx;
    }
  });

  it("shows a single error preserving report order and fallback details when failed mixes with setup-required and healthy clients", async () => {
    const deps = makeDeps({
      upgradeIntegrations: vi.fn(async (): Promise<IntegrationUpgradeReport> => ({
        clientIds: ["copilot", "codex", "claude", "antigravity"],
        skillTargets: ["agents", "claude", "antigravity"],
        updatedAssets: ["mcp"],
        clients: [
          { id: "copilot", name: "GitHub Copilot", status: "updated" },
          { id: "codex", name: "Codex", status: "failed", detail: "  " },
          { id: "claude", name: "Claude", status: "setup-required" },
          { id: "antigravity", name: "Antigravity", status: "failed", detail: "Malformed mcp_config.json" },
        ],
      })),
    });

    await runAutomaticIntegrationUpgrade(deps);

    expect(deps.refreshIntegrationSupport).toHaveBeenCalledTimes(1);
    expect(deps.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(deps.reportDiagnostic).toHaveBeenCalledTimes(1);

    const [message, ...actions] = vi.mocked(deps.showErrorMessage).mock.calls[0]!;
    expect(actions).toEqual([VIEW_INSTALLATION_GUIDE_ACTION]);
    expect(message).not.toContain("GitHub Copilot");

    const codexPos = message.indexOf(
      'Codex (failed): Automatic upgrade failed. Run "AI Artifacts: Install Integration for Codex"',
    );
    const claudePos = message.indexOf(
      'Claude (setup-required): Manual setup is required. Run "AI Artifacts: Install Integration for Claude"',
    );
    const agPos = message.indexOf(
      'Antigravity (failed): Malformed mcp_config.json. Run "AI Artifacts: Install Integration for Antigravity"',
    );
    expect(codexPos).toBeGreaterThanOrEqual(0);
    expect(claudePos).toBeGreaterThan(codexPos);
    expect(agPos).toBeGreaterThan(claudePos);
  });

  it("shows a single error with original message, logs diagnostic, refreshes once, and resolves when coordinator rejects", async () => {
    const boom = new Error("ENOENT: packaged mcp server missing");
    const callOrder: string[] = [];
    const deps = makeDeps({
      upgradeIntegrations: vi.fn(async () => {
        callOrder.push("upgrade-throw");
        throw boom;
      }),
      refreshIntegrationSupport: vi.fn(() => {
        callOrder.push("refresh");
      }),
      reportDiagnostic: vi.fn(() => {
        callOrder.push("diagnostic");
      }),
      showErrorMessage: vi.fn(async () => {
        callOrder.push("error-popup");
        return undefined;
      }),
    });

    await expect(runAutomaticIntegrationUpgrade(deps)).resolves.toBeUndefined();

    expect(callOrder).toEqual(["upgrade-throw", "diagnostic", "refresh", "error-popup"]);
    expect(deps.reportDiagnostic).toHaveBeenCalledWith(
      "Automatic integration upgrade failed.",
      boom,
    );
    expect(deps.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).toHaveBeenCalledTimes(1);
    const [message, ...actions] = vi.mocked(deps.showErrorMessage).mock.calls[0]!;
    expect(message).toContain("ENOENT: packaged mcp server missing");
    expect(actions).toEqual([VIEW_INSTALLATION_GUIDE_ACTION]);
  });

  it("handles empty reports using only shared agents assets unless receipt read rejects", async () => {
    // 1. Current shared receipt stays silent even if old Claude/Antigravity receipt entries are stale
    const currentDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => emptyReport()),
      getInstalledIntegrationVersion: vi.fn<() => InstalledIntegrationVersionState>(() => ({
        status: "valid",
        manifest: manifest(12, { agents: 4, claude: 1 }, { agents: 1, antigravity: 1 }),
      })),
    });
    await runAutomaticIntegrationUpgrade(currentDeps);
    expect(currentDeps.refreshIntegrationSupport).toHaveBeenCalledTimes(1);
    expect(currentDeps.showWarningMessage).not.toHaveBeenCalled();
    expect(currentDeps.showErrorMessage).not.toHaveBeenCalled();
    expect(currentDeps.reportDiagnostic).not.toHaveBeenCalled();

    // 2. Missing receipt triggers one setup warning
    const missingDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => emptyReport()),
      getInstalledIntegrationVersion: vi.fn<() => InstalledIntegrationVersionState>(() => ({
        status: "missing",
      })),
    });
    await runAutomaticIntegrationUpgrade(missingDeps);
    expect(missingDeps.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(missingDeps.showErrorMessage).not.toHaveBeenCalled();
    expect(vi.mocked(missingDeps.showWarningMessage).mock.calls[0]?.[1]).toBe(
      VIEW_INSTALLATION_GUIDE_ACTION,
    );

    // 3. Invalid receipt logs diagnostic and warns
    const invalidError = new SyntaxError("Unexpected token");
    const invalidDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => emptyReport()),
      getInstalledIntegrationVersion: vi.fn<() => InstalledIntegrationVersionState>(() => ({
        status: "invalid",
        error: invalidError,
      })),
    });
    await runAutomaticIntegrationUpgrade(invalidDeps);
    expect(invalidDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Installed integration version receipt is invalid; treating shared assets as stale.",
      invalidError,
    );
    expect(invalidDeps.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(invalidDeps.showErrorMessage).not.toHaveBeenCalled();

    // 4. Stale shared receipt triggers warning
    const staleDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => emptyReport()),
      getInstalledIntegrationVersion: vi.fn<() => InstalledIntegrationVersionState>(() => ({
        status: "valid",
        manifest: manifest(11, { agents: 4 }, { agents: 1 }),
      })),
    });
    await runAutomaticIntegrationUpgrade(staleDeps);
    expect(staleDeps.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(staleDeps.showErrorMessage).not.toHaveBeenCalled();

    // 5. Read I/O error becomes an error popup preserving original message, not a setup warning
    const readIoError = new Error("EACCES: permission denied");
    const ioErrorDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => emptyReport()),
      getInstalledIntegrationVersion: vi.fn(async () => {
        throw readIoError;
      }),
    });
    await expect(runAutomaticIntegrationUpgrade(ioErrorDeps)).resolves.toBeUndefined();
    expect(ioErrorDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not read installed integration versions.",
      readIoError,
    );
    expect(ioErrorDeps.showWarningMessage).not.toHaveBeenCalled();
    expect(ioErrorDeps.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ioErrorDeps.showErrorMessage).mock.calls[0]?.[0]).toContain(
      "EACCES: permission denied",
    );
  });

  it("opens guide only when chosen and isolates refresh, UI, guide, and diagnostic failures", async () => {
    const setupReport = (): IntegrationUpgradeReport => ({
      clientIds: ["codex"],
      skillTargets: ["agents"],
      updatedAssets: [],
      clients: [{ id: "codex", name: "Codex", status: "setup-required", detail: "Missing entry" }],
    });

    // Clicking View Installation Guide opens external guide
    const openDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => setupReport()),
      showWarningMessage: vi.fn(async () => VIEW_INSTALLATION_GUIDE_ACTION),
    });
    await runAutomaticIntegrationUpgrade(openDeps);
    expect(openDeps.openInstallationGuide).toHaveBeenCalledTimes(1);
    expect(INSTALLATION_GUIDE_URL).toBe(
      "https://github.com/huynguyen294/ai-artifacts#getting-started",
    );

    // Dismissing does not open guide
    const dismissDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => setupReport()),
      showWarningMessage: vi.fn(async () => undefined),
    });
    await runAutomaticIntegrationUpgrade(dismissDeps);
    expect(dismissDeps.openInstallationGuide).not.toHaveBeenCalled();

    // UI failure is contained and does not re-notify with error
    const uiError = new Error("window showWarningMessage failed");
    const uiFailDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => setupReport()),
      showWarningMessage: vi.fn(async () => {
        throw uiError;
      }),
    });
    await expect(runAutomaticIntegrationUpgrade(uiFailDeps)).resolves.toBeUndefined();
    expect(uiFailDeps.showErrorMessage).not.toHaveBeenCalled();
    expect(uiFailDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not show automatic upgrade notification.",
      uiError,
    );

    // Guide open failure is contained
    const guideError = new Error("openExternal failed");
    const guideFailDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => setupReport()),
      showWarningMessage: vi.fn(async () => VIEW_INSTALLATION_GUIDE_ACTION),
      openInstallationGuide: vi.fn(async () => {
        throw guideError;
      }),
    });
    await expect(runAutomaticIntegrationUpgrade(guideFailDeps)).resolves.toBeUndefined();
    expect(guideFailDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not open installation guide.",
      guideError,
    );

    // Refresh & diagnostic throwing still resolve cleanly
    const refreshFailDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => setupReport()),
      refreshIntegrationSupport: vi.fn(() => {
        throw new Error("refresh failed");
      }),
      reportDiagnostic: vi.fn(() => {
        throw new Error("diagnostic failed");
      }),
    });
    await expect(runAutomaticIntegrationUpgrade(refreshFailDeps)).resolves.toBeUndefined();
    expect(refreshFailDeps.showWarningMessage).toHaveBeenCalledTimes(1);
  });
});

describe("computeStaleIntegrationAssets", () => {
  it("computes stale MCP, review-skill, and session-skill assets across agents, claude, and antigravity deterministically", () => {
    expect(
      computeStaleIntegrationAssets(
        { mcpVersion: 12, skillVersion: 4, sessionSkillVersion: 1 },
        undefined,
        ["antigravity", "claude", "agents", "antigravity"],
      ),
    ).toEqual([
      "mcp",
      "skill:agents",
      "session-skill:agents",
      "skill:claude",
      "session-skill:claude",
      "skill:antigravity",
      "session-skill:antigravity",
    ]);

    expect(
      computeStaleIntegrationAssets(
        { mcpVersion: 12, skillVersion: 4, sessionSkillVersion: 1 },
        manifest(
          12,
          { agents: 4, claude: 4, antigravity: 4 },
          { agents: 1, claude: 1, antigravity: 1 },
        ),
        ["agents", "claude", "antigravity"],
      ),
    ).toEqual([]);

    expect(
      computeStaleIntegrationAssets(
        { mcpVersion: 12, skillVersion: 4, sessionSkillVersion: 1 },
        manifest(12, { agents: 4, antigravity: 3 }, { agents: 1, antigravity: 1 }),
        ["agents", "antigravity"],
      ),
    ).toEqual(["skill:antigravity"]);

    expect(
      computeStaleIntegrationAssets(
        { mcpVersion: 12, skillVersion: 4 },
        manifest(12, { agents: 4 }, { agents: 1 }),
        ["agents"],
      ),
    ).toEqual([]);
  });
});
