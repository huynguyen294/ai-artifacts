import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  INSTALLATION_GUIDE_URL,
  LAST_NOTIFIED_VERSION_KEY,
  LATER_ACTION,
  RUN_INSTALLER_ACTION,
  VIEW_INSTALLATION_GUIDE_ACTION,
  buildUpgradeNotificationMessage,
  maybeShowUpgradeNotification,
  type UpgradeNotificationDeps,
} from "../src/extension/upgrade-notification";

function makeDeps(
  overrides: Partial<UpgradeNotificationDeps> = {},
): UpgradeNotificationDeps {
  return {
    currentVersion: "1.2.3",
    getLastNotifiedVersion: vi.fn(() => undefined),
    setLastNotifiedVersion: vi.fn(async () => undefined),
    showInformationMessage: vi.fn(async () => undefined),
    runInstaller: vi.fn(async () => undefined),
    openInstallationGuide: vi.fn(async () => undefined),
    reportDiagnostic: vi.fn(),
    ...overrides,
  };
}

describe("upgrade notification", () => {
  it("persists an unrecorded version before showing the agreed message and actions", async () => {
    const callOrder: string[] = [];
    const setLastNotifiedVersion = vi.fn(async () => {
      callOrder.push("persist");
    });
    const showInformationMessage = vi.fn(async () => {
      callOrder.push("show");
      return undefined;
    });
    const deps = makeDeps({ setLastNotifiedVersion, showInformationMessage });

    await maybeShowUpgradeNotification(deps);

    expect(setLastNotifiedVersion).toHaveBeenCalledWith("1.2.3");
    expect(showInformationMessage).toHaveBeenCalledWith(
      buildUpgradeNotificationMessage("1.2.3"),
      RUN_INSTALLER_ACTION,
      VIEW_INSTALLATION_GUIDE_ACTION,
      LATER_ACTION,
    );
    expect(callOrder).toEqual(["persist", "show"]);
  });

  it("shows once when the recorded version differs", async () => {
    const deps = makeDeps({
      currentVersion: "2.0.0",
      getLastNotifiedVersion: vi.fn(() => "1.9.0"),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.setLastNotifiedVersion).toHaveBeenCalledWith("2.0.0");
    expect(deps.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the current version was already recorded", async () => {
    const deps = makeDeps({
      getLastNotifiedVersion: vi.fn(() => "1.2.3"),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.setLastNotifiedVersion).not.toHaveBeenCalled();
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.runInstaller).not.toHaveBeenCalled();
    expect(deps.openInstallationGuide).not.toHaveBeenCalled();
  });

  it("runs the installer only when Run Installer is selected", async () => {
    const deps = makeDeps({
      showInformationMessage: vi.fn(async () => RUN_INSTALLER_ACTION),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.runInstaller).toHaveBeenCalledTimes(1);
    expect(deps.openInstallationGuide).not.toHaveBeenCalled();
  });

  it("opens the installation guide only when its action is selected", async () => {
    const deps = makeDeps({
      showInformationMessage: vi.fn(
        async () => VIEW_INSTALLATION_GUIDE_ACTION,
      ),
    });

    await maybeShowUpgradeNotification(deps);

    expect(deps.openInstallationGuide).toHaveBeenCalledTimes(1);
    expect(deps.runInstaller).not.toHaveBeenCalled();
  });

  it.each([LATER_ACTION, undefined])(
    "records the version but performs no action for %s",
    async (selectedAction) => {
      let storedVersion: string | undefined;
      const showInformationMessage = vi.fn(async () => selectedAction);
      const deps = makeDeps({
        getLastNotifiedVersion: () => storedVersion,
        setLastNotifiedVersion: async (version) => {
          storedVersion = version;
        },
        showInformationMessage,
      });

      await maybeShowUpgradeNotification(deps);
      await maybeShowUpgradeNotification(deps);

      expect(storedVersion).toBe("1.2.3");
      expect(showInformationMessage).toHaveBeenCalledTimes(1);
      expect(deps.runInstaller).not.toHaveBeenCalled();
      expect(deps.openInstallationGuide).not.toHaveBeenCalled();
    },
  );

  it("logs and skips the notification when state persistence fails", async () => {
    const stateError = new Error("storage unavailable");
    const deps = makeDeps({
      setLastNotifiedVersion: vi.fn(async () => {
        throw stateError;
      }),
    });

    await expect(maybeShowUpgradeNotification(deps)).resolves.toBeUndefined();

    expect(deps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not persist notification state.",
      stateError,
    );
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.runInstaller).not.toHaveBeenCalled();
    expect(deps.openInstallationGuide).not.toHaveBeenCalled();
  });

  it("contains notification and action failures without rejecting activation work", async () => {
    const notificationError = new Error("notification unavailable");
    const notificationDeps = makeDeps({
      showInformationMessage: vi.fn(async () => {
        throw notificationError;
      }),
    });

    await expect(
      maybeShowUpgradeNotification(notificationDeps),
    ).resolves.toBeUndefined();
    expect(notificationDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not show the upgrade notification.",
      notificationError,
    );

    const actionError = new Error("command failed");
    const actionDeps = makeDeps({
      showInformationMessage: vi.fn(async () => RUN_INSTALLER_ACTION),
      runInstaller: vi.fn(async () => {
        throw actionError;
      }),
    });

    await expect(
      maybeShowUpgradeNotification(actionDeps),
    ).resolves.toBeUndefined();
    expect(actionDeps.reportDiagnostic).toHaveBeenCalledWith(
      "The selected upgrade notification action failed.",
      actionError,
    );
  });

  it("skips safely when the extension version is invalid", async () => {
    const deps = makeDeps({ currentVersion: "  " });

    await maybeShowUpgradeNotification(deps);

    expect(deps.reportDiagnostic).toHaveBeenCalledTimes(1);
    expect(deps.getLastNotifiedVersion).not.toHaveBeenCalled();
    expect(deps.setLastNotifiedVersion).not.toHaveBeenCalled();
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
  });

  it("keeps the stable state key and installation guide target", () => {
    expect(RUN_INSTALLER_ACTION).toBe("Run Installer");
    expect(LAST_NOTIFIED_VERSION_KEY).toBe(
      "upgradeNotification.lastNotifiedVersion",
    );
    expect(INSTALLATION_GUIDE_URL).toBe(
      "https://github.com/huynguyen294/ai-artifacts#getting-started",
    );
  });
});

describe("extension activation wiring", () => {
  it("uses global state, the install-and-verify flow, and the README guide", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    const extensionSource = await readFile(
      path.join(repositoryRoot, "src/extension/extension.ts"),
      "utf8",
    );

    expect(extensionSource).toContain("void maybeShowUpgradeNotification({");
    expect(extensionSource).toContain("context.extension.packageJSON.version");
    expect(extensionSource).toContain("context.globalState.get<string>");
    expect(extensionSource).toContain("context.globalState.update(");
    expect(extensionSource).toContain(
      "const installAllDetectedIntegrationsAndNotify",
    );
    expect(extensionSource).toContain("await checkAllIntegrations(context);");
    expect(extensionSource).toContain(
      "runInstaller: installAllDetectedIntegrationsAndNotify",
    );
    expect(extensionSource).toContain(
      "vscode.env.openExternal(vscode.Uri.parse(INSTALLATION_GUIDE_URL))",
    );
  });
});
