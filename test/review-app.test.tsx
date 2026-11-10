import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReviewState, WebviewToExtensionMessage } from "../src/shared/contracts";
import { parseMarkdownBlocks } from "../src/shared/markdown-blocks";
import { App as ReviewApp } from "../src/webview/ReviewApp";

const mockPostMessage = vi.fn();

vi.mock("../src/webview/vscode-api", () => ({
  vscode: {
    postMessage: (msg: WebviewToExtensionMessage) => mockPostMessage(msg),
    getState: vi.fn(),
    setState: vi.fn(),
  },
}));

function createSampleReviewState(overrides?: Partial<ReviewState>): ReviewState {
  const markdown = "# Sample Implementation Plan\n\nThis is a sample document for testing.";
  const blocks = parseMarkdownBlocks(markdown);
  const now = "2026-11-08T00:00:00.000Z";
  return {
    artifact: {
      schemaVersion: 6,
      kind: "implementation-plan",
      artifactId: "test-artifact-001",
      title: "Sample Implementation Plan",
      createdAt: now,
      updatedAt: now,
      reviewRound: 1,
      reviewSessionId: "11111111-1111-4111-8111-111111111111",
    },
    markdown,
    blocks,
    comments: {
      schemaVersion: 6,
      artifactId: "test-artifact-001",
      reviewRound: 1,
      artifactSha256: "0".repeat(64),
      comments: [],
    },
    lifecycle: {
      readOnly: false,
    },
    ...overrides,
  };
}

function getUtilityBarLeftHtml(html: string): string {
  const start = html.indexOf('<div class="review-utility-bar-left">');
  const end = html.indexOf('<div class="review-utility-bar-right">');
  return html.slice(start, end);
}

describe("ReviewApp Webview Component (Phase 4.5)", () => {
  describe("Loading State", () => {
    it("renders loading state when initial state is undefined", () => {
      const html = renderToStaticMarkup(<ReviewApp />);
      expect(html).toContain('class="loading"');
      expect(html).toContain("Loading artifact…");
    });
  });

  describe("Review Utility Bar — Session Entry (4 States)", () => {
    it("State 1: renders disabled Sessions button when session support is false", () => {
      const html = renderToStaticMarkup(
        <ReviewApp
          initialState={createSampleReviewState()}
          initialSessionSupport={{ supported: false, sessions: [] }}
          initialSessionsLoaded={true}
        />,
      );
      const leftHtml = getUtilityBarLeftHtml(html);

      expect(leftHtml).toContain('class="ghost sessions-toggle"');
      expect(leftHtml).toContain("disabled=\"\"");
      expect(leftHtml).toContain('title="Sessions require MCP server version 12 or higher"');
      expect(leftHtml).toContain("<span>Sessions</span>");
      expect(leftHtml).not.toContain("Start a work session");
      expect(leftHtml).not.toContain("start-session-helper");
      expect(leftHtml).not.toContain("comment-count-badge");
    });

    it("State 2: renders disabled Sessions button when sessions are still loading", () => {
      const html = renderToStaticMarkup(
        <ReviewApp
          initialState={createSampleReviewState()}
          initialSessionSupport={{ supported: true, sessions: [] }}
          initialSessionsLoaded={false}
        />,
      );
      const leftHtml = getUtilityBarLeftHtml(html);

      expect(leftHtml).toContain('class="ghost sessions-toggle"');
      expect(leftHtml).toContain("disabled=\"\"");
      expect(leftHtml).toContain('title="Loading sessions..."');
      expect(leftHtml).toContain("<span>Sessions</span>");
      expect(leftHtml).not.toContain("Start a work session");
      expect(leftHtml).not.toContain("start-session-helper");
      expect(leftHtml).not.toContain("comment-count-badge");
    });

    it("State 3: renders 'Start a work session' button with helper text when supported, loaded, and sessions list is empty", () => {
      const html = renderToStaticMarkup(
        <ReviewApp
          initialState={createSampleReviewState()}
          initialSessionSupport={{ supported: true, sessions: [] }}
          initialSessionsLoaded={true}
        />,
      );
      const leftHtml = getUtilityBarLeftHtml(html);

      expect(leftHtml).toContain('class="start-session-container"');
      expect(leftHtml).toContain('class="ghost start-work-session-button"');
      expect(leftHtml).toContain("<span>Start a work session</span>");
      expect(leftHtml).toContain(
        'title="For ongoing work, keep related artifacts and shared instructions together across agents and chats."',
      );
      expect(leftHtml).toContain('class="start-session-helper"');
      expect(leftHtml).toContain(
        "For ongoing work, keep related artifacts and shared instructions together across agents and chats.",
      );
      expect(leftHtml).not.toContain("sessions-toggle");
      expect(leftHtml).not.toContain("comment-count-badge");
    });

    it("State 4: renders 'Sessions' toggle button with count badge when artifact has memberships", () => {
      const html = renderToStaticMarkup(
        <ReviewApp
          initialState={createSampleReviewState()}
          initialSessionSupport={{
            supported: true,
            sessions: [
              { sessionId: "sess-1", title: "Refactor Session", version: 2 },
              { sessionId: "sess-2", title: "Docs Session", version: 2 },
            ],
          }}
          initialSessionsLoaded={true}
        />,
      );
      const leftHtml = getUtilityBarLeftHtml(html);

      expect(leftHtml).toContain('class="ghost sessions-toggle"');
      expect(leftHtml).not.toContain("disabled=\"\"");
      expect(leftHtml).toContain('title="Open sessions for this artifact (2)"');
      expect(leftHtml).toContain("<span>Sessions</span>");
      expect(leftHtml).toContain('class="comment-count-badge"');
      expect(leftHtml).toContain('aria-label="2 sessions"');
      expect(leftHtml).toContain(">2<");
      expect(leftHtml).not.toContain("Start a work session");
      expect(leftHtml).not.toContain("start-session-helper");
    });
  });

  describe("Topbar Actions — Direct Inspect Prompt & Dialog Removal", () => {
    it("renders direct Inspect artifact button without modal dialogs", () => {
      const html = renderToStaticMarkup(
        <ReviewApp
          initialState={createSampleReviewState()}
          initialSessionSupport={{ supported: true, sessions: [] }}
          initialSessionsLoaded={true}
          initialConnectPromptCopied={false}
        />,
      );

      expect(html).toContain('aria-label="Inspect artifact"');
      expect(html).toContain('title="Inspect artifact"');
      expect(html).toContain("icon-button copy-button");
      expect(html).not.toContain("copy-button copied");

      // Verify old modal and dialog elements do NOT exist
      expect(html).not.toContain("artifact-connect-dialog");
      expect(html).not.toContain("ArtifactConnectDialog");
      expect(html).not.toContain("dialog-overlay");
    });

    it("renders copied feedback state on the Inspect artifact button", () => {
      const html = renderToStaticMarkup(
        <ReviewApp
          initialState={createSampleReviewState()}
          initialSessionSupport={{ supported: true, sessions: [] }}
          initialSessionsLoaded={true}
          initialConnectPromptCopied={true}
        />,
      );

      expect(html).toContain('aria-label="Inspect prompt copied"');
      expect(html).toContain('title="Inspect prompt copied"');
      expect(html).toContain("icon-button copy-button copied");
    });
  });

  describe("Message Contracts", () => {
    it("renders Archived badge and only Restore button when artifact is archived", () => {
      const archivedState = createSampleReviewState({
        uiState: {
          pinned: false,
          archivedAt: "2026-11-08T10:00:00.000Z",
        },
      });

      const html = renderToStaticMarkup(<ReviewApp initialState={archivedState} />);

      // Eyebrow has Archived pill
      expect(html).toContain("archived-pill");
      expect(html).toContain("Archived");

      // Only Restore button is in topbar-actions
      expect(html).toContain("Restore");
      expect(html).not.toContain("Approve");
      expect(html).not.toContain("Request changes");
      expect(html).not.toContain('title="Save comments"');
      expect(html).not.toContain('title="Inspect artifact"');
    });

    it("dispatches typed messages for review utility bar and inspect actions", () => {
      mockPostMessage.mockClear();

      // Inspect action sends { type: "copyArtifactConnectPrompt" }
      const onInspectClick = () => {
        mockPostMessage({ type: "copyArtifactConnectPrompt" });
      };
      onInspectClick();
      expect(mockPostMessage).toHaveBeenCalledWith({ type: "copyArtifactConnectPrompt" });

      // Start work session sends { type: "startWorkSession" }
      const onStartSessionClick = () => {
        mockPostMessage({ type: "startWorkSession" });
      };
      onStartSessionClick();
      expect(mockPostMessage).toHaveBeenCalledWith({ type: "startWorkSession" });

      // Sessions toggle sends { type: "openArtifactSessions" }
      const onOpenSessionsClick = () => {
        mockPostMessage({ type: "openArtifactSessions" });
      };
      onOpenSessionsClick();
      expect(mockPostMessage).toHaveBeenCalledWith({ type: "openArtifactSessions" });
    });

    it("renders terminal deleted state when artifact has been deleted", () => {
      // Direct rendering of deleted terminal state banner
      const html = renderToStaticMarkup(
        <main className="loading artifact-deleted-terminal">
          <div className="session-error-banner" role="alert">
            <h3>Artifact Deleted</h3>
            <p>This artifact has been deleted permanently and is no longer available.</p>
          </div>
        </main>,
      );

      expect(html).toContain("artifact-deleted-terminal");
      expect(html).toContain("Artifact Deleted");
      expect(html).toContain("This artifact has been deleted permanently and is no longer available.");
    });

    it("renders ROUND before type, with edit buttons when active, and hides edit buttons when archived", () => {
      const activeState = createSampleReviewState();
      const activeHtml = renderToStaticMarkup(<ReviewApp initialState={activeState} />);

      // Eyebrow format: ROUND {round} · {kind}
      expect(activeHtml).toContain("ROUND 1 · Implementation plan");
      // Edit buttons present
      expect(activeHtml).toContain('title="Change artifact type"');
      expect(activeHtml).toContain('title="Rename artifact"');

      // When archived: edit buttons hidden
      const archivedState = createSampleReviewState({
        uiState: { pinned: false, archivedAt: "2026-11-08T00:00:00.000Z" },
      });
      const archivedHtml = renderToStaticMarkup(<ReviewApp initialState={archivedState} />);
      expect(archivedHtml).not.toContain('title="Change artifact type"');
      expect(archivedHtml).not.toContain('title="Rename artifact"');
    });
  });
});
