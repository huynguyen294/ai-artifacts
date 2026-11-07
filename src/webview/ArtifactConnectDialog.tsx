import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ArtifactSessionTarget } from "../shared/contracts";
import { trapFocusInContainer } from "./focus-trap";

export interface ArtifactConnectDialogProps {
  open: boolean;
  sessions: ArtifactSessionTarget[];
  onClose: () => void;
  onCopy: (options: { mode: "new" } | { mode: "join"; sessionId: string }) => void;
}

export function ArtifactConnectDialog({
  open,
  sessions,
  onClose,
  onCopy,
}: ArtifactConnectDialogProps): ReactNode {
  const [mode, setMode] = useState<"new" | "join">("new");
  const availableV2Sessions = sessions.filter((s) => s.version === 2);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    availableV2Sessions[0]?.sessionId ?? "",
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setMode("new");
      if (availableV2Sessions.length > 0) {
        setSelectedSessionId(availableV2Sessions[0]!.sessionId);
      }
      primaryButtonRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const container = dialogRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      trapFocusInContainer(container, e);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = (): void => {
    if (mode === "new") {
      onCopy({ mode: "new" });
    } else {
      if (!selectedSessionId) return;
      onCopy({ mode: "join", sessionId: selectedSessionId });
    }
    onClose();
  };

  const isJoinDisabled = availableV2Sessions.length === 0;

  return (
    <div className="dialog-overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="dialog-card connect-dialog-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-dialog-title"
      >
        <div className="dialog-header">
          <h3 id="connect-dialog-title">Connect AI to Artifact</h3>
          <button
            type="button"
            className="icon-button dialog-close-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        <div className="dialog-body connect-dialog-body">
          <div className="connect-mode-options">
            <label className={`connect-mode-option ${mode === "new" ? "selected" : ""}`}>
              <div className="connect-mode-radio">
                <input
                  type="radio"
                  name="connectMode"
                  value="new"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
              </div>
              <div className="connect-mode-content">
                <div className="connect-mode-title">New Session</div>
                <div className="connect-mode-description">
                  Start a new work session from this artifact.
                </div>
              </div>
            </label>

            <label
              className={`connect-mode-option ${mode === "join" ? "selected" : ""} ${isJoinDisabled ? "disabled" : ""}`}
            >
              <div className="connect-mode-radio">
                <input
                  type="radio"
                  name="connectMode"
                  value="join"
                  checked={mode === "join"}
                  disabled={isJoinDisabled}
                  onChange={() => {
                    if (!isJoinDisabled) setMode("join");
                  }}
                />
              </div>
              <div className="connect-mode-content">
                <div className="connect-mode-title">Join Session</div>
                <div className="connect-mode-description">
                  Inspect this artifact and join one of its existing sessions with its full session context.
                </div>

                {mode === "join" && (
                  <div className="connect-session-list">
                    {sessions.length === 0 ? (
                      <div className="connect-session-empty">
                        This artifact does not belong to any session yet.
                      </div>
                    ) : (
                      sessions.map((s) => {
                        const isV1 = s.version === 1;
                        return (
                          <label
                            key={s.sessionId}
                            className={`connect-session-item ${isV1 ? "disabled" : ""}`}
                            title={isV1 ? "Migrate this conversation to Session v2 before joining." : undefined}
                          >
                            <input
                              type="radio"
                              name="targetSession"
                              value={s.sessionId}
                              checked={selectedSessionId === s.sessionId}
                              disabled={isV1}
                              onChange={() => {
                                if (!isV1) setSelectedSessionId(s.sessionId);
                              }}
                            />
                            <span className="connect-session-item-title">{s.title}</span>
                            {isV1 ? (
                              <span className="connect-session-v1-badge">Migration required</span>
                            ) : (
                              <span className="connect-session-type-badge">{s.typeLabel ?? "Session"}</span>
                            )}
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </label>
          </div>
        </div>

        <div className="dialog-footer">
          <button
            type="button"
            className="ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            ref={primaryButtonRef}
            type="button"
            className="primary"
            onClick={handleCopy}
            disabled={mode === "join" && (!selectedSessionId || isJoinDisabled)}
          >
            Copy Prompt
          </button>
        </div>
      </div>
    </div>
  );
}

