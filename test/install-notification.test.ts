import { describe, expect, it, vi } from "vitest";
import {
  notifyInstallationError,
  notifyInstallationResult,
  RELOAD_WINDOW_ACTION,
  type InstallationNotificationDeps,
} from "../src/extension/install-notification";

function makeDeps(
  overrides: Partial<InstallationNotificationDeps> = {},
): InstallationNotificationDeps {
  return {
    showInformationMessage: vi.fn(async () => undefined),
    showWarningMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined),
    reloadWindow: vi.fn(async () => undefined),
    reportDiagnostic: vi.fn(),
    ...overrides,
  };
}

describe("install notification helper", () => {
  it("shows one Information notification with Reload Window on full success", async () => {
    const deps = makeDeps();

    await notifyInstallationResult(deps, {
      installedClients: ["Codex", "Cursor"],
      failedClients: [],
    });

    expect(deps.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(deps.showInformationMessage).toHaveBeenCalledWith(
      "AI Artifacts installed for Codex, Cursor. Reload this window to apply changes. For AI clients running outside this window, restart the client and start a new chat.",
      RELOAD_WINDOW_ACTION,
    );
    expect(deps.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
    expect(deps.reloadWindow).not.toHaveBeenCalled();
  });

  it("shows one Warning notification with both successes, failures, and Reload Window on partial failure", async () => {
    const deps = makeDeps();

    await notifyInstallationResult(deps, {
      installedClients: ["GitHub Copilot (VS Code)"],
      failedClients: [
        { name: "Cursor", error: "invalid JSON object" },
        { name: "Codex", error: "EACCES" },
      ],
    });

    expect(deps.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(deps.showWarningMessage).toHaveBeenCalledWith(
      "AI Artifacts installed for GitHub Copilot (VS Code). Failed for: Cursor (invalid JSON object); Codex (EACCES). Reload this window to apply successful installations. For AI clients running outside this window, restart the client and start a new chat.",
      RELOAD_WINDOW_ACTION,
    );
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
    expect(deps.reloadWindow).not.toHaveBeenCalled();
  });

  it("shows one Error notification without Reload Window when all clients fail", async () => {
    const deps = makeDeps();

    await notifyInstallationResult(deps, {
      installedClients: [],
      failedClients: [
        { name: "Codex", error: "unmanaged conflict" },
        { name: "Antigravity", error: "write failed" },
      ],
    });

    expect(deps.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(deps.showErrorMessage).toHaveBeenCalledWith(
      "AI Artifacts installation failed: Codex (unmanaged conflict); Antigravity (write failed)",
    );
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.reloadWindow).not.toHaveBeenCalled();
  });

  it("shows one Information notification with default or custom empty message and no Reload action", async () => {
    const defaultDeps = makeDeps();
    await notifyInstallationResult(defaultDeps, {
      installedClients: [],
      failedClients: [],
    });
    expect(defaultDeps.showInformationMessage).toHaveBeenCalledWith(
      "AI Artifacts Installer: No AI clients were installed.",
    );
    expect(defaultDeps.reloadWindow).not.toHaveBeenCalled();

    const customDeps = makeDeps();
    await notifyInstallationResult(
      customDeps,
      { installedClients: [], failedClients: [] },
      "AI Artifacts Installer: No AI clients were selected.",
    );
    expect(customDeps.showInformationMessage).toHaveBeenCalledWith(
      "AI Artifacts Installer: No AI clients were selected.",
    );
    expect(customDeps.reloadWindow).not.toHaveBeenCalled();
  });

  it("shows one Error notification preserving root cause for fatal or shared preparation errors", async () => {
    const deps = makeDeps();

    await notifyInstallationError(deps, new Error("packaged runtime missing"));

    expect(deps.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(deps.showErrorMessage).toHaveBeenCalledWith(
      "AI Artifacts installation could not complete: packaged runtime missing",
    );
    const [message] = vi.mocked(deps.showErrorMessage).mock.calls[0]!;
    expect(message).not.toMatch(/rolled back/i);
    expect(deps.reloadWindow).not.toHaveBeenCalled();
  });

  it("reloads window only when the user clicks Reload Window and never on dismiss", async () => {
    const clickOrder: string[] = [];
    const reloadDeps = makeDeps({
      showInformationMessage: vi.fn(async () => {
        clickOrder.push("show");
        return RELOAD_WINDOW_ACTION;
      }),
      reloadWindow: vi.fn(async () => {
        clickOrder.push("reload");
      }),
    });

    await notifyInstallationResult(reloadDeps, {
      installedClients: ["Codex"],
      failedClients: [],
    });
    expect(clickOrder).toEqual(["show", "reload"]);
    expect(reloadDeps.reloadWindow).toHaveBeenCalledTimes(1);

    const partialReloadDeps = makeDeps({
      showWarningMessage: vi.fn(async () => RELOAD_WINDOW_ACTION),
    });
    await notifyInstallationResult(partialReloadDeps, {
      installedClients: ["Codex"],
      failedClients: [{ name: "Cursor", error: "boom" }],
    });
    expect(partialReloadDeps.reloadWindow).toHaveBeenCalledTimes(1);
  });

  it("contains UI, reload, and diagnostic failures without triggering secondary popups", async () => {
    // 1. UI notification throws -> logs diagnostic, never calls reload or error popup
    const uiError = new Error("toast rejected");
    const uiFailDeps = makeDeps({
      showInformationMessage: vi.fn(async () => {
        throw uiError;
      }),
    });
    await expect(
      notifyInstallationResult(uiFailDeps, {
        installedClients: ["Codex"],
        failedClients: [],
      }),
    ).resolves.toBeUndefined();
    expect(uiFailDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not show installation result notification.",
      uiError,
    );
    expect(uiFailDeps.showErrorMessage).not.toHaveBeenCalled();
    expect(uiFailDeps.reloadWindow).not.toHaveBeenCalled();

    // 2. reloadWindow rejects -> logs diagnostic, never shows second popup
    const reloadError = new Error("reload command failed");
    const reloadFailDeps = makeDeps({
      showWarningMessage: vi.fn(async () => RELOAD_WINDOW_ACTION),
      reloadWindow: vi.fn(async () => {
        throw reloadError;
      }),
    });
    await expect(
      notifyInstallationResult(reloadFailDeps, {
        installedClients: ["Codex"],
        failedClients: [{ name: "Cursor", error: "failed" }],
      }),
    ).resolves.toBeUndefined();
    expect(reloadFailDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not reload window after installation.",
      reloadError,
    );
    expect(reloadFailDeps.showErrorMessage).not.toHaveBeenCalled();

    // 3. reportDiagnostic itself throws -> resolves cleanly
    const diagFailDeps = makeDeps({
      showErrorMessage: vi.fn(async () => {
        throw new Error("error UI failed");
      }),
      reportDiagnostic: vi.fn(() => {
        throw new Error("diagnostic logger failed");
      }),
    });
    await expect(notifyInstallationError(diagFailDeps, new Error("root failure"))).resolves.toBeUndefined();
  });
});

