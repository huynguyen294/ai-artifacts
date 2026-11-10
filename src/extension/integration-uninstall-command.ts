import type * as vscode from "vscode";
import type { McpClientId } from "../shared/contracts";
import type { IntegrationStatus } from "./global-integration-status";
import type {
  InstallerClientDescriptor,
  SelectedIntegrationsUninstallResult,
} from "./workspace-integration";

const STATUS_LABELS: Record<IntegrationStatus, string> = {
  ready: "Ready",
  missing: "Missing",
  outdated: "Outdated",
  "configuration-conflict": "Configuration conflict",
  "restart-required": "Restart required",
};

export interface UninstallClientQuickPickItem extends vscode.QuickPickItem {
  clientId: McpClientId;
}

export interface IntegrationUninstallCommandDeps {
  createQuickPick: () => vscode.QuickPick<UninstallClientQuickPickItem>;
  listClients: () => Promise<{ clients: InstallerClientDescriptor[] }>;
  uninstallClients: (clientIds: McpClientId[]) => Promise<SelectedIntegrationsUninstallResult>;
  withProgress: <T>(
    title: string,
    task: () => Promise<T>,
  ) => Promise<T>;
  showInformationMessage: (message: string) => void | Thenable<unknown>;
  showWarningMessage: (message: string) => void | Thenable<unknown>;
  showErrorMessage: (message: string) => void | Thenable<unknown>;
  onDidUninstall?: () => void;
}

export async function runIntegrationUninstallCommand(
  deps: IntegrationUninstallCommandDeps,
): Promise<void> {
  const quickPick = deps.createQuickPick();
  quickPick.title = "AI Artifacts: Uninstall";
  quickPick.placeholder = "Select AI clients to uninstall, then click OK or press Enter";
  quickPick.canSelectMany = true;
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.busy = true;

  const disposables: vscode.Disposable[] = [];
  let isDisposed = false;
  let isSubmitting = false;

  const disposeQuickPick = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    for (const disposable of disposables) {
      disposable.dispose();
    }
    quickPick.dispose();
  };

  return new Promise((resolve) => {
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const handleConfirm = async (): Promise<void> => {
      if (isDisposed || quickPick.busy || isSubmitting) return;
      const selectedIds = quickPick.selectedItems.map((item) => item.clientId);
      isSubmitting = true;
      quickPick.hide();

      if (selectedIds.length === 0) {
        void deps.showInformationMessage("AI Artifacts Uninstall: No AI clients were selected.");
        settle();
        return;
      }

      try {
        const result = await deps.withProgress("Uninstalling AI Artifacts integrations...", () =>
          deps.uninstallClients(selectedIds),
        );

        if (result.uninstalledClients.length > 0 || result.notConfiguredClients.length > 0) {
          deps.onDidUninstall?.();
        }

        const uninstalledNames = result.uninstalledClients.map((client) => client.name).join(", ");
        const notConfiguredNames = result.notConfiguredClients.map((client) => client.name).join(", ");
        const failedSummary = result.failedClients
          .map((client) => `${client.name} (${client.error})`)
          .join("; ");

        if (result.failedClients.length > 0 && result.uninstalledClients.length > 0) {
          void deps.showWarningMessage(
            `AI Artifacts uninstalled for ${uninstalledNames}, but failed for: ${failedSummary}. Restart updated client(s) and check failed configuration(s).`,
          );
        } else if (result.failedClients.length > 0) {
          void deps.showErrorMessage(`AI Artifacts uninstall failed: ${failedSummary}`);
        } else if (result.uninstalledClients.length > 0 && result.notConfiguredClients.length > 0) {
          void deps.showInformationMessage(
            `AI Artifacts uninstalled for ${uninstalledNames}. Not configured for ${notConfiguredNames}. Restart updated client(s) to apply changes.`,
          );
        } else if (result.uninstalledClients.length > 0) {
          void deps.showInformationMessage(
            `AI Artifacts uninstalled for ${uninstalledNames}. Restart your AI client(s) to apply changes.`,
          );
        } else if (result.notConfiguredClients.length > 0) {
          void deps.showInformationMessage(
            `AI Artifacts integration was not found for ${notConfiguredNames}.`,
          );
        } else {
          void deps.showInformationMessage("AI Artifacts Uninstall: No AI clients were uninstalled.");
        }
      } catch (error) {
        void deps.showErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        settle();
      }
    };

    disposables.push(
      quickPick.onDidAccept(() => {
        void handleConfirm();
      }),
      quickPick.onDidHide(() => {
        disposeQuickPick();
        if (!isSubmitting) {
          settle();
        }
      }),
    );

    quickPick.show();

    void (async () => {
      try {
        const { clients } = await deps.listClients();
        if (isDisposed) return;

        const items: UninstallClientQuickPickItem[] = clients.map((client) => {
          const badges = [
            STATUS_LABELS[client.status],
            client.isDetected ? "Detected" : undefined,
            client.isSaved ? "Saved" : undefined,
          ].filter((value): value is string => Boolean(value));

          return {
            label: client.name,
            clientId: client.id,
            description: badges.join(" · "),
            detail: client.detail ? `${client.configPath} — ${client.detail}` : client.configPath,
          };
        });

        quickPick.items = items;
        // Start with no pre-selected items to prevent accidental uninstall on Enter.
        quickPick.selectedItems = [];
        quickPick.busy = false;
      } catch (error) {
        if (isDisposed) return;
        quickPick.busy = false;
        quickPick.hide();
        void deps.showErrorMessage(error instanceof Error ? error.message : String(error));
        settle();
      }
    })();
  });
}
