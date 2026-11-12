import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MessageListener = (message: unknown) => unknown;
type DisposeListener = () => unknown;
type ViewStateListener = (event: { webviewPanel: MockWebviewPanel }) => unknown;

interface MockWebviewPanel {
  viewType: string;
  title: string;
  viewColumn: number;
  visible: boolean;
  options: unknown;
  webview: {
    options: unknown;
    html: string;
    cspSource: string;
    asWebviewUri: (uri: { fsPath: string }) => { toString: () => string };
    postMessage: ReturnType<typeof vi.fn<(message: unknown) => unknown>>;
    onDidReceiveMessage: (listener: MessageListener) => { dispose: () => void };
  };
  reveal: ReturnType<typeof vi.fn<(column?: number) => void>>;
  onDidChangeViewState: (listener: ViewStateListener) => { dispose: () => void };
  onDidDispose: (listener: DisposeListener) => { dispose: () => void };
  dispose: ReturnType<typeof vi.fn<() => void>>;
  _emitMessage: (message: unknown) => Promise<void>;
  _emitViewState: (visible: boolean) => void;
  _emitDispose: () => void;
  _getMessageListeners: () => MessageListener[];
  _getViewStateListeners: () => ViewStateListener[];
  _getDisposeListeners: () => DisposeListener[];
  _getMessageListenerCount: () => number;
  _getViewStateListenerCount: () => number;
  _getDisposeListenerCount: () => number;
}

const {
  createdPanels,
  mockCreateWebviewPanel,
  mockOpenExternal,
  mockShowErrorMessage,
  mockActiveTextEditor,
  nextPanelVisible,
  mockGetWebviewHtml,
} = vi.hoisted(() => {
  const panels: MockWebviewPanel[] = [];
  const activeEditorState: { current: { viewColumn?: number } | undefined } = {
    current: undefined,
  };
  const visibleState = { current: true };

  const createPanel = vi.fn(
    (
      viewType: string,
      title: string,
      showOptions: number,
      options: unknown,
    ): MockWebviewPanel => {
      let messageListeners: MessageListener[] = [];
      let viewStateListeners: ViewStateListener[] = [];
      let disposeListeners: DisposeListener[] = [];
      let disposed = false;

      const panel: MockWebviewPanel = {
        viewType,
        title,
        viewColumn: showOptions,
        visible: visibleState.current,
        options,
        webview: {
          options,
          html: "",
          cspSource: "vscode-webview://test",
          asWebviewUri: (uri) => ({
            toString: () => `vscode-resource://${uri.fsPath.replace(/\\/g, "/")}`,
          }),
          postMessage: vi.fn(async () => true),
          onDidReceiveMessage: (listener) => {
            messageListeners.push(listener);
            return {
              dispose: () => {
                messageListeners = messageListeners.filter((item) => item !== listener);
              },
            };
          },
        },
        reveal: vi.fn((column?: number) => {
          if (column !== undefined) {
            panel.viewColumn = column;
          }
        }),
        onDidChangeViewState: (listener) => {
          viewStateListeners.push(listener);
          return {
            dispose: () => {
              viewStateListeners = viewStateListeners.filter((item) => item !== listener);
            },
          };
        },
        onDidDispose: (listener) => {
          disposeListeners.push(listener);
          return {
            dispose: () => {
              disposeListeners = disposeListeners.filter((item) => item !== listener);
            },
          };
        },
        dispose: vi.fn(() => {
          if (disposed) return;
          disposed = true;
          for (const listener of [...disposeListeners]) {
            listener();
          }
        }),
        _emitMessage: async (message) => {
          for (const listener of [...messageListeners]) {
            await listener(message);
          }
        },
        _emitViewState: (visible) => {
          panel.visible = visible;
          for (const listener of [...viewStateListeners]) {
            listener({ webviewPanel: panel });
          }
        },
        _emitDispose: () => {
          panel.dispose();
        },
        _getMessageListeners: () => [...messageListeners],
        _getViewStateListeners: () => [...viewStateListeners],
        _getDisposeListeners: () => [...disposeListeners],
        _getMessageListenerCount: () => messageListeners.length,
        _getViewStateListenerCount: () => viewStateListeners.length,
        _getDisposeListenerCount: () => disposeListeners.length,
      };

      panels.push(panel);
      return panel;
    },
  );

  return {
    createdPanels: panels,
    mockCreateWebviewPanel: createPanel,
    mockOpenExternal: vi.fn(async () => true),
    mockShowErrorMessage: vi.fn(async () => undefined),
    mockActiveTextEditor: activeEditorState,
    nextPanelVisible: visibleState,
    mockGetWebviewHtml: vi.fn(),
  };
});

vi.mock("../src/extension/webview-html", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/extension/webview-html")>();
  mockGetWebviewHtml.mockImplementation(original.getWebviewHtml);
  return {
    ...original,
    getWebviewHtml: mockGetWebviewHtml,
  };
});

vi.mock("vscode", () => ({
  ViewColumn: { One: 1, Two: 2, Three: 3 },
  Uri: {
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
    parse: (url: string) => {
      const parsed = new URL(url);
      return {
        scheme: parsed.protocol.replace(":", ""),
        toString: () => url,
      };
    },
  },
  env: {
    openExternal: mockOpenExternal,
  },
  window: {
    get activeTextEditor() {
      return mockActiveTextEditor.current;
    },
    createWebviewPanel: mockCreateWebviewPanel,
    showErrorMessage: mockShowErrorMessage,
  },
}));

import { WhatsNewPanelController } from "../src/extension/whats-new-panel";
import { getWebviewHtml } from "../src/extension/webview-html";

describe("WhatsNewPanelController & webview HTML", () => {
  const extensionUri = { fsPath: "/mock/extension" } as any;

  beforeEach(() => {
    createdPanels.length = 0;
    mockActiveTextEditor.current = undefined;
    nextPanelVisible.current = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders getWebviewHtml for whats-new with media CSP and escaped media base URI while keeping review and session strict", () => {
    const whatsNewHtml = getWebviewHtml({
      appName: "whats-new",
      extensionUri,
      webview: {
        cspSource: "vscode-webview://unit",
        asWebviewUri: (uri: { fsPath: string }) => ({
          toString: () => `vscode-resource://${uri.fsPath.replace(/\\/g, "/")}?a=1&b="quoted"<tag>'s`,
        }),
      } as any,
    });

    expect(whatsNewHtml).toContain('data-app="whats-new"');
    expect(whatsNewHtml).toContain("review.js");
    expect(whatsNewHtml).toContain("review.css");
    expect(whatsNewHtml).toContain("default-src 'none'; img-src data: vscode-webview://unit;");
    expect(whatsNewHtml).not.toContain("media-src");
    expect(whatsNewHtml).not.toContain("frame-src");
    expect(whatsNewHtml).toContain(
      'data-content-media-base-uri="vscode-resource:///mock/extension/media/whats-new?a=1&amp;b=&quot;quoted&quot;&lt;tag&gt;&#39;s"',
    );

    for (const appName of ["review", "session"] as const) {
      const otherHtml = getWebviewHtml({
        appName,
        extensionUri,
        webview: {
          cspSource: "vscode-webview://unit",
          asWebviewUri: (uri: { fsPath: string }) => ({
            toString: () => `vscode-resource://${uri.fsPath.replace(/\\/g, "/")}`,
          }),
        } as any,
      });

      expect(otherHtml).toContain(`data-app="${appName}"`);
      expect(otherHtml).toContain("default-src 'none'; img-src data:; style-src");
      expect(otherHtml).not.toContain("data-content-media-base-uri");
    }
  });

  it("does not create a Webview in constructor, creates and reuses one panel on show, recreates after close, and disposes cleanly", () => {
    const controller = new WhatsNewPanelController(extensionUri);
    expect(mockCreateWebviewPanel).not.toHaveBeenCalled();

    // First show creates panel in ViewColumn.One when no active editor
    controller.show();
    expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1);
    const firstPanel = createdPanels[0]!;
    expect(firstPanel.viewType).toBe("agentPlus.whatsNew");
    expect(firstPanel.title).toBe("What's New & Tips");
    expect(firstPanel.viewColumn).toBe(1);
    expect(firstPanel.options).toEqual({
      enableScripts: true,
      localResourceRoots: [
        { fsPath: path.join("/mock/extension", "dist", "webview") },
        { fsPath: path.join("/mock/extension", "media", "whats-new") },
      ],
    });
    expect(firstPanel.webview.html).toContain('data-app="whats-new"');
    expect(firstPanel.webview.html).toContain(
      'data-content-media-base-uri="vscode-resource:///mock/extension/media/whats-new"',
    );
    const initialHtml = firstPanel.webview.html;

    // Second show reveals existing panel without recreating or reassigning HTML
    firstPanel.viewColumn = 2;
    controller.show();
    expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1);
    expect(firstPanel.reveal).toHaveBeenCalledTimes(1);
    expect(firstPanel.reveal).toHaveBeenCalledWith(2);
    expect(firstPanel.webview.html).toBe(initialHtml);

    // Closing panel clears reference & listeners; next show creates a new panel using activeTextEditor.viewColumn
    firstPanel._emitDispose();
    expect(firstPanel._getMessageListenerCount()).toBe(0);
    expect(firstPanel._getDisposeListenerCount()).toBe(0);

    mockActiveTextEditor.current = { viewColumn: 3 };
    controller.show();
    expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(2);
    const secondPanel = createdPanels[1]!;
    expect(secondPanel.viewColumn).toBe(3);

    // Controller dispose closes open panel and cleans up listeners
    controller.dispose();
    expect(secondPanel.dispose).toHaveBeenCalledTimes(1);
    expect(secondPanel._getMessageListenerCount()).toBe(0);
    expect(secondPanel._getDisposeListenerCount()).toBe(0);

    // Extra dispose call is safe
    controller.dispose();
  });

  it("handles valid external links, rejects disallowed protocols, ignores review/malformed messages, and handles openExternal errors", async () => {
    const controller = new WhatsNewPanelController(extensionUri);
    controller.show();
    const panel = createdPanels[0]!;

    // 1. Valid https link opens externally
    await panel._emitMessage({ type: "openExternal", url: "https://github.com/huynguyen294/ai-artifacts" });
    expect(mockOpenExternal).toHaveBeenCalledTimes(1);
    expect(mockOpenExternal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scheme: "https",
        toString: expect.any(Function),
      }),
    );
    expect(mockShowErrorMessage).not.toHaveBeenCalled();

    // 2. Disallowed protocols do not open externally and report concise error
    mockOpenExternal.mockClear();
    mockShowErrorMessage.mockClear();
    for (const disallowedUrl of [
      "file:///etc/passwd",
      "command:workbench.action.reloadWindow",
      "javascript:alert(1)",
    ]) {
      await panel._emitMessage({ type: "openExternal", url: disallowedUrl });
    }
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(mockShowErrorMessage).toHaveBeenCalledTimes(3);

    // 3. Review, session, local file, and malformed messages are ignored without actions or error popups
    mockOpenExternal.mockClear();
    mockShowErrorMessage.mockClear();
    await panel._emitMessage({ type: "ready" });
    await panel._emitMessage({ type: "openLocalFile", url: "file:///tmp/notes.md" });
    await panel._emitMessage({ type: "openExternal", url: "https://example.com", extra: true });
    await panel._emitMessage({ type: "submitReview", decision: "approve" });
    await panel._emitMessage({ type: "addSessionArtifact" });
    await panel._emitMessage({ type: "removeComment", commentId: "11111111-1111-4111-8111-111111111111" });
    await panel._emitMessage({ type: "unknown", payload: 123 });
    await panel._emitMessage(null);
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(mockShowErrorMessage).not.toHaveBeenCalled();

    // 4. openExternal rejection or false result is handled gracefully
    mockOpenExternal.mockRejectedValueOnce(new Error("Browser launch failed"));
    await panel._emitMessage({ type: "openExternal", url: "https://example.com" });
    expect(mockShowErrorMessage).toHaveBeenCalledWith("Failed to open link: Browser launch failed");

    mockShowErrorMessage.mockClear();
    mockOpenExternal.mockResolvedValueOnce(false);
    await panel._emitMessage({ type: "openExternal", url: "https://example.com" });
    expect(mockShowErrorMessage).toHaveBeenCalledWith("Failed to open link: Unable to open the external link.");

    controller.dispose();
  });

  it("ignores invalid versions in showVersion, never emits navigation from plain show(), and waits for whatsNewReady before posting", async () => {
    const controller = new WhatsNewPanelController(extensionUri);

    // Invalid version inputs never open panel or mutate state
    controller.showVersion("");
    controller.showVersion("   \t\n");
    controller.showVersion(123 as unknown as string);
    expect(mockCreateWebviewPanel).not.toHaveBeenCalled();

    // Plain show() does not enqueue or emit any open-version navigation even after ready/visible
    controller.show();
    const panel = createdPanels[0]!;
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
    await panel._emitMessage({ type: "whatsNewReady" });
    panel._emitViewState(true);
    expect(panel.webview.postMessage).not.toHaveBeenCalled();

    controller.dispose();

    // showVersion before ready holds pending target until whatsNewReady arrives
    let resolveDeferred!: (value: boolean) => void;
    const deferredDelivery = new Promise<boolean>((resolve) => {
      resolveDeferred = resolve;
    });

    controller.showVersion("1.2.0");
    expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(2);
    const secondPanel = createdPanels[1]!;
    secondPanel.webview.postMessage.mockReturnValueOnce(deferredDelivery);

    // Invalid subsequent calls must not overwrite pending "1.2.0" or call reveal
    controller.showVersion("");
    controller.showVersion("   ");
    expect(secondPanel.reveal).not.toHaveBeenCalled();

    // Not ready yet -> nothing posted
    expect(secondPanel.webview.postMessage).not.toHaveBeenCalled();

    // whatsNewReady flushes lightweight navigation payload with requestId: 1
    await secondPanel._emitMessage({ type: "whatsNewReady" });
    expect(secondPanel.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(secondPanel.webview.postMessage).toHaveBeenCalledWith({
      type: "whatsNewOpenVersion",
      requestId: 1,
      version: "1.2.0",
    });

    // While deferred postMessage hasn't resolved or ACKed, a viewState reveal retries cleanly
    secondPanel._emitViewState(true);
    expect(secondPanel.webview.postMessage).toHaveBeenCalledTimes(2);

    resolveDeferred(true);
    await deferredDelivery;

    // Even after postMessage resolves to true, pending remains until matching ACK arrives
    secondPanel._emitViewState(true);
    expect(secondPanel.webview.postMessage).toHaveBeenCalledTimes(3);

    // Generic Review { type: "ready" } neither enables ready flush nor clears pending
    await secondPanel._emitMessage({ type: "ready" });
    expect(secondPanel.webview.postMessage).toHaveBeenCalledTimes(3);

    // Exact matching ACK clears pending; subsequent ready/visible/show do not resend
    await secondPanel._emitMessage({
      type: "whatsNewNavigationApplied",
      requestId: 1,
      version: "1.2.0",
    });
    await secondPanel._emitMessage({ type: "whatsNewReady" });
    secondPanel._emitViewState(true);
    controller.show();
    expect(secondPanel.webview.postMessage).toHaveBeenCalledTimes(3);

    controller.dispose();
  });

  it("navigates an already-ready visible panel via exact version string without reassigning HTML", async () => {
    const controller = new WhatsNewPanelController(extensionUri);
    controller.show();
    const panel = createdPanels[0]!;
    const initialHtml = panel.webview.html;
    await panel._emitMessage({ type: "whatsNewReady" });

    // Even an unmapped/exact non-normalized string like "v2.0.0" is forwarded verbatim
    controller.showVersion("v2.0.0");
    expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(panel.viewColumn);
    expect(panel.webview.html).toBe(initialHtml);
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith({
      type: "whatsNewOpenVersion",
      requestId: 1,
      version: "v2.0.0",
    });

    // Synchronous onDidChangeViewState during panel.reveal must not duplicate postMessage in the same turn
    panel.visible = false;
    panel.reveal.mockImplementationOnce(() => {
      panel._emitViewState(true);
    });
    controller.showVersion("9.9.9");
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith({
      type: "whatsNewOpenVersion",
      requestId: 2,
      version: "9.9.9",
    });

    controller.dispose();
  });

  it("retains pending request across false, sync throw, and rejected Thenable deliveries without showing error popups", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new WhatsNewPanelController(extensionUri);

    controller.showVersion("1.2.0");
    const panel = createdPanels[0]!;

    // 1. postMessage returns false
    panel.webview.postMessage.mockResolvedValueOnce(false);
    await panel._emitMessage({ type: "whatsNewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(mockShowErrorMessage).not.toHaveBeenCalled();

    // 2. postMessage throws synchronously
    panel.webview.postMessage.mockImplementationOnce(() => {
      throw new Error("webview disposed during post");
    });
    panel._emitViewState(true);
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("What's New:"),
      expect.any(Error),
    );
    expect(mockShowErrorMessage).not.toHaveBeenCalled();

    // 3. postMessage rejects via catchless VS Code-style Thenable
    panel.webview.postMessage.mockImplementationOnce(() => ({
      then: (_onFulfilled: unknown, onRejected?: (reason: unknown) => void) => {
        onRejected?.(new Error("thenable rejected"));
      },
    }));
    await panel._emitMessage({ type: "whatsNewReady" });
    await Promise.resolve();
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(3);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    expect(mockShowErrorMessage).not.toHaveBeenCalled();

    // 4. Subsequent delivery succeeds and clears only on ACK
    panel.webview.postMessage.mockResolvedValueOnce(true);
    panel._emitViewState(true);
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(4);

    await panel._emitMessage({
      type: "whatsNewNavigationApplied",
      requestId: 1,
      version: "1.2.0",
    });
    panel._emitViewState(true);
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(4);

    controller.dispose();
  });

  it("withholds navigation while hidden, flushes on reveal/visible and reload whatsNewReady, and applies latest-wins ACK rules", async () => {
    nextPanelVisible.current = false;
    const controller = new WhatsNewPanelController(extensionUri);

    controller.showVersion("1.2.0");
    const panel = createdPanels[0]!;
    await panel._emitMessage({ type: "whatsNewReady" });
    expect(panel.webview.postMessage).not.toHaveBeenCalled();

    // Supersede with version "2.0.0" while still hidden
    controller.showVersion("2.0.0");
    expect(panel.webview.postMessage).not.toHaveBeenCalled();

    // Panel becomes visible -> sends latest target (requestId: 2, version: "2.0.0")
    panel._emitViewState(true);
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith({
      type: "whatsNewOpenVersion",
      requestId: 2,
      version: "2.0.0",
    });

    // Stale, mismatched-version, mismatched-id, or extra-field ACKs must not clear pending
    await panel._emitMessage({
      type: "whatsNewNavigationApplied",
      requestId: 1,
      version: "1.2.0",
    });
    await panel._emitMessage({
      type: "whatsNewNavigationApplied",
      requestId: 2,
      version: "1.2.0",
    });
    await panel._emitMessage({
      type: "whatsNewNavigationApplied",
      requestId: 99,
      version: "2.0.0",
    });
    await panel._emitMessage({
      type: "whatsNewNavigationApplied",
      requestId: 2,
      version: "2.0.0",
      extra: true,
    });

    // Simulated Webview reload emitting whatsNewReady again still delivers "2.0.0"
    await panel._emitMessage({ type: "whatsNewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith({
      type: "whatsNewOpenVersion",
      requestId: 2,
      version: "2.0.0",
    });

    // Matching ACK clears pending; post-ACK reload/visible/show stays quiet
    await panel._emitMessage({
      type: "whatsNewNavigationApplied",
      requestId: 2,
      version: "2.0.0",
    });
    await panel._emitMessage({ type: "whatsNewReady" });
    panel._emitViewState(true);
    controller.show();
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("cleans up pending state, listeners, and stale callbacks on close, dispose, and creation/HTML failures", async () => {
    const controller = new WhatsNewPanelController(extensionUri);

    // 1. Closing panel while navigation is pending clears pending and listeners while keeping monotonic IDs
    controller.showVersion("1.2.0");
    const firstPanel = createdPanels[0]!;
    const staleMessageListeners = firstPanel._getMessageListeners();
    const staleViewStateListeners = firstPanel._getViewStateListeners();
    const staleDisposeListeners = firstPanel._getDisposeListeners();
    expect(staleMessageListeners).toHaveLength(1);
    expect(staleViewStateListeners).toHaveLength(1);
    expect(staleDisposeListeners).toHaveLength(1);

    firstPanel._emitDispose();
    expect(firstPanel._getMessageListenerCount()).toBe(0);
    expect(firstPanel._getViewStateListenerCount()).toBe(0);
    expect(firstPanel._getDisposeListenerCount()).toBe(0);

    // Plain reopen must open default list and NOT resurrect pending "1.2.0"
    controller.show();
    const secondPanel = createdPanels[1]!;
    await secondPanel._emitMessage({ type: "whatsNewReady" });
    expect(secondPanel.webview.postMessage).not.toHaveBeenCalled();

    // New showVersion on second panel increments requestId monotonically to 2
    controller.showVersion("2.0.0");
    expect(secondPanel.webview.postMessage).toHaveBeenCalledWith({
      type: "whatsNewOpenVersion",
      requestId: 2,
      version: "2.0.0",
    });

    // Stale callbacks from firstPanel must be ignored and never mutate secondPanel
    for (const listener of staleMessageListeners) {
      await listener({ type: "whatsNewNavigationApplied", requestId: 2, version: "2.0.0" });
    }
    for (const listener of staleDisposeListeners) {
      listener();
    }
    secondPanel._emitViewState(true);
    expect(secondPanel.webview.postMessage).toHaveBeenCalledTimes(2);

    // Controller dispose clears remaining panel cleanly
    controller.dispose();
    expect(secondPanel._getMessageListenerCount()).toBe(0);
    expect(secondPanel._getViewStateListenerCount()).toBe(0);
    expect(secondPanel._getDisposeListenerCount()).toBe(0);

    // 2. HTML failure cleans panel, listeners, and pending so subsequent show() stays clean
    mockGetWebviewHtml.mockImplementationOnce(() => {
      throw new Error("missing webview dist");
    });
    expect(() => controller.showVersion("3.0.0")).toThrow("missing webview dist");
    const failedHtmlPanel = createdPanels[2]!;
    expect(failedHtmlPanel.dispose).toHaveBeenCalledTimes(1);
    expect(failedHtmlPanel._getMessageListenerCount()).toBe(0);
    expect(failedHtmlPanel._getViewStateListenerCount()).toBe(0);
    expect(failedHtmlPanel._getDisposeListenerCount()).toBe(0);

    controller.show();
    const recoveredPanel = createdPanels[3]!;
    await recoveredPanel._emitMessage({ type: "whatsNewReady" });
    expect(recoveredPanel.webview.postMessage).not.toHaveBeenCalled();
    controller.dispose();

    // 3. createWebviewPanel failure clears pending so next show() does not leak the failed request
    mockCreateWebviewPanel.mockImplementationOnce(() => {
      throw new Error("webview creation failed");
    });
    expect(() => controller.showVersion("4.0.0")).toThrow("webview creation failed");

    controller.show();
    const postCreateFailurePanel = createdPanels[4]!;
    await postCreateFailurePanel._emitMessage({ type: "whatsNewReady" });
    expect(postCreateFailurePanel.webview.postMessage).not.toHaveBeenCalled();

    // Also keep explicit assertion that stale viewState listener reference won't throw after dispose
    for (const listener of staleViewStateListeners) {
      listener({ webviewPanel: firstPanel });
    }

    controller.dispose();
  });
});
