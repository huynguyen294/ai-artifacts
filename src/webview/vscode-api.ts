import type {
  SessionWebviewToExtensionMessage,
  WebviewToExtensionMessage,
} from "../shared/contracts";
import type { WhatsNewWebviewToExtensionMessage } from "../shared/whats-new-protocol";

declare function acquireVsCodeApi<TState = unknown>(): {
  postMessage(
    message:
      | WebviewToExtensionMessage
      | SessionWebviewToExtensionMessage
      | WhatsNewWebviewToExtensionMessage,
  ): void;
  getState(): TState | undefined;
  setState(state: TState): void;
};

export const vscode = acquireVsCodeApi();
