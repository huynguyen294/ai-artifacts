import { StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/webview/ReviewApp";
import "../src/webview/styles.css";
import "./vscode-theme.css";
import { createInitialConversationState, createInitialReviewState } from "./mock-data";
import { DevToolbar } from "./DevToolbar";
import {
  ARTIFACT_ROOT_BLOCK_ID,
  ARTIFACT_ROOT_BLOCK_TYPE,
  ARTIFACT_ROOT_TEXT,
  type ExtensionToWebviewMessage,
  type ReviewComment,
  type ReviewState,
  type WebviewToExtensionMessage,
} from "../src/shared/contracts";

declare global {
  interface Window {
    __dev_vscode_handler?: ((message: WebviewToExtensionMessage) => void) | null | undefined;
    __dev_vscode_queue?: WebviewToExtensionMessage[] | undefined;
    setDevVsCodeHandler?: ((handler: ((message: WebviewToExtensionMessage) => void) | null) => void) | undefined;
  }
}

function postToWebview(message: ExtensionToWebviewMessage): void {
  window.postMessage(message, "*");
}

export function DevHostApp(): ReactNode {
  const [reviewState, setReviewState] = useState<ReviewState>(() => createInitialReviewState());
  const reviewStateRef = useRef(reviewState);
  reviewStateRef.current = reviewState;

  const broadcastState = useCallback((state: ReviewState) => {
    setReviewState(state);
    postToWebview({ type: "state", state });
  }, []);

  const handleWebviewMessage = useCallback((message: WebviewToExtensionMessage) => {
    const current = reviewStateRef.current;

    switch (message.type) {
      case "ready": {
        postToWebview({ type: "state", state: current });
        postToWebview({ type: "conversationArtifactsState", state: createInitialConversationState() });
        break;
      }

      case "addComment": {
        const block = current.blocks.find((b) => b.id === message.blockId);
        const isArtifactWide = message.blockId === ARTIFACT_ROOT_BLOCK_ID;

        const newComment: ReviewComment = isArtifactWide
          ? {
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
              block: {
                id: ARTIFACT_ROOT_BLOCK_ID,
                type: ARTIFACT_ROOT_BLOCK_TYPE,
                heading: null,
              },
              selection: {
                quote: ARTIFACT_ROOT_TEXT,
                start: 0,
                end: ARTIFACT_ROOT_TEXT.length,
                prefix: "",
                suffix: "",
              },
              body: message.body,
            }
          : {
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
              block: {
                id: message.blockId,
                type: block?.type ?? "paragraph",
                heading: block?.heading ?? null,
              },
              selection: {
                quote: message.selection.quote,
                start: message.selection.start,
                end: message.selection.end,
                prefix: "",
                suffix: "",
              },
              body: message.body,
            };

        const nextState: ReviewState = {
          ...current,
          comments: {
            ...current.comments,
            comments: [...current.comments.comments, newComment],
          },
        };
        broadcastState(nextState);
        break;
      }

      case "removeComment": {
        const nextState: ReviewState = {
          ...current,
          comments: {
            ...current.comments,
            comments: current.comments.comments.filter((c) => c.id !== message.commentId),
          },
        };
        broadcastState(nextState);
        break;
      }

      case "submitReview": {
        postToWebview({
          type: "sendState",
          status: "submitting",
          message: "Dev Host: Simulating decision return to AI turn…",
        });

        setTimeout(() => {
          const nextState: ReviewState = {
            ...current,
            submission: {
              schemaVersion: 6,
              artifactId: current.artifact.artifactId,
              reviewRound: current.artifact.reviewRound,
              reviewSessionId: current.artifact.reviewSessionId,
              submittedAt: new Date().toISOString(),
              decision: message.decision,
              artifactSha256: current.comments.artifactSha256,
              commentsSha256: "0".repeat(64),
            },
          };
          broadcastState(nextState);

          const feedbackText =
            message.decision === "revise"
              ? "Review comments returned to the waiting AI turn."
              : message.decision === "save"
                ? undefined
                : "Artifact approved. Return to the AI chat to continue.";

          postToWebview({
            type: "sendState",
            status: "submitted",
            ...(feedbackText !== undefined ? { message: feedbackText } : {}),
          });
        }, 300);
        break;
      }

      case "copyArtifactConnectPrompt": {
        const prompt = `@codex inspect_artifact_review(artifactDirectory: "dev/artifacts/${current.artifact.artifactId}")`;
        void navigator.clipboard.writeText(prompt);
        postToWebview({ type: "artifactConnectPromptCopied" });
        break;
      }

      case "openConversationArtifact": {
        console.info(`[Dev Host] Request to open conversation artifact: ${message.artifactId}`);
        alert(`[Dev Host] Switched to artifact: ${message.artifactId}`);
        break;
      }

      case "openExternal": {
        window.open(message.url, "_blank");
        break;
      }
    }
  }, [broadcastState]);

  useEffect(() => {
    if (typeof window.setDevVsCodeHandler === "function") {
      window.setDevVsCodeHandler(handleWebviewMessage);
    } else {
      window.__dev_vscode_handler = handleWebviewMessage;
    }

    // Proactively broadcast initial state on mount to guarantee immediate render
    broadcastState(reviewStateRef.current);
    postToWebview({ type: "conversationArtifactsState", state: createInitialConversationState() });

    return () => {
      if (typeof window.setDevVsCodeHandler === "function") {
        window.setDevVsCodeHandler(null);
      } else {
        window.__dev_vscode_handler = null;
      }
    };
  }, [broadcastState, handleWebviewMessage]);

  const handleReset = useCallback(() => {
    const fresh = createInitialReviewState();
    broadcastState(fresh);
    postToWebview({ type: "conversationArtifactsState", state: createInitialConversationState() });
  }, [broadcastState]);

  return (
    <>
      <App />
      <DevToolbar
        reviewState={reviewState}
        onUpdateReviewState={broadcastState}
        onReset={handleReset}
      />
    </>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element in dev index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <DevHostApp />
  </StrictMode>,
);
