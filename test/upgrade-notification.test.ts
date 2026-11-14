import { describe, expect, it, vi } from "vitest";
import {
  CODEX_TROUBLESHOOTING_GUIDE_URL,
  computeStaleIntegrationAssets,
  INSTALLATION_GUIDE_URL,
  runAutomaticIntegrationUpgrade,
  VIEW_INSTALLATION_GUIDE_ACTION,
  type AutomaticIntegrationUpgradeDeps,
} from "../src/extension/upgrade-notification";
import { CODEX_UNEXPECTED_KEY_CONFLICT } from "../src/extension/mcp-config";
import type { IntegrationUpgradeReport } from "../src/extension/workspace-integration";
import type {
  IntegrationVersionManifest,
  InstalledSkillVersions,
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
    upgradeIntegrations: vi.fn(async (): Promise<IntegrationUpgradeReport> => ({
      clientIds: ["codex"],
      skillTargets: ["agents"],
      updatedAssets: ["mcp"],
      clients: [{ id: "codex", name: "Codex", status: "updated" }],
    })),
    refreshIntegrationSupport: vi.fn(),
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
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
    expect(deps.openInstallationGuide).not.toHaveBeenCalled();
    expect(deps.reportDiagnostic).not.toHaveBeenCalled();
  });

  it("stays silent for unchanged, definition-only, and empty reports without suppressing repeat runs", async () => {
    const unchangedDeps = makeDeps({
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

    await runAutomaticIntegrationUpgrade(unchangedDeps);
    await runAutomaticIntegrationUpgrade(unchangedDeps);

    expect(unchangedDeps.upgradeIntegrations).toHaveBeenCalledTimes(2);
    expect(unchangedDeps.refreshIntegrationSupport).toHaveBeenCalledTimes(2);
    expect(unchangedDeps.showErrorMessage).not.toHaveBeenCalled();
    expect(unchangedDeps.openInstallationGuide).not.toHaveBeenCalled();

    const emptyDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => emptyReport()),
    });
    await runAutomaticIntegrationUpgrade(emptyDeps);
    expect(emptyDeps.refreshIntegrationSupport).toHaveBeenCalledTimes(1);
    expect(emptyDeps.showErrorMessage).not.toHaveBeenCalled();
    expect(emptyDeps.openInstallationGuide).not.toHaveBeenCalled();
    expect(emptyDeps.reportDiagnostic).not.toHaveBeenCalled();
  });

  it("shows one aggregated error preserving report order for failed clients while excluding healthy clients and mentioning Installer once", async () => {
    const deps = makeDeps({
      upgradeIntegrations: vi.fn(async (): Promise<IntegrationUpgradeReport> => ({
        clientIds: ["copilot", "codex", "cursor", "antigravity"],
        skillTargets: ["agents", "antigravity"],
        updatedAssets: ["mcp"],
        clients: [
          { id: "copilot", name: "GitHub Copilot (VS Code)", status: "updated" },
          { id: "codex", name: "Codex", status: "failed", detail: "   " },
          { id: "cursor", name: "Cursor", status: "unchanged" },
          { id: "antigravity", name: "Antigravity", status: "failed", detail: "Malformed mcp_config.json" },
        ],
      })),
    });

    await runAutomaticIntegrationUpgrade(deps);

    expect(deps.refreshIntegrationSupport).toHaveBeenCalledTimes(1);
    expect(deps.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(deps.reportDiagnostic).toHaveBeenCalledTimes(1);

    const [message, ...actions] = vi.mocked(deps.showErrorMessage).mock.calls[0]!;
    expect(actions).toEqual([VIEW_INSTALLATION_GUIDE_ACTION]);
    expect(message).toContain("AI Artifacts automatic upgrade failed for one or more clients.");
    expect(message).not.toContain("GitHub Copilot");
    expect(message).not.toContain("Cursor");
    expect(message.match(/AI Artifacts: Installer/g)).toHaveLength(1);

    const codexPos = message.indexOf("Codex: Automatic upgrade failed.");
    const agPos = message.indexOf("Antigravity: Malformed mcp_config.json.");
    expect(codexPos).toBeGreaterThanOrEqual(0);
    expect(agPos).toBeGreaterThan(codexPos);
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
    expect(deps.showErrorMessage).toHaveBeenCalledTimes(1);
    const [message, ...actions] = vi.mocked(deps.showErrorMessage).mock.calls[0]!;
    expect(message).toContain("ENOENT: packaged mcp server missing");
    expect(actions).toEqual([VIEW_INSTALLATION_GUIDE_ACTION]);
  });

  it("opens guide only when chosen and isolates refresh, UI, guide, and diagnostic failures", async () => {
    const failedReport = (): IntegrationUpgradeReport => ({
      clientIds: ["codex"],
      skillTargets: ["agents"],
      updatedAssets: [],
      clients: [{ id: "codex", name: "Codex", status: "failed", detail: "EACCES writing config" }],
    });

    // Clicking View Installation Guide on non-conflict failure opens getting-started guide
    const openDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => failedReport()),
      showErrorMessage: vi.fn(async () => VIEW_INSTALLATION_GUIDE_ACTION),
    });
    await runAutomaticIntegrationUpgrade(openDeps);
    expect(openDeps.openInstallationGuide).toHaveBeenCalledTimes(1);
    expect(openDeps.openInstallationGuide).toHaveBeenCalledWith(INSTALLATION_GUIDE_URL);
    expect(INSTALLATION_GUIDE_URL).toBe(
      "https://github.com/huynguyen294/ai-artifacts#getting-started",
    );

    // Clicking View Installation Guide on CODEX_UNEXPECTED_KEY_CONFLICT routes directly to Codex TOML troubleshooting section
    const conflictOpenDeps = makeDeps({
      upgradeIntegrations: vi.fn(async (): Promise<IntegrationUpgradeReport> => ({
        clientIds: ["codex", "cursor"],
        skillTargets: ["agents"],
        updatedAssets: ["mcp"],
        clients: [
          {
            id: "codex",
            name: "Codex",
            status: "failed",
            detail: "Unexpected key followUpQueueMode",
            errorCode: CODEX_UNEXPECTED_KEY_CONFLICT,
          },
          { id: "cursor", name: "Cursor", status: "updated" },
        ],
      })),
      showErrorMessage: vi.fn(async () => VIEW_INSTALLATION_GUIDE_ACTION),
    });
    await runAutomaticIntegrationUpgrade(conflictOpenDeps);
    expect(conflictOpenDeps.openInstallationGuide).toHaveBeenCalledWith(CODEX_TROUBLESHOOTING_GUIDE_URL);
    expect(CODEX_TROUBLESHOOTING_GUIDE_URL).toBe(
      "https://github.com/huynguyen294/ai-artifacts#codex-toml-unexpected-keys-or-missing-section-header",
    );

    // Dismissing does not open guide
    const dismissDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => failedReport()),
      showErrorMessage: vi.fn(async () => undefined),
    });
    await runAutomaticIntegrationUpgrade(dismissDeps);
    expect(dismissDeps.openInstallationGuide).not.toHaveBeenCalled();

    // UI failure is contained cleanly
    const uiError = new Error("window showErrorMessage failed");
    const uiFailDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => failedReport()),
      showErrorMessage: vi.fn(async () => {
        throw uiError;
      }),
    });
    await expect(runAutomaticIntegrationUpgrade(uiFailDeps)).resolves.toBeUndefined();
    expect(uiFailDeps.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(uiFailDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not show automatic upgrade notification.",
      uiError,
    );

    // Guide open failure is contained
    const guideError = new Error("openExternal failed");
    const guideFailDeps = makeDeps({
      upgradeIntegrations: vi.fn(async () => failedReport()),
      showErrorMessage: vi.fn(async () => VIEW_INSTALLATION_GUIDE_ACTION),
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
      upgradeIntegrations: vi.fn(async () => failedReport()),
      refreshIntegrationSupport: vi.fn(() => {
        throw new Error("refresh failed");
      }),
      reportDiagnostic: vi.fn(() => {
        throw new Error("diagnostic failed");
      }),
    });
    await expect(runAutomaticIntegrationUpgrade(refreshFailDeps)).resolves.toBeUndefined();
    expect(refreshFailDeps.showErrorMessage).toHaveBeenCalledTimes(1);
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
