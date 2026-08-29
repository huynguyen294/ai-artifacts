import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  inline,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  type VirtualElement,
} from "@floating-ui/react";
import { useEffect, useRef, type ReactNode } from "react";

export type SelectionDraft = {
  blockId: string;
  quote: string;
  start: number;
  end: number;
  range: Range;
  contextElement: HTMLElement;
};

type Props = {
  draft: SelectionDraft;
  body: string;
  onBodyChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function SelectionCommentPopover({ draft, body, onBodyChange, onCancel, onSubmit }: Props): ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open && !body.trim()) onCancel();
    },
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [inline(), offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
  });

  useEffect(() => {
    const reference: VirtualElement = {
      contextElement: draft.contextElement,
      getBoundingClientRect: () => draft.range.getBoundingClientRect(),
      getClientRects: () => draft.range.getClientRects(),
    };
    refs.setPositionReference(reference);
  }, [draft, refs]);

  const dismiss = useDismiss(context, {
    outsidePress: () => !body.trim(),
  });
  const role = useRole(context, { role: "dialog" });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={textareaRef} returnFocus={false}>
        <section
          ref={refs.setFloating}
          style={floatingStyles}
          className="comment-popover"
          aria-label="Add review comment"
          {...getFloatingProps()}
        >
          <blockquote>{draft.quote}</blockquote>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            placeholder="What should change?"
            rows={4}
          />
          <div className="editor-actions">
            <button className="ghost" onClick={onCancel}>Cancel</button>
            <button className="primary" disabled={!body.trim()} onClick={onSubmit}>Comment</button>
          </div>
        </section>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
