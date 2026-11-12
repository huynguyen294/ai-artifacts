import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runWhatsNewNotification,
  VIEW_WHATS_NEW_ACTION,
  type WhatsNewNotificationDeps,
} from "../src/extension/whats-new-notification";
import type { WhatsNewRelease } from "../src/shared/whats-new-releases";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const sampleReleases: readonly WhatsNewRelease[] = [
  {
    version: "1.2.0",
    title: "Work Sessions are here — with multi-agent support",
    description: "Manage shared session instructions and artifacts.",
    features: ["Session Manager"],
    bugFixes: [],
    notify: true,
  },
  {
    version: "1.1.4",
    title: "Complete Review Feedback",
    description: "Silent entry.",
    features: [],
    bugFixes: [],
    notify: false,
  },
  {
    version: "1.1.3",
    title: "Omitted notify default",
    description: "Implicitly false.",
    features: [],
    bugFixes: [],
  },
];

function makeDeps(
  overrides: Partial<WhatsNewNotificationDeps> = {},
): WhatsNewNotificationDeps {
  return {
    getCurrentVersion: vi.fn(() => "1.2.0"),
    releases: sampleReleases,
    claimUpgradeNotification: vi.fn(async () => true),
    showInformationMessage: vi.fn(async () => undefined),
    openVersion: vi.fn(),
    reportDiagnostic: vi.fn(),
    ...overrides,
  };
}

describe("whats-new notification controller", () => {
  it("shows one non-modal Info notification when exact runtime release has notify: true and state claims true, opening the version only on button click", async () => {
    const clickDeps = makeDeps({
      showInformationMessage: vi.fn(async () => VIEW_WHATS_NEW_ACTION),
    });

    await runWhatsNewNotification(clickDeps);

    expect(clickDeps.claimUpgradeNotification).toHaveBeenCalledTimes(1);
    expect(clickDeps.claimUpgradeNotification).toHaveBeenCalledWith("1.2.0", true);
    expect(clickDeps.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(clickDeps.showInformationMessage).toHaveBeenCalledWith(
      "AI Artifacts 1.2.0: Work Sessions are here — with multi-agent support",
      VIEW_WHATS_NEW_ACTION,
    );
    expect(clickDeps.openVersion).toHaveBeenCalledTimes(1);
    expect(clickDeps.openVersion).toHaveBeenCalledWith("1.2.0");
    expect(clickDeps.reportDiagnostic).not.toHaveBeenCalled();

    // Dismiss (undefined) or other return does not open panel
    const dismissDeps = makeDeps({
      showInformationMessage: vi.fn(async () => undefined),
    });
    await runWhatsNewNotification(dismissDeps);
    expect(dismissDeps.claimUpgradeNotification).toHaveBeenCalledWith("1.2.0", true);
    expect(dismissDeps.openVersion).not.toHaveBeenCalled();

    const otherActionDeps = makeDeps({
      showInformationMessage: vi.fn(async () => "Dismiss"),
    });
    await runWhatsNewNotification(otherActionDeps);
    expect(otherActionDeps.openVersion).not.toHaveBeenCalled();
  });

  it("always observes runtime version with notifyEnabled=false for missing, false, omitted, or mismatched releases without catch-up", async () => {
    for (const version of ["1.3.0", "1.1.4", "1.1.3", "v1.2.0"]) {
      const claimMock = vi.fn(async () => false);
      const deps = makeDeps({
        getCurrentVersion: vi.fn(() => version),
        claimUpgradeNotification: claimMock,
      });

      await runWhatsNewNotification(deps);

      expect(claimMock).toHaveBeenCalledTimes(1);
      expect(claimMock).toHaveBeenCalledWith(version, false);
      expect(deps.showInformationMessage).not.toHaveBeenCalled();
      expect(deps.openVersion).not.toHaveBeenCalled();
      expect(deps.reportDiagnostic).not.toHaveBeenCalled();
    }

    // Even if a test double claims true while notify is false/missing, UI stays suppressed
    const safetyDeps = makeDeps({
      getCurrentVersion: vi.fn(() => "1.3.0"),
      claimUpgradeNotification: vi.fn(async () => true),
    });
    await runWhatsNewNotification(safetyDeps);
    expect(safetyDeps.showInformationMessage).not.toHaveBeenCalled();
    expect(safetyDeps.openVersion).not.toHaveBeenCalled();
  });

  it("stays silent when state returns false (fresh bootstrap, reload, downgrade, or lost race)", async () => {
    const deps = makeDeps({
      claimUpgradeNotification: vi.fn(async () => false),
    });

    await runWhatsNewNotification(deps);

    expect(deps.claimUpgradeNotification).toHaveBeenCalledWith("1.2.0", true);
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.openVersion).not.toHaveBeenCalled();
    expect(deps.reportDiagnostic).not.toHaveBeenCalled();
  });

  it("contains getVersion, state, UI, openVersion, and diagnostic errors without retries or secondary side effects", async () => {
    // 1. getCurrentVersion throws
    const versionErr = new Error("packageJSON missing");
    const getVersionThrowDeps = makeDeps({
      getCurrentVersion: vi.fn(() => {
        throw versionErr;
      }),
    });
    await expect(runWhatsNewNotification(getVersionThrowDeps)).resolves.toBeUndefined();
    expect(getVersionThrowDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not read current extension version.",
      versionErr,
    );
    expect(getVersionThrowDeps.claimUpgradeNotification).not.toHaveBeenCalled();
    expect(getVersionThrowDeps.showInformationMessage).not.toHaveBeenCalled();

    // 2. Non-string or empty version
    for (const badVersion of [undefined, null, 120, ""]) {
      const badVersionDeps = makeDeps({
        getCurrentVersion: vi.fn(() => badVersion),
      });
      await expect(runWhatsNewNotification(badVersionDeps)).resolves.toBeUndefined();
      expect(badVersionDeps.reportDiagnostic).toHaveBeenCalledTimes(1);
      expect(badVersionDeps.claimUpgradeNotification).not.toHaveBeenCalled();
    }

    // 3. State rejects
    const stateErr = new Error("EACCES baseline");
    const stateFailDeps = makeDeps({
      claimUpgradeNotification: vi.fn(async () => {
        throw stateErr;
      }),
    });
    await expect(runWhatsNewNotification(stateFailDeps)).resolves.toBeUndefined();
    expect(stateFailDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not update What's New notification state.",
      stateErr,
    );
    expect(stateFailDeps.showInformationMessage).not.toHaveBeenCalled();
    expect(stateFailDeps.openVersion).not.toHaveBeenCalled();

    // 4. showInformationMessage rejects -> claimed once, no retry, no openVersion
    const uiErr = new Error("notification host unavailable");
    const uiFailDeps = makeDeps({
      showInformationMessage: vi.fn(async () => {
        throw uiErr;
      }),
    });
    await expect(runWhatsNewNotification(uiFailDeps)).resolves.toBeUndefined();
    expect(uiFailDeps.claimUpgradeNotification).toHaveBeenCalledTimes(1);
    expect(uiFailDeps.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(uiFailDeps.openVersion).not.toHaveBeenCalled();
    expect(uiFailDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not show What's New upgrade notification.",
      uiErr,
    );

    // 5. openVersion throws / rejects (and reportDiagnostic also throws) -> contained cleanly without retry
    const openErr = new Error("panel open failed");
    const openFailDeps = makeDeps({
      showInformationMessage: vi.fn(async () => VIEW_WHATS_NEW_ACTION),
      openVersion: vi.fn(async () => {
        throw openErr;
      }),
      reportDiagnostic: vi.fn(() => {
        throw new Error("logger broken");
      }),
    });
    await expect(runWhatsNewNotification(openFailDeps)).resolves.toBeUndefined();
    expect(openFailDeps.claimUpgradeNotification).toHaveBeenCalledTimes(1);
    expect(openFailDeps.openVersion).toHaveBeenCalledTimes(1);
  });

  it("stays free of vscode, frontend ?raw content, and integration history imports", async () => {
    const controllerSource = await fs.readFile(
      path.join(repositoryRoot, "src", "extension", "whats-new-notification.ts"),
      "utf8",
    );
    const stateSource = await fs.readFile(
      path.join(repositoryRoot, "src", "extension", "whats-new-notification-state.ts"),
      "utf8",
    );

    for (const source of [controllerSource, stateSource]) {
      expect(source).not.toContain('from "vscode"');
      expect(source).not.toContain("?raw");
      expect(source).not.toContain("whats-new-content");
      expect(source).not.toContain("installed-clients");
      expect(source).not.toContain("integration-version");
    }
  });
});

