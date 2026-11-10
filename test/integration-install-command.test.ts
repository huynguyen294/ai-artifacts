import { describe, expect, it, vi } from "vitest";
import type { QuickInputButton } from "vscode";
import type { McpClientId } from "../src/shared/contracts";

vi.mock("vscode", () => ({
  ThemeIcon: class {
    constructor(public readonly id: string) {}
  },
}));

import {
  runIntegrationInstallCommand,
  type InstallerClientQuickPickItem,
  type IntegrationInstallCommandDeps,
} from "../src/extension/integration-install-command";
import type { InstallerClientDescriptor } from "../src/extension/workspace-integration";

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
      isSaved: false,
      status: "missing",
    },
    {
      id: "codex",
      name: "Codex",
      configPath: "/home/user/.codex/config.toml",
      isDetected: false,
      isSaved: true,
      status: "configuration-conflict",
      detail: "config.toml defines mcp_servers.ai_artifacts outside the extension-managed block.",
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
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    onDidInstall: vi.fn(),
    ...overrides,
  };
}

describe("integration-install-command", () => {
  it("enables checkboxes, exposes a Run button, formats status, and pre-selects detected/saved clients", async () => {
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
    expect(qp.items[0]!.description).toBe("Ready · Detected · Saved");
    expect(qp.items[1]!.description).toBe("Missing · Detected");
    expect(qp.items[2]!.description).toBe("Configuration conflict · Saved");
    expect(qp.items[2]!.detail).toContain("outside the extension-managed block");
    expect(qp.selectedItems.map((item) => item.clientId)).toEqual(["copilot", "cursor", "codex"]);

    qp.hide();
    await promise;
    expect(deps.installClients).not.toHaveBeenCalled();
    expect(qp.dispose).toHaveBeenCalledTimes(1);
  });

  it("installs selected clients when the custom Run button is clicked", async () => {
    const qp = new MockMultiQuickPick();
    const deps = createDeps(qp, {
      installClients: vi.fn(async () => ({
        installedClients: [
          { id: "cursor" as const, name: "Cursor" },
          { id: "claude" as const, name: "Claude" },
        ],
        failedClients: [],
      })),
    });

    const promise = runIntegrationInstallCommand(deps);
    await vi.waitFor(() => {
      expect(qp.busy).toBe(false);
    });

    qp.selectedItems = qp.items.filter((item) => item.clientId === "cursor" || item.clientId === "claude");
    qp.triggerButton(qp.buttons[0]!);
    await promise;

    expect(deps.installClients).toHaveBeenCalledWith(["cursor", "claude"]);
    expect(deps.onDidInstall).toHaveBeenCalledTimes(1);
    expect(deps.showInformationMessage).toHaveBeenCalledWith(
      "AI Artifacts installed for Cursor, Claude. Restart your AI client(s) and start a new chat to apply changes.",
    );
  });

  it("installs selected clients on OK / Enter acceptance and reports partial failures", async () => {
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
      "AI Artifacts installed for Cursor, but failed for: Codex (config conflict). Restart updated client(s) and check failed configuration(s).",
    );
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
});
