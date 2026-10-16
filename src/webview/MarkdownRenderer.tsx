import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
} from "react";
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

type RenderContextValue = {
  blocks: MarkdownBlock[];
  commentsByBlock: Map<string, ReviewComment[]>;
  onCommentClick: Props["onCommentClick"];
};

const RenderContext = createContext<RenderContextValue | undefined>(undefined);
const EMPTY_COMMENTS: ReviewComment[] = [];
const REMARK_PLUGINS = [remarkGfm];

function useRenderContext(): RenderContextValue {
  const value = useContext(RenderContext);
  if (!value) throw new Error("Markdown renderer context is unavailable.");
  return value;
}

function findBlock(
  blocks: MarkdownBlock[],
  node: PositionedNode | undefined,
  type: MarkdownBlock["type"],
): MarkdownBlock | undefined {
  const start = node?.position?.start.offset;
  return start === undefined ? undefined : blocks.find((block) => block.type === type && block.sourceStart === start);
}

type ReviewElementProps = {
  tag: ElementType;
  node: PositionedNode | undefined;
  type: MarkdownBlock["type"];
  children: ReactNode;
  elementProps: Record<string, unknown>;
};

function ReviewElement({ tag, node, type, children, elementProps }: ReviewElementProps): ReactNode {
  const { blocks, commentsByBlock, onCommentClick } = useRenderContext();
  const block = findBlock(blocks, node, type);
  if (!block) return createElement(tag, elementProps, children);
  const comments = commentsByBlock.get(block.id) ?? EMPTY_COMMENTS;
  return createElement(tag, {
    ...elementProps,
    "data-block-id": block.id,
    "data-block-type": block.type,
    className: [elementProps.className, "review-block", block.type].filter(Boolean).join(" "),
  }, annotateChildren(children, comments, onCommentClick));
}

type ReviewCodeProps = ComponentPropsWithoutRef<"code"> & { node?: PositionedNode | undefined };

function ReviewCode({ node, className, children, ...props }: ReviewCodeProps): ReactNode {
  const { blocks, commentsByBlock, onCommentClick } = useRenderContext();
  const block = findBlock(blocks, node, "code");
  if (!block) return <code className={className} {...props}>{children}</code>;
  const comments = commentsByBlock.get(block.id) ?? EMPTY_COMMENTS;
  return block.language?.toLowerCase() === "mermaid"
    ? <MermaidBlock block={block} comments={comments} onCommentClick={onCommentClick} />
    : <CodeBlock block={block} comments={comments} onCommentClick={onCommentClick} />;
}

// Keep these component types stable. Recreating them when comments change remounts
// lazy enhancements such as Mermaid and briefly clears their rendered output.
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ node, children, ...props }) => <ReviewElement tag="h1" node={node} type="heading" elementProps={props}>{children}</ReviewElement>,
  h2: ({ node, children, ...props }) => <ReviewElement tag="h2" node={node} type="heading" elementProps={props}>{children}</ReviewElement>,
  h3: ({ node, children, ...props }) => <ReviewElement tag="h3" node={node} type="heading" elementProps={props}>{children}</ReviewElement>,
  h4: ({ node, children, ...props }) => <ReviewElement tag="h4" node={node} type="heading" elementProps={props}>{children}</ReviewElement>,
  h5: ({ node, children, ...props }) => <ReviewElement tag="h5" node={node} type="heading" elementProps={props}>{children}</ReviewElement>,
  h6: ({ node, children, ...props }) => <ReviewElement tag="h6" node={node} type="heading" elementProps={props}>{children}</ReviewElement>,
  p: ({ node, children, ...props }) => <ReviewElement tag="p" node={node} type="paragraph" elementProps={props}>{children}</ReviewElement>,
  li: ({ node, children, ...props }) => <ReviewElement tag="li" node={node} type="list-item" elementProps={props}>{children}</ReviewElement>,
  blockquote: ({ node, children, ...props }) => <ReviewElement tag="blockquote" node={node} type="quote" elementProps={props}>{children}</ReviewElement>,
  td: ({ node, children, ...props }) => <ReviewElement tag="td" node={node} type="table-cell" elementProps={props}>{children}</ReviewElement>,
  th: ({ node, children, ...props }) => <ReviewElement tag="th" node={node} type="table-cell" elementProps={props}>{children}</ReviewElement>,
  pre: ({ children }) => <>{children}</>,
  code: (props) => <ReviewCode {...props} />,
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

export function MarkdownRenderer({ markdown, blocks, commentsByBlock, onCommentClick }: Props): ReactNode {
  const renderContext = useMemo<RenderContextValue>(
    () => ({ blocks, commentsByBlock, onCommentClick }),
    [blocks, commentsByBlock, onCommentClick],
  );

  return (
    <RenderContext.Provider value={renderContext}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={MARKDOWN_COMPONENTS}
        skipHtml
        urlTransform={safeArtifactUrl}
      >
        {markdown.replace(/\r\n/g, "\n")}
      </ReactMarkdown>
    </RenderContext.Provider>
  );
}
