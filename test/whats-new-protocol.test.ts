import { describe, expect, it } from "vitest";
import {
  whatsNewExtensionToWebviewMessageSchema,
  whatsNewVersionSchema,
  whatsNewWebviewToExtensionMessageSchema,
} from "../src/shared/whats-new-protocol";

describe("whats-new-protocol", () => {
  it("validates version identity strings without trimming or normalizing", () => {
    expect(whatsNewVersionSchema.parse("1.2.0")).toBe("1.2.0");
    expect(whatsNewVersionSchema.parse("v1.2.0")).toBe("v1.2.0");
    expect(whatsNewVersionSchema.parse(" 1.2.0 ")).toBe(" 1.2.0 ");

    for (const invalid of ["", "   ", "\t\n", 120, null, undefined]) {
      expect(whatsNewVersionSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("parses valid host-to-webview navigation messages and rejects malformed or foreign payloads", () => {
    const parsed = whatsNewExtensionToWebviewMessageSchema.parse({
      type: "whatsNewOpenVersion",
      requestId: 3,
      version: "v1.2.0",
    });
    expect(parsed).toEqual({
      type: "whatsNewOpenVersion",
      requestId: 3,
      version: "v1.2.0",
    });

    const invalidPayloads: unknown[] = [
      null,
      {},
      { type: "whatsNewOpenVersion", requestId: 1 },
      { type: "whatsNewOpenVersion", version: "1.2.0" },
      { type: "whatsNewOpenVersion", requestId: 0, version: "1.2.0" },
      { type: "whatsNewOpenVersion", requestId: -1, version: "1.2.0" },
      { type: "whatsNewOpenVersion", requestId: 1.5, version: "1.2.0" },
      { type: "whatsNewOpenVersion", requestId: Number.NaN, version: "1.2.0" },
      { type: "whatsNewOpenVersion", requestId: Number.POSITIVE_INFINITY, version: "1.2.0" },
      { type: "whatsNewOpenVersion", requestId: "1", version: "1.2.0" },
      { type: "whatsNewOpenVersion", requestId: 1, version: "" },
      { type: "whatsNewOpenVersion", requestId: 1, version: "   " },
      { type: "whatsNewOpenVersion", requestId: 1, version: "1.2.0", extra: true },
      { type: "state", state: {} },
      { type: "workSessionState", state: { status: "error", message: "no" } },
      { type: "ready" },
      { type: "whatsNewReady" },
    ];

    for (const payload of invalidPayloads) {
      expect(whatsNewExtensionToWebviewMessageSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("parses valid webview-to-host messages and blocks review, session, generic ready, and extra fields", () => {
    expect(whatsNewWebviewToExtensionMessageSchema.parse({ type: "whatsNewReady" })).toEqual({
      type: "whatsNewReady",
    });

    expect(
      whatsNewWebviewToExtensionMessageSchema.parse({
        type: "whatsNewNavigationApplied",
        requestId: 2,
        version: " 1.2.0 ",
      }),
    ).toEqual({
      type: "whatsNewNavigationApplied",
      requestId: 2,
      version: " 1.2.0 ",
    });

    expect(
      whatsNewWebviewToExtensionMessageSchema.parse({
        type: "openExternal",
        url: "https://github.com/huynguyen294/ai-artifacts",
      }),
    ).toEqual({
      type: "openExternal",
      url: "https://github.com/huynguyen294/ai-artifacts",
    });

    const invalidMessages: unknown[] = [
      null,
      { type: "ready" },
      { type: "whatsNewReady", extra: 1 },
      { type: "whatsNewNavigationApplied", requestId: 0, version: "1.2.0" },
      { type: "whatsNewNavigationApplied", requestId: -2, version: "1.2.0" },
      { type: "whatsNewNavigationApplied", requestId: 1.25, version: "1.2.0" },
      { type: "whatsNewNavigationApplied", requestId: 1, version: "" },
      { type: "whatsNewNavigationApplied", requestId: 1, version: "   " },
      { type: "whatsNewNavigationApplied", requestId: 1, version: "1.2.0", extra: "bad" },
      { type: "openExternal", url: "not-a-valid-url" },
      { type: "openExternal", url: "https://example.com", extra: true },
      { type: "openLocalFile", url: "file:///tmp/README.md" },
      { type: "submitReview", decision: "approve" },
      { type: "addSessionArtifact" },
      { type: "openArtifact", artifactId: "artifact-1" },
    ];

    for (const msg of invalidMessages) {
      expect(whatsNewWebviewToExtensionMessageSchema.safeParse(msg).success).toBe(false);
    }
  });
});

