import type {
  SessionWebviewToExtensionMessage,
  WebviewToExtensionMessage,
} from "../shared/contracts";

declare function acquireVsCodeApi<TState = unknown>(): {
  postMessage(message: WebviewToExtensionMessage | SessionWebviewToExtensionMessage): void;
  getState(): TState | undefined;
  setState(state: TState): void;
};

export const vscode = acquireVsCodeApi();
