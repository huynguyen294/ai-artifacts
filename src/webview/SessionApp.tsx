import { useEffect, useReducer } from "react";
import type {
  SessionExtensionToWebviewMessage,
  WorkSessionArtifactRow,
  WorkSessionViewData,
} from "../shared/contracts";
import { vscode } from "./vscode-api";

export type SessionAppState =
  | { status: "loading" }
  | { status: "ready"; data: WorkSessionViewData }
  | { status: "error"; message: string };

export interface SessionAppProps {
  initialState?: SessionAppState;
  initialPanelExpanded?: boolean;
}

export interface SessionManagerState {
  state: SessionAppState;
  panelExpanded: boolean;
  draftInstructions: string;
  hasInitializedDraft: boolean;
  savingInstructions: boolean;
  instructionsError?: string | undefined;
  actionError?: string | undefined;
  activeCardMenuId?: string | undefined;
}

export type SessionManagerAction =
  | { type: "message"; message: SessionExtensionToWebviewMessage }
  | { type: "setDraft"; draft: string }
  | { type: "startSaveInstructions" }
  | { type: "togglePanel" }
  | { type: "setActiveCardMenu"; menuId: string | undefined }
  | { type: "dismissActionError" };

export function createInitialSessionManagerState(
  initialState?: SessionAppState,
  initialPanelExpanded = true,
): SessionManagerState {
  return {
    state: initialState ?? { status: "loading" },
    panelExpanded: initialPanelExpanded,
    draftInstructions: initialState && initialState.status === "ready" ? initialState.data.instructions : "",
    hasInitializedDraft: initialState && initialState.status === "ready" ? true : false,
    savingInstructions: false,
    instructionsError: undefined,
    actionError: undefined,
    activeCardMenuId: undefined,
  };
}

export function sessionManagerReducer(
  current: SessionManagerState,
  action: SessionManagerAction,
): SessionManagerState {
  switch (action.type) {
    case "setDraft":
      return {
        ...current,
        draftInstructions: action.draft,
        instructionsError: undefined,
      };

    case "startSaveInstructions":
      return {
        ...current,
        savingInstructions: true,
        instructionsError: undefined,
      };

    case "togglePanel":
      return {
        ...current,
        panelExpanded: !current.panelExpanded,
      };

    case "setActiveCardMenu":
      return {
        ...current,
        activeCardMenuId: action.menuId,
      };

    case "dismissActionError":
      return {
        ...current,
        actionError: undefined,
      };

    case "message": {
      const msg = action.message;
      if (!msg) return current;

      if (msg.type === "workSessionState") {
        if (msg.state.status === "ready") {
          const nextDraft = current.hasInitializedDraft
            ? current.draftInstructions
            : msg.state.data.instructions;
          return {
            ...current,
            state: { status: "ready", data: msg.state.data },
            draftInstructions: nextDraft,
            hasInitializedDraft: true,
            panelExpanded: msg.panelExpanded !== undefined ? msg.panelExpanded : current.panelExpanded,
          };
        }
        return {
          ...current,
          state: { status: "error", message: msg.state.message },
        };
      }

      if (msg.type === "workSessionSummaryPatch") {
        if (current.state.status !== "ready") return current;
        return {
          ...current,
          state: {
            status: "ready",
            data: {
              ...current.state.data,
              title: msg.summary.title,
              typeId: msg.summary.typeId,
              typeLabel: msg.summary.typeLabel,
              updatedAt: msg.summary.updatedAt,
            },
          },
        };
      }

      if (msg.type === "workSessionArtifactsPatch") {
        if (current.state.status !== "ready") return current;
        return {
          ...current,
          state: {
            status: "ready",
            data: {
              ...current.state.data,
              working: msg.working,
              references: msg.references,
              archived: msg.archived,
              updatedAt: msg.updatedAt,
            },
          },
        };
      }

      if (msg.type === "workSessionInstructionsPatch") {
        return {
          ...current,
          draftInstructions: msg.instructions,
          instructionsError: undefined,
          state:
            current.state.status === "ready"
              ? {
                  status: "ready",
                  data: {
                    ...current.state.data,
                    instructions: msg.instructions,
                  },
                }
              : current.state,
        };
      }

      if (msg.type === "sessionInstructionsSaved") {
        return {
          ...current,
          savingInstructions: false,
          instructionsError: undefined,
          actionError: undefined,
          draftInstructions: msg.instructions,
          state:
            current.state.status === "ready"
              ? {
                  status: "ready",
                  data: {
                    ...current.state.data,
                    instructions: msg.instructions,
                  },
                }
              : current.state,
        };
      }

      if (msg.type === "sessionPanelExpanded") {
        return {
          ...current,
          panelExpanded: msg.expanded,
        };
      }

      if (msg.type === "actionError") {
        if (msg.action === "saveSessionInstructions") {
          return {
            ...current,
            savingInstructions: false,
            instructionsError: msg.message,
          };
        }
        return {
          ...current,
          actionError: msg.message,
        };
      }

      if (msg.type === "error") {
        return {
          ...current,
          state: { status: "error", message: msg.message },
        };
      }

      return current;
    }

    default:
      return current;
  }
}

export function SessionApp({ initialState, initialPanelExpanded = true }: SessionAppProps = {}) {
  const [managerState, dispatch] = useReducer(
    sessionManagerReducer,
    createInitialSessionManagerState(initialState, initialPanelExpanded),
  );

  const {
    state,
    panelExpanded,
    draftInstructions,
    savingInstructions,
    instructionsError,
    actionError,
    activeCardMenuId,
  } = managerState;

  useEffect(() => {
    const handleMessage = (event: MessageEvent<SessionExtensionToWebviewMessage>) => {
      const msg = event.data;
      if (!msg) return;
      dispatch({ type: "message", message: msg });
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  // Close card context menu on document click
  useEffect(() => {
    const handleDocumentClick = () => {
      dispatch({ type: "setActiveCardMenu", menuId: undefined });
    };
    window.addEventListener("click", handleDocumentClick);
    return () => {
      window.removeEventListener("click", handleDocumentClick);
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="session-app loading">
        <div className="session-status-text">Loading work session...</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="session-app error">
        <div className="session-error-banner">
          <h3>Failed to load work session</h3>
          <p>{state.message}</p>
        </div>
      </div>
    );
  }

  const { data } = state;

  const handleRenameSession = () => {
    vscode.postMessage({ type: "renameSession" });
  };

  const handleTogglePanel = () => {
    const next = !panelExpanded;
    dispatch({ type: "togglePanel" });
    vscode.postMessage({ type: "setSessionPanelExpanded", expanded: next });
  };

  const handleSelectType = () => {
    vscode.postMessage({ type: "selectSessionType" });
  };

  const handleSaveInstructions = () => {
    dispatch({ type: "startSaveInstructions" });
    vscode.postMessage({
      type: "saveSessionInstructions",
      instructions: draftInstructions,
    });
  };

  const handleMoveArtifact = (artifactId: string, zone: "working" | "references" | "archived") => {
    dispatch({ type: "setActiveCardMenu", menuId: undefined });
    vscode.postMessage({ type: "moveArtifact", artifactId, zone });
  };

  const handleReorderArtifact = (artifactId: string, direction: "up" | "down") => {
    dispatch({ type: "setActiveCardMenu", menuId: undefined });
    vscode.postMessage({ type: "reorderArtifact", artifactId, direction });
  };

  const handleRemoveArtifact = (artifactId: string) => {
    dispatch({ type: "setActiveCardMenu", menuId: undefined });
    vscode.postMessage({ type: "removeArtifact", artifactId });
  };

  const renderZone = (
    title: string,
    zoneKey: "working" | "references" | "archived",
    items: readonly WorkSessionArtifactRow[],
  ) => {
    return (
      <section className={`session-zone session-zone-${zoneKey}`}>
        <div className="session-zone-header">
          <h4>
            {title} <span className="session-zone-count">({items.length})</span>
          </h4>
        </div>
        {items.length === 0 ? (
          <div className="session-zone-empty">No artifacts in this zone</div>
        ) : (
          <div className="session-artifact-list">
            {items.map((artifact, index) => {
              const isMenuOpen = activeCardMenuId === artifact.artifactId;
              const isFirst = index === 0;
              const isLast = index === items.length - 1;

              return (
                <div
                  key={artifact.artifactId}
                  className={`session-artifact-card ${artifact.unavailable ? "session-artifact-card-unavailable" : ""}`}
                  onClick={() => {
                    if (artifact.unavailable) return;
                    vscode.postMessage({ type: "openArtifact", artifactId: artifact.artifactId });
                  }}
                  role="button"
                  tabIndex={artifact.unavailable ? -1 : 0}
                  aria-disabled={artifact.unavailable ? true : undefined}
                  onKeyDown={(e) => {
                    if (artifact.unavailable) return;
                    if (e.key === "Enter" || e.key === " ") {
                      vscode.postMessage({ type: "openArtifact", artifactId: artifact.artifactId });
                    }
                  }}
                >
                  <div className="session-card-header">
                    <div className="session-card-main">
                      <span className="session-card-title">{artifact.title}</span>
                      {artifact.unavailable ? (
                        <span className="session-card-unavailable-badge">Unavailable</span>
                      ) : (
                        <span className="session-card-kind-badge">{artifact.kind}</span>
                      )}
                    </div>
                    <div
                      className="session-card-menu-anchor"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="session-card-menu-btn"
                        title="Artifact options"
                        onClick={() =>
                          dispatch({
                            type: "setActiveCardMenu",
                            menuId: isMenuOpen ? undefined : artifact.artifactId,
                          })
                        }
                        aria-expanded={isMenuOpen}
                      >
                        ⋯
                      </button>
                      {isMenuOpen && (
                        <div
                          className="session-card-dropdown"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <div className="session-dropdown-header">Move to</div>
                          {zoneKey !== "working" && (
                            <button
                              type="button"
                              className="session-dropdown-item"
                              onClick={() => handleMoveArtifact(artifact.artifactId, "working")}
                            >
                              Move to Working
                            </button>
                          )}
                          {zoneKey !== "references" && (
                            <button
                              type="button"
                              className="session-dropdown-item"
                              onClick={() => handleMoveArtifact(artifact.artifactId, "references")}
                            >
                              Move to References
                            </button>
                          )}
                          {zoneKey !== "archived" && (
                            <button
                              type="button"
                              className="session-dropdown-item"
                              onClick={() => handleMoveArtifact(artifact.artifactId, "archived")}
                            >
                              Move to Archived
                            </button>
                          )}
                          <div className="session-dropdown-divider" />
                          <div className="session-dropdown-header">Reorder</div>
                          <button
                            type="button"
                            className="session-dropdown-item"
                            disabled={isFirst}
                            onClick={() => handleReorderArtifact(artifact.artifactId, "up")}
                          >
                            Move Up
                          </button>
                          <button
                            type="button"
                            className="session-dropdown-item"
                            disabled={isLast}
                            onClick={() => handleReorderArtifact(artifact.artifactId, "down")}
                          >
                            Move Down
                          </button>
                          <div className="session-dropdown-divider" />
                          <button
                            type="button"
                            className="session-dropdown-item session-dropdown-item-danger"
                            onClick={() => handleRemoveArtifact(artifact.artifactId)}
                          >
                            Remove from session
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="session-card-meta">
                    <span className="session-card-updated">{artifact.updatedAt}</span>
                    <span className="session-card-id">{artifact.artifactId}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="session-app-container">
      <header className="session-header">
        <div className="session-header-top">
          <div className="session-title-row">
            <h2 className="session-title">{data.title}</h2>
            <button
              type="button"
              className="session-icon-button"
              title="Rename session"
              onClick={handleRenameSession}
              aria-label="Rename session"
            >
              ✎
            </button>
          </div>
          <div className="session-header-actions">
            <button
              type="button"
              className="session-icon-button session-panel-toggle-btn"
              onClick={handleTogglePanel}
              title={panelExpanded ? "Collapse side panel" : "Expand side panel"}
              aria-label={panelExpanded ? "Collapse side panel" : "Expand side panel"}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M1.5 3C1.5 2.17157 2.17157 1.5 3 1.5H13C13.8284 1.5 14.5 2.17157 14.5 3V13C14.5 13.8284 13.8284 14.5 13 14.5H3C2.17157 14.5 1.5 13.8284 1.5 13V3ZM3 2.5H10V13.5H3C2.72386 13.5 2.5 13.2761 2.5 13V3C2.5 2.72386 2.72386 2.5 3 2.5ZM11 13.5H13C13.2761 13.5 13.5 13.2761 13.5 13V3C13.5 2.72386 13.2761 2.5 13 2.5H11V13.5Z"
                />
                {panelExpanded && (
                  <rect x="11" y="2.5" width="2.5" height="11" fill="currentColor" opacity="0.4" />
                )}
              </svg>
            </button>
          </div>
        </div>
        <div className="session-header-meta">
          <span>Updated: {data.updatedAt}</span>
          <span>·</span>
          <span>Created: {data.createdAt}</span>
        </div>
      </header>

      {actionError && (
        <div className="session-banner-error" role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className="session-banner-error-close"
            onClick={() => dispatch({ type: "dismissActionError" })}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      <div className="session-layout">
        {/* Main column: Working Zone (borderless, paddingless) */}
        <main className="session-main-column">
          {renderZone("Working", "working", data.working)}
        </main>

        {/* Side panel: Type -> Instructions -> References -> Archived (single border each) */}
        {panelExpanded && (
          <aside className="session-side-panel">
            {/* 1. Type Section */}
            <div className="session-side-section session-type-section">
              <div className="session-side-section-header">
                <h4>Session Type</h4>
                <button
                  type="button"
                  className="session-icon-button"
                  title="Change session type"
                  onClick={handleSelectType}
                  aria-label="Change session type"
                >
                  ✎
                </button>
              </div>
              <div className="session-type-display">
                <span className="session-type-badge">{data.typeLabel}</span>
              </div>
            </div>

            {/* 2. Instructions Section */}
            <div className="session-side-section session-instructions-section">
              <div className="session-side-section-header">
                <h4>Instructions</h4>
                <button
                  type="button"
                  className="primary session-save-btn"
                  onClick={handleSaveInstructions}
                  disabled={savingInstructions || draftInstructions === data.instructions}
                >
                  {savingInstructions ? "Saving..." : "Save"}
                </button>
              </div>
              <textarea
                className="session-instructions-textarea"
                value={draftInstructions}
                onChange={(e) => {
                  dispatch({ type: "setDraft", draft: e.target.value });
                }}
                placeholder="Enter instructions for this session..."
                rows={6}
                disabled={savingInstructions}
              />
              {instructionsError && <div className="session-inline-error">{instructionsError}</div>}
            </div>

            {/* 3. References Zone (Direct session-zone, single border) */}
            {renderZone("References", "references", data.references)}

            {/* 4. Archived Zone (Direct session-zone, single border) */}
            {renderZone("Archived", "archived", data.archived)}
          </aside>
        )}
      </div>
    </div>
  );
}
