import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_ROOT_BLOCK_ID,
  ARTIFACT_ROOT_BLOCK_TYPE,
  ARTIFACT_ROOT_TEXT,
  type ReviewComment,
} from "../src/shared/contracts";
import { CommentsDrawer } from "../src/webview/CommentsDrawer";

describe("CommentsDrawer", () => {
  it("renders artifact-wide feedback in the shared comments list", () => {
    const comment: ReviewComment = {
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-10-16T00:00:00.000Z",
      block: {
        id: ARTIFACT_ROOT_BLOCK_ID,
        type: ARTIFACT_ROOT_BLOCK_TYPE,
        heading: null,
      },
      selection: {
        quote: ARTIFACT_ROOT_TEXT,
        start: 0,
        end: ARTIFACT_ROOT_TEXT.length,
        prefix: "",
        suffix: "",
      },
      body: "Use the inline comments as the implementation direction.",
    };

    const html = renderToStaticMarkup(
      <CommentsDrawer
        open
        comments={[comment]}
        submitted={false}
        onClose={() => {}}
        onJump={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(html).toContain("Comments (1)");
    expect(html).toContain("General feedback");
    expect(html).toContain(ARTIFACT_ROOT_TEXT);
    expect(html).toContain("Use the inline comments as the implementation direction.");
  });
});
