import type {
  IntegrationVersionManifest,
  InstalledSkillVersions,
} from "../shared/contracts";
import type {
  IntegrationUpgradeClientReport,
  IntegrationUpgradeReport,
} from "./workspace-integration";

export const VIEW_INSTALLATION_GUIDE_ACTION = "View Installation Guide";
export const INSTALLATION_GUIDE_URL =
  "https://github.com/huynguyen294/ai-artifacts#getting-started";

export type IntegrationSkillTarget = keyof InstalledSkillVersions;
export type StaleIntegrationAsset =
  | "mcp"
  | "skill:agents"
  | "skill:claude"
  | "skill:antigravity"
  | "session-skill:agents"
  | "session-skill:claude"
  | "session-skill:antigravity";

export type BundledIntegrationVersions = {
  mcpVersion: number;
  skillVersion: number;
  sessionSkillVersion?: number;
};

type MaybePromise<T> = T | PromiseLike<T>;

export interface AutomaticIntegrationUpgradeDeps {
  upgradeIntegrations: () => Promise<IntegrationUpgradeReport>;
  refreshIntegrationSupport: () => void;
  showErrorMessage: (
    message: string,
    ...actions: string[]
  ) => MaybePromise<string | undefined>;
  openInstallationGuide: () => MaybePromise<unknown>;
  reportDiagnostic: (message: string, error: unknown) => void;
}

function reportDiagnosticSafely(
  deps: AutomaticIntegrationUpgradeDeps,
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
  const required: IntegrationSkillTarget[] = ["agents"];
  if (targets.includes("claude")) required.push("claude");
  if (targets.includes("antigravity")) required.push("antigravity");
  return required;
}

export function computeStaleIntegrationAssets(
  bundledVersions: BundledIntegrationVersions,
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
    if (
      bundledVersions.sessionSkillVersion !== undefined
      && manifest?.sessionSkills?.[target] !== bundledVersions.sessionSkillVersion
    ) {
      staleAssets.push(`session-skill:${target}`);
    }
  }
  return staleAssets;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  return trimmed || "Unknown error.";
}

function ensureSentenceEnding(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function formatClientFailureItem(client: IntegrationUpgradeClientReport): string {
  const detail = ensureSentenceEnding(client.detail?.trim() || "Automatic upgrade failed.");
  return `${client.name}: ${detail}`;
}

async function notifyErrorWithGuideAction(
  deps: AutomaticIntegrationUpgradeDeps,
  message: string,
): Promise<void> {
  let selectedAction: string | undefined;
  try {
    selectedAction = await deps.showErrorMessage(message, VIEW_INSTALLATION_GUIDE_ACTION);
  } catch (uiError) {
    reportDiagnosticSafely(deps, "Could not show automatic upgrade notification.", uiError);
    return;
  }

  if (selectedAction !== VIEW_INSTALLATION_GUIDE_ACTION) {
    return;
  }

  try {
    await deps.openInstallationGuide();
  } catch (guideError) {
    reportDiagnosticSafely(deps, "Could not open installation guide.", guideError);
  }
}

export async function runAutomaticIntegrationUpgrade(
  deps: AutomaticIntegrationUpgradeDeps,
): Promise<void> {
  let report: IntegrationUpgradeReport | undefined;
  let upgradeError: unknown;
  let upgradeFailed = false;

  try {
    report = await deps.upgradeIntegrations();
  } catch (error) {
    upgradeFailed = true;
    upgradeError = error;
    reportDiagnosticSafely(deps, "Automatic integration upgrade failed.", error);
  } finally {
    try {
      deps.refreshIntegrationSupport();
    } catch (refreshError) {
      reportDiagnosticSafely(
        deps,
        "Could not refresh integration support after automatic upgrade.",
        refreshError,
      );
    }
  }

  if (upgradeFailed || !report) {
    const detail = ensureSentenceEnding(errorMessage(upgradeError));
    await notifyErrorWithGuideAction(
      deps,
      `AI Artifacts automatic upgrade could not complete: ${detail} Run "AI Artifacts: Installer" from the Command Palette, or view the installation guide.`,
    );
    return;
  }

  const failedClients = report.clients.filter((client) => client.status === "failed");
  if (failedClients.length === 0) {
    return;
  }

  reportDiagnosticSafely(
    deps,
    "Automatic integration upgrade reported failures.",
    failedClients,
  );

  const items = failedClients.map(formatClientFailureItem).join(" ");
  await notifyErrorWithGuideAction(
    deps,
    `AI Artifacts automatic upgrade failed for one or more clients. ${items} Run "AI Artifacts: Installer" from the Command Palette and select the failed client(s), or view the installation guide.`,
  );
}
