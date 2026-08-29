import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react";
import type {
  ExtensionToWebviewMessage,
  MarkdownBlock,
  ReviewComment,
  ReviewState,
  SendStatus,
} from "../shared/contracts";
import { vscode } from "./vscode-api";

type SelectionDraft = {
  blockId: string;
  quote: string;
  start: number;
  end: number;
};

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

function getEffectiveNode(node: Node, offset: number, isEnd: boolean): Node {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (isEnd) {
      if (offset === 0 && el.previousSibling) {
        return el.previousSibling;
      }
      if (offset > 0 && el.childNodes.length > 0) {
        return el.childNodes[Math.min(offset - 1, el.childNodes.length - 1)] ?? el;
      }
    } else {
      if (el.childNodes.length > 0) {
        return el.childNodes[Math.min(offset, el.childNodes.length - 1)] ?? el;
      }
    }
  } else if (isEnd && offset === 0) {
    if (node.previousSibling) return node.previousSibling;
    if (node.parentElement && node.parentElement.previousSibling) return node.parentElement.previousSibling;
  }
  return node;
}

function captureSelection(): { draft: SelectionDraft | null; isCrossBlock: boolean } {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return { draft: null, isCrossBlock: false };
  const rawQuote = selection.toString();
  if (!rawQuote.trim()) return { draft: null, isCrossBlock: false };

  if (selection.rangeCount !== 1) return { draft: null, isCrossBlock: true };
  const range = selection.getRangeAt(0);

  const startNode = getEffectiveNode(range.startContainer, range.startOffset, false);
  const endNode = getEffectiveNode(range.endContainer, range.endOffset, true);

  const startBlock = elementOf(startNode)?.closest<HTMLElement>("[data-block-id]");
  const endBlock = elementOf(endNode)?.closest<HTMLElement>("[data-block-id]");

  if (!startBlock) return { draft: null, isCrossBlock: false };
  if (endBlock && startBlock !== endBlock) {
    const endPrefix = range.cloneRange();
    try {
      endPrefix.selectNodeContents(endBlock);
      endPrefix.setEnd(range.endContainer, range.endOffset);
      if (endPrefix.toString().trim().length > 0) {
        return { draft: null, isCrossBlock: true };
      }
    } catch {
      return { draft: null, isCrossBlock: true };
    }
  }

  const blockText = startBlock.textContent ?? "";
  const cleanedQuote = rawQuote.replace(/[\r\n]+$/, "").trimEnd();
  if (!cleanedQuote.trim()) return { draft: null, isCrossBlock: false };

  const prefix = range.cloneRange();
  try {
    prefix.selectNodeContents(startBlock);
    prefix.setEnd(range.startContainer, range.startOffset);
  } catch {
    // ignore
  }

  let start = prefix.toString().length;
  let quote = cleanedQuote;

  if (blockText.slice(start, start + quote.length) !== quote) {
    const directIdx = blockText.indexOf(quote);
    if (directIdx !== -1) {
      start = directIdx;
    } else {
      const trimmed = quote.trim();
      const trimmedIdx = blockText.indexOf(trimmed);
      if (trimmedIdx !== -1) {
        start = trimmedIdx;
        quote = trimmed;
      }
    }
  }

  return {
    draft: { blockId: startBlock.dataset.blockId ?? "", quote, start, end: start + quote.length },
    isCrossBlock: false,
  };
}

function highlightedText(block: MarkdownBlock, comments: ReviewComment[]): ReactNode {
  const ranges = comments
    .filter((comment) => comment.block.id === block.id)
    .map((comment) => ({ start: comment.selection.start, end: comment.selection.end }))
    .sort((left, right) => left.start - right.start);
  if (ranges.length === 0) return block.text;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    const start = Math.max(cursor, range.start);
    const end = Math.max(start, range.end);
    if (start > cursor) nodes.push(block.text.slice(cursor, start));
    if (end > start) nodes.push(<mark key={`${start}-${end}-${index}`}>{block.text.slice(start, end)}</mark>);
    cursor = Math.max(cursor, end);
  });
  if (cursor < block.text.length) nodes.push(block.text.slice(cursor));
  return nodes;
}

function ArtifactBlock({ block, comments }: { block: MarkdownBlock; comments: ReviewComment[] }): ReactNode {
  const content = highlightedText(block, comments);
  const common = { "data-block-id": block.id, className: `plan-block ${block.type}` };
  if (block.type === "heading") {
    const level = Math.min(6, Math.max(1, block.level ?? 2));
    const Heading = `h${level}` as ElementType;
    return <Heading {...common}>{content}</Heading>;
  }
  if (block.type === "list-item") return <div {...common} className={`${common.className} list-item`}>{content}</div>;
  if (block.type === "quote") return <blockquote {...common}>{content}</blockquote>;
  if (block.type === "code") return <pre {...common}><code>{content}</code></pre>;
  return <p {...common}>{content}</p>;
}

export function App(): ReactNode {
  const [state, setState] = useState<ReviewState>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [body, setBody] = useState("");
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [sendMessage, setSendMessage] = useState<string>();
  const reviewRoundRef = useRef<number | undefined>(undefined);

  const [copied, setCopied] = useState(false);

  const handleCopyMarkdown = async (): Promise<void> => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy Markdown to clipboard.");
    }
  };

  useEffect(() => {
    const listener = (event: MessageEvent<ExtensionToWebviewMessage>): void => {
      const message = event.data;
      if (message.type === "state") {
        if (reviewRoundRef.current !== undefined && reviewRoundRef.current !== message.state.artifact.reviewRound) {
          setDraft(null);
          setBody("");
          window.getSelection()?.removeAllRanges();
        }
        reviewRoundRef.current = message.state.artifact.reviewRound;
        setState(message.state);
        setError(undefined);
        if (message.state.submission) {
          setSendStatus("submitted");
          const decision = message.state.submission.decision;
          setSendMessage(
            decision === "revise"
              ? "Review comments returned to the waiting Codex turn."
              : decision === "save"
                ? undefined
                : "Artifact approved. Return to the Codex chat to continue.",
          );
        } else {
          setSendStatus("idle");
          setSendMessage(undefined);
        }
      } else if (message.type === "sendState") {
        setSendStatus(message.status);
        setSendMessage(message.message);
      } else if (message.type === "error") {
        setError(message.message);
      }
    };
    window.addEventListener("message", listener);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, []);

  const commentsByBlock = useMemo(() => {
    const result = new Map<string, ReviewComment[]>();
    for (const comment of state?.comments.comments ?? []) {
      const comments = result.get(comment.block.id) ?? [];
      comments.push(comment);
      result.set(comment.block.id, comments);
    }
    return result;
  }, [state]);

  const beginComment = (): void => {
    const { draft: selectionDraft, isCrossBlock } = captureSelection();
    if (isCrossBlock) {
      setError("Select text inside one paragraph, heading, list item, quote, or code block.");
      return;
    }
    if (!selectionDraft) {
      return;
    }
    setDraft(selectionDraft);
    setBody("");
    setError(undefined);
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

  if (!state) {
    return <main className="loading">{error ?? "Loading artifact…"}</main>;
  }

  const isSubmitting = sendStatus === "submitting";
  const isSubmitted = Boolean(state.submission) || sendStatus === "submitted";
  const hasUnsavedComment = Boolean(draft && body.trim());

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">{state.artifact.kind.toUpperCase()} · ROUND {state.artifact.reviewRound}</span>
          <h1>{state.artifact.title}</h1>
        </div>
        <div className="topbar-actions">
          <button
            className={`icon-button copy-button${copied ? " copied" : ""}`}
            onClick={handleCopyMarkdown}
            aria-label={copied ? "Copied" : "Copy Markdown"}
            title={copied ? "Copied!" : "Copy Markdown"}
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5" stroke="currentColor" strokeWidth="1.2"/></svg>
            )}
          </button>
          <span className="comment-count">{state.comments.comments.length} comments</span>
          <button
            className="ghost"
            disabled={isSubmitting || isSubmitted || hasUnsavedComment}
            title={hasUnsavedComment ? "Save or cancel the comment draft first." : undefined}
            onClick={() => vscode.postMessage({ type: "submitReview", decision: "save" })}
          >
            Just save
          </button>
          <button
            className="ghost"
            disabled={isSubmitting || isSubmitted || hasUnsavedComment || state.comments.comments.length === 0}
            title={hasUnsavedComment ? "Save or cancel the comment draft first." : undefined}
            onClick={() => vscode.postMessage({ type: "submitReview", decision: "revise" })}
          >
            Review
          </button>
          <button
            className="primary"
            disabled={isSubmitting || isSubmitted || hasUnsavedComment}
            title={hasUnsavedComment ? "Save or cancel the comment draft first." : undefined}
            onClick={() => vscode.postMessage({ type: "submitReview", decision: "approve" })}
          >
            {isSubmitting ? "Submitting…" : "Proceed"}
          </button>
        </div>
      </header>

      {(error || sendMessage) && (
        <div className={`notice ${sendStatus === "error" || error ? "error" : sendStatus}`}>
          {error ?? sendMessage}
        </div>
      )}

      <div className="workspace">
        <article className="plan" onMouseUp={isSubmitted ? undefined : beginComment}>
          {state.blocks.map((block) => (
            <ArtifactBlock key={block.id} block={block} comments={commentsByBlock.get(block.id) ?? []} />
          ))}
        </article>

        <aside className="review-panel">
          <div className="panel-heading">
            <h2>Review</h2>
            <p>Select text in the artifact to add a comment.</p>
          </div>

          {draft && !isSubmitted && (
            <section className="comment-editor">
              <blockquote>{draft.quote}</blockquote>
              <textarea
                autoFocus
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What should change?"
                rows={4}
              />
              <div className="editor-actions">
                <button className="ghost" onClick={() => setDraft(null)}>Cancel</button>
                <button className="primary" disabled={!body.trim()} onClick={submitComment}>Comment</button>
              </div>
            </section>
          )}

          <div className="comment-list">
            {state.comments.comments.length === 0 && !draft && <p className="empty">No comments yet.</p>}
            {state.comments.comments.map((comment, index) => (
              <section className="comment-card" key={comment.id}>
                <div className="comment-meta">
                  <span>#{index + 1}{comment.block.heading ? ` · ${comment.block.heading}` : ""}</span>
                  <button
                    className="icon-button delete-comment-button"
                    disabled={isSubmitted}
                    aria-label="Delete comment"
                    title="Delete comment"
                    onClick={() => vscode.postMessage({ type: "removeComment", commentId: comment.id })}
                  >×</button>
                </div>
                <blockquote>{comment.selection.quote}</blockquote>
                <p>{comment.body}</p>
              </section>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
