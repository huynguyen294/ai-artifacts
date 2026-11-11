import { describe, expect, it } from "vitest";
import { safeArtifactUrl, safeReviewUrl } from "../src/webview/url-policy";

describe("safeArtifactUrl", () => {
  it("allows review-safe links", () => {
    expect(safeArtifactUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(safeArtifactUrl("mailto:review@example.com")).toBe("mailto:review@example.com");
    expect(safeArtifactUrl("#details")).toBe("#details");
  });

  it("rejects executable, local and malformed links", () => {
    expect(safeArtifactUrl("javascript:alert(1)")).toBe("");
    expect(safeArtifactUrl("file:///secret.txt")).toBe("");
    expect(safeArtifactUrl("not a url")).toBe("");
  });
});

describe("safeReviewUrl", () => {
  it.each([
    "file:///D:/workspace/plan.md",
    "D:/workspace/plan.md",
    "D:\\workspace\\plan.md",
    "D:%5Cworkspace%5Cplan.md",
    "/workspace/plan%20notes.md",
  ])("allows an absolute local file link only in review mode: %s", (url) => {
    expect(safeReviewUrl(url)).toBe(url);
    expect(safeArtifactUrl(url)).toBe("");
  });

  it("preserves external links and rejects commands and ambiguous relative paths", () => {
    expect(safeReviewUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(safeReviewUrl("mailto:review@example.com")).toBe("mailto:review@example.com");
    expect(safeReviewUrl("#details")).toBe("#details");
    for (const url of ["javascript:alert(1)", "command:workbench.action.closeWindow", "./plan.md", "file://remote/share/plan.md"]) {
      expect(safeReviewUrl(url)).toBe("");
    }
  });
});
