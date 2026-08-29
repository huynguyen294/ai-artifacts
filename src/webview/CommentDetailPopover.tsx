import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useEffect, type ReactNode } from "react";
import type { ReviewComment } from "../shared/contracts";

type Props = {
  comment: ReviewComment;
  anchor: HTMLElement;
  submitted: boolean;
  onClose: () => void;
  onRemove: () => void;
};

export function CommentDetailPopover({ comment, anchor, submitted, onClose, onRemove }: Props): ReactNode {
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => { if (!open) onClose(); },
    placement: "right-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
  });
  useEffect(() => refs.setReference(anchor), [anchor, refs]);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
        <section
          ref={refs.setFloating}
          style={floatingStyles}
          className="comment-popover comment-detail-popover"
          aria-label="Review comment"
          {...getFloatingProps()}
        >
          <blockquote>{comment.selection.quote}</blockquote>
          <p>{comment.body}</p>
          {!submitted && <div className="editor-actions"><button className="danger-text" onClick={onRemove}>Delete comment</button></div>}
        </section>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
