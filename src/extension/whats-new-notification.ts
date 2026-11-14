import type { WhatsNewRelease } from "../shared/whats-new-releases";

export const VIEW_WHATS_NEW_ACTION = "View what's new";

export interface WhatsNewNotificationDeps {
  getCurrentVersion: () => unknown;
  releases: readonly WhatsNewRelease[];
  recordVersion: (
    version: string,
    notifyEnabled: boolean,
  ) => Promise<boolean>;
  showInformationMessage: (
    message: string,
    ...actions: string[]
  ) => string | undefined | PromiseLike<string | undefined>;
  openVersion: (version: string) => unknown | PromiseLike<unknown>;
  reportDiagnostic: (message: string, error: unknown) => void;
}

function reportDiagnosticSafely(
  deps: WhatsNewNotificationDeps,
  message: string,
  error: unknown,
): void {
  try {
    deps.reportDiagnostic(message, error);
  } catch {
    // Diagnostics must never reject or affect extension activation.
  }
}

export async function runWhatsNewNotification(
  deps: WhatsNewNotificationDeps,
): Promise<void> {
  let rawVersion: unknown;
  try {
    rawVersion = deps.getCurrentVersion();
  } catch (versionError) {
    reportDiagnosticSafely(deps, "Could not read current extension version.", versionError);
    return;
  }

  if (typeof rawVersion !== "string" || rawVersion.length === 0) {
    reportDiagnosticSafely(
      deps,
      "Current extension version is missing or not a non-empty string.",
      rawVersion,
    );
    return;
  }

  const currentVersion = rawVersion;
  const matchingRelease = deps.releases.find((release) => release.version === currentVersion);
  const notifyEnabled = matchingRelease?.notify === true;

  let shouldNotify: boolean;
  try {
    shouldNotify = await deps.recordVersion(currentVersion, notifyEnabled);
  } catch (stateError) {
    reportDiagnosticSafely(deps, "Could not update What's New notification state.", stateError);
    return;
  }

  if (!shouldNotify || !matchingRelease || !notifyEnabled) {
    return;
  }

  let selectedAction: string | undefined;
  try {
    selectedAction = await deps.showInformationMessage(
      `AI Artifacts ${currentVersion}: ${matchingRelease.notificationTitle ?? matchingRelease.title}`,
      VIEW_WHATS_NEW_ACTION,
    );
  } catch (uiError) {
    reportDiagnosticSafely(deps, "Could not show What's New upgrade notification.", uiError);
    return;
  }

  if (selectedAction !== VIEW_WHATS_NEW_ACTION) {
    return;
  }

  try {
    await deps.openVersion(currentVersion);
  } catch (openError) {
    reportDiagnosticSafely(
      deps,
      `Could not open What's New for version ${currentVersion}.`,
      openError,
    );
  }
}

