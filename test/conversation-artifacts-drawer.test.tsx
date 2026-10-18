import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConversationArtifactGroup, ConversationArtifactsViewState } from "../src/shared/contracts";
import {
  ConversationArtifactsDrawer,
  formatTimestamp,
  reconcileExpandedGroupIds,
} from "../src/webview/ConversationArtifactsDrawer";
import { trapFocusInContainer } from "../src/webview/focus-trap";

describe("ConversationArtifactsDrawer", () => {
  const currentArtifactId = "11111111-1111-4111-8111-111111111111";
  const siblingArtifactId = "22222222-2222-4222-8222-222222222222";
  const otherArtifactId = "33333333-3333-4333-8333-333333333333";

  const sampleGroups: ConversationArtifactGroup[] = [
    {
      artifactConversationId: "aaaaaaa1-1111-4111-8111-111111111111",
      conversationName: "Architecture Discussion",
      currentArtifactRegisteredAt: "2026-10-18T10:00:00.000Z",
      artifacts: [
        {
          artifactId: currentArtifactId,
          title: "System Architecture Proposal",
          kind: "plan",
          registeredAt: "2026-10-18T09:00:00.000Z",
          isCurrent: true,
        },
        {
          artifactId: siblingArtifactId,
          title: "Data Migration Spec",
          kind: "spec",
          registeredAt: "2026-10-18T10:00:00.000Z",
          isCurrent: false,
        },
      ],
    },
    {
      artifactConversationId: "bbbbbbb2-2222-4222-8222-222222222222",
      conversationName: "API Design Review",
      currentArtifactRegisteredAt: "2026-10-17T15:00:00.000Z",
      artifacts: [
        {
          artifactId: otherArtifactId,
          title: "GraphQL Schema Definition",
          kind: "code",
          registeredAt: "2026-10-17T15:00:00.000Z",
          isCurrent: false,
        },
      ],
    },
  ];

  it("renders nothing when open is false", () => {
    const html = renderToStaticMarkup(
      <ConversationArtifactsDrawer
        open={false}
        state={{ status: "loading" }}
        onClose={() => {}}
        onOpenArtifact={() => {}}
      />,
    );
    expect(html).toBe("");
  });

  it("renders loading state when open and status is loading", () => {
    const html = renderToStaticMarkup(
      <ConversationArtifactsDrawer
        open
        state={{ status: "loading" }}
        onClose={() => {}}
        onOpenArtifact={() => {}}
      />,
    );
    expect(html).toContain("Conversations");
    expect(html).toContain("Loading conversations…");
    expect(html).toContain("drawer-backdrop");
  });

  it("renders error alert when status is error", () => {
    const html = renderToStaticMarkup(
      <ConversationArtifactsDrawer
        open
        state={{ status: "error", message: "Failed to read conversation registry" }}
        onClose={() => {}}
        onOpenArtifact={() => {}}
      />,
    );
    expect(html).toContain("Conversations");
    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Failed to read conversation registry");
  });

  it("renders empty state message when groups is empty", () => {
    const state: ConversationArtifactsViewState = {
      status: "ready",
      groups: [],
      skippedCount: 0,
    };
    const html = renderToStaticMarkup(
      <ConversationArtifactsDrawer
        open
        state={state}
        onClose={() => {}}
        onOpenArtifact={() => {}}
      />,
    );
    expect(html).toContain("No conversations found for this artifact.");
  });

  it("renders conversation accordion groups with titles, counts, and auto-expands the first group", () => {
    const state: ConversationArtifactsViewState = {
      status: "ready",
      groups: sampleGroups,
      skippedCount: 0,
    };
    const html = renderToStaticMarkup(
      <ConversationArtifactsDrawer
        open
        state={state}
        onClose={() => {}}
        onOpenArtifact={() => {}}
      />,
    );

    // Both conversation group headers are rendered
    expect(html).toContain("Architecture Discussion");
    expect(html).toContain("API Design Review");

    // First group is auto-expanded by default
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("System Architecture Proposal");
    expect(html).toContain("Data Migration Spec");

    // Second group is collapsed by default in static render
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("GraphQL Schema Definition");
  });

  it("highlights current artifact with isCurrent, aria-current=page, and disabled button", () => {
    const state: ConversationArtifactsViewState = {
      status: "ready",
      groups: sampleGroups,
      skippedCount: 0,
    };
    const html = renderToStaticMarkup(
      <ConversationArtifactsDrawer
        open
        state={state}
        onClose={() => {}}
        onOpenArtifact={() => {}}
      />,
    );

    // Current artifact has isCurrent styling, badge, disabled state and aria-current="page"
    expect(html).toContain("aria-current=\"page\"");
    expect(html).toContain("Current</span>");
    expect(html).toContain("conversation-item-card current");

    // Non-current sibling is enabled and does NOT have aria-current
    expect(html).toContain("Data Migration Spec");
    expect(html).toContain("title=\"Open Data Migration Spec\"");
  });

  it("renders accessibility attributes for modal dialog and accordion regions", () => {
    const state: ConversationArtifactsViewState = {
      status: "ready",
      groups: sampleGroups,
      skippedCount: 0,
    };
    const html = renderToStaticMarkup(
      <ConversationArtifactsDrawer
        open
        state={state}
        onClose={() => {}}
        onOpenArtifact={() => {}}
      />,
    );

    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).toContain("aria-label=\"Conversation artifacts\"");
    expect(html).toContain("aria-controls=\"conversation-group-aaaaaaa1-1111-4111-8111-111111111111\"");
    expect(html).toContain("role=\"region\"");
  });

  it("formats timestamps safely", () => {
    const valid = formatTimestamp("2026-10-18T10:30:00.000Z");
    expect(valid).toBeTruthy();
    expect(typeof valid).toBe("string");

    const invalid = formatTimestamp("not-a-valid-date");
    expect(invalid).toBe("not-a-valid-date");
  });

  describe("reconcileExpandedGroupIds", () => {
    it("auto-expands the first group on initial load", () => {
      const result = reconcileExpandedGroupIds(new Set(), sampleGroups);
      expect(result).toEqual(new Set(["aaaaaaa1-1111-4111-8111-111111111111"]));
    });

    it("retains manually opened groups when groups remain the same", () => {
      const prev = new Set([
        "aaaaaaa1-1111-4111-8111-111111111111",
        "bbbbbbb2-2222-4222-8222-222222222222",
      ]);
      const result = reconcileExpandedGroupIds(prev, sampleGroups);
      expect(result).toEqual(prev);
    });

    it("purges stale IDs and auto-expands first group when groups are completely replaced", () => {
      const stalePrev = new Set(["old-group-that-no-longer-exists"]);
      const result = reconcileExpandedGroupIds(stalePrev, sampleGroups);
      expect(result).toEqual(new Set(["aaaaaaa1-1111-4111-8111-111111111111"]));
    });

    it("preserves remaining valid IDs when groups are partially modified", () => {
      const partialPrev = new Set([
        "old-group-gone",
        "bbbbbbb2-2222-4222-8222-222222222222",
      ]);
      const result = reconcileExpandedGroupIds(partialPrev, sampleGroups);
      expect(result).toEqual(new Set(["bbbbbbb2-2222-4222-8222-222222222222"]));
    });

    it("returns empty set when group list becomes empty", () => {
      const prev = new Set(["aaaaaaa1-1111-4111-8111-111111111111"]);
      const result = reconcileExpandedGroupIds(prev, []);
      expect(result).toEqual(new Set());
    });
  });

  describe("trapFocusInContainer", () => {
    it("does nothing on wide viewport (>= 1100px)", () => {
      const originalWindow = (globalThis as unknown as { window?: { innerWidth: number } }).window;
      try {
        (globalThis as unknown as { window: { innerWidth: number } }).window = { innerWidth: 1200 };
        let defaultPrevented = false;
        const event = {
          key: "Tab",
          shiftKey: false,
          preventDefault: () => { defaultPrevented = true; },
        } as unknown as KeyboardEvent;

        const container = {
          querySelectorAll: () => [],
        } as unknown as HTMLElement;

        trapFocusInContainer(container, event);
        expect(defaultPrevented).toBe(false);
      } finally {
        (globalThis as unknown as { window?: { innerWidth: number } }).window = originalWindow;
      }
    });

    it("ignores non-Tab key events", () => {
      const originalWindow = (globalThis as unknown as { window?: { innerWidth: number } }).window;
      try {
        (globalThis as unknown as { window: { innerWidth: number } }).window = { innerWidth: 800 };
        let defaultPrevented = false;
        const event = {
          key: "Escape",
          shiftKey: false,
          preventDefault: () => { defaultPrevented = true; },
        } as unknown as KeyboardEvent;

        const container = {
          querySelectorAll: () => [],
        } as unknown as HTMLElement;

        trapFocusInContainer(container, event);
        expect(defaultPrevented).toBe(false);
      } finally {
        (globalThis as unknown as { window?: { innerWidth: number } }).window = originalWindow;
      }
    });

    it("loops focus from last element to first element on Tab in narrow layout", () => {
      const originalWindow = (globalThis as unknown as { window?: { innerWidth: number } }).window;
      const originalDocument = (globalThis as unknown as { document?: { activeElement: unknown } }).document;
      try {
        (globalThis as unknown as { window: { innerWidth: number } }).window = { innerWidth: 800 };

        let firstFocused = false;
        let lastFocused = false;
        const firstElement = {
          focus: () => { firstFocused = true; },
          offsetParent: {},
          getClientRects: () => [{}],
        };
        const lastElement = {
          focus: () => { lastFocused = true; },
          offsetParent: {},
          getClientRects: () => [{}],
        };

        (globalThis as unknown as { document: { activeElement: unknown } }).document = {
          activeElement: lastElement,
        };

        let defaultPrevented = false;
        const event = {
          key: "Tab",
          shiftKey: false,
          preventDefault: () => { defaultPrevented = true; },
        } as unknown as KeyboardEvent;

        const container = {
          querySelectorAll: () => [firstElement, lastElement],
          contains: () => true,
        } as unknown as HTMLElement;

        trapFocusInContainer(container, event);
        expect(defaultPrevented).toBe(true);
        expect(firstFocused).toBe(true);
      } finally {
        (globalThis as unknown as { window?: { innerWidth: number } }).window = originalWindow;
        (globalThis as unknown as { document?: { activeElement: unknown } }).document = originalDocument;
      }
    });
  });
});
