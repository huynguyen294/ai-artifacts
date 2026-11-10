import * as vscode from "vscode";
import type { McpClientId } from "../shared/contracts";
import type { IntegrationStatus } from "./global-integration-status";
import type {
  InstallerClientDescriptor,
  SelectedIntegrationsInstallResult,
} from "./workspace-integration";

const STATUS_LABELS: Record<IntegrationStatus, string> = {
  ready: "Ready",
  missing: "Missing",
  outdated: "Outdated",
  "configuration-conflict": "Configuration conflict",
  "restart-required": "Restart required",
};

export interface InstallerClientQuickPickItem extends vscode.QuickPickItem {
  clientId: McpClientId;
}

export interface IntegrationInstallCommandDeps {
  createQuickPick: () => vscode.QuickPick<InstallerClientQuickPickItem>;
  listClients: () => Promise<{ clients: InstallerClientDescriptor[] }>;
  installClients: (clientIds: McpClientId[]) => Promise<SelectedIntegrationsInstallResult>;
  withProgress: <T>(
    title: string,
    task: () => Promise<T>,
  ) => Promise<T>;
  showInformationMessage: (message: string) => void | Thenable<unknown>;
  showWarningMessage: (message: string) => void | Thenable<unknown>;
  showErrorMessage: (message: string) => void | Thenable<unknown>;
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
        void deps.showInformationMessage("AI Artifacts Installer: No AI clients were selected.");
        settle();
        return;
      }

      try {
        const result = await deps.withProgress("Installing AI Artifacts integrations...", () =>
          deps.installClients(selectedIds),
        );

        if (result.installedClients.length > 0) {
          deps.onDidInstall?.();
        }

        if (result.failedClients.length === 0 && result.installedClients.length > 0) {
          const names = result.installedClients.map((client) => client.name).join(", ");
          void deps.showInformationMessage(
            `AI Artifacts installed for ${names}. Restart your AI client(s) and start a new chat to apply changes.`,
          );
        } else if (result.installedClients.length > 0 && result.failedClients.length > 0) {
          const installedNames = result.installedClients.map((client) => client.name).join(", ");
          const failedSummary = result.failedClients
            .map((client) => `${client.name} (${client.error})`)
            .join("; ");
          void deps.showWarningMessage(
            `AI Artifacts installed for ${installedNames}, but failed for: ${failedSummary}. Restart updated client(s) and check failed configuration(s).`,
          );
        } else if (result.failedClients.length > 0) {
          const failedSummary = result.failedClients
            .map((client) => `${client.name} (${client.error})`)
            .join("; ");
          void deps.showErrorMessage(`AI Artifacts installation failed: ${failedSummary}`);
        } else {
          void deps.showInformationMessage("AI Artifacts Installer: No AI clients were installed.");
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
      quickPick.onDidTriggerButton((button) => {
        if (button === runButton) {
          void handleConfirm();
        }
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

        const items: InstallerClientQuickPickItem[] = [];
        const preselected: InstallerClientQuickPickItem[] = [];

        for (const client of clients) {
          const badges = [
            STATUS_LABELS[client.status],
            client.isDetected ? "Detected" : undefined,
            client.isSaved ? "Saved" : undefined,
          ].filter((value): value is string => Boolean(value));

          const item: InstallerClientQuickPickItem = {
            label: client.name,
            clientId: client.id,
            description: badges.join(" · "),
            detail: client.detail ? `${client.configPath} — ${client.detail}` : client.configPath,
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
        quickPick.busy = false;
        quickPick.hide();
        void deps.showErrorMessage(error instanceof Error ? error.message : String(error));
        settle();
      }
    })();
  });
}
