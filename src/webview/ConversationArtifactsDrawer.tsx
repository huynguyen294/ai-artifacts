import { useEffect, useState, type ReactNode } from "react";
import type { ConversationArtifactGroup, ConversationArtifactsViewState } from "../shared/contracts";

export type ConversationArtifactsDrawerProps = {
  open: boolean;
  state: ConversationArtifactsViewState;
  onClose: () => void;
  onOpenArtifact: (artifactId: string) => void;
};

export function reconcileExpandedGroupIds(
  prevExpandedIds: Set<string>,
  groups: ConversationArtifactGroup[],
): Set<string> {
  const validGroupIds = new Set(groups.map((g) => g.artifactConversationId));
  const filtered = new Set([...prevExpandedIds].filter((id) => validGroupIds.has(id)));
  if (filtered.size === 0 && groups.length > 0) {
    const firstId = groups[0]?.artifactConversationId;
    return firstId ? new Set([firstId]) : filtered;
  }
  return filtered;
}

export function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function ConversationArtifactsDrawer({
  open,
  state,
  onClose,
  onOpenArtifact,
}: ConversationArtifactsDrawerProps): ReactNode {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    reconcileExpandedGroupIds(new Set(), state.status === "ready" ? state.groups : []),
  );

  useEffect(() => {
    if (state.status !== "ready") return;
    setExpandedIds((prev) => reconcileExpandedGroupIds(prev, state.groups));
  }, [state]);

  if (!open) return null;

  const toggleGroup = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <>
      <button
        className="drawer-backdrop"
        aria-label="Close conversation artifacts"
        onClick={onClose}
      />
      <aside
        id="conversation-artifacts-drawer"
        className="conversations-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Conversation artifacts"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="drawer-heading">
          <div>
            <h2>Conversations</h2>
            <p>Artifacts in related conversations.</p>
          </div>
          <button
            autoFocus
            className="icon-button"
            aria-label="Close conversation artifacts"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="conversation-drawer-content">
          {state.status === "loading" && (
            <div className="conversation-drawer-loading">
              <p>Loading conversations…</p>
            </div>
          )}

          {state.status === "error" && (
            <div className="conversation-drawer-error" role="alert">
              <p>{state.message}</p>
            </div>
          )}

          {state.status === "ready" && state.groups.length === 0 && (
            <p className="empty">No conversations found for this artifact.</p>
          )}

          {state.status === "ready" && state.groups.length > 0 && (
            <div className="conversation-accordion-list">
              {state.groups.map((group) => {
                const isExpanded = expandedIds.has(group.artifactConversationId);
                const contentId = `conversation-group-${group.artifactConversationId}`;
                const headerId = `conversation-header-${group.artifactConversationId}`;

                return (
                  <section className="conversation-group" key={group.artifactConversationId}>
                    <button
                      id={headerId}
                      className="conversation-group-header"
                      aria-expanded={isExpanded}
                      aria-controls={contentId}
                      onClick={() => toggleGroup(group.artifactConversationId)}
                    >
                      <svg
                        className={`conversation-group-chevron${isExpanded ? " expanded" : ""}`}
                        aria-hidden="true"
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M6 4l4 4-4 4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="conversation-group-name" title={group.conversationName}>
                        {group.conversationName}
                      </span>
                      <span
                        className="conversation-count-badge"
                        aria-label={`${group.artifacts.length} artifacts`}
                      >
                        {group.artifacts.length}
                      </span>
                    </button>

                    {isExpanded && (
                      <ul
                        id={contentId}
                        className="conversation-item-list"
                        role="region"
                        aria-labelledby={headerId}
                      >
                        {group.artifacts.map((artifact) => {
                          const isCurrent = artifact.isCurrent;
                          return (
                            <li
                              key={artifact.artifactId}
                              className={`conversation-item-card${isCurrent ? " current" : ""}`}
                            >
                              <button
                                className={`conversation-artifact-button${isCurrent ? " current" : ""}`}
                                disabled={isCurrent}
                                aria-current={isCurrent ? "page" : undefined}
                                title={isCurrent ? `${artifact.title} (current)` : `Open ${artifact.title}`}
                                onClick={() => {
                                  if (!isCurrent) {
                                    onOpenArtifact(artifact.artifactId);
                                  }
                                }}
                              >
                                <div className="conversation-artifact-meta">
                                  <span className="conversation-kind-badge">{artifact.kind}</span>
                                  <time
                                    className="conversation-timestamp"
                                    dateTime={artifact.registeredAt}
                                  >
                                    {formatTimestamp(artifact.registeredAt)}
                                  </time>
                                </div>
                                <span className="conversation-artifact-title">{artifact.title}</span>
                                {isCurrent && (
                                  <span className="conversation-current-badge">Current</span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
