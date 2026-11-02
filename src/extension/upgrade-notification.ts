import type { IntegrationVersionManifest, InstalledSkillVersions } from "../shared/contracts";

export const LAST_NOTIFIED_INTEGRATION_STATE_KEY =
  "upgradeNotification.lastNotifiedIntegrationState";
export const RUN_INSTALLER_ACTION = "Run Installer";
export const VIEW_INSTALLATION_GUIDE_ACTION = "View Installation Guide";
export const LATER_ACTION = "Later";
export const INSTALLATION_GUIDE_URL =
  "https://github.com/huynguyen294/ai-artifacts#getting-started";

export type IntegrationSkillTarget = keyof InstalledSkillVersions;
export type StaleIntegrationAsset = "mcp" | "skill:agents" | "skill:claude";

export type IntegrationNotificationState = {
  mcpVersion: number;
  skillVersion: number;
  staleAssets: StaleIntegrationAsset[];
};

export type InstalledIntegrationVersionState =
  | { status: "valid"; manifest: IntegrationVersionManifest }
  | { status: "missing" }
  | { status: "invalid"; error: unknown };

type MaybePromise<T> = T | PromiseLike<T>;

export interface UpgradeNotificationDeps {
  bundledVersions: {
    mcpVersion: number;
    skillVersion: number;
  };
  skillTargets: readonly IntegrationSkillTarget[];
  getInstalledIntegrationVersion: () => MaybePromise<InstalledIntegrationVersionState>;
  getLastNotifiedIntegrationState: () => unknown;
  setLastNotifiedIntegrationState: (
    state: IntegrationNotificationState,
  ) => MaybePromise<void>;
  showInformationMessage: (
    message: string,
    ...actions: string[]
  ) => MaybePromise<string | undefined>;
  runInstaller: () => MaybePromise<unknown>;
  openInstallationGuide: () => MaybePromise<unknown>;
  reportDiagnostic: (message: string, error: unknown) => void;
}

function reportDiagnosticSafely(
  deps: UpgradeNotificationDeps,
  message: string,
  error: unknown,
): void {
  try {
    deps.reportDiagnostic(message, error);
  } catch {
    // Diagnostics must never affect extension activation.
  }
}

function requiredSkillTargets(
  targets: readonly IntegrationSkillTarget[],
): IntegrationSkillTarget[] {
  return targets.includes("claude") ? ["agents", "claude"] : ["agents"];
}

export function computeStaleIntegrationAssets(
  bundledVersions: UpgradeNotificationDeps["bundledVersions"],
  manifest: IntegrationVersionManifest | undefined,
  skillTargets: readonly IntegrationSkillTarget[],
): StaleIntegrationAsset[] {
  const staleAssets: StaleIntegrationAsset[] = [];
  if (manifest?.mcpVersion !== bundledVersions.mcpVersion) {
    staleAssets.push("mcp");
  }
  for (const target of requiredSkillTargets(skillTargets)) {
    if (manifest?.skills[target] !== bundledVersions.skillVersion) {
      staleAssets.push(`skill:${target}`);
    }
  }
  return staleAssets;
}

function isSameNotificationState(
  value: unknown,
  expected: IntegrationNotificationState,
): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<IntegrationNotificationState>;
  return candidate.mcpVersion === expected.mcpVersion
    && candidate.skillVersion === expected.skillVersion
    && Array.isArray(candidate.staleAssets)
    && candidate.staleAssets.length === expected.staleAssets.length
    && candidate.staleAssets.every((asset, index) => asset === expected.staleAssets[index]);
}

function assetLabel(asset: StaleIntegrationAsset): string {
  if (asset === "mcp") return "MCP runtime";
  if (asset === "skill:agents") return "shared agent skill (.agents)";
  return "Claude skill (.claude)";
}

export function buildUpgradeNotificationMessage(
  staleAssets: readonly StaleIntegrationAsset[],
): string {
  const assets = staleAssets.map(assetLabel).join(", ");
  return `AI Artifacts integration update required for: ${assets}. Valid skill customizations will be preserved. Run the installer, then restart your AI client.`;
}

export async function maybeShowUpgradeNotification(
  deps: UpgradeNotificationDeps,
): Promise<void> {
  let installedState: InstalledIntegrationVersionState;
  try {
    installedState = await deps.getInstalledIntegrationVersion();
  } catch (error) {
    reportDiagnosticSafely(deps, "Could not read installed integration versions.", error);
    installedState = { status: "missing" };
  }

  if (installedState.status === "invalid") {
    reportDiagnosticSafely(
      deps,
      "Installed integration version receipt is invalid; treating all required assets as stale.",
      installedState.error,
    );
  }
  const manifest = installedState.status === "valid" ? installedState.manifest : undefined;
  const staleAssets = computeStaleIntegrationAssets(
    deps.bundledVersions,
    manifest,
    deps.skillTargets,
  );
  const notificationState: IntegrationNotificationState = {
    ...deps.bundledVersions,
    staleAssets,
  };

  let lastNotifiedState: unknown;
  try {
    lastNotifiedState = deps.getLastNotifiedIntegrationState();
  } catch (error) {
    reportDiagnosticSafely(deps, "Could not read notification state.", error);
    return;
  }

  if (isSameNotificationState(lastNotifiedState, notificationState)) return;

  try {
    await deps.setLastNotifiedIntegrationState(notificationState);
  } catch (error) {
    reportDiagnosticSafely(deps, "Could not persist notification state.", error);
    return;
  }

  if (staleAssets.length === 0) return;

  let selectedAction: string | undefined;
  try {
    selectedAction = await deps.showInformationMessage(
      buildUpgradeNotificationMessage(staleAssets),
      RUN_INSTALLER_ACTION,
      VIEW_INSTALLATION_GUIDE_ACTION,
      LATER_ACTION,
    );
  } catch (error) {
    reportDiagnosticSafely(deps, "Could not show the upgrade notification.", error);
    return;
  }

  try {
    if (selectedAction === RUN_INSTALLER_ACTION) {
      await deps.runInstaller();
    } else if (selectedAction === VIEW_INSTALLATION_GUIDE_ACTION) {
      await deps.openInstallationGuide();
    }
  } catch (error) {
    reportDiagnosticSafely(deps, "The selected upgrade notification action failed.", error);
  }
}
