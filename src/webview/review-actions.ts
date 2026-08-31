import type { ReviewDecision } from "../shared/contracts";

export type ReviewActionState = {
  disabled: boolean;
  primary: boolean;
  label: string;
};

type ReviewActionsInput = {
  commentCount: number;
  isSubmitting: boolean;
  isSubmitted: boolean;
  hasUnsavedComment: boolean;
  lifecycleReadOnly?: boolean;
  submittingDecision?: ReviewDecision;
};

export function deriveReviewActions(input: ReviewActionsInput): Record<ReviewDecision, ReviewActionState> {
  const lifecycleLocked = Boolean(input.lifecycleReadOnly)
    || input.isSubmitting
    || input.isSubmitted
    || input.hasUnsavedComment;
  const hasComments = input.commentCount > 0;
  const sending = (decision: ReviewDecision, fallback: string): string =>
    input.isSubmitting && input.submittingDecision === decision ? "Sending…" : fallback;

  return {
    revise: {
      disabled: lifecycleLocked || !hasComments,
      primary: hasComments,
      label: sending("revise", `Review (${input.commentCount})`),
    },
    approve: {
      disabled: lifecycleLocked,
      primary: true,
      label: sending("approve", "Proceed"),
    },
    save: {
      disabled: lifecycleLocked,
      primary: false,
      label: sending("save", "Just save"),
    },
  };
}
