import { describe, expect, it } from "vitest";
import { resolveContentImage } from "../src/webview/content-media";

describe("resolveContentImage", () => {
  const baseUri = "https://file+.vscode-resource.vscode-cdn.net/d%3A/ext/media/whats-new";

  it("resolves valid media/ references against base URIs with or without trailing slash", () => {
    expect(resolveContentImage("media/samples/ai-artifacts.png", baseUri)).toBe(
      "https://file+.vscode-resource.vscode-cdn.net/d%3A/ext/media/whats-new/samples/ai-artifacts.png",
    );
    expect(resolveContentImage("media/samples/inline-feedback.gif", `${baseUri}/`)).toBe(
      "https://file+.vscode-resource.vscode-cdn.net/d%3A/ext/media/whats-new/samples/inline-feedback.gif",
    );
    expect(resolveContentImage("media/tips/Shot_01.jpg", "vscode-resource:///mock/ext/media/whats-new")).toBe(
      "vscode-resource:///mock/ext/media/whats-new/tips/Shot_01.jpg",
    );
    expect(resolveContentImage("media/1.2.0/Demo_Shot.PNG", baseUri)).toBe(
      "https://file+.vscode-resource.vscode-cdn.net/d%3A/ext/media/whats-new/1.2.0/Demo_Shot.PNG",
    );
    expect(resolveContentImage("media/photo.jpeg", baseUri)).toBe(
      "https://file+.vscode-resource.vscode-cdn.net/d%3A/ext/media/whats-new/photo.jpeg",
    );
    expect(resolveContentImage("media/pic.webp", baseUri)).toBe(
      "https://file+.vscode-resource.vscode-cdn.net/d%3A/ext/media/whats-new/pic.webp",
    );
  });

  it("rejects missing or invalid base URIs", () => {
    expect(resolveContentImage("media/samples/ai-artifacts.png", "")).toBeUndefined();
    expect(resolveContentImage("media/samples/ai-artifacts.png", "   ")).toBeUndefined();
    expect(resolveContentImage("media/samples/ai-artifacts.png", "/media/whats-new")).toBeUndefined();
    expect(resolveContentImage("media/samples/ai-artifacts.png", "file:///d:/ext/media/whats-new")).toBeUndefined();
    expect(resolveContentImage("media/samples/ai-artifacts.png", "javascript:alert(1)")).toBeUndefined();
    expect(resolveContentImage("media/samples/ai-artifacts.png", "data:text/plain;base64,SGVsbG8=")).toBeUndefined();
  });

  it("rejects traversal, encoded characters, remote URLs, and unsupported extensions", () => {
    const rejected = [
      "samples/ai-artifacts.png",
      "Media/samples/ai-artifacts.png",
      "/media/samples/ai-artifacts.png",
      "media/",
      "media/samples/",
      "media//ai-artifacts.png",
      "media/./ai-artifacts.png",
      "media/../icon.png",
      "media/samples/../../icon.png",
      "media/%2e%2e/icon.png",
      "media/samples\\ai-artifacts.png",
      "media/c:ai-artifacts.png",
      "media/samples/ai-artifacts.png?v=1",
      "media/samples/ai-artifacts.png#hash",
      "media/my image.png",
      "https://example.com/a.png",
      "http://example.com/a.png",
      "//cdn.example.com/a.png",
      "file:///etc/passwd.png",
      "command:vscode.open",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "media/demo.mp4",
      "media/icon.svg",
      "media/readme.md",
      "media/.png",
      "media/noext",
    ];

    for (const ref of rejected) {
      expect(resolveContentImage(ref, baseUri)).toBeUndefined();
    }
  });
});

