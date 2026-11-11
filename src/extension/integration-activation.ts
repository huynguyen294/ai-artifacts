import type {
  ExistingInstalledIntegrationVersionReadResult,
  InstalledIntegrationVersionReadResult,
} from "./workspace-integration";

export const INSTALLER_ONBOARDING_ACCEPTED_KEY = "installer.onboardingAccepted";
export const RUN_INSTALLER_ACTION = "Run Installer";

type MaybePromise<T> = T | PromiseLike<T>;

export interface IntegrationActivationDeps {
  getInstalledIntegrationVersion: () => MaybePromise<InstalledIntegrationVersionReadResult>;
  isOnboardingAccepted: () => boolean;
  acceptOnboarding: () => MaybePromise<void>;
  runInstaller: () => MaybePromise<unknown>;
  runUpgrade: (state: ExistingInstalledIntegrationVersionReadResult) => Promise<void>;
  showInformationMessage: (
    message: string,
    ...actions: string[]
  ) => MaybePromise<string | undefined>;
  showErrorMessage: (
    message: string,
    ...actions: string[]
  ) => MaybePromise<string | undefined>;
  reportDiagnostic: (message: string, error: unknown) => void;
}

function reportDiagnosticSafely(
  deps: IntegrationActivationDeps,
  message: string,
  error: unknown,
): void {
  try {
    deps.reportDiagnostic(message, error);
  } catch {
    // Diagnostics must never affect extension activation.
  }
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  return trimmed || "Unknown error.";
}

function ensureSentenceEnding(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

async function showErrorMessageSafely(
  deps: IntegrationActivationDeps,
  message: string,
  diagnosticContext: string,
): Promise<void> {
  try {
    await deps.showErrorMessage(message);
  } catch (uiError) {
    reportDiagnosticSafely(deps, diagnosticContext, uiError);
  }
}

export async function runIntegrationActivation(
  deps: IntegrationActivationDeps,
): Promise<void> {
  let installedVersion: InstalledIntegrationVersionReadResult;
  try {
    installedVersion = await deps.getInstalledIntegrationVersion();
  } catch (readError) {
    reportDiagnosticSafely(deps, "Could not read installed integration versions.", readError);
    const detail = ensureSentenceEnding(errorMessage(readError));
    await showErrorMessageSafely(
      deps,
      `AI Artifacts could not read installed integration status: ${detail} Run "AI Artifacts: Installer" from the Command Palette if setup or repair is needed.`,
      "Could not show integration version read error notification.",
    );
    return;
  }

  if (installedVersion.status !== "missing") {
    try {
      await deps.runUpgrade(installedVersion);
    } catch (upgradeError) {
      reportDiagnosticSafely(deps, "Automatic integration upgrade failed.", upgradeError);
    }
    return;
  }

  if (deps.isOnboardingAccepted()) {
    return;
  }

  let selectedAction: string | undefined;
  try {
    selectedAction = await deps.showInformationMessage(
      "Set up AI Artifacts for your AI client(s).",
      RUN_INSTALLER_ACTION,
    );
  } catch (uiError) {
    reportDiagnosticSafely(deps, "Could not show onboarding installer prompt.", uiError);
    return;
  }

  if (selectedAction !== RUN_INSTALLER_ACTION) {
    return;
  }

  try {
    await deps.acceptOnboarding();
  } catch (acceptError) {
    reportDiagnosticSafely(deps, "Could not persist onboarding acceptance.", acceptError);
  }

  try {
    await deps.runInstaller();
  } catch (runError) {
    reportDiagnosticSafely(deps, "Could not launch AI Artifacts Installer.", runError);
    const detail = ensureSentenceEnding(errorMessage(runError));
    await showErrorMessageSafely(
      deps,
      `AI Artifacts could not open Installer: ${detail} Run "AI Artifacts: Installer" from the Command Palette.`,
      "Could not show installer launch error notification.",
    );
  }
}

