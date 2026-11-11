export const RELOAD_WINDOW_ACTION = "Reload Window";

const DEFAULT_EMPTY_INSTALL_MESSAGE = "AI Artifacts Installer: No AI clients were installed.";

type MaybePromise<T> = T | PromiseLike<T>;

export type InstallationNotificationResult = {
  installedClients: readonly string[];
  failedClients: readonly { name: string; error: string }[];
};

export interface InstallationNotificationDeps {
  showInformationMessage: (
    message: string,
    ...actions: string[]
  ) => MaybePromise<string | undefined>;
  showWarningMessage: (
    message: string,
    ...actions: string[]
  ) => MaybePromise<string | undefined>;
  showErrorMessage: (
    message: string,
    ...actions: string[]
  ) => MaybePromise<string | undefined>;
  reloadWindow: () => MaybePromise<unknown>;
  reportDiagnostic: (message: string, error: unknown) => void;
}

function reportDiagnosticSafely(
  deps: InstallationNotificationDeps,
  message: string,
  error: unknown,
): void {
  try {
    deps.reportDiagnostic(message, error);
  } catch {
    // Diagnostics must never convert notification or reload failures into install failures.
  }
}

function formatErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  return trimmed || "Unknown error.";
}

function formatFailedClients(
  failedClients: readonly { name: string; error: string }[],
): string {
  return failedClients
    .map((client) => `${client.name} (${client.error.trim() || "Unknown error."})`)
    .join("; ");
}

async function showReloadPromptAndHandleAction(
  deps: InstallationNotificationDeps,
  severity: "information" | "warning",
  message: string,
): Promise<void> {
  let selectedAction: string | undefined;
  try {
    selectedAction =
      severity === "warning"
        ? await deps.showWarningMessage(message, RELOAD_WINDOW_ACTION)
        : await deps.showInformationMessage(message, RELOAD_WINDOW_ACTION);
  } catch (uiError) {
    reportDiagnosticSafely(deps, "Could not show installation result notification.", uiError);
    return;
  }

  if (selectedAction !== RELOAD_WINDOW_ACTION) {
    return;
  }

  try {
    await deps.reloadWindow();
  } catch (reloadError) {
    reportDiagnosticSafely(deps, "Could not reload window after installation.", reloadError);
  }
}

export async function notifyInstallationResult(
  deps: InstallationNotificationDeps,
  result: InstallationNotificationResult,
  emptyMessage = DEFAULT_EMPTY_INSTALL_MESSAGE,
): Promise<void> {
  const { installedClients, failedClients } = result;

  if (installedClients.length > 0 && failedClients.length === 0) {
    const names = installedClients.join(", ");
    await showReloadPromptAndHandleAction(
      deps,
      "information",
      `AI Artifacts installed for ${names}. Reload this window to apply changes. For AI clients running outside this window, restart the client and start a new chat.`,
    );
    return;
  }

  if (installedClients.length > 0 && failedClients.length > 0) {
    const names = installedClients.join(", ");
    const failedSummary = formatFailedClients(failedClients);
    await showReloadPromptAndHandleAction(
      deps,
      "warning",
      `AI Artifacts installed for ${names}. Failed for: ${failedSummary}. Reload this window to apply successful installations. For AI clients running outside this window, restart the client and start a new chat.`,
    );
    return;
  }

  if (failedClients.length > 0) {
    const failedSummary = formatFailedClients(failedClients);
    try {
      await deps.showErrorMessage(`AI Artifacts installation failed: ${failedSummary}`);
    } catch (uiError) {
      reportDiagnosticSafely(deps, "Could not show installation failure notification.", uiError);
    }
    return;
  }

  try {
    await deps.showInformationMessage(emptyMessage);
  } catch (uiError) {
    reportDiagnosticSafely(deps, "Could not show empty installation notification.", uiError);
  }
}

export async function notifyInstallationError(
  deps: InstallationNotificationDeps,
  error: unknown,
): Promise<void> {
  const detail = formatErrorText(error);
  try {
    await deps.showErrorMessage(`AI Artifacts installation could not complete: ${detail}`);
  } catch (uiError) {
    reportDiagnosticSafely(deps, "Could not show installation error notification.", uiError);
  }
}

