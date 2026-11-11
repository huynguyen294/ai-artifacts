import type { ReactNode } from "react";
import type { MarkdownBlock, ReviewComment } from "../shared/contracts";
import { MarkdownRenderer } from "./MarkdownRenderer";

const EMPTY_BLOCKS: MarkdownBlock[] = [];
const EMPTY_COMMENTS = new Map<string, ReviewComment[]>();
const ignoreCommentClick = () => {};

export function WhatsNewDocument(props: {
  markdown: string;
}): ReactNode {
  return (
    <div className="artifact-document whats-new-document">
      <MarkdownRenderer
        markdown={props.markdown}
        blocks={EMPTY_BLOCKS}
        commentsByBlock={EMPTY_COMMENTS}
        onCommentClick={ignoreCommentClick}
      />
    </div>
  );
}

