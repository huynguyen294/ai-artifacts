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
  activeCardMenuId?: string | undefined;
}

export type SessionManagerAction =
  | { type: "message"; message: SessionExtensionToWebviewMessage }
  | { type: "setDraft"; draft: string }
  | { type: "startSaveInstructions" }
  | { type: "togglePanel" }
  | { type: "setActiveCardMenu"; menuId: string | undefined };

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

      if (msg.type === "sessionInstructionsSaved") {
        return {
          ...current,
          savingInstructions: false,
          instructionsError: undefined,
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
        return current;
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
        <div className="session-status-text">Đang tải phiên làm việc...</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="session-app error">
        <div className="session-error-banner">
          <h3>Lỗi tải phiên làm việc</h3>
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
          <div className="session-zone-empty">Không có artifact trong vùng này</div>
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
                        <span className="session-card-unavailable-badge">Không khả dụng</span>
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
                        title="Tùy chọn artifact"
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
                          <div className="session-dropdown-header">Chuyển vùng</div>
                          {zoneKey !== "working" && (
                            <button
                              type="button"
                              className="session-dropdown-item"
                              onClick={() => handleMoveArtifact(artifact.artifactId, "working")}
                            >
                              Sang Working
                            </button>
                          )}
                          {zoneKey !== "references" && (
                            <button
                              type="button"
                              className="session-dropdown-item"
                              onClick={() => handleMoveArtifact(artifact.artifactId, "references")}
                            >
                              Sang References
                            </button>
                          )}
                          {zoneKey !== "archived" && (
                            <button
                              type="button"
                              className="session-dropdown-item"
                              onClick={() => handleMoveArtifact(artifact.artifactId, "archived")}
                            >
                              Sang Archived
                            </button>
                          )}
                          <div className="session-dropdown-divider" />
                          <div className="session-dropdown-header">Sắp xếp</div>
                          <button
                            type="button"
                            className="session-dropdown-item"
                            disabled={isFirst}
                            onClick={() => handleReorderArtifact(artifact.artifactId, "up")}
                          >
                            Lên trên
                          </button>
                          <button
                            type="button"
                            className="session-dropdown-item"
                            disabled={isLast}
                            onClick={() => handleReorderArtifact(artifact.artifactId, "down")}
                          >
                            Xuống dưới
                          </button>
                          <div className="session-dropdown-divider" />
                          <button
                            type="button"
                            className="session-dropdown-item session-dropdown-item-danger"
                            onClick={() => handleRemoveArtifact(artifact.artifactId)}
                          >
                            Gỡ khỏi phiên
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
              title="Đổi tên phiên"
              onClick={handleRenameSession}
              aria-label="Đổi tên phiên"
            >
              ✎
            </button>
          </div>
          <div className="session-header-actions">
            <button
              type="button"
              className={`session-panel-toggle-btn ${panelExpanded ? "active" : ""}`}
              onClick={handleTogglePanel}
              title={panelExpanded ? "Đóng bảng phụ" : "Mở bảng phụ"}
            >
              {panelExpanded ? "Đóng bảng phụ" : "Mở bảng phụ"}
            </button>
          </div>
        </div>
        <div className="session-header-meta">
          <span>Cập nhật: {data.updatedAt}</span>
          <span>·</span>
          <span>Tạo lúc: {data.createdAt}</span>
        </div>
      </header>

      <div className="session-layout">
        {/* Main column: Working Zone */}
        <main className="session-main-column">
          {renderZone("Working", "working", data.working)}
        </main>

        {/* Side panel: Type -> Instructions -> References -> Archived */}
        {panelExpanded && (
          <aside className="session-side-panel">
            {/* 1. Type Section */}
            <div className="session-side-section session-type-section">
              <div className="session-side-section-header">
                <h4>Loại phiên</h4>
                <button
                  type="button"
                  className="session-icon-button"
                  title="Thay đổi loại phiên"
                  onClick={handleSelectType}
                  aria-label="Thay đổi loại phiên"
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
                <h4>Hướng dẫn</h4>
              </div>
              <textarea
                className="session-instructions-textarea"
                value={draftInstructions}
                onChange={(e) => {
                  dispatch({ type: "setDraft", draft: e.target.value });
                }}
                placeholder="Nhập hướng dẫn cho phiên làm việc..."
                rows={6}
                disabled={savingInstructions}
              />
              <div className="session-instructions-actions">
                {instructionsError && <div className="session-inline-error">{instructionsError}</div>}
                <button
                  type="button"
                  className="primary session-save-btn"
                  onClick={handleSaveInstructions}
                  disabled={savingInstructions || draftInstructions === data.instructions}
                >
                  {savingInstructions ? "Đang lưu..." : "Lưu hướng dẫn"}
                </button>
              </div>
            </div>

            {/* 3. References Zone */}
            <div className="session-side-section">
              {renderZone("References", "references", data.references)}
            </div>

            {/* 4. Archived Zone */}
            <div className="session-side-section">
              {renderZone("Archived", "archived", data.archived)}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
