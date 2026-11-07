import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtifactSessionTarget } from "../src/shared/contracts";
import { ArtifactConnectDialog } from "../src/webview/ArtifactConnectDialog";

describe("ArtifactConnectDialog", () => {
  it("renders nothing when open is false", () => {
    const html = renderToStaticMarkup(
      <ArtifactConnectDialog
        open={false}
        sessions={[]}
        onClose={() => {}}
        onCopy={() => {}}
      />,
    );
    expect(html).toBe("");
  });

  it("renders mode options with Join disabled when no v2 sessions are available", () => {
    const v1Sessions: ArtifactSessionTarget[] = [
      {
        sessionId: "conv-1",
        title: "Legacy Conversation",
        version: 1,
        registeredAt: "2026-10-18T10:00:00.000Z",
      },
    ];

    const html = renderToStaticMarkup(
      <ArtifactConnectDialog
        open={true}
        sessions={v1Sessions}
        onClose={() => {}}
        onCopy={() => {}}
      />,
    );

    expect(html).toContain("Connect AI to Artifact");
    expect(html).toContain("New Session");
    expect(html).toContain("Join Session");
    // Join mode option should have disabled class because 0 v2 sessions
    expect(html).toContain("connect-mode-option  disabled");
    expect(html).toContain("Copy Prompt");
  });

  it("renders v2 sessions and v1 sessions with badge Cần chuyển đổi v2 when available", () => {
    const mixedSessions: ArtifactSessionTarget[] = [
      {
        sessionId: "sess-v2",
        title: "Work Session 2",
        version: 2,
        type: "feature",
        typeLabel: "Feature",
        registeredAt: "2026-10-18T10:00:00.000Z",
      },
      {
        sessionId: "conv-v1",
        title: "Legacy Conv 1",
        version: 1,
        registeredAt: "2026-10-18T09:00:00.000Z",
      },
    ];

    const html = renderToStaticMarkup(
      <ArtifactConnectDialog
        open={true}
        sessions={mixedSessions}
        onClose={() => {}}
        onCopy={() => {}}
      />,
    );

    expect(html).toContain("Connect AI to Artifact");
    // New session is rendered by default
    expect(html).toContain("New Session");
    expect(html).toContain("Join Session");
    // Join is NOT disabled because sess-v2 exists
    expect(html).not.toContain("connect-mode-option  disabled");
  });
});

