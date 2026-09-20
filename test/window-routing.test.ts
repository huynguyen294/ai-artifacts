import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WindowSelectionExpiredError,
  artifactWindowConnectionInputSchema,
  reconnectConnectionInputSchema,
} from "../src/shared/contracts";
import {
  WindowSelectionTokenStore,
  buildWindowCandidates,
  formatWindowCandidateLabel,
  resolveArtifactWindowCandidates,
  selectFocusedWindowTarget,
  selectReconnectWindowTarget,
  windowCandidateId,
} from "../src/shared/window-routing";
import type { WorkspaceRegistrySnapshot } from "../src/shared/workspace-registry";

function snapshot(overrides: Partial<WorkspaceRegistrySnapshot> = {}): WorkspaceRegistrySnapshot {
  const instanceId = overrides.instanceId ?? randomUUID();
  const now = Date.now();
  return {
    schemaVersion: 2,
    instanceId,
    processId: 12345,
    workspaceFile: null,
    focused: false,
    folders: [],
    activeFile: null,
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 45_000).toISOString(),
    ...overrides,
  };
}

describe("window-routing contract", () => {
  describe("deterministic focused target selection", () => {
    it("selects exactly the single focused window", () => {
      const win1 = snapshot({ focused: true });
      const win2 = snapshot({ focused: false });
      const result = selectFocusedWindowTarget([win1, win2]);

      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        expect(result.targetWindow.instanceId).toBe(win1.instanceId);
        expect(result.matchReason).toBe("focused");
      }
    });

    it("selects the sole live window when no window is focused", () => {
      const win = snapshot({ focused: false });
      const result = selectFocusedWindowTarget([win]);

      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        expect(result.targetWindow.instanceId).toBe(win.instanceId);
        expect(result.matchReason).toBe("sole-live");
      }
    });

    it("requires selection when multiple windows are focused (race condition)", () => {
      const win1 = snapshot({ focused: true });
      const win2 = snapshot({ focused: true });
      const result = selectFocusedWindowTarget([win1, win2]);

      expect(result.status).toBe("selection-required");
      if (result.status === "selection-required") {
        expect(result.reason).toBe("multiple-focused");
      }
    });

    it("requires selection when multiple live windows exist and none is focused", () => {
      const win1 = snapshot({ focused: false });
      const win2 = snapshot({ focused: false });
      const result = selectFocusedWindowTarget([win1, win2]);

      expect(result.status).toBe("selection-required");
      if (result.status === "selection-required") {
        expect(result.reason).toBe("multiple-live-none-focused");
      }
    });

    it("returns not-found when no live windows exist", () => {
      const result = selectFocusedWindowTarget([]);
      expect(result.status).toBe("not-found");
    });
  });

  describe("WindowSelectionTokenStore", () => {
    it("mints, claims, and consumes a token", () => {
      const store = new WindowSelectionTokenStore();
      const instanceId = randomUUID();
      const candidateId = windowCandidateId(instanceId);

      const { selectionToken, expiresAt } = store.mint(instanceId, candidateId);
      expect(selectionToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

      const grant = store.claim(selectionToken);
      expect(grant.windowInstanceId).toBe(instanceId);
      expect(grant.candidateId).toBe(candidateId);

      // Claiming again throws WindowSelectionExpiredError
      expect(() => store.claim(selectionToken)).toThrow(WindowSelectionExpiredError);

      store.consume(selectionToken);
      expect(store.getGrant(selectionToken)).toBeUndefined();
    });

    it("releases claim to allow subsequent claiming", () => {
      const store = new WindowSelectionTokenStore();
      const instanceId = randomUUID();
      const candidateId = windowCandidateId(instanceId);
      const { selectionToken } = store.mint(instanceId, candidateId);

      store.claim(selectionToken);
      store.release(selectionToken);

      // Can be claimed again after release
      const grant = store.claim(selectionToken);
      expect(grant.windowInstanceId).toBe(instanceId);
    });

    it("rejects expired token on claim", () => {
      const store = new WindowSelectionTokenStore();
      const instanceId = randomUUID();
      const candidateId = windowCandidateId(instanceId);
      const pastTime = Date.now() - 20 * 60 * 1000;
      const { selectionToken } = store.mint(instanceId, candidateId, pastTime);

      expect(() => store.claim(selectionToken)).toThrow(WindowSelectionExpiredError);
    });
  });

  describe("candidate building and labeling", () => {
    it("formats candidate labels for workspace files, folders, and empty windows", () => {
      const emptyWin = snapshot({ focused: false, folders: [] });
      expect(formatWindowCandidateLabel(emptyWin)).toBe("Empty window");

      const focusedEmptyWin = snapshot({ focused: true, folders: [] });
      expect(formatWindowCandidateLabel(focusedEmptyWin)).toBe("Empty window — focused");

      const folderWin = snapshot({
        focused: false,
        folders: [{ path: "D:\\projects\\agent-plus", realPath: "D:\\projects\\agent-plus" }],
      });
      expect(formatWindowCandidateLabel(folderWin)).toBe("agent-plus");

      const wsFileWin = snapshot({
        focused: true,
        workspaceFile: "D:\\projects\\work.code-workspace",
        folders: [{ path: "D:\\projects\\agent-plus", realPath: "D:\\projects\\agent-plus" }],
      });
      expect(formatWindowCandidateLabel(wsFileWin)).toBe("work — focused");
    });

    it("builds candidate objects with minted selection tokens", () => {
      const store = new WindowSelectionTokenStore();
      const win = snapshot({
        focused: true,
        folders: [{ path: "D:\\projects\\agent-plus", realPath: "D:\\projects\\agent-plus" }],
      });
      const candidates = buildWindowCandidates([win], store);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.windowInstanceId).toBe(win.instanceId);
      expect(candidates[0]!.focused).toBe(true);
      expect(candidates[0]!.label).toBe("agent-plus — focused");
      expect(candidates[0]!.folders).toEqual([{ name: "agent-plus", path: "D:\\projects\\agent-plus" }]);
      expect(candidates[0]!.selectionToken).toBeDefined();
    });
  });

  describe("resolveArtifactWindowCandidates", () => {
    it("returns not-found when registry is empty", () => {
      const store = new WindowSelectionTokenStore();
      const result = resolveArtifactWindowCandidates("agent", [], store);
      expect(result.status).toBe("not-found");
      expect(result.candidates).toHaveLength(0);
    });

    it("matches unique window by query", () => {
      const store = new WindowSelectionTokenStore();
      const win1 = snapshot({
        folders: [{ path: "D:\\projects\\agent-plus", realPath: "D:\\projects\\agent-plus" }],
      });
      const win2 = snapshot({
        folders: [{ path: "D:\\projects\\script-runner", realPath: "D:\\projects\\script-runner" }],
      });

      const result = resolveArtifactWindowCandidates("agent-plus", [win1, win2], store);
      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        expect(result.window.windowInstanceId).toBe(win1.instanceId);
      }
    });

    it("returns selection-required when multiple windows match query", () => {
      const store = new WindowSelectionTokenStore();
      const win1 = snapshot({
        folders: [{ path: "D:\\projects\\agent-plus", realPath: "D:\\projects\\agent-plus" }],
      });
      const win2 = snapshot({
        folders: [{ path: "D:\\projects\\agent-core", realPath: "D:\\projects\\agent-core" }],
      });

      const result = resolveArtifactWindowCandidates("agent", [win1, win2], store);
      expect(result.status).toBe("selection-required");
      if (result.status === "selection-required") {
        expect(result.matchMode).toBe("matched");
        expect(result.candidates).toHaveLength(2);
      }
    });

    it("falls back to all-available when query matches nothing but live windows exist", () => {
      const store = new WindowSelectionTokenStore();
      const win1 = snapshot({
        folders: [{ path: "D:\\projects\\agent-plus", realPath: "D:\\projects\\agent-plus" }],
      });
      const win2 = snapshot({
        folders: [{ path: "D:\\projects\\script-runner", realPath: "D:\\projects\\script-runner" }],
      });

      const result = resolveArtifactWindowCandidates("nonexistent", [win1, win2], store);
      expect(result.status).toBe("selection-required");
      if (result.status === "selection-required") {
        expect(result.matchMode).toBe("all-available");
        expect(result.candidates).toHaveLength(2);
      }
    });

    it("returns all windows when query is omitted", () => {
      const store = new WindowSelectionTokenStore();
      const win1 = snapshot({
        folders: [{ path: "D:\\projects\\agent-plus", realPath: "D:\\projects\\agent-plus" }],
      });
      const win2 = snapshot({
        folders: [{ path: "D:\\projects\\script-runner", realPath: "D:\\projects\\script-runner" }],
      });

      const result = resolveArtifactWindowCandidates(undefined, [win1, win2], store);
      expect(result.status).toBe("selection-required");
      if (result.status === "selection-required") {
        expect(result.matchMode).toBe("all-available");
        expect(result.candidates).toHaveLength(2);
      }
    });
  });

  describe("selectReconnectWindowTarget", () => {
    it("returns not-found when no live windows exist", () => {
      const result = selectReconnectWindowTarget([]);
      expect(result.status).toBe("not-found");
    });

    it("always selects the sole live window, even if affinity hint is mismatched or missing", () => {
      const win = snapshot({ focused: false });
      const randomId = randomUUID();

      // No affinity
      const res1 = selectReconnectWindowTarget([win]);
      expect(res1.status).toBe("matched");
      if (res1.status === "matched") {
        expect(res1.targetWindow.instanceId).toBe(win.instanceId);
        expect(res1.matchReason).toBe("sole-live");
      }

      // Mismatched affinity
      const res2 = selectReconnectWindowTarget([win], randomId, randomId);
      expect(res2.status).toBe("matched");
      if (res2.status === "matched") {
        expect(res2.targetWindow.instanceId).toBe(win.instanceId);
        expect(res2.matchReason).toBe("sole-live");
      }

      // Valid affinity to this sole window
      const res3 = selectReconnectWindowTarget([win], win.instanceId, win.instanceId);
      expect(res3.status).toBe("matched");
      if (res3.status === "matched") {
        expect(res3.targetWindow.instanceId).toBe(win.instanceId);
        expect(res3.matchReason).toBe("sole-live");
      }
    });

    it("selects artifact-affinity target over a focused window when valid and live", () => {
      const winA = snapshot({ focused: false });
      const winB = snapshot({ focused: true });

      const result = selectReconnectWindowTarget([winA, winB], winA.instanceId, winA.instanceId);
      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        expect(result.targetWindow.instanceId).toBe(winA.instanceId);
        expect(result.matchReason).toBe("artifact-affinity");
      }
    });

    it("selects artifact-affinity target when no windows are focused", () => {
      const winA = snapshot({ focused: false });
      const winB = snapshot({ focused: false });

      const result = selectReconnectWindowTarget([winA, winB], winA.instanceId, winA.instanceId);
      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        expect(result.targetWindow.instanceId).toBe(winA.instanceId);
        expect(result.matchReason).toBe("artifact-affinity");
      }
    });

    it("falls back to focused window when AI affinity is omitted", () => {
      const winA = snapshot({ focused: false });
      const winB = snapshot({ focused: true });

      const result = selectReconnectWindowTarget([winA, winB], undefined, winA.instanceId);
      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        expect(result.targetWindow.instanceId).toBe(winB.instanceId);
        expect(result.matchReason).toBe("focused");
      }
    });

    it("falls back to focused window when persisted connection is missing", () => {
      const winA = snapshot({ focused: false });
      const winB = snapshot({ focused: true });

      const result = selectReconnectWindowTarget([winA, winB], winA.instanceId, undefined);
      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        expect(result.targetWindow.instanceId).toBe(winB.instanceId);
        expect(result.matchReason).toBe("focused");
      }
    });

    it("falls back to focused window when AI ID does not match persisted connection ID", () => {
      const winA = snapshot({ focused: false });
      const winB = snapshot({ focused: true });
      const differentId = randomUUID();

      const result = selectReconnectWindowTarget([winA, winB], differentId, winA.instanceId);
      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        expect(result.targetWindow.instanceId).toBe(winB.instanceId);
        expect(result.matchReason).toBe("focused");
      }
    });

    it("falls back to focused window when matching ID is no longer in live snapshots (stale)", () => {
      const deadId = randomUUID();
      const winA = snapshot({ focused: false });
      const winB = snapshot({ focused: true });

      const result = selectReconnectWindowTarget([winA, winB], deadId, deadId);
      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        expect(result.targetWindow.instanceId).toBe(winB.instanceId);
        expect(result.matchReason).toBe("focused");
      }
    });

    it("returns selection-required when affinity is invalid and no window is focused", () => {
      const winA = snapshot({ focused: false });
      const winB = snapshot({ focused: false });

      const result = selectReconnectWindowTarget([winA, winB], undefined, undefined);
      expect(result.status).toBe("selection-required");
      if (result.status === "selection-required") {
        expect(result.reason).toBe("multiple-live-none-focused");
        expect(result.candidates).toHaveLength(2);
      }
    });

    it("returns selection-required when affinity is invalid and multiple windows are focused", () => {
      const winA = snapshot({ focused: true });
      const winB = snapshot({ focused: true });

      const result = selectReconnectWindowTarget([winA, winB], undefined, undefined);
      expect(result.status).toBe("selection-required");
      if (result.status === "selection-required") {
        expect(result.reason).toBe("multiple-focused");
        expect(result.candidates).toHaveLength(2);
      }
    });
  });

  describe("connection input schemas", () => {
    it("validates artifactWindowConnectionInputSchema strictly", () => {
      const validId = randomUUID();
      const valid = artifactWindowConnectionInputSchema.safeParse({
        targetMode: "artifact-window",
        windowInstanceId: validId,
      });
      expect(valid.success).toBe(true);

      // Rejects invalid UUID
      const invalidUuid = artifactWindowConnectionInputSchema.safeParse({
        targetMode: "artifact-window",
        windowInstanceId: "not-a-uuid",
      });
      expect(invalidUuid.success).toBe(false);

      // Rejects extra fields (strict)
      const extraField = artifactWindowConnectionInputSchema.safeParse({
        targetMode: "artifact-window",
        windowInstanceId: validId,
        connectionRevision: 2,
      });
      expect(extraField.success).toBe(false);

      // Rejects mixed targetMode
      const mixed = artifactWindowConnectionInputSchema.safeParse({
        targetMode: "explicit-window",
        windowInstanceId: validId,
      });
      expect(mixed.success).toBe(false);
    });

    it("validates reconnectConnectionInputSchema discriminated union", () => {
      const id = randomUUID();
      const token = randomUUID();

      const affinity = reconnectConnectionInputSchema.safeParse({
        targetMode: "artifact-window",
        windowInstanceId: id,
      });
      expect(affinity.success).toBe(true);

      const explicit = reconnectConnectionInputSchema.safeParse({
        targetMode: "explicit-window",
        selectionToken: token,
      });
      expect(explicit.success).toBe(true);

      // Rejects mixed fields
      const mixed = reconnectConnectionInputSchema.safeParse({
        targetMode: "artifact-window",
        windowInstanceId: id,
        selectionToken: token,
      });
      expect(mixed.success).toBe(false);

      // Rejects unknown mode
      const unknownMode = reconnectConnectionInputSchema.safeParse({
        targetMode: "unknown",
        windowInstanceId: id,
      });
      expect(unknownMode.success).toBe(false);
    });
  });
});
