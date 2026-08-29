import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { MarkdownBlock, ReviewComment } from "../shared/contracts";
import { loadShiki, styleNonce } from "./enhancement-loader";
import { annotateChildren } from "./review-annotations";
import { useViewerTheme } from "./theme";

type Props = {
  block: MarkdownBlock;
  comments: ReviewComment[];
  onCommentClick: (commentId: string, anchor: HTMLElement) => void;
};

type Highlight = Awaited<ReturnType<Awaited<ReturnType<typeof loadShiki>>["highlight"]>>;

export function CodeBlock({ block, comments, onCommentClick }: Props): ReactNode {
  const theme = useViewerTheme();
  const [highlight, setHighlight] = useState<Highlight>();
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const language = block.language?.trim() || "text";

  useEffect(() => {
    let cancelled = false;
    setHighlight(undefined);
    setFailed(false);
    if (comments.length > 0 || theme === "high-contrast") return () => { cancelled = true; };
    void loadShiki()
      .then((api) => api.highlight(block.text, language, theme))
      .then((result) => {
        if (!cancelled) setHighlight(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [block.text, comments.length, language, theme]);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(block.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="code-block-shell" data-block-id={block.id} data-block-type="code">
      <div className="code-block-toolbar">
        <span>{language}</span>
        <button className="text-button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
      </div>
      {highlight ? (
        <>
          <style nonce={styleNonce()}>{highlight.css}</style>
          <pre className="shiki-output"><code>{highlight.lines.map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {line.map((token, tokenIndex) => (
                <span key={tokenIndex} className={token.className}>{token.content}</span>
              ))}
              {lineIndex < highlight.lines.length - 1 ? "\n" : null}
            </Fragment>
          ))}</code></pre>
        </>
      ) : (
        <pre className={failed ? "enhancement-fallback" : undefined}>
          <code>{annotateChildren(block.text, comments, onCommentClick, true)}</code>
        </pre>
      )}
    </div>
  );
}
