export const LAST_NOTIFIED_VERSION_KEY = "upgradeNotification.lastNotifiedVersion";
export const RUN_INSTALLER_ACTION = "Run Installer";
export const VIEW_INSTALLATION_GUIDE_ACTION = "View Installation Guide";
export const LATER_ACTION = "Later";
export const INSTALLATION_GUIDE_URL =
  "https://github.com/huynguyen294/ai-artifacts#getting-started";

type MaybePromise<T> = T | PromiseLike<T>;

export interface UpgradeNotificationDeps {
  currentVersion: unknown;
  getLastNotifiedVersion: () => unknown;
  setLastNotifiedVersion: (version: string) => MaybePromise<void>;
  showInformationMessage: (
    message: string,
    ...actions: string[]
  ) => MaybePromise<string | undefined>;
  runInstaller: () => MaybePromise<unknown>;
  openInstallationGuide: () => MaybePromise<unknown>;
  reportDiagnostic: (message: string, error: unknown) => void;
}

export function buildUpgradeNotificationMessage(version: string): string {
  return `AI Artifacts v${version} is ready. The MCP integration and agent skill may have changed. Follow the installation guide and run the installer to sync them with this version and get the latest features and improvements. Restart your AI client afterward.`;
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

export async function maybeShowUpgradeNotification(
  deps: UpgradeNotificationDeps,
): Promise<void> {
  const version =
    typeof deps.currentVersion === "string" ? deps.currentVersion.trim() : "";
  if (!version) {
    reportDiagnosticSafely(
      deps,
      "Skipped notification because the extension version is missing or invalid.",
      new TypeError("Expected a non-empty extension version."),
    );
    return;
  }

  let lastNotifiedVersion: unknown;
  try {
    lastNotifiedVersion = deps.getLastNotifiedVersion();
  } catch (error) {
    reportDiagnosticSafely(deps, "Could not read notification state.", error);
    return;
  }

  if (lastNotifiedVersion === version) return;

  try {
    await deps.setLastNotifiedVersion(version);
  } catch (error) {
    reportDiagnosticSafely(deps, "Could not persist notification state.", error);
    return;
  }

  let selectedAction: string | undefined;
  try {
    selectedAction = await deps.showInformationMessage(
      buildUpgradeNotificationMessage(version),
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
