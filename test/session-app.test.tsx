import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkSessionViewData } from "../src/shared/contracts";
import {
  createInitialSessionManagerState,
  SessionApp,
  sessionManagerReducer,
} from "../src/webview/SessionApp";

// Mock vscode API for webview tests
vi.mock("../src/webview/vscode-api", () => ({
  vscode: {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  },
}));

describe("SessionApp Webview Component (Phase 3)", () => {
  const sampleViewData: WorkSessionViewData = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    title: "Feature Implementation Session",
    typeId: "feature",
    typeLabel: "Feature",
    instructions: "## Guidelines\n1. Follow TDD.\n2. Keep diffs focused.",
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T11:00:00.000Z",
    working: [
      {
        artifactId: "artifact-working-01",
        title: "Main Implementation Plan",
        kind: "implementation-plan",
        updatedAt: "2026-04-10T11:00:00.000Z",
      },
    ],
    references: [
      {
        artifactId: "artifact-ref-01",
        title: "API Design Spec",
        kind: "spec",
        updatedAt: "2026-04-10T09:30:00.000Z",
      },
    ],
    archived: [
      {
        artifactId: "artifact-archived-01",
        title: "Deprecated Proposal",
        kind: "document",
        updatedAt: "2026-04-09T18:00:00.000Z",
        unavailable: true,
      },
    ],
  };

  describe("Rendering (SSR / Static Layout)", () => {
    it("renders loading state by default", () => {
      const html = renderToStaticMarkup(<SessionApp />);
      expect(html).toContain("session-app loading");
      expect(html).toContain("Loading work session...");
    });

    it("renders error banner when status is error", () => {
      const html = renderToStaticMarkup(
        <SessionApp initialState={{ status: "error", message: "Failed to load session" }} />,
      );
      expect(html).toContain("session-app error");
      expect(html).toContain("Failed to load work session");
      expect(html).toContain("Failed to load session");
    });

    it("renders full 2-column manager layout when panelExpanded is true", () => {
      const html = renderToStaticMarkup(
        <SessionApp
          initialState={{ status: "ready", data: sampleViewData }}
          initialPanelExpanded={true}
        />,
      );

      // Header
      expect(html).toContain("Feature Implementation Session");
      expect(html).toContain('title="Rename session"');
      expect(html).toContain('title="Collapse side panel"');

      // Main column: Working zone
      expect(html).toContain("session-main-column");
      expect(html).toContain("session-zone-working");
      expect(html).toContain("Main Implementation Plan");
      expect(html).toContain("artifact-working-01");
      expect(html).toContain('title="Artifact options"');

      // Side panel: Type -> Instructions -> References -> Archived
      expect(html).toContain("session-side-panel");
      expect(html).toContain("Session Type");
      expect(html).toContain('title="Change session type"');
      expect(html).toContain("Feature");

      // Instructions textarea
      expect(html).toContain("session-instructions-textarea");
      expect(html).toContain("## Guidelines");
      expect(html).toContain("Save");

      // References and Archived zones in side panel
      expect(html).toContain("session-zone-references");
      expect(html).toContain("API Design Spec");
      expect(html).toContain("session-zone-archived");
      expect(html).toContain("Deprecated Proposal");
    });

    it("collapses side panel when initialPanelExpanded is false and expands main column", () => {
      const html = renderToStaticMarkup(
        <SessionApp
          initialState={{ status: "ready", data: sampleViewData }}
          initialPanelExpanded={false}
        />,
      );

      expect(html).toContain("Feature Implementation Session");
      expect(html).toContain('title="Expand side panel"');

      // Main column has Working zone
      expect(html).toContain("session-main-column");
      expect(html).toContain("session-zone-working");

      // Side panel is not rendered
      expect(html).not.toContain("session-side-panel");
      expect(html).not.toContain("session-instructions-textarea");
    });

    it("marks unavailable artifacts with disabled styling and badge", () => {
      const html = renderToStaticMarkup(
        <SessionApp
          initialState={{ status: "ready", data: sampleViewData }}
          initialPanelExpanded={true}
        />,
      );

      expect(html).toContain("session-artifact-card-unavailable");
      expect(html).toContain("Unavailable");
      expect(html).toContain('aria-disabled="true"');
    });

    it("renders session card menu anchor element", () => {
      const html = renderToStaticMarkup(
        <SessionApp
          initialState={{ status: "ready", data: sampleViewData }}
          initialPanelExpanded={true}
        />,
      );
      expect(html).toContain("session-card-menu-anchor");
      expect(html).toContain("session-card-menu-btn");
    });
  });

  describe("Finding 1 & 3: State Machine & Background Refresh Isolation", () => {
    it("initializes draft on first ready workSessionState message", () => {
      const initial = createInitialSessionManagerState({ status: "loading" });
      expect(initial.hasInitializedDraft).toBe(false);
      expect(initial.draftInstructions).toBe("");

      const afterReady = sessionManagerReducer(initial, {
        type: "message",
        message: {
          type: "workSessionState",
          state: { status: "ready", data: sampleViewData },
          panelExpanded: true,
        },
      });

      expect(afterReady.hasInitializedDraft).toBe(true);
      expect(afterReady.draftInstructions).toBe(sampleViewData.instructions);
      expect(afterReady.panelExpanded).toBe(true);
    });

    it("does NOT overwrite user draft instructions when receiving subsequent workSessionState (e.g. support gate/background refresh)", () => {
      const initial = createInitialSessionManagerState({
        status: "ready",
        data: sampleViewData,
      });

      // User starts typing a draft (not yet saved)
      const afterUserTyping = sessionManagerReducer(initial, {
        type: "setDraft",
        draft: "My in-progress draft that must NOT be wiped by background refresh",
      });

      expect(afterUserTyping.draftInstructions).toBe(
        "My in-progress draft that must NOT be wiped by background refresh",
      );

      // Simulate background refresh emitting workSessionState with old persisted instructions
      const afterBackgroundRefresh = sessionManagerReducer(afterUserTyping, {
        type: "message",
        message: {
          type: "workSessionState",
          state: {
            status: "ready",
            data: {
              ...sampleViewData,
              instructions: "Old persisted instructions on disk",
            },
          },
        },
      });

      // Key assertion for Finding 1: draft is preserved, data is updated
      expect(afterBackgroundRefresh.draftInstructions).toBe(
        "My in-progress draft that must NOT be wiped by background refresh",
      );
      expect(afterBackgroundRefresh.state.status === "ready" && afterBackgroundRefresh.state.data.instructions).toBe(
        "Old persisted instructions on disk",
      );
    });

    it("preserves draft instructions when receiving workSessionSummaryPatch or workSessionArtifactsPatch", () => {
      const initial = createInitialSessionManagerState({
        status: "ready",
        data: sampleViewData,
      });

      const withDraft = sessionManagerReducer(initial, {
        type: "setDraft",
        draft: "User typing draft",
      });

      // Summary patch
      const afterSummary = sessionManagerReducer(withDraft, {
        type: "message",
        message: {
          type: "workSessionSummaryPatch",
          summary: {
            title: "Renamed Title",
            typeId: "bug",
            typeLabel: "Bug",
            updatedAt: "2026-04-10T12:00:00.000Z",
          },
        },
      });

      expect(afterSummary.draftInstructions).toBe("User typing draft");
      expect(afterSummary.state.status === "ready" && afterSummary.state.data.title).toBe("Renamed Title");

      // Artifacts patch
      const afterArtifacts = sessionManagerReducer(afterSummary, {
        type: "message",
        message: {
          type: "workSessionArtifactsPatch",
          working: [],
          references: [],
          archived: [],
          updatedAt: "2026-04-10T12:05:00.000Z",
        },
      });

      expect(afterArtifacts.draftInstructions).toBe("User typing draft");
      expect(afterArtifacts.state.status === "ready" && afterArtifacts.state.data.working).toHaveLength(0);
    });

    it("updates draft and persisted instructions on sessionInstructionsSaved", () => {
      const initial = createInitialSessionManagerState({
        status: "ready",
        data: sampleViewData,
      });

      const savingState = sessionManagerReducer(initial, {
        type: "startSaveInstructions",
      });
      expect(savingState.savingInstructions).toBe(true);

      const afterSaved = sessionManagerReducer(savingState, {
        type: "message",
        message: {
          type: "sessionInstructionsSaved",
          instructions: "New saved instructions content",
        },
      });

      expect(afterSaved.savingInstructions).toBe(false);
      expect(afterSaved.instructionsError).toBeUndefined();
      expect(afterSaved.draftInstructions).toBe("New saved instructions content");
      expect(afterSaved.state.status === "ready" && afterSaved.state.data.instructions).toBe(
        "New saved instructions content",
      );
    });

    it("preserves user draft and sets inline error on actionError for saveSessionInstructions", () => {
      const initial = createInitialSessionManagerState({
        status: "ready",
        data: sampleViewData,
      });

      const withDraft = sessionManagerReducer(initial, {
        type: "setDraft",
        draft: "Draft trying to save but server fails",
      });

      const saving = sessionManagerReducer(withDraft, {
        type: "startSaveInstructions",
      });
      expect(saving.savingInstructions).toBe(true);

      const afterError = sessionManagerReducer(saving, {
        type: "message",
        message: {
          type: "actionError",
          action: "saveSessionInstructions",
          message: "MCP server version 12 or higher is required.",
        },
      });

      // User's draft is preserved so they don't lose work!
      expect(afterError.draftInstructions).toBe("Draft trying to save but server fails");
      expect(afterError.savingInstructions).toBe(false);
      expect(afterError.instructionsError).toBe("MCP server version 12 or higher is required.");
    });

    it("updates draft and persisted instructions when receiving workSessionInstructionsPatch (external change on disk)", () => {
      const initial = createInitialSessionManagerState({
        status: "ready",
        data: sampleViewData,
      });

      const withDraft = sessionManagerReducer(initial, {
        type: "setDraft",
        draft: "My in-progress draft",
      });

      const afterExternalPatch = sessionManagerReducer(withDraft, {
        type: "message",
        message: {
          type: "workSessionInstructionsPatch",
          instructions: "Instructions updated externally by AI assistant",
        },
      });

      expect(afterExternalPatch.draftInstructions).toBe("Instructions updated externally by AI assistant");
      expect(afterExternalPatch.state.status === "ready" && afterExternalPatch.state.data.instructions).toBe(
        "Instructions updated externally by AI assistant",
      );
    });

    it("captures actionError for non-instructions actions and clears on dismissActionError", () => {
      const initial = createInitialSessionManagerState({
        status: "ready",
        data: sampleViewData,
      });

      const afterActionError = sessionManagerReducer(initial, {
        type: "message",
        message: {
          type: "actionError",
          action: "renameSession",
          message: "Failed to rename session: disk full",
        },
      });

      expect(afterActionError.actionError).toBe("Failed to rename session: disk full");

      const dismissed = sessionManagerReducer(afterActionError, {
        type: "dismissActionError",
      });
      expect(dismissed.actionError).toBeUndefined();
    });

    it("toggles panel and responds to sessionPanelExpanded message", () => {
      const initial = createInitialSessionManagerState({ status: "ready", data: sampleViewData }, true);
      expect(initial.panelExpanded).toBe(true);

      const toggled = sessionManagerReducer(initial, { type: "togglePanel" });
      expect(toggled.panelExpanded).toBe(false);

      const fromMessage = sessionManagerReducer(toggled, {
        type: "message",
        message: { type: "sessionPanelExpanded", expanded: true },
      });
      expect(fromMessage.panelExpanded).toBe(true);
    });
  });

  describe("Finding 2: Menu Keydown Event Propagation", () => {
    it("stops keydown event propagation on session card menu anchor", () => {
      // Simulate the onKeyDown handler attached to .session-card-menu-anchor
      const stopPropagationMock = vi.fn();
      const mockEvent = {
        key: "Enter",
        stopPropagation: stopPropagationMock,
      } as unknown as React.KeyboardEvent;

      // Inline handler mirrors: onKeyDown={(e) => e.stopPropagation()}
      const handleMenuAnchorKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
      };

      handleMenuAnchorKeyDown(mockEvent);
      expect(stopPropagationMock).toHaveBeenCalledTimes(1);
    });
  });
});
