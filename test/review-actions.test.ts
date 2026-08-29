import { describe, expect, it } from "vitest";
import { deriveReviewActions } from "../src/webview/review-actions";

describe("deriveReviewActions", () => {
  it("makes Proceed primary when there are no comments", () => {
    const actions = deriveReviewActions({
      commentCount: 0,
      isSubmitting: false,
      isSubmitted: false,
      hasUnsavedComment: false,
    });
    expect(actions.approve.primary).toBe(true);
    expect(actions.revise).toMatchObject({ disabled: true, primary: false, label: "Review (0)" });
  });

  it("makes Review primary when active while keeping Proceed primary", () => {
    const actions = deriveReviewActions({
      commentCount: 3,
      isSubmitting: false,
      isSubmitted: false,
      hasUnsavedComment: false,
    });
    expect(actions.revise).toMatchObject({ disabled: false, primary: true, label: "Review (3)" });
    expect(actions.approve.primary).toBe(true);
  });

  it("labels only the submitted decision as sending", () => {
    const actions = deriveReviewActions({
      commentCount: 1,
      isSubmitting: true,
      isSubmitted: false,
      hasUnsavedComment: false,
      submittingDecision: "revise",
    });
    expect(actions.revise.label).toBe("Sending…");
    expect(actions.approve.label).toBe("Proceed");
    expect(Object.values(actions).every((action) => action.disabled)).toBe(true);
  });
});
