import type { ReactNode } from "react";
import type { ReviewComment } from "../shared/contracts";

type Props = {
  open: boolean;
  comments: ReviewComment[];
  submitted: boolean;
  onClose: () => void;
  onJump: (comment: ReviewComment) => void;
  onRemove: (commentId: string) => void;
};

export function CommentsDrawer({ open, comments, submitted, onClose, onJump, onRemove }: Props): ReactNode {
  if (!open) return null;
  return (
    <>
      <button className="drawer-backdrop" aria-label="Close comments" onClick={onClose} />
      <aside
        id="artifact-comments-drawer"
        className="comments-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Artifact comments"
        onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
      >
        <div className="drawer-heading">
          <div>
            <h2>Comments ({comments.length})</h2>
            <p>Select a comment to find it in the artifact.</p>
          </div>
          <button autoFocus className="icon-button" aria-label="Close comments" onClick={onClose}>×</button>
        </div>
        <div className="comment-list">
          {comments.length === 0 && <p className="empty">No comments yet. Select text in the artifact to add one.</p>}
          {comments.map((comment, index) => (
            <section className="comment-card" key={comment.id}>
              <button className="comment-jump" onClick={() => onJump(comment)}>
                <span className="comment-meta">#{index + 1}{comment.block.heading ? ` · ${comment.block.heading}` : ""}</span>
                <blockquote>{comment.selection.quote}</blockquote>
                <span className="comment-body">{comment.body}</span>
              </button>
              {!submitted && (
                <button
                  className="icon-button delete-comment-button"
                  aria-label="Delete comment"
                  title="Delete comment"
                  onClick={() => onRemove(comment.id)}
                >×</button>
              )}
            </section>
          ))}
        </div>
      </aside>
    </>
  );
}
