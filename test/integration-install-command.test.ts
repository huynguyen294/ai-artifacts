import { describe, expect, it, vi } from "vitest";
import type { QuickInputButton } from "vscode";
import type { McpClientId } from "../src/shared/contracts";

vi.mock("vscode", () => ({
  ThemeIcon: class {
    constructor(public readonly id: string) {}
  },
}));

import { RELOAD_WINDOW_ACTION } from "../src/extension/install-notification";
import {
  runIntegrationInstallCommand,
  type InstallerClientQuickPickItem,
  type IntegrationInstallCommandDeps,
} from "../src/extension/integration-install-command";
import type { InstallableClientDescriptor } from "../src/extension/workspace-integration";

class MockMultiQuickPick {
  title: string | undefined;
  placeholder: string | undefined;
  canSelectMany = false;
  matchOnDescription = false;
  matchOnDetail = false;
  busy = false;
  buttons: readonly QuickInputButton[] = [];
  items: InstallerClientQuickPickItem[] = [];
  selectedItems: InstallerClientQuickPickItem[] = [];

  private acceptListeners: Array<() => void> = [];
  private triggerButtonListeners: Array<(button: QuickInputButton) => void> = [];
  private hideListeners: Array<() => void> = [];

  onDidAccept(listener: () => void) {
    this.acceptListeners.push(listener);
    return { dispose: () => {} };
  }

  onDidTriggerButton(listener: (button: QuickInputButton) => void) {
    this.triggerButtonListeners.push(listener);
    return { dispose: () => {} };
  }

  onDidHide(listener: () => void) {
    this.hideListeners.push(listener);
    return { dispose: () => {} };
  }

  show = vi.fn();
  hide = vi.fn(() => {
    for (const listener of this.hideListeners) {
      listener();
    }
  });
  dispose = vi.fn();

  triggerAccept() {
    for (const listener of this.acceptListeners) {
      listener();
    }
  }

  triggerButton(button: QuickInputButton) {
    for (const listener of this.triggerButtonListeners) {
      listener(button);
    }
  }
}

function createSampleClients(): InstallableClientDescriptor[] {
  return [
    {
      id: "copilot",
      name: "GitHub Copilot (VS Code)",
      configPath: "/home/user/.config/Code/User/mcp.json",
      isDetected: true,
      isSaved: true,
    },
    {
      id: "cursor",
      name: "Cursor",
      configPath: "/home/user/.cursor/mcp.json",
      isDetected: true,
      isSaved: false,
    },
    {
      id: "codex",
      name: "Codex",
      configPath: "/home/user/.codex/config.toml",
      isDetected: false,
      isSaved: true,
    },
    {
      id: "claude",
      name: "Claude",
      configPath: "/home/user/.claude.json",
      isDetected: false,
      isSaved: false,
    },
  ];
}

function createDeps(
  qp: MockMultiQuickPick,
  overrides?: Partial<IntegrationInstallCommandDeps>,
): IntegrationInstallCommandDeps {
  return {
    createQuickPick: () => qp as any,
    listClients: vi.fn(async () => ({ clients: createSampleClients() })),
    installClients: vi.fn(async (clientIds: McpClientId[]) => ({
      installedClients: clientIds.map((id) => ({ id, name: id })),
      failedClients: [],
    })),
    withProgress: vi.fn(async (_title, task) => task()),
    showInformationMessage: vi.fn(async () => undefined),
    showWarningMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined),
    reloadWindow: vi.fn(async () => undefined),
    reportDiagnostic: vi.fn(),
    onDidInstall: vi.fn(),
    ...overrides,
  };
}

describe("integration-install-command", () => {
  it("enables checkboxes, exposes a Run button, formats metadata badges and config path, and pre-selects detected/saved clients", async () => {
    const qp = new MockMultiQuickPick();
    const deps = createDeps(qp);

    const promise = runIntegrationInstallCommand(deps);
    await vi.waitFor(() => {
      expect(qp.busy).toBe(false);
    });

    expect(qp.title).toBe("AI Artifacts: Installer");
    expect(qp.canSelectMany).toBe(true);
    expect(qp.buttons).toHaveLength(1);
    expect(qp.buttons[0]!.tooltip).toBe("Run Installer for selected clients");
    expect(qp.items.map((item) => item.clientId)).toEqual(["copilot", "cursor", "codex", "claude"]);
    expect(qp.items[0]!.description).toBe("Detected · Saved");
    expect(qp.items[1]!.description).toBe("Detected");
    expect(qp.items[2]!.description).toBe("Saved");
    expect(qp.items[3]!.description).toBe("");
    expect(qp.items[0]!.detail).toBe("/home/user/.config/Code/User/mcp.json");
    expect(qp.items[2]!.detail).toBe("/home/user/.codex/config.toml");
    expect(qp.selectedItems.map((item) => item.clientId)).toEqual(["copilot", "cursor", "codex"]);

    qp.hide();
    await promise;
    expect(deps.installClients).not.toHaveBeenCalled();
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
    expect(qp.dispose).toHaveBeenCalledTimes(1);
  });

  it("installs selected clients when Run is clicked, shows Reload Window, and triggers reload only on click", async () => {
    const qp = new MockMultiQuickPick();
    const deps = createDeps(qp, {
      installClients: vi.fn(async () => ({
        installedClients: [
          { id: "cursor" as const, name: "Cursor" },
          { id: "claude" as const, name: "Claude" },
        ],
        failedClients: [],
      })),
      showInformationMessage: vi.fn(async () => RELOAD_WINDOW_ACTION),
    });

    const promise = runIntegrationInstallCommand(deps);
    await vi.waitFor(() => {
      expect(qp.busy).toBe(false);
    });

    qp.selectedItems = qp.items.filter((item) => item.clientId === "cursor" || item.clientId === "claude");
    qp.triggerButton(qp.buttons[0]!);
    qp.triggerAccept();
    await promise;

    expect(deps.installClients).toHaveBeenCalledTimes(1);
    expect(deps.installClients).toHaveBeenCalledWith(["cursor", "claude"]);
    expect(deps.onDidInstall).toHaveBeenCalledTimes(1);
    expect(deps.showInformationMessage).toHaveBeenCalledWith(
      "AI Artifacts installed for Cursor, Claude. Reload this window to apply changes. For AI clients running outside this window, restart the client and start a new chat.",
      RELOAD_WINDOW_ACTION,
    );
    expect(deps.reloadWindow).toHaveBeenCalledTimes(1);
  });

  it("installs selected clients on OK / Enter acceptance and reports partial failures with Reload Window", async () => {
    const qp = new MockMultiQuickPick();
    const deps = createDeps(qp, {
      installClients: vi.fn(async () => ({
        installedClients: [{ id: "cursor" as const, name: "Cursor" }],
        failedClients: [{ id: "codex" as const, name: "Codex", error: "config conflict" }],
      })),
    });

    const promise = runIntegrationInstallCommand(deps);
    await vi.waitFor(() => {
      expect(qp.busy).toBe(false);
    });

    qp.selectedItems = qp.items.filter((item) => item.clientId === "cursor" || item.clientId === "codex");
    qp.triggerAccept();
    await promise;

    expect(deps.installClients).toHaveBeenCalledWith(["cursor", "codex"]);
    expect(deps.onDidInstall).toHaveBeenCalledTimes(1);
    expect(deps.showWarningMessage).toHaveBeenCalledWith(
      "AI Artifacts installed for Cursor. Failed for: Codex (config conflict). Reload this window to apply successful installations. For AI clients running outside this window, restart the client and start a new chat.",
      RELOAD_WINDOW_ACTION,
    );
    expect(deps.reloadWindow).not.toHaveBeenCalled();
  });

  it("keeps success notification and does not report fake install error when onDidInstall throws", async () => {
    const refreshError = new Error("sidebar tree refresh failed");
    const qp = new MockMultiQuickPick();
    const deps = createDeps(qp, {
      installClients: vi.fn(async () => ({
        installedClients: [{ id: "codex" as const, name: "Codex" }],
        failedClients: [],
      })),
      onDidInstall: vi.fn(() => {
        throw refreshError;
      }),
    });

    const promise = runIntegrationInstallCommand(deps);
    await vi.waitFor(() => {
      expect(qp.busy).toBe(false);
    });

    qp.selectedItems = qp.items.filter((item) => item.clientId === "codex");
    qp.triggerAccept();
    await promise;

    expect(deps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not refresh integration support after installation.",
      refreshError,
    );
    expect(deps.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });

  it("skips installation and shows an info message when zero clients are selected", async () => {
    const qp = new MockMultiQuickPick();
    const deps = createDeps(qp);

    const promise = runIntegrationInstallCommand(deps);
    await vi.waitFor(() => {
      expect(qp.busy).toBe(false);
    });

    qp.selectedItems = [];
    qp.triggerAccept();
    await promise;

    expect(deps.installClients).not.toHaveBeenCalled();
    expect(deps.onDidInstall).not.toHaveBeenCalled();
    expect(deps.showInformationMessage).toHaveBeenCalledWith(
      "AI Artifacts Installer: No AI clients were selected.",
    );
  });

  it("shows error without refreshing views when all selected clients fail", async () => {
    const qp = new MockMultiQuickPick();
    const deps = createDeps(qp, {
      installClients: vi.fn(async () => ({
        installedClients: [],
        failedClients: [{ id: "codex" as const, name: "Codex", error: "boom" }],
      })),
    });

    const promise = runIntegrationInstallCommand(deps);
    await vi.waitFor(() => {
      expect(qp.busy).toBe(false);
    });

    qp.selectedItems = qp.items.filter((item) => item.clientId === "codex");
    qp.triggerAccept();
    await promise;

    expect(deps.onDidInstall).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).toHaveBeenCalledWith(
      "AI Artifacts installation failed: Codex (boom)",
    );
  });

  it("shows a single fatal error when listClients or shared install throws, settling after notification", async () => {
    let errorNotificationDone = false;
    const qpLoadFail = new MockMultiQuickPick();
    const loadFailDeps = createDeps(qpLoadFail, {
      listClients: vi.fn(async () => {
        throw new Error("cannot read installed-clients.json");
      }),
      showErrorMessage: vi.fn(async () => {
        await Promise.resolve();
        errorNotificationDone = true;
        return undefined;
      }),
    });

    await runIntegrationInstallCommand(loadFailDeps);
    expect(errorNotificationDone).toBe(true);
    expect(loadFailDeps.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(loadFailDeps.showErrorMessage).toHaveBeenCalledWith(
      "AI Artifacts installation could not complete: cannot read installed-clients.json",
    );
    expect(loadFailDeps.showInformationMessage).not.toHaveBeenCalled();
    expect(loadFailDeps.installClients).not.toHaveBeenCalled();

    const qpSharedFail = new MockMultiQuickPick();
    const sharedFailDeps = createDeps(qpSharedFail, {
      installClients: vi.fn(async () => {
        throw new Error("packaged runtime missing");
      }),
    });
    const sharedPromise = runIntegrationInstallCommand(sharedFailDeps);
    await vi.waitFor(() => {
      expect(qpSharedFail.busy).toBe(false);
    });
    qpSharedFail.selectedItems = qpSharedFail.items.filter((item) => item.clientId === "codex");
    qpSharedFail.triggerAccept();
    await sharedPromise;

    expect(sharedFailDeps.onDidInstall).not.toHaveBeenCalled();
    expect(sharedFailDeps.showErrorMessage).toHaveBeenCalledWith(
      "AI Artifacts installation could not complete: packaged runtime missing",
    );
  });
});
