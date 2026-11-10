import type {
  IntegrationVersionManifest,
  InstalledSkillVersions,
  McpClientId,
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

export type InstalledIntegrationVersionState =
  | { status: "valid"; manifest: IntegrationVersionManifest }
  | { status: "missing" }
  | { status: "invalid"; error: unknown };

type MaybePromise<T> = T | PromiseLike<T>;

export interface AutomaticIntegrationUpgradeDeps {
  bundledVersions: BundledIntegrationVersions;
  upgradeIntegrations: () => Promise<IntegrationUpgradeReport>;
  getInstalledIntegrationVersion: () => MaybePromise<InstalledIntegrationVersionState>;
  refreshIntegrationSupport: () => void;
  showWarningMessage: (
    message: string,
    ...actions: string[]
  ) => MaybePromise<string | undefined>;
  showErrorMessage: (
    message: string,
    ...actions: string[]
  ) => MaybePromise<string | undefined>;
  openInstallationGuide: () => MaybePromise<unknown>;
  reportDiagnostic: (message: string, error: unknown) => void;
}

const INSTALL_CLIENT_COMMAND_TITLES: Record<McpClientId, string> = {
  copilot: "AI Artifacts: Install Integration for GitHub Copilot",
  cursor: "AI Artifacts: Install Integration for Cursor",
  codex: "AI Artifacts: Install Integration for Codex",
  claude: "AI Artifacts: Install Integration for Claude",
  windsurf: "AI Artifacts: Install Integration for Windsurf",
  cline: "AI Artifacts: Install Integration for Cline",
  antigravity: "AI Artifacts: Install Integration for Antigravity",
};

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

function formatClientAttentionItem(client: IntegrationUpgradeClientReport): string {
  const fallbackDetail =
    client.status === "setup-required"
      ? "Manual setup is required."
      : "Automatic upgrade failed.";
  const detail = ensureSentenceEnding(client.detail?.trim() || fallbackDetail);
  const commandTitle = INSTALL_CLIENT_COMMAND_TITLES[client.id];
  return `${client.name} (${client.status}): ${detail} Run "${commandTitle}" from the Command Palette.`;
}

async function notifyWithGuideAction(
  deps: AutomaticIntegrationUpgradeDeps,
  severity: "warning" | "error",
  message: string,
): Promise<void> {
  let selectedAction: string | undefined;
  try {
    selectedAction =
      severity === "error"
        ? await deps.showErrorMessage(message, VIEW_INSTALLATION_GUIDE_ACTION)
        : await deps.showWarningMessage(message, VIEW_INSTALLATION_GUIDE_ACTION);
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
    await notifyWithGuideAction(
      deps,
      "error",
      `AI Artifacts automatic upgrade could not complete: ${detail} Run the install command for your AI client from the Command Palette, or view the installation guide.`,
    );
    return;
  }

  if (report.clientIds.length === 0) {
    let installedState: InstalledIntegrationVersionState;
    try {
      installedState = await deps.getInstalledIntegrationVersion();
    } catch (readError) {
      reportDiagnosticSafely(deps, "Could not read installed integration versions.", readError);
      const detail = ensureSentenceEnding(errorMessage(readError));
      await notifyWithGuideAction(
        deps,
        "error",
        `AI Artifacts could not read installed integration status: ${detail} Run the install command for your AI client from the Command Palette if integrations are missing, or view the installation guide.`,
      );
      return;
    }

    if (installedState.status === "invalid") {
      reportDiagnosticSafely(
        deps,
        "Installed integration version receipt is invalid; treating shared assets as stale.",
        installedState.error,
      );
    }

    const manifest = installedState.status === "valid" ? installedState.manifest : undefined;
    const staleSharedAssets = computeStaleIntegrationAssets(
      deps.bundledVersions,
      manifest,
      ["agents"],
    );
    if (staleSharedAssets.length === 0) {
      return;
    }

    await notifyWithGuideAction(
      deps,
      "warning",
      "AI Artifacts integration assets require manual setup because no configured AI client was detected or saved. Run the install command for your AI client from the Command Palette, or view the installation guide.",
    );
    return;
  }

  const attentionClients = report.clients.filter(
    (client) => client.status === "failed" || client.status === "setup-required",
  );
  if (attentionClients.length === 0) {
    return;
  }

  const hasFailed = attentionClients.some((client) => client.status === "failed");
  reportDiagnosticSafely(
    deps,
    hasFailed
      ? "Automatic integration upgrade reported failures."
      : "Automatic integration upgrade requires manual client setup.",
    attentionClients,
  );

  const items = attentionClients.map(formatClientAttentionItem).join(" ");
  const prefix = hasFailed
    ? "AI Artifacts automatic upgrade failed for one or more clients."
    : "AI Artifacts automatic upgrade needs attention.";
  await notifyWithGuideAction(
    deps,
    hasFailed ? "error" : "warning",
    `${prefix} ${items} Or view the installation guide.`,
  );
}
