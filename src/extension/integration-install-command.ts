import * as vscode from "vscode";
import type { McpClientId } from "../shared/contracts";
import {
  notifyInstallationError,
  notifyInstallationResult,
  type InstallationNotificationDeps,
} from "./install-notification";
import type {
  InstallableClientDescriptor,
  SelectedIntegrationsInstallResult,
} from "./workspace-integration";

export interface InstallerClientQuickPickItem extends vscode.QuickPickItem {
  clientId: McpClientId;
}

export interface IntegrationInstallCommandDeps extends InstallationNotificationDeps {
  createQuickPick: () => vscode.QuickPick<InstallerClientQuickPickItem>;
  listClients: () => Promise<{ clients: InstallableClientDescriptor[] }>;
  installClients: (clientIds: McpClientId[]) => Promise<SelectedIntegrationsInstallResult>;
  withProgress: <T>(
    title: string,
    task: () => Promise<T>,
  ) => Promise<T>;
  onDidInstall?: () => void;
}

export async function runIntegrationInstallCommand(
  deps: IntegrationInstallCommandDeps,
): Promise<void> {
  const quickPick = deps.createQuickPick();
  quickPick.title = "AI Artifacts: Installer";
  quickPick.placeholder = "Select AI clients to install, then click OK, Run, or press Enter";
  quickPick.canSelectMany = true;
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.busy = true;

  const runButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("play"),
    tooltip: "Run Installer for selected clients",
  };
  quickPick.buttons = [runButton];

  const disposables: vscode.Disposable[] = [];
  let isDisposed = false;
  let isSubmitting = false;
  let isHandlingLoadError = false;

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
      if (isDisposed || quickPick.busy || isSubmitting || isHandlingLoadError) return;
      const selectedIds = quickPick.selectedItems.map((item) => item.clientId);
      isSubmitting = true;
      quickPick.hide();

      if (selectedIds.length === 0) {
        try {
          await notifyInstallationResult(
            deps,
            { installedClients: [], failedClients: [] },
            "AI Artifacts Installer: No AI clients were selected.",
          );
        } finally {
          settle();
        }
        return;
      }

      let result: SelectedIntegrationsInstallResult;
      try {
        result = await deps.withProgress("Installing AI Artifacts integrations...", () =>
          deps.installClients(selectedIds),
        );
      } catch (error) {
        try {
          await notifyInstallationError(deps, error);
        } finally {
          settle();
        }
        return;
      }

      if (result.installedClients.length > 0) {
        try {
          deps.onDidInstall?.();
        } catch (refreshError) {
          try {
            deps.reportDiagnostic(
              "Could not refresh integration support after installation.",
              refreshError,
            );
          } catch {
            // Diagnostics must never affect installer completion.
          }
        }
      }

      try {
        await notifyInstallationResult(deps, {
          installedClients: result.installedClients.map((client) => client.name),
          failedClients: result.failedClients,
        });
      } finally {
        settle();
      }
    };

    disposables.push(
      quickPick.onDidAccept(() => {
        void handleConfirm();
      }),
      quickPick.onDidTriggerButton((button) => {
        if (button === runButton) {
          void handleConfirm();
        }
      }),
      quickPick.onDidHide(() => {
        disposeQuickPick();
        if (!isSubmitting && !isHandlingLoadError) {
          settle();
        }
      }),
    );

    quickPick.show();

    void (async () => {
      try {
        const { clients } = await deps.listClients();
        if (isDisposed) return;

        const items: InstallerClientQuickPickItem[] = [];
        const preselected: InstallerClientQuickPickItem[] = [];

        for (const client of clients) {
          const badges = [
            client.isDetected ? "Detected" : undefined,
            client.isSaved ? "Saved" : undefined,
          ].filter((value): value is string => Boolean(value));

          const item: InstallerClientQuickPickItem = {
            label: client.name,
            clientId: client.id,
            description: badges.join(" · "),
            detail: client.configPath,
          };
          items.push(item);
          if (client.isDetected || client.isSaved) {
            preselected.push(item);
          }
        }

        quickPick.items = items;
        quickPick.selectedItems = preselected;
        quickPick.busy = false;
      } catch (error) {
        if (isDisposed) return;
        isHandlingLoadError = true;
        quickPick.busy = false;
        quickPick.hide();
        try {
          await notifyInstallationError(deps, error);
        } finally {
          settle();
        }
      }
    })();
  });
}
