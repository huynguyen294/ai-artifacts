import { describe, expect, it, vi } from "vitest";
import type { McpClientId } from "../src/shared/contracts";
import {
  runIntegrationUninstallCommand,
  type IntegrationUninstallCommandDeps,
  type UninstallClientQuickPickItem,
} from "../src/extension/integration-uninstall-command";
import type { InstallerClientDescriptor } from "../src/extension/workspace-integration";

class MockUninstallQuickPick {
  title: string | undefined;
  placeholder: string | undefined;
  canSelectMany = false;
  matchOnDescription = false;
  matchOnDetail = false;
  busy = false;
  items: UninstallClientQuickPickItem[] = [];
  selectedItems: UninstallClientQuickPickItem[] = [];

  private acceptListeners: Array<() => void> = [];
  private hideListeners: Array<() => void> = [];

  onDidAccept(listener: () => void) {
    this.acceptListeners.push(listener);
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
}

function createSampleClients(): InstallerClientDescriptor[] {
  return [
    {
      id: "copilot",
      name: "GitHub Copilot (VS Code)",
      configPath: "/home/user/.config/Code/User/mcp.json",
      isDetected: true,
      isSaved: true,
      status: "ready",
    },
    {
      id: "cursor",
      name: "Cursor",
      configPath: "/home/user/.cursor/mcp.json",
      isDetected: true,
      isSaved: true,
      status: "ready",
    },
    {
      id: "claude",
      name: "Claude",
      configPath: "/home/user/.claude.json",
      isDetected: false,
      isSaved: false,
      status: "missing",
    },
  ];
}

function createDeps(
  qp: MockUninstallQuickPick,
  overrides?: Partial<IntegrationUninstallCommandDeps>,
): IntegrationUninstallCommandDeps {
  return {
    createQuickPick: () => qp as any,
    listClients: vi.fn(async () => ({ clients: createSampleClients() })),
    uninstallClients: vi.fn(async (clientIds: McpClientId[]) => ({
      uninstalledClients: clientIds.map((id) => ({ id, name: id })),
      notConfiguredClients: [],
      failedClients: [],
    })),
    withProgress: vi.fn(async (_title, task) => task()),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    onDidUninstall: vi.fn(),
    ...overrides,
  };
}

describe("integration-uninstall-command", () => {
  it("enables checkboxes, starts with zero pre-selected items, and cancels cleanly on hide", async () => {
    const qp = new MockUninstallQuickPick();
    const deps = createDeps(qp);

    const promise = runIntegrationUninstallCommand(deps);
    await vi.waitFor(() => {
      expect(qp.busy).toBe(false);
    });

    expect(qp.title).toBe("AI Artifacts: Uninstall");
    expect(qp.canSelectMany).toBe(true);
    expect(qp.items.map((item) => item.clientId)).toEqual(["copilot", "cursor", "claude"]);
    expect(qp.items[0]!.description).toBe("Ready · Detected · Saved");
    expect(qp.selectedItems).toEqual([]);

    qp.hide();
    await promise;
    expect(deps.uninstallClients).not.toHaveBeenCalled();
    expect(qp.dispose).toHaveBeenCalledTimes(1);
  });

  it("skips uninstall when nothing is checked on OK / Enter", async () => {
    const qp = new MockUninstallQuickPick();
    const deps = createDeps(qp);

    const promise = runIntegrationUninstallCommand(deps);
    await vi.waitFor(() => {
      expect(qp.busy).toBe(false);
    });

    qp.triggerAccept();
    await promise;

    expect(deps.uninstallClients).not.toHaveBeenCalled();
    expect(deps.onDidUninstall).not.toHaveBeenCalled();
    expect(deps.showInformationMessage).toHaveBeenCalledWith(
      "AI Artifacts Uninstall: No AI clients were selected.",
    );
  });

  it("uninstalls selected clients and handles mixed configured/not-configured results", async () => {
    const qp = new MockUninstallQuickPick();
    const deps = createDeps(qp, {
      uninstallClients: vi.fn(async () => ({
        uninstalledClients: [{ id: "cursor" as const, name: "Cursor" }],
        notConfiguredClients: [{ id: "claude" as const, name: "Claude" }],
        failedClients: [],
      })),
    });

    const promise = runIntegrationUninstallCommand(deps);
    await vi.waitFor(() => {
      expect(qp.busy).toBe(false);
    });

    qp.selectedItems = qp.items.filter((item) => item.clientId === "cursor" || item.clientId === "claude");
    qp.triggerAccept();
    await promise;

    expect(deps.uninstallClients).toHaveBeenCalledWith(["cursor", "claude"]);
    expect(deps.onDidUninstall).toHaveBeenCalledTimes(1);
    expect(deps.showInformationMessage).toHaveBeenCalledWith(
      "AI Artifacts uninstalled for Cursor. Not configured for Claude. Restart updated client(s) to apply changes.",
    );
  });

  it("reports partial failures as warning and total failures as error", async () => {
    const qp1 = new MockUninstallQuickPick();
    const deps1 = createDeps(qp1, {
      uninstallClients: vi.fn(async () => ({
        uninstalledClients: [{ id: "cursor" as const, name: "Cursor" }],
        notConfiguredClients: [],
        failedClients: [{ id: "copilot" as const, name: "GitHub Copilot (VS Code)", error: "EPERM" }],
      })),
    });

    const p1 = runIntegrationUninstallCommand(deps1);
    await vi.waitFor(() => {
      expect(qp1.busy).toBe(false);
    });
    qp1.selectedItems = qp1.items.filter((item) => item.clientId === "cursor" || item.clientId === "copilot");
    qp1.triggerAccept();
    await p1;

    expect(deps1.onDidUninstall).toHaveBeenCalledTimes(1);
    expect(deps1.showWarningMessage).toHaveBeenCalledWith(
      "AI Artifacts uninstalled for Cursor, but failed for: GitHub Copilot (VS Code) (EPERM). Restart updated client(s) and check failed configuration(s).",
    );

    const qp2 = new MockUninstallQuickPick();
    const deps2 = createDeps(qp2, {
      uninstallClients: vi.fn(async () => ({
        uninstalledClients: [],
        notConfiguredClients: [],
        failedClients: [{ id: "copilot" as const, name: "GitHub Copilot (VS Code)", error: "EPERM" }],
      })),
    });

    const p2 = runIntegrationUninstallCommand(deps2);
    await vi.waitFor(() => {
      expect(qp2.busy).toBe(false);
    });
    qp2.selectedItems = qp2.items.filter((item) => item.clientId === "copilot");
    qp2.triggerAccept();
    await p2;

    expect(deps2.onDidUninstall).not.toHaveBeenCalled();
    expect(deps2.showErrorMessage).toHaveBeenCalledWith(
      "AI Artifacts uninstall failed: GitHub Copilot (VS Code) (EPERM)",
    );
  });
});

