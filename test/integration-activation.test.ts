import { describe, expect, it, vi } from "vitest";
import {
  INSTALLER_ONBOARDING_ACCEPTED_KEY,
  RUN_INSTALLER_ACTION,
  runIntegrationActivation,
  type IntegrationActivationDeps,
} from "../src/extension/integration-activation";
import {
  CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
  MCP_VERSION,
  WORK_SESSION_SKILL_VERSION,
} from "../src/shared/contracts";
import type { InstalledIntegrationVersionReadResult } from "../src/extension/workspace-integration";

function makeDeps(
  overrides: Partial<IntegrationActivationDeps> = {},
): IntegrationActivationDeps {
  return {
    getInstalledIntegrationVersion: vi.fn(
      async (): Promise<InstalledIntegrationVersionReadResult> => ({ status: "missing" }),
    ),
    isOnboardingAccepted: vi.fn(() => false),
    acceptOnboarding: vi.fn(async () => undefined),
    runInstaller: vi.fn(async () => undefined),
    runUpgrade: vi.fn(async () => undefined),
    showInformationMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined),
    reportDiagnostic: vi.fn(),
    ...overrides,
  };
}

describe("integration activation controller", () => {
  it("invites missing users once when onboarding is not accepted, skipping detection and upgrade", async () => {
    expect(INSTALLER_ONBOARDING_ACCEPTED_KEY).toBe("installer.onboardingAccepted");

    const deps = makeDeps();
    await runIntegrationActivation(deps);

    expect(deps.getInstalledIntegrationVersion).toHaveBeenCalledTimes(1);
    expect(deps.isOnboardingAccepted).toHaveBeenCalledTimes(1);
    expect(deps.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(deps.showInformationMessage).toHaveBeenCalledWith(
      "Set up AI Artifacts for your AI client(s).",
      RUN_INSTALLER_ACTION,
    );
    expect(deps.acceptOnboarding).not.toHaveBeenCalled();
    expect(deps.runInstaller).not.toHaveBeenCalled();
    expect(deps.runUpgrade).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
    expect(deps.reportDiagnostic).not.toHaveBeenCalled();
  });

  it("invites again on the next activation if the user dismisses the onboarding prompt", async () => {
    let accepted = false;
    const deps = makeDeps({
      isOnboardingAccepted: vi.fn(() => accepted),
      acceptOnboarding: vi.fn(async () => {
        accepted = true;
      }),
      showInformationMessage: vi.fn(async () => undefined),
    });

    await runIntegrationActivation(deps);
    await runIntegrationActivation(deps);

    expect(deps.showInformationMessage).toHaveBeenCalledTimes(2);
    expect(accepted).toBe(false);
    expect(deps.acceptOnboarding).not.toHaveBeenCalled();
    expect(deps.runInstaller).not.toHaveBeenCalled();
    expect(deps.runUpgrade).not.toHaveBeenCalled();
  });

  it("records onboarding acceptance before executing Installer on click and stays silent later even if picker cancels", async () => {
    const callOrder: string[] = [];
    let accepted = false;
    let releaseAccept!: () => void;
    const pendingAccept = new Promise<void>((resolve) => {
      releaseAccept = resolve;
    });

    const deps = makeDeps({
      isOnboardingAccepted: vi.fn(() => accepted),
      acceptOnboarding: vi.fn(async () => {
        callOrder.push("accept-start");
        await pendingAccept;
        accepted = true;
        callOrder.push("accept-done");
      }),
      runInstaller: vi.fn(async () => {
        callOrder.push("run-installer");
      }),
      showInformationMessage: vi.fn(async () => {
        callOrder.push("show-info");
        return RUN_INSTALLER_ACTION;
      }),
    });

    const activationPromise = runIntegrationActivation(deps);
    await vi.waitFor(() => {
      expect(callOrder).toEqual(["show-info", "accept-start"]);
    });
    expect(deps.runInstaller).not.toHaveBeenCalled();

    releaseAccept();
    await activationPromise;

    expect(callOrder).toEqual(["show-info", "accept-start", "accept-done", "run-installer"]);
    expect(accepted).toBe(true);
    expect(deps.runUpgrade).not.toHaveBeenCalled();

    // Next activation while version file is still missing (e.g. user canceled picker): silent, no upgrade
    await runIntegrationActivation(deps);
    expect(deps.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(deps.acceptOnboarding).toHaveBeenCalledTimes(1);
    expect(deps.runInstaller).toHaveBeenCalledTimes(1);
    expect(deps.runUpgrade).not.toHaveBeenCalled();
  });

  it("stays silent on missing version when onboarding was previously accepted", async () => {
    const deps = makeDeps({
      isOnboardingAccepted: vi.fn(() => true),
    });

    await runIntegrationActivation(deps);

    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.acceptOnboarding).not.toHaveBeenCalled();
    expect(deps.runInstaller).not.toHaveBeenCalled();
    expect(deps.runUpgrade).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });

  it("routes valid existing version snapshots directly to upgrade without touching onboarding state", async () => {
    const validSnapshot: InstalledIntegrationVersionReadResult = {
      status: "valid",
      manifest: {
        schemaVersion: 1,
        mcpVersion: MCP_VERSION - 1,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION },
        updatedAt: "2026-11-11T00:00:00.000Z",
      },
    };
    const deps = makeDeps({
      getInstalledIntegrationVersion: vi.fn(async () => validSnapshot),
    });

    await runIntegrationActivation(deps);

    expect(deps.runUpgrade).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.runUpgrade).mock.calls[0]?.[0]).toBe(validSnapshot);
    expect(deps.isOnboardingAccepted).not.toHaveBeenCalled();
    expect(deps.acceptOnboarding).not.toHaveBeenCalled();
    expect(deps.runInstaller).not.toHaveBeenCalled();
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
  });

  it("treats invalid receipt snapshots as existing user state for upgrade without emitting a setup warning", async () => {
    const invalidSnapshot: InstalledIntegrationVersionReadResult = {
      status: "invalid",
      error: new SyntaxError("Malformed JSON"),
    };
    const deps = makeDeps({
      getInstalledIntegrationVersion: vi.fn(async () => invalidSnapshot),
    });

    await runIntegrationActivation(deps);

    expect(deps.runUpgrade).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.runUpgrade).mock.calls[0]?.[0]).toBe(invalidSnapshot);
    expect(deps.isOnboardingAccepted).not.toHaveBeenCalled();
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });

  it("shows a single error notification on version read I/O failure without inviting or upgrading", async () => {
    const readError = new Error("EACCES: permission denied");
    const deps = makeDeps({
      getInstalledIntegrationVersion: vi.fn(async () => {
        throw readError;
      }),
    });

    await expect(runIntegrationActivation(deps)).resolves.toBeUndefined();

    expect(deps.getInstalledIntegrationVersion).toHaveBeenCalledTimes(1);
    expect(deps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not read installed integration versions.",
      readError,
    );
    expect(deps.showErrorMessage).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(deps.showErrorMessage).mock.calls[0]!;
    expect(message).toContain("EACCES: permission denied");
    expect(message).toContain("AI Artifacts: Installer");
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.runUpgrade).not.toHaveBeenCalled();
    expect(deps.runInstaller).not.toHaveBeenCalled();
    expect(deps.isOnboardingAccepted).not.toHaveBeenCalled();
  });

  it("contains UI, state persistence, installer execution, and diagnostic errors without secondary popups", async () => {
    // 1. showInformationMessage throws -> contained, no onboarding update or error popup
    const promptError = new Error("prompt UI failed");
    const promptFailDeps = makeDeps({
      showInformationMessage: vi.fn(async () => {
        throw promptError;
      }),
    });
    await expect(runIntegrationActivation(promptFailDeps)).resolves.toBeUndefined();
    expect(promptFailDeps.acceptOnboarding).not.toHaveBeenCalled();
    expect(promptFailDeps.showErrorMessage).not.toHaveBeenCalled();
    expect(promptFailDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not show onboarding installer prompt.",
      promptError,
    );

    // 2. acceptOnboarding throws -> logs diagnostic and still runs Installer
    const acceptError = new Error("globalState write failed");
    const acceptFailDeps = makeDeps({
      showInformationMessage: vi.fn(async () => RUN_INSTALLER_ACTION),
      acceptOnboarding: vi.fn(async () => {
        throw acceptError;
      }),
    });
    await expect(runIntegrationActivation(acceptFailDeps)).resolves.toBeUndefined();
    expect(acceptFailDeps.reportDiagnostic).toHaveBeenCalledWith(
      "Could not persist onboarding acceptance.",
      acceptError,
    );
    expect(acceptFailDeps.runInstaller).toHaveBeenCalledTimes(1);
    expect(acceptFailDeps.showErrorMessage).not.toHaveBeenCalled();

    // 3. runInstaller rejects -> shows one Error and does not retry
    const execError = new Error("command agentPlus.installer not found");
    const execFailDeps = makeDeps({
      showInformationMessage: vi.fn(async () => RUN_INSTALLER_ACTION),
      runInstaller: vi.fn(async () => {
        throw execError;
      }),
    });
    await expect(runIntegrationActivation(execFailDeps)).resolves.toBeUndefined();
    expect(execFailDeps.runInstaller).toHaveBeenCalledTimes(1);
    expect(execFailDeps.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFailDeps.showErrorMessage).mock.calls[0]?.[0]).toContain(
      "command agentPlus.installer not found",
    );

    // 4. showErrorMessage and reportDiagnostic throw -> contained cleanly
    const fatalUiDeps = makeDeps({
      getInstalledIntegrationVersion: vi.fn(async () => {
        throw new Error("EIO read failure");
      }),
      showErrorMessage: vi.fn(async () => {
        throw new Error("error UI failed");
      }),
      reportDiagnostic: vi.fn(() => {
        throw new Error("diagnostic failed");
      }),
    });
    await expect(runIntegrationActivation(fatalUiDeps)).resolves.toBeUndefined();
    expect(fatalUiDeps.showErrorMessage).toHaveBeenCalledTimes(1);
  });
});

