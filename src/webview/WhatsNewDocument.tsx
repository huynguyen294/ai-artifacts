import type { ReactNode } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

export function WhatsNewDocument(props: {
  markdown: string;
  mediaBaseUri: string;
}): ReactNode {
  return (
    <div className="artifact-document whats-new-document">
      <MarkdownRenderer
        mode="content"
        markdown={props.markdown}
        mediaBaseUri={props.mediaBaseUri}
      />
    </div>
  );
}
