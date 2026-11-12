import {
  whatsNewExtensionToWebviewMessageSchema,
  type WhatsNewOpenVersionMessage,
} from "../shared/whats-new-protocol";
import { vscode } from "./vscode-api";

export function subscribeToWhatsNewNavigation(
  onNavigate: (message: WhatsNewOpenVersionMessage) => void,
): () => void {
  const handler = (event: MessageEvent<unknown>): void => {
    const parsed = whatsNewExtensionToWebviewMessageSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.type !== "whatsNewOpenVersion") {
      return;
    }
    onNavigate(parsed.data);
  };

  window.addEventListener("message", handler);
  vscode.postMessage({ type: "whatsNewReady" });

  return () => {
    window.removeEventListener("message", handler);
  };
}

