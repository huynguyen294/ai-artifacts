import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPostMessage } = vi.hoisted(() => ({
  mockPostMessage: vi.fn(),
}));

vi.mock("../src/webview/vscode-api", () => ({
  vscode: {
    postMessage: mockPostMessage,
    getState: vi.fn(),
    setState: vi.fn(),
  },
}));

describe("whats-new-navigation", () => {
  type MessageHandler = (event: MessageEvent<unknown>) => void;

  let activeHandlers: Set<MessageHandler>;
  let addEventListenerSpy: ReturnType<typeof vi.fn>;
  let removeEventListenerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPostMessage.mockClear();
    activeHandlers = new Set<MessageHandler>();
    addEventListenerSpy = vi.fn((type: string, listener: MessageHandler) => {
      if (type === "message") {
        activeHandlers.add(listener);
      }
    });
    removeEventListenerSpy = vi.fn((type: string, listener: MessageHandler) => {
      if (type === "message") {
        activeHandlers.delete(listener);
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function installWindowStub(): void {
    vi.stubGlobal("window", {
      addEventListener: addEventListenerSpy,
      removeEventListener: removeEventListenerSpy,
    });
  }

  function dispatchWindowMessage(data: unknown): void {
    for (const handler of [...activeHandlers]) {
      handler({ data } as MessageEvent<unknown>);
    }
  }

  it("has no module-scope window side effects when imported", async () => {
    vi.resetModules();
    expect(typeof window).toBe("undefined");

    const mod = await import("../src/webview/whats-new-navigation");
    expect(typeof mod.subscribeToWhatsNewNavigation).toBe("function");
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("attaches window listener before sending whatsNewReady, validates messages without early ACK, and cleans up symmetrically", async () => {
    installWindowStub();
    const { subscribeToWhatsNewNavigation } = await import("../src/webview/whats-new-navigation");

    const onNavigate = vi.fn();
    const unsubscribe = subscribeToWhatsNewNavigation(onNavigate);

    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).toHaveBeenCalledWith({ type: "whatsNewReady" });
    expect(addEventListenerSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      mockPostMessage.mock.invocationCallOrder[0]!,
    );

    const registeredHandler = addEventListenerSpy.mock.calls[0]![1] as MessageHandler;

    // Invalid, malformed, or foreign messages are ignored
    dispatchWindowMessage(null);
    dispatchWindowMessage({ type: "state", state: {} });
    dispatchWindowMessage({ type: "workSessionState", state: { status: "loading" } });
    dispatchWindowMessage({ type: "whatsNewOpenVersion", requestId: 0, version: "1.2.0" });
    dispatchWindowMessage({ type: "whatsNewOpenVersion", requestId: 1, version: "   " });
    dispatchWindowMessage({ type: "whatsNewOpenVersion", requestId: 1, version: "1.2.0", extra: true });
    expect(onNavigate).not.toHaveBeenCalled();

    // Valid navigation message reaches callback with exact payload; adapter never ACKs early
    dispatchWindowMessage({ type: "whatsNewOpenVersion", requestId: 4, version: "v1.2.0" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({
      type: "whatsNewOpenVersion",
      requestId: 4,
      version: "v1.2.0",
    });
    expect(mockPostMessage).toHaveBeenCalledTimes(1);

    // Cleanup removes the exact registered handler
    unsubscribe();
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(removeEventListenerSpy).toHaveBeenCalledWith("message", registeredHandler);
    expect(activeHandlers.size).toBe(0);

    dispatchWindowMessage({ type: "whatsNewOpenVersion", requestId: 5, version: "1.2.0" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("supports subscribe -> cleanup -> subscribe without leaving duplicate listeners", async () => {
    installWindowStub();
    const { subscribeToWhatsNewNavigation } = await import("../src/webview/whats-new-navigation");

    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    const cleanupFirst = subscribeToWhatsNewNavigation(firstCallback);
    cleanupFirst();
    const cleanupSecond = subscribeToWhatsNewNavigation(secondCallback);

    expect(activeHandlers.size).toBe(1);
    dispatchWindowMessage({ type: "whatsNewOpenVersion", requestId: 7, version: "1.2.0" });

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledWith({
      type: "whatsNewOpenVersion",
      requestId: 7,
      version: "1.2.0",
    });

    cleanupSecond();
    expect(activeHandlers.size).toBe(0);
  });
});

