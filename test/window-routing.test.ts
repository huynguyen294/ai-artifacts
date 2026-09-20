import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WindowSelectionExpiredError,
} from "../src/shared/contracts";
import {
  WindowSelectionTokenStore,
  buildWindowCandidates,
  formatWindowCandidateLabel,
  resolveArtifactWindowCandidates,
  selectFocusedWindowTarget,
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
});
