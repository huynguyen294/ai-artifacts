import { describe, expect, it } from "vitest";
import { safeArtifactUrl } from "../src/webview/url-policy";

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
