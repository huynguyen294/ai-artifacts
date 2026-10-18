import { useState, type ReactNode } from "react";
import type { ReviewState } from "../src/shared/contracts";

type Props = {
  reviewState: ReviewState;
  onUpdateReviewState: (nextState: ReviewState) => void;
  onReset: () => void;
};

export function DevToolbar({ reviewState, onUpdateReviewState, onReset }: Props): ReactNode {
  const [theme, setTheme] = useState<"vscode-dark" | "vscode-light" | "vscode-high-contrast">("vscode-dark");
  const [collapsed, setCollapsed] = useState(false);

  const switchTheme = (nextTheme: "vscode-dark" | "vscode-light" | "vscode-high-contrast") => {
    document.documentElement.className = nextTheme;
    document.body.className = nextTheme;
    setTheme(nextTheme);
  };

  const toggleReadOnly = () => {
    const isReadOnly = !reviewState.lifecycle.readOnly;
    onUpdateReviewState({
      ...reviewState,
      lifecycle: {
        readOnly: isReadOnly,
        ...(isReadOnly ? { message: "Simulated: Lifecycle is read-only (e.g. approved or round closed)." } : {}),
      },
    });
  };

  const toggleSubmitted = () => {
    if (reviewState.submission) {
      const { submission: _removed, ...withoutSubmission } = reviewState;
      onUpdateReviewState(withoutSubmission);
    } else {
      onUpdateReviewState({
        ...reviewState,
        submission: {
          schemaVersion: 6,
          artifactId: reviewState.artifact.artifactId,
          reviewRound: reviewState.artifact.reviewRound,
          reviewSessionId: reviewState.artifact.reviewSessionId,
          submittedAt: new Date().toISOString(),
          decision: "approve",
          artifactSha256: reviewState.comments.artifactSha256,
          commentsSha256: "0".repeat(64),
        },
      });
    }
  };

  const incrementRound = () => {
    const { submission: _removed, ...withoutSubmission } = reviewState;
    const nextRound = reviewState.artifact.reviewRound + 1;
    onUpdateReviewState({
      ...withoutSubmission,
      artifact: {
        ...reviewState.artifact,
        reviewRound: nextRound,
      },
      comments: {
        ...reviewState.comments,
        reviewRound: nextRound,
        comments: [],
      },
    });
  };

  if (collapsed) {
    return (
      <div className="dev-toolbar-container">
        <button
          className="dev-toolbar-badge"
          style={{ cursor: "pointer", border: "none", padding: "6px 10px" }}
          onClick={() => setCollapsed(false)}
          title="Open Dev Tools"
        >
          ⚙️ Dev Host
        </button>
      </div>
    );
  }

  return (
    <div className="dev-toolbar-container">
      <div className="dev-toolbar">
        <span className="dev-toolbar-badge">Dev Host</span>

        <div className="dev-toolbar-group">
          <button
            className={theme === "vscode-dark" ? "active" : ""}
            onClick={() => switchTheme("vscode-dark")}
            title="Dark Theme"
          >
            Dark
          </button>
          <button
            className={theme === "vscode-light" ? "active" : ""}
            onClick={() => switchTheme("vscode-light")}
            title="Light Theme"
          >
            Light
          </button>
          <button
            className={theme === "vscode-high-contrast" ? "active" : ""}
            onClick={() => switchTheme("vscode-high-contrast")}
            title="High Contrast"
          >
            HC
          </button>
        </div>

        <div className="dev-toolbar-group">
          <button
            className={reviewState.lifecycle.readOnly ? "active" : ""}
            onClick={toggleReadOnly}
            title="Toggle Read Only mode"
          >
            {reviewState.lifecycle.readOnly ? "Read-Only: ON" : "Read-Only: OFF"}
          </button>
          <button
            className={reviewState.submission ? "active" : ""}
            onClick={toggleSubmitted}
            title="Toggle Submitted state"
          >
            {reviewState.submission ? "Submitted: ON" : "Submitted: OFF"}
          </button>
          <button onClick={incrementRound} title="Advance to next review round">
            Round +1 (R{reviewState.artifact.reviewRound})
          </button>
        </div>

        <div className="dev-toolbar-group">
          <button onClick={onReset} title="Reset to initial mock state">
            Reset
          </button>
          <button onClick={() => setCollapsed(true)} title="Minimize dev bar">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
