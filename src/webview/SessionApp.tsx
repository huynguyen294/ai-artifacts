import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { formatArtifactKindLabel } from "../shared/artifact-kinds";
import { normalizeArtifactTitleSearch } from "../shared/artifact-title-search";
import type {
  ArtifactAutoOpenState,
  SessionExtensionToWebviewMessage,
  WorkSessionArtifactRow,
  WorkSessionViewData,
  WorkSessionWaiterItem,
} from "../shared/contracts";
import { vscode } from "./vscode-api";

export type SessionAppState =
  | { status: "loading" }
  | { status: "ready"; data: WorkSessionViewData }
  | { status: "error"; message: string };

export interface SessionAppProps {
  initialState?: SessionAppState;
  initialPanelExpanded?: boolean;
  initialWaitingRoomOpen?: boolean;
}

export interface SessionManagerState {
  state: SessionAppState;
  artifactAutoOpen?: ArtifactAutoOpenState;
  panelExpanded: boolean;
  draftInstructions: string;
  hasInitializedDraft: boolean;
  savingInstructions: boolean;
  restoringSession: boolean;
  stoppingWaitIds: string[];
  instructionsError?: string | undefined;
  actionError?: string | undefined;
  activeCardMenuId?: string | undefined;
  connectCopied: boolean;
}

export type SessionManagerAction =
  | { type: "message"; message: SessionExtensionToWebviewMessage }
  | { type: "setDraft"; draft: string }
  | { type: "startSaveInstructions" }
  | { type: "startRestoreSession" }
  | { type: "startStopWaiter"; waitId: string }
  | { type: "togglePanel" }
  | { type: "setActiveCardMenu"; menuId: string | undefined }
  | { type: "dismissActionError" }
  | { type: "setConnectCopied"; copied: boolean };

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
    restoringSession: false,
    stoppingWaitIds: [],
    instructionsError: undefined,
    actionError: undefined,
    activeCardMenuId: undefined,
    connectCopied: false,
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

    case "startRestoreSession":
      return {
        ...current,
        restoringSession: true,
        actionError: undefined,
      };

    case "startStopWaiter":
      return {
        ...current,
        stoppingWaitIds: current.stoppingWaitIds.includes(action.waitId)
          ? current.stoppingWaitIds
          : [...current.stoppingWaitIds, action.waitId],
        actionError: undefined,
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

    case "setConnectCopied":
      return {
        ...current,
        connectCopied: action.copied,
      };

    case "message": {
      const msg = action.message;
      if (!msg) return current;

      if (msg.type === "artifactAutoOpenState") {
        return { ...current, artifactAutoOpen: msg.state };
      }

      if (msg.type === "workSessionState") {
        if (msg.state.status === "ready") {
          const nextDraft = current.hasInitializedDraft
            ? current.draftInstructions
            : msg.state.data.instructions;
          const activeWaitIds = new Set((msg.state.data.waiters ?? []).map((w) => w.waitId));
          return {
            ...current,
            state: { status: "ready", data: msg.state.data },
            draftInstructions: nextDraft,
            hasInitializedDraft: true,
            panelExpanded: msg.panelExpanded !== undefined ? msg.panelExpanded : current.panelExpanded,
            restoringSession: false,
            stoppingWaitIds: current.stoppingWaitIds.filter((id) => activeWaitIds.has(id)),
          };
        }
        return {
          ...current,
          state: { status: "error", message: msg.state.message },
          restoringSession: false,
          stoppingWaitIds: [],
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

      if (msg.type === "workSessionWaitersPatch") {
        if (current.state.status !== "ready") return current;
        const activeWaitIds = new Set(msg.waiters.map((w) => w.waitId));
        return {
          ...current,
          stoppingWaitIds: current.stoppingWaitIds.filter((id) => activeWaitIds.has(id)),
          state: {
            status: "ready",
            data: {
              ...current.state.data,
              waiters: msg.waiters,
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

      if (msg.type === "sessionConnectPromptCopied") {
        return {
          ...current,
          connectCopied: true,
        };
      }

      if (msg.type === "sessionPanelExpanded") {
        return {
          ...current,
          panelExpanded: msg.expanded,
        };
      }

      if (msg.type === "sessionUiStatePatch") {
        if (current.state.status !== "ready") return { ...current, restoringSession: false };
        if (current.state.data.sessionId !== msg.sessionId) return { ...current, restoringSession: false };
        return {
          ...current,
          restoringSession: false,
          state: {
            status: "ready",
            data: {
              ...current.state.data,
              uiState: msg.uiState,
            },
          },
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
        if (msg.action === "stopSessionWaiter") {
          return {
            ...current,
            stoppingWaitIds: [],
            actionError: msg.message,
          };
        }
        return {
          ...current,
          restoringSession: false,
          actionError: msg.message,
        };
      }

      if (msg.type === "error") {
        return {
          ...current,
          restoringSession: false,
          state: { status: "error", message: msg.message },
        };
      }

      return current;
    }

    default:
      return current;
  }
}

const ZONE_HELPERS = {
  working: "",
  references: "Supporting material for this session.",
  archived: "Artifacts set aside within this session.",
} as const;

const INSTRUCTIONS_HELPER = "Rules, workflows, and other guidance for AI in this session.";

export function formatArtifactDate(updatedAt: string, createdAt?: string): string {
  const isUpdated = Boolean(createdAt && updatedAt && createdAt !== updatedAt);
  const targetDateStr = isUpdated ? updatedAt : (createdAt || updatedAt);
  const prefix = isUpdated ? "Updated" : "Created";
  try {
    const d = new Date(targetDateStr);
    if (isNaN(d.getTime())) return `${prefix}: ${targetDateStr}`;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${prefix}: ${y}/${m}/${day}`;
  } catch {
    return `${prefix}: ${targetDateStr}`;
  }
}

export function formatArtifactHoverInfo(artifact: WorkSessionArtifactRow): string {
  const dateText = formatArtifactDate(artifact.updatedAt, artifact.createdAt);
  const statusOrKind = artifact.unavailable
    ? "Unavailable"
    : `Type: ${formatArtifactKindLabel(artifact.kind)}`;
  const parts = [artifact.title];
  if (artifact.description) {
    parts.push(artifact.description);
  }
  parts.push(`${statusOrKind} · ${dateText}`);
  return parts.join("\n");
}

export function formatWaiterHoverInfo(waiter: WorkSessionWaiterItem): string {
  const summary = `${waiter.name} waiting for ${waiter.waitingFor}`;
  if (waiter.artifact) {
    return `${summary}\nArtifact: ${waiter.artifact.title}`;
  }
  return summary;
}

export function computeWaitersPopoverPosition(
  button: { getBoundingClientRect?: () => { left: number; bottom: number } } | null | undefined,
  viewport?: { innerWidth: number; innerHeight: number },
): { top: number; left: number } | undefined {
  if (!button || typeof button.getBoundingClientRect !== "function") return undefined;
  const vw = viewport?.innerWidth ?? (typeof window !== "undefined" ? window.innerWidth : 0);
  const vh = viewport?.innerHeight ?? (typeof window !== "undefined" ? window.innerHeight : 0);
  const rect = button.getBoundingClientRect();
  const maxWidth = Math.min(360, Math.max(240, vw - 16));
  const left = Math.max(8, Math.min(rect.left, vw - maxWidth - 8));
  const top = Math.min(rect.bottom + 4, Math.max(8, vh - 120));
  return { top: Math.round(top), left: Math.round(left) };
}

export function SessionApp({
  initialState,
  initialPanelExpanded = true,
  initialWaitingRoomOpen = false,
}: SessionAppProps = {}) {
  const [managerState, dispatch] = useReducer(
    sessionManagerReducer,
    createInitialSessionManagerState(initialState, initialPanelExpanded),
  );
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [waitingRoomOpen, setWaitingRoomOpen] = useState(initialWaitingRoomOpen);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | undefined>(
    undefined,
  );
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const waitingRoomRef = useRef<HTMLDivElement>(null);
  const waitingRoomBtnRef = useRef<HTMLButtonElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");

  const {
    state,
    artifactAutoOpen,
    panelExpanded,
    draftInstructions,
    savingInstructions,
    restoringSession,
    stoppingWaitIds,
    instructionsError,
    actionError,
    activeCardMenuId,
    connectCopied,
  } = managerState;

  useEffect(() => {
    if (connectCopied) {
      const timer = setTimeout(() => {
        dispatch({ type: "setConnectCopied", copied: false });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [connectCopied]);

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

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [moreMenuOpen]);

  useEffect(() => {
    if (!waitingRoomOpen) {
      setPopoverPosition(undefined);
      return;
    }

    const updatePosition = () => {
      const nextPos = computeWaitersPopoverPosition(waitingRoomBtnRef.current);
      if (nextPos) {
        setPopoverPosition(nextPos);
      }
    };

    const handleClick = (e: MouseEvent) => {
      if (waitingRoomRef.current && !waitingRoomRef.current.contains(e.target as Node)) {
        setWaitingRoomOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setWaitingRoomOpen(false);
      }
    };

    updatePosition();
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [waitingRoomOpen]);

  const distinctKinds = useMemo(() => {
    if (state.status !== "ready") return [];
    const allItems = [
      ...state.data.working,
      ...state.data.references,
      ...state.data.archived,
    ];
    const set = new Set<string>();
    for (const item of allItems) {
      if (item.kind && !item.unavailable) {
        set.add(item.kind);
      }
    }
    return Array.from(set).sort();
  }, [state]);

  useEffect(() => {
    if (kindFilter !== "all" && !distinctKinds.includes(kindFilter)) {
      setKindFilter("all");
    }
  }, [distinctKinds, kindFilter]);

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

  const handleRestoreSession = () => {
    dispatch({ type: "startRestoreSession" });
    vscode.postMessage({ type: "restoreSession" });
  };

  const handleArchiveSession = () => {
    setMoreMenuOpen(false);
    vscode.postMessage({ type: "archiveSession" });
  };

  const handleDeleteSession = () => {
    setMoreMenuOpen(false);
    vscode.postMessage({ type: "deleteSession" });
  };

  const handleExportSession = () => {
    setMoreMenuOpen(false);
    vscode.postMessage({ type: "exportSession" });
  };

  const handleRenameArtifact = (artifactId: string) => {
    dispatch({ type: "setActiveCardMenu", menuId: undefined });
    vscode.postMessage({ type: "renameArtifact", artifactId });
  };

  const handleChangeArtifactType = (artifactId: string) => {
    dispatch({ type: "setActiveCardMenu", menuId: undefined });
    vscode.postMessage({ type: "changeArtifactType", artifactId });
  };

  const isFiltered = searchQuery.trim().length > 0 || kindFilter !== "all";

  const filterItems = (items: readonly WorkSessionArtifactRow[]) => {
    const query = normalizeArtifactTitleSearch(searchQuery);
    return items.filter((item) => {
      if (kindFilter !== "all") {
        if (item.unavailable || item.kind !== kindFilter) {
          return false;
        }
      }
      if (query) {
        const titleNorm = normalizeArtifactTitleSearch(item.title);
        const idNorm = normalizeArtifactTitleSearch(item.artifactId);
        if (!titleNorm.includes(query) && !idNorm.includes(query)) {
          return false;
        }
      }
      return true;
    });
  };

  const handleTogglePanel = () => {
    const next = !panelExpanded;
    dispatch({ type: "togglePanel" });
    vscode.postMessage({ type: "setSessionPanelExpanded", expanded: next });
  };

  const handleSelectType = () => {
    vscode.postMessage({ type: "selectSessionType" });
  };

  const handleCopyConnectPrompt = () => {
    vscode.postMessage({ type: "copySessionConnectPrompt" });
  };

  const handleOpenInstructionsFile = () => {
    vscode.postMessage({ type: "openSessionInstructionsFile" });
  };

  const handleAddArtifact = () => {
    setWaitingRoomOpen(false);
    vscode.postMessage({ type: "addSessionArtifact" });
  };

  const handleStopWaiter = (waitId: string) => {
    dispatch({ type: "startStopWaiter", waitId });
    vscode.postMessage({ type: "stopSessionWaiter", waitId });
  };

  const waiters = data.waiters ?? [];

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
    rawItems: readonly WorkSessionArtifactRow[],
  ) => {
    const visibleItems = filterItems(rawItems);

    return (
      <section className={`session-zone session-zone-${zoneKey}`}>
        <div className="session-zone-header">
          <div className="session-zone-header-row">
            <h4>
              {title}{" "}
              <span className="session-zone-count">
                {isFiltered ? `(${visibleItems.length}/${rawItems.length})` : `(${rawItems.length})`}
              </span>
            </h4>
            {zoneKey === "working" && (
              <div className="session-zone-header-actions">
                <button
                  type="button"
                  className="secondary session-add-artifact-btn"
                  title="Add Artifact"
                  aria-label="Add Artifact"
                  onClick={handleAddArtifact}
                >
                  <span className="session-add-artifact-icon" aria-hidden="true">＋</span>
                  <span>Add Artifact</span>
                </button>
                <div className="session-waiting-room-anchor" ref={waitingRoomRef}>
                  <button
                    ref={waitingRoomBtnRef}
                    type="button"
                    className={`secondary session-waiting-room-btn${waiters.length > 0 ? " has-waiters" : ""}`}
                    title="View agents waiting in this session"
                    aria-label={`Waiting room (${waiters.length})`}
                    aria-expanded={waitingRoomOpen}
                    aria-haspopup="dialog"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "setActiveCardMenu", menuId: undefined });
                      setMoreMenuOpen(false);
                      if (!waitingRoomOpen) {
                        setPopoverPosition(computeWaitersPopoverPosition(waitingRoomBtnRef.current));
                        setWaitingRoomOpen(true);
                      } else {
                        setWaitingRoomOpen(false);
                      }
                    }}
                  >
                    <span>Waiting room ({waiters.length})</span>
                  </button>
                  {waitingRoomOpen && (
                    <div
                      className="session-waiters-popover"
                      role="dialog"
                      aria-label="Waiting room"
                      style={
                        popoverPosition
                          ? { top: `${popoverPosition.top}px`, left: `${popoverPosition.left}px` }
                          : undefined
                      }
                      onClick={(e) => e.stopPropagation()}
                    >
                      {waiters.length === 0 ? (
                        <div className="session-waiters-empty">
                          <div className="session-waiters-empty-title">Waiting Room</div>
                          <p className="session-waiters-empty-desc">
                            Let connected agents stay on standby in this session so another agent can hand off work to them across chats:
                          </p>
                          <ol className="session-waiters-empty-steps">
                            <li>
                              Ask an agent in this session to <strong>wait in the waiting room</strong> (for example:{" "}
                              <em>&ldquo;Wait in this session for code review&rdquo;</em>).
                            </li>
                            <li>
                              Later, ask another agent in this session to <strong>wake that waiting agent</strong> with a
                              message to run the next task.
                            </li>
                          </ol>
                        </div>
                      ) : (
                        <ul className="session-waiters-list">
                          {waiters.map((waiter) => {
                            const isStopping = stoppingWaitIds.includes(waiter.waitId);
                            return (
                              <li
                                key={waiter.waitId}
                                className="session-waiter-item"
                                title={formatWaiterHoverInfo(waiter)}
                              >
                                <span className="session-waiter-text">
                                  <strong>{waiter.name}</strong> waiting for {waiter.waitingFor}
                                </span>
                                <button
                                  type="button"
                                  className="secondary session-waiter-stop-btn"
                                  disabled={isStopping}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStopWaiter(waiter.waitId);
                                  }}
                                >
                                  {isStopping ? "Stopping..." : "Stop"}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {ZONE_HELPERS[zoneKey] ? (
            <div className="session-zone-helper">{ZONE_HELPERS[zoneKey]}</div>
          ) : null}
        </div>
        {zoneKey === "working" && (
          <div className="session-filter-bar">
            <input
              type="text"
              className="session-filter-search"
              placeholder="Filter artifacts in session..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Filter artifacts by title"
            />
            <select
              className="session-filter-select"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              aria-label="Filter by type"
            >
              <option value="all">All Types</option>
              {distinctKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {formatArtifactKindLabel(kind)}
                </option>
              ))}
            </select>
          </div>
        )}
        {visibleItems.length === 0 ? (
          <div className="session-zone-empty">
            {isFiltered ? "No matching artifacts" : "No artifacts in this zone"}
          </div>
        ) : (
          <div className="session-artifact-list">
            {visibleItems.map((artifact) => {
              const isMenuOpen = activeCardMenuId === artifact.artifactId;
              const rawIndex = rawItems.findIndex((it) => it.artifactId === artifact.artifactId);
              const isFirst = rawIndex === 0;
              const isLast = rawIndex === rawItems.length - 1;
              const isCompactZone = zoneKey === "references" || zoneKey === "archived";

              return (
                <div
                  key={artifact.artifactId}
                  data-artifact-id={artifact.artifactId}
                  className={`session-artifact-card ${artifact.unavailable ? "session-artifact-card-unavailable" : ""}`}
                  title={isCompactZone ? formatArtifactHoverInfo(artifact) : undefined}
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
                      {artifact.unavailable && (
                        <span className="session-card-unavailable-badge">Unavailable</span>
                      )}
                    </div>
                    <div
                      className="session-card-menu-anchor"
                      title=""
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="session-card-menu-btn"
                        title="Artifact options"
                        onClick={() => {
                          setWaitingRoomOpen(false);
                          dispatch({
                            type: "setActiveCardMenu",
                            menuId: isMenuOpen ? undefined : artifact.artifactId,
                          });
                        }}
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
                          <div className="session-dropdown-header">Artifact</div>
                          <button
                            type="button"
                            className="session-dropdown-item"
                            onClick={() => handleRenameArtifact(artifact.artifactId)}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="session-dropdown-item"
                            onClick={() => handleChangeArtifactType(artifact.artifactId)}
                          >
                            Change Type
                          </button>
                          <div className="session-dropdown-divider" />
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
                  {zoneKey === "working" && artifact.description && (
                    <div className="session-card-description">{artifact.description}</div>
                  )}
                  <div className="session-card-meta">
                    <span className="session-card-updated">
                      {formatArtifactDate(artifact.updatedAt, artifact.createdAt)}
                    </span>
                    {!artifact.unavailable && (
                      <span className="session-card-kind-badge">{formatArtifactKindLabel(artifact.kind)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const isArchived = Boolean(data.uiState?.archivedAt);

  return (
    <div className="session-app-container" data-panel-expanded={panelExpanded ? "true" : "false"}>
      <header className="session-header">
        <div className="session-header-top">
          <div className="session-title-row">
            {isArchived && <span className="session-archived-badge">Archived</span>}
            <h2 className="session-title" title={data.title}>
              {data.title}
            </h2>
            {!isArchived && (
              <button
                type="button"
                className="session-icon-button"
                title="Rename session"
                onClick={handleRenameSession}
                aria-label="Rename session"
              >
                ✎
              </button>
            )}
          </div>
          {isArchived ? (
            <div className="session-header-actions">
              <button
                type="button"
                className="primary session-header-btn session-restore-btn"
                disabled={restoringSession}
                onClick={handleRestoreSession}
              >
                {restoringSession ? "Restoring..." : "Restore"}
              </button>
            </div>
          ) : (
            <div className="session-header-actions">
              <button
                type="button"
                className={`primary session-header-btn session-connect-btn${connectCopied ? " copied" : ""}`}
                onClick={handleCopyConnectPrompt}
                title={connectCopied ? "Copied!" : "Copy session connect prompt for AI assistant"}
                aria-label={connectCopied ? "Session connect prompt copied" : "Copy session connect prompt"}
              >
                {connectCopied ? (
                  <>
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path
                        d="m2.5 8 3.25 3.25 7.75-7.75"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path
                        d="m6.1 9.9-1.2 1.2a2.83 2.83 0 0 1-4-4l2.2-2.2a2.83 2.83 0 0 1 4 0"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                      <path
                        d="m9.9 6.1 1.2-1.2a2.83 2.83 0 0 1 4 4l-2.2 2.2a2.83 2.83 0 0 1-4 0"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                      <path d="m5.6 10.4 4.8-4.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    <span>Connect</span>
                  </>
                )}
              </button>
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
              <div className="session-header-more-anchor" ref={moreMenuRef}>
                <button
                  type="button"
                  className="session-icon-button session-more-btn"
                  title="Settings"
                  aria-label="Settings"
                  aria-expanded={moreMenuOpen}
                  onClick={() => {
                    setWaitingRoomOpen(false);
                    setMoreMenuOpen(!moreMenuOpen);
                  }}
                >
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                    <path d="m9.5 3-.6 2.1-1.8 1-2.1-.5-2.5 4.3 1.5 1.6v2l-1.5 1.6L5 19.4l2.1-.5 1.8 1 .6 2.1h5l.6-2.1 1.8-1 2.1.5 2.5-4.3-1.5-1.6v-2l1.5-1.6L19 5.6l-2.1.5-1.8-1-.6-2.1z" />
                    <circle cx="12" cy="12.5" r="3" />
                  </svg>
                </button>
                {moreMenuOpen && (
                  <div className="session-card-dropdown session-header-dropdown" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="session-dropdown-item"
                      disabled={!artifactAutoOpen?.configuredEnabled}
                      title={artifactAutoOpen?.configuredEnabled === false
                        ? "Auto-open is disabled in IDE settings"
                        : artifactAutoOpen ? "Change auto-open temporarily for this window" : "Loading auto-open setting"}
                      onClick={() => {
                        if (!artifactAutoOpen) return;
                        vscode.postMessage({ type: "setArtifactAutoOpen", enabled: !artifactAutoOpen.enabled });
                        setMoreMenuOpen(false);
                      }}
                    >
                      {artifactAutoOpen?.enabled ? "Turn off auto-open artifact" : "Turn on auto-open artifact"}
                    </button>
                    <div className="session-dropdown-divider" />
                    <button
                      type="button"
                      className="session-dropdown-item"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        handleRenameSession();
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="session-dropdown-item"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        handleSelectType();
                      }}
                    >
                      Change Type
                    </button>
                    <div className="session-dropdown-divider" />
                    <button
                      type="button"
                      className="session-dropdown-item"
                      onClick={handleExportSession}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="session-dropdown-item"
                      onClick={handleArchiveSession}
                    >
                      Archive
                    </button>
                    <button
                      type="button"
                      className="session-dropdown-item session-dropdown-item-danger"
                      onClick={handleDeleteSession}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
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
            <div className="session-type-section">
              <h4>Session Type</h4>
              <button
                type="button"
                className="session-type-chip-btn"
                title="Change session type"
                onClick={handleSelectType}
                aria-label="Change session type"
              >
                <span className="session-type-chip-label">{data.typeLabel}</span>
                <span className="session-type-chip-icon" aria-hidden="true">✎</span>
              </button>
            </div>

            {/* 2. Instructions Section */}
            <div className="session-side-section session-instructions-section">
              <div className="session-side-section-header">
                <h4>Instructions</h4>
                <div className="session-instructions-actions">
                  <button
                    type="button"
                    className="secondary session-open-instructions-btn"
                    onClick={handleOpenInstructionsFile}
                    title="Open instructions Markdown file in editor"
                  >
                    Open Markdown File
                  </button>
                  <button
                    type="button"
                    className="primary session-save-btn"
                    onClick={handleSaveInstructions}
                    disabled={savingInstructions || draftInstructions === data.instructions}
                  >
                    {savingInstructions ? "Saving..." : "Save"}
                  </button>
                </div>
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
              <div className="session-zone-helper">{INSTRUCTIONS_HELPER}</div>
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
