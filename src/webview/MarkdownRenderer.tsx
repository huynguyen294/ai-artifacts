import { createElement, useMemo, type ElementType, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MarkdownBlock, ReviewComment } from "../shared/contracts";
import { vscode } from "./vscode-api";
import { annotateChildren } from "./review-annotations";
import { CodeBlock } from "./CodeBlock";
import { MermaidBlock } from "./MermaidBlock";
import { safeArtifactUrl } from "./url-policy";

type Props = {
  markdown: string;
  blocks: MarkdownBlock[];
  commentsByBlock: Map<string, ReviewComment[]>;
  onCommentClick: (commentId: string, anchor: HTMLElement) => void;
};

type PositionedNode = { position?: { start: { offset?: number | undefined } } | undefined };

export function MarkdownRenderer({ markdown, blocks, commentsByBlock, onCommentClick }: Props): ReactNode {
  const components = useMemo<Components>(() => {
    const findBlock = (node: PositionedNode | undefined, type: MarkdownBlock["type"]): MarkdownBlock | undefined => {
      const start = node?.position?.start.offset;
      return start === undefined ? undefined : blocks.find((block) => block.type === type && block.sourceStart === start);
    };

    const reviewElement = (
      tag: ElementType,
      node: PositionedNode | undefined,
      type: MarkdownBlock["type"],
      children: ReactNode,
      props: Record<string, unknown>,
    ): ReactNode => {
      const block = findBlock(node, type);
      if (!block) return createElement(tag, props, children);
      const comments = commentsByBlock.get(block.id) ?? [];
      return createElement(tag, {
        ...props,
        "data-block-id": block.id,
        "data-block-type": block.type,
        className: [props.className, "review-block", block.type].filter(Boolean).join(" "),
      }, annotateChildren(children, comments, onCommentClick));
    };

    return {
      h1: ({ node, children, ...props }) => reviewElement("h1", node, "heading", children, props),
      h2: ({ node, children, ...props }) => reviewElement("h2", node, "heading", children, props),
      h3: ({ node, children, ...props }) => reviewElement("h3", node, "heading", children, props),
      h4: ({ node, children, ...props }) => reviewElement("h4", node, "heading", children, props),
      h5: ({ node, children, ...props }) => reviewElement("h5", node, "heading", children, props),
      h6: ({ node, children, ...props }) => reviewElement("h6", node, "heading", children, props),
      p: ({ node, children, ...props }) => reviewElement("p", node, "paragraph", children, props),
      li: ({ node, children, ...props }) => reviewElement("li", node, "list-item", children, props),
      blockquote: ({ node, children, ...props }) => reviewElement("blockquote", node, "quote", children, props),
      td: ({ node, children, ...props }) => reviewElement("td", node, "table-cell", children, props),
      th: ({ node, children, ...props }) => reviewElement("th", node, "table-cell", children, props),
      pre: ({ children }) => <>{children}</>,
      code: ({ node, className, children, ...props }) => {
        const block = findBlock(node, "code");
        if (!block) return <code className={className} {...props}>{children}</code>;
        const comments = commentsByBlock.get(block.id) ?? [];
        return block.language?.toLowerCase() === "mermaid"
          ? <MermaidBlock block={block} comments={comments} onCommentClick={onCommentClick} />
          : <CodeBlock block={block} comments={comments} onCommentClick={onCommentClick} />;
      },
      a: ({ href, children, ...props }) => {
        const target = href ? safeArtifactUrl(href) : "";
        return (
          <a
            {...props}
            href={target || undefined}
            rel="noreferrer"
            onClick={(event) => {
              if (!target || target.startsWith("#")) return;
              event.preventDefault();
              vscode.postMessage({ type: "openExternal", url: target });
            }}
          >{children}</a>
        );
      },
      img: ({ alt }) => <span className="remote-image-placeholder" role="img" aria-label={alt ?? "Remote image"}>[{alt || "Remote image not loaded"}]</span>,
      input: (props) => <input {...props} disabled />,
    };
  }, [blocks, commentsByBlock, onCommentClick]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
      skipHtml
      urlTransform={safeArtifactUrl}
    >
      {markdown.replace(/\r\n/g, "\n")}
    </ReactMarkdown>
  );
}
