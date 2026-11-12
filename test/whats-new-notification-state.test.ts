import { describe, expect, it, vi } from "vitest";
import {
  recordWhatsNewVersion,
  WHATS_NEW_HIGHEST_OBSERVED_VERSION_KEY as VERSION_KEY,
} from "../src/extension/whats-new-notification-state";

function makeState(initialVersion?: unknown) {
  const values = new Map<string, unknown>();
  if (initialVersion !== undefined) values.set(VERSION_KEY, initialVersion);
  return {
    get: vi.fn((key: string) => values.get(key)),
    update: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
}

describe("What's New version state via VS Code globalState", () => {
  it("records a fresh baseline silently, including after the user later runs Installer", async () => {
    const state = makeState();
    expect(await recordWhatsNewVersion(state, "1.2.0", true, false)).toBe(false);
    expect(state.update).toHaveBeenCalledWith(VERSION_KEY, "1.2.0");
    expect(await recordWhatsNewVersion(state, "1.2.0", true, true)).toBe(false);
    expect(state.update).toHaveBeenCalledTimes(1);
  });

  it("announces the exact opted-in version once for legacy integration users without notification history", async () => {
    const state = makeState();
    expect(await recordWhatsNewVersion(state, "1.2.0", true, true)).toBe(true);
    expect(state.get(VERSION_KEY)).toBe("1.2.0");
    expect(await recordWhatsNewVersion(state, "1.2.0", true, true)).toBe(false);
    expect(state.update).toHaveBeenCalledTimes(1);
  });

  it("observes silent versions without catch-up, even when notify is enabled later", async () => {
    const state = makeState("1.1.4");
    expect(await recordWhatsNewVersion(state, "1.2.0", false)).toBe(false);
    expect(await recordWhatsNewVersion(state, "1.2.0", true)).toBe(false);
    expect(await recordWhatsNewVersion(state, "1.4.0", true)).toBe(true);
  });

  it("does not catch up a legacy bootstrap initially observed with notify disabled", async () => {
    const state = makeState();
    expect(await recordWhatsNewVersion(state, "1.2.0", false, true)).toBe(false);
    expect(await recordWhatsNewVersion(state, "1.2.0", true, true)).toBe(false);
  });

  it("compares numeric segments and keeps the highest observed version through downgrade and return", async () => {
    const state = makeState("1.9.0");
    expect(await recordWhatsNewVersion(state, "1.10.0", true)).toBe(true);
    expect(await recordWhatsNewVersion(state, "1.9.5", true)).toBe(false);
    expect(state.get(VERSION_KEY)).toBe("1.10.0");
    expect(await recordWhatsNewVersion(state, "1.10.0", true)).toBe(false);
    expect(await recordWhatsNewVersion(state, "1.11.0", true)).toBe(true);
  });

  it("waits for globalState.update to finish before allowing notification UI", async () => {
    const state = makeState("1.1.4");
    let finishUpdate!: () => void;
    state.update.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishUpdate = resolve;
    }));
    let resolved = false;
    const pending = recordWhatsNewVersion(state, "1.2.0", true).then((notify) => {
      resolved = true;
      return notify;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    finishUpdate();
    await expect(pending).resolves.toBe(true);
  });

  it("propagates get/update failures so the controller can stay silent diagnostically", async () => {
    const readState = makeState();
    const readError = new Error("state read failed");
    readState.get.mockImplementationOnce(() => { throw readError; });
    await expect(recordWhatsNewVersion(readState, "1.2.0", true)).rejects.toBe(readError);
    expect(readState.update).not.toHaveBeenCalled();

    const writeState = makeState("1.1.4");
    const writeError = new Error("state update failed");
    writeState.update.mockRejectedValueOnce(writeError);
    await expect(recordWhatsNewVersion(writeState, "1.2.0", true)).rejects.toBe(writeError);
    expect(writeState.get(VERSION_KEY)).toBe("1.1.4");
  });

  it("rejects invalid current or stored versions without overwriting state", async () => {
    const state = makeState();
    for (const version of ["", "v1.2.0", "01.2.0", "1.2", "1.2.0-beta.1", "1.2.0+build.4", "99999999999999999999.0.0"]) {
      await expect(recordWhatsNewVersion(state, version, true)).rejects.toThrow();
    }
    expect(state.get).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    const corruptState = makeState({ version: "1.1.4" });
    await expect(recordWhatsNewVersion(corruptState, "1.2.0", true)).rejects.toThrow();
    expect(corruptState.update).not.toHaveBeenCalled();
  });
});
