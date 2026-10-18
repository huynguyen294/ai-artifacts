import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  ARTIFACT_ROOT_BLOCK_ID,
  ARTIFACT_ROOT_BLOCK_TYPE,
  ARTIFACT_ROOT_TEXT,
} from "../shared/contracts";
import type {
  ExtensionToWebviewMessage,
  MarkdownBlock,
  ReviewComment,
  ReviewDecision,
  ReviewState,
  SendStatus,
  ConversationArtifactsViewState,
} from "../shared/contracts";
import { vscode } from "./vscode-api";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SelectionCommentPopover, type SelectionDraft } from "./SelectionCommentPopover";
import { CommentDetailPopover } from "./CommentDetailPopover";
import { CommentsDrawer } from "./CommentsDrawer";
import { ConversationArtifactsDrawer } from "./ConversationArtifactsDrawer";
import { trapFocusInContainer } from "./focus-trap";
import { deriveReviewActions } from "./review-actions";

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function effectiveNode(node: Node, offset: number, isEnd: boolean): Node {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const index = isEnd ? Math.max(0, offset - 1) : offset;
    return element.childNodes[Math.min(index, Math.max(0, element.childNodes.length - 1))] ?? element;
  }
  if (isEnd && offset === 0 && node.previousSibling) return node.previousSibling;
  return node;
}

function normalizedInlineText(value: string, trimEnd = true): string {
  const normalized = value.replace(/\s+/g, " ").trimStart();
  return trimEnd ? normalized.trimEnd() : normalized;
}

function nearestOccurrence(text: string, quote: string, expected: number): number {
  let nearest = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = text.indexOf(quote); index !== -1; index = text.indexOf(quote, index + 1)) {
    const candidateDistance = Math.abs(index - expected);
    if (candidateDistance < distance) {
      nearest = index;
      distance = candidateDistance;
    }
  }
  return nearest;
}

function captureSelection(blocks: Map<string, MarkdownBlock>): { draft: SelectionDraft | null; isCrossBlock: boolean } {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
    return { draft: null, isCrossBlock: selection?.rangeCount !== 1 };
  }
  const range = selection.getRangeAt(0);
  const startNode = effectiveNode(range.startContainer, range.startOffset, false);
  const endNode = effectiveNode(range.endContainer, range.endOffset, true);
  const startBlock = elementOf(startNode)?.closest<HTMLElement>("[data-block-id]");
  const endBlock = elementOf(endNode)?.closest<HTMLElement>("[data-block-id]");
  if (!startBlock) return { draft: null, isCrossBlock: false };
  if (endBlock && endBlock !== startBlock) {
    // Browsers may report the range end as offset zero inside the next block.
    // Treat it as cross-block only when text from that block is actually selected.
    const endPrefix = range.cloneRange();
    try {
      endPrefix.selectNodeContents(endBlock);
      endPrefix.setEnd(range.endContainer, range.endOffset);
      if (endPrefix.toString().trim().length > 0) return { draft: null, isCrossBlock: true };
    } catch {
      return { draft: null, isCrossBlock: true };
    }
  }

  const blockId = startBlock.dataset.blockId ?? "";
  const block = blocks.get(blockId);
  if (!block) return { draft: null, isCrossBlock: false };
  const rawQuote = selection.toString();
  const preserveWhitespace = block.type === "code";
  const quote = preserveWhitespace ? rawQuote.replace(/[\r\n]+$/, "") : normalizedInlineText(rawQuote);
  if (!quote.trim()) return { draft: null, isCrossBlock: false };

  const prefix = range.cloneRange();
  prefix.selectNodeContents(startBlock);
  prefix.setEnd(range.startContainer, range.startOffset);
  const expectedStart = preserveWhitespace
    ? prefix.toString().length
    : normalizedInlineText(prefix.toString(), false).length;
  let start = expectedStart;
  if (block.text.slice(start, start + quote.length) !== quote) {
    start = nearestOccurrence(block.text, quote, expectedStart);
  }
  if (start < 0) return { draft: null, isCrossBlock: false };

  return {
    draft: {
      blockId,
      quote,
      start,
      end: start + quote.length,
      range: range.cloneRange(),
      contextElement: startBlock,
    },
    isCrossBlock: false,
  };
}

export function App(): ReactNode {
  const [state, setState] = useState<ReviewState>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [body, setBody] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [conversationsDrawerOpen, setConversationsDrawerOpen] = useState(false);
  const [conversationState, setConversationState] = useState<ConversationArtifactsViewState>({ status: "loading" });
  const [activeComment, setActiveComment] = useState<{ id: string; anchor: HTMLElement }>();
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [sendMessage, setSendMessage] = useState<string>();
  const [submittingDecision, setSubmittingDecision] = useState<ReviewDecision>();
  const [copied, setCopied] = useState(false);
  const [connectPromptCopied, setConnectPromptCopied] = useState(false);
  const reviewRoundRef = useRef<number | undefined>(undefined);
  const generalFeedbackButtonRef = useRef<HTMLButtonElement>(null);
  const conversationsButtonRef = useRef<HTMLButtonElement>(null);
  const commentsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const listener = (event: MessageEvent<ExtensionToWebviewMessage>): void => {
      const message = event.data;
      if (message.type === "state") {
        const roundChanged =
          reviewRoundRef.current !== undefined && reviewRoundRef.current !== message.state.artifact.reviewRound;
        reviewRoundRef.current = message.state.artifact.reviewRound;
        setState(message.state);
        setError(undefined);
        if (roundChanged) {
          setDraft(null);
          setBody("");
          setDrawerOpen(false);
          setConversationsDrawerOpen(false);
          setActiveComment(undefined);
          window.getSelection()?.removeAllRanges();
        }
        if (message.state.submission) {
          setSendStatus("submitted");
          setSubmittingDecision(undefined);
          setSendMessage(
            message.state.submission.decision === "revise"
              ? "Review comments returned to the waiting AI turn."
              : message.state.submission.decision === "save"
                ? undefined
                : "Artifact approved. Return to the AI chat to continue.",
          );
        } else {
          setSendStatus("idle");
          setSendMessage(undefined);
        }
      } else if (message.type === "conversationArtifactsState") {
        setConversationState(message.state);
      } else if (message.type === "sendState") {
        setSendStatus(message.status);
        setSendMessage(message.message);
        if (message.status !== "submitting") setSubmittingDecision(undefined);
      } else if (message.type === "artifactConnectPromptCopied") {
        setConnectPromptCopied(true);
        window.setTimeout(() => setConnectPromptCopied(false), 1600);
      } else if (message.type === "error") {
        setError(message.message);
      }
    };
    window.addEventListener("message", listener);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, []);

  const blocksById = useMemo(() => new Map(state?.blocks.map((block) => [block.id, block]) ?? []), [state]);
  const commentsByBlock = useMemo(() => {
    const result = new Map<string, ReviewComment[]>();
    for (const comment of state?.comments.comments ?? []) {
      if (comment.block.type === ARTIFACT_ROOT_BLOCK_TYPE) continue;
      const comments = result.get(comment.block.id) ?? [];
      comments.push(comment);
      result.set(comment.block.id, comments);
    }
    return result;
  }, [state]);

  const openComment = useCallback((commentId: string, anchor: HTMLElement): void => {
    setActiveComment({ id: commentId, anchor });
  }, []);

  const beginComment = (event: ReactMouseEvent<HTMLElement>): void => {
    const selection = window.getSelection();
    if (selection?.isCollapsed && (event.target as Element).closest("button, a, textarea, [data-comment-ids]")) {
      return;
    }
    const captured = captureSelection(blocksById);
    if (captured.isCrossBlock) {
      setError("Select text inside one paragraph, heading, list item, quote, code block, or table cell.");
      return;
    }
    if (!captured.draft) return;
    setDraft(captured.draft);
    setBody("");
    setActiveComment(undefined);
    setError(undefined);
  };

  const beginGeneralFeedback = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    setDraft({
      blockId: ARTIFACT_ROOT_BLOCK_ID,
      quote: ARTIFACT_ROOT_TEXT,
      start: 0,
      end: ARTIFACT_ROOT_TEXT.length,
      contextElement: event.currentTarget,
    });
    setBody("");
    setActiveComment(undefined);
    setError(undefined);
    window.getSelection()?.removeAllRanges();
  };

  const submitComment = (): void => {
    if (!draft || !body.trim()) return;
    vscode.postMessage({
      type: "addComment",
      blockId: draft.blockId,
      selection: { quote: draft.quote, start: draft.start, end: draft.end },
      body,
    });
    setDraft(null);
    setBody("");
    window.getSelection()?.removeAllRanges();
  };

  const removeComment = (commentId: string): void => {
    setActiveComment(undefined);
    vscode.postMessage({ type: "removeComment", commentId });
  };

  const jumpToComment = (comment: ReviewComment): void => {
    if (comment.block.type === ARTIFACT_ROOT_BLOCK_TYPE) {
      const anchor = generalFeedbackButtonRef.current;
      if (!anchor) return;
      anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      anchor.focus({ preventScroll: true });
      setActiveComment({ id: comment.id, anchor });
      setDrawerOpen(false);
      return;
    }
    const mark = [...document.querySelectorAll<HTMLElement>("[data-comment-ids]")].find((element) =>
      element.dataset.commentIds?.split(",").includes(comment.id),
    );
    if (!mark) return;
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    mark.focus({ preventScroll: true });
    setActiveComment({ id: comment.id, anchor: mark });
    setDrawerOpen(false);
  };

  const submitDecision = (decision: ReviewDecision): void => {
    setSubmittingDecision(decision);
    vscode.postMessage({ type: "submitReview", decision });
  };

  const copyMarkdown = async (): Promise<void> => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Failed to copy Markdown to clipboard.");
    }
  };

  const openConversationsDrawer = useCallback((): void => {
    setConversationsDrawerOpen(true);
    if (typeof window !== "undefined" && window.innerWidth < 1100) {
      setDrawerOpen(false);
    }
  }, []);

  const closeConversationsDrawer = useCallback((): void => {
    setConversationsDrawerOpen(false);
    conversationsButtonRef.current?.focus();
  }, []);

  const openCommentsDrawer = useCallback((): void => {
    setDrawerOpen(true);
    if (typeof window !== "undefined" && window.innerWidth < 1100) {
      setConversationsDrawerOpen(false);
    }
  }, []);

  const closeCommentsDrawer = useCallback((): void => {
    setDrawerOpen(false);
    commentsButtonRef.current?.focus();
  }, []);

  const handleOpenArtifact = useCallback((artifactId: string): void => {
    vscode.postMessage({ type: "openConversationArtifact", artifactId });
  }, []);

  useEffect(() => {
    if (!drawerOpen && !conversationsDrawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const activeDrawerId = conversationsDrawerOpen
        ? "conversation-artifacts-drawer"
        : drawerOpen
          ? "artifact-comments-drawer"
          : null;
      if (!activeDrawerId) return;
      const container = document.getElementById(activeDrawerId);
      if (container) {
        trapFocusInContainer(container, event);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen, conversationsDrawerOpen]);

  if (!state) return <main className="loading">{error ?? "Loading artifact…"}</main>;

  const comments = state.comments.comments;
  const isSubmitting = sendStatus === "submitting";
  const isSubmitted = Boolean(state.submission) || sendStatus === "submitted";
  const hasUnsavedComment = Boolean(draft && body.trim());
  const actions = deriveReviewActions({
    commentCount: comments.length,
    isSubmitting,
    isSubmitted,
    hasUnsavedComment,
    lifecycleReadOnly: state.lifecycle.readOnly,
    ...(submittingDecision ? { submittingDecision } : {}),
  });
  const selectedComment = activeComment ? comments.find((comment) => comment.id === activeComment.id) : undefined;
  const blockedTitle = state.lifecycle.readOnly
    ? state.lifecycle.message
    : hasUnsavedComment
      ? "Save or cancel the comment draft first."
      : undefined;
  const totalConversationArtifacts = conversationState.status === "ready"
    ? conversationState.groups.reduce((sum, g) => sum + g.artifacts.length, 0)
    : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="artifact-heading">
          <span className="eyebrow">
            {state.artifact.kind.toUpperCase()} · ROUND {state.artifact.reviewRound}
          </span>
          <h1>{state.artifact.title}</h1>
        </div>
        <div className="topbar-actions">
          <div className="topbar-icon-actions">
            <button
              className={`icon-button copy-button${copied ? " copied" : ""}`}
              onClick={() => void copyMarkdown()}
              aria-label={copied ? "Markdown copied" : "Copy Markdown"}
              title={copied ? "Copied!" : "Copy Markdown"}
            >
              {copied ? (
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="m2.5 8 3.25 3.25 7.75-7.75"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                  <path
                    d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                </svg>
              )}
            </button>
            <button
              className="icon-button copy-button"
              disabled={actions.save.disabled}
              aria-label={actions.save.label}
              title={blockedTitle ?? actions.save.label}
              onClick={() => submitDecision("save")}
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2.5 2.5h8.9l2.1 2.1v8.9h-11v-11Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <path d="M5 2.5v4h6v-4M5 13.5V9h6v4.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              className={`icon-button copy-button${connectPromptCopied ? " copied" : ""}`}
              onClick={() => vscode.postMessage({ type: "copyArtifactConnectPrompt" })}
              aria-label={connectPromptCopied ? "AI connect prompt copied" : "Copy AI connect prompt"}
              title={connectPromptCopied ? "Copied!" : "Copy AI connect prompt"}
            >
              {connectPromptCopied ? (
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="m2.5 8 3.25 3.25 7.75-7.75"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
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
              )}
            </button>
          </div>
          <button
            className={actions.revise.primary ? "primary" : "ghost"}
            disabled={actions.revise.disabled}
            title={blockedTitle}
            onClick={() => submitDecision("revise")}
          >
            {actions.revise.label}
          </button>
          <button
            className={actions.approve.primary ? "primary" : "ghost"}
            disabled={actions.approve.disabled}
            title={blockedTitle}
            onClick={() => submitDecision("approve")}
          >
            {actions.approve.label}
          </button>
        </div>
      </header>

      {(error || sendMessage || state.lifecycle.message) && (
        <div className={`notice ${sendStatus === "error" || error ? "error" : sendStatus}`}>
          {error ?? sendMessage ?? state.lifecycle.message}
        </div>
      )}

      <nav className="review-utility-bar" aria-label="Artifact review tools">
        <div className="review-utility-bar-left">
          <button
            ref={conversationsButtonRef}
            className="ghost conversations-toggle"
            aria-expanded={conversationsDrawerOpen}
            aria-controls="conversation-artifacts-drawer"
            title={
              totalConversationArtifacts > 0
                ? `View artifacts in this conversation (${totalConversationArtifacts})`
                : "View artifacts in this conversation"
            }
            onClick={openConversationsDrawer}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 4.5h12M2 8h12M2 11.5h8"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            <span>Conversation Artifacts</span>
            {totalConversationArtifacts > 0 && (
              <span
                className="comment-count-badge"
                aria-label={`${totalConversationArtifacts} artifacts`}
              >
                {totalConversationArtifacts}
              </span>
            )}
          </button>
        </div>
        <div className="review-utility-bar-right">
          <button
            ref={generalFeedbackButtonRef}
            className="ghost general-feedback-toggle"
            disabled={isSubmitted || state.lifecycle.readOnly || hasUnsavedComment}
            aria-haspopup="dialog"
            aria-expanded={draft?.blockId === ARTIFACT_ROOT_BLOCK_ID}
            title={isSubmitted
              ? "This artifact review round was already submitted."
              : blockedTitle ?? "Add feedback that applies to the entire artifact"}
            onClick={beginGeneralFeedback}
          >
            General feedback
          </button>
          <button
            ref={commentsButtonRef}
            className="ghost comments-toggle"
            aria-expanded={drawerOpen}
            aria-controls="artifact-comments-drawer"
            title="Open comments panel"
            onClick={openCommentsDrawer}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M2.5 3.75C2.5 2.78 3.28 2 4.25 2h7.5c.97 0 1.75.78 1.75 1.75v5.5c0 .97-.78 1.75-1.75 1.75H7l-3.1 2.4c-.58.45-1.4.04-1.4-.7V3.75Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span>View comments</span>
            <span className="comment-count-badge" aria-label={`${comments.length} comments`}>
              {comments.length}
            </span>
          </button>
        </div>
      </nav>

      <main className="document-workspace">
        <article
          className="artifact-document"
          onMouseUp={isSubmitted || state.lifecycle.readOnly ? undefined : beginComment}
        >
          <MarkdownRenderer
            markdown={state.markdown}
            blocks={state.blocks}
            commentsByBlock={commentsByBlock}
            onCommentClick={openComment}
          />
        </article>
      </main>

      {draft && !isSubmitted && !state.lifecycle.readOnly && (
        <SelectionCommentPopover
          draft={draft}
          body={body}
          onBodyChange={setBody}
          onCancel={() => {
            setDraft(null);
            setBody("");
          }}
          onSubmit={submitComment}
        />
      )}
      {selectedComment && activeComment && (
        <CommentDetailPopover
          comment={selectedComment}
          anchor={activeComment.anchor}
          submitted={isSubmitted || state.lifecycle.readOnly}
          onClose={() => setActiveComment(undefined)}
          onRemove={() => removeComment(selectedComment.id)}
        />
      )}
      <ConversationArtifactsDrawer
        open={conversationsDrawerOpen}
        state={conversationState}
        onClose={closeConversationsDrawer}
        onOpenArtifact={handleOpenArtifact}
      />
      <CommentsDrawer
        open={drawerOpen}
        comments={comments}
        submitted={isSubmitted || state.lifecycle.readOnly}
        onClose={closeCommentsDrawer}
        onJump={jumpToComment}
        onRemove={removeComment}
      />
    </div>
  );
}
