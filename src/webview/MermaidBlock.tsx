import { useEffect, useState, type ReactNode } from "react";
import type { MarkdownBlock, ReviewComment } from "../shared/contracts";
import { loadMermaid } from "./enhancement-loader";
import { annotateChildren } from "./review-annotations";
import { themeColors, useViewerTheme } from "./theme";

type Props = {
  block: MarkdownBlock;
  comments: ReviewComment[];
  onCommentClick: (commentId: string, anchor: HTMLElement) => void;
};

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function MermaidBlock({ block, comments, onCommentClick }: Props): ReactNode {
  const theme = useViewerTheme();
  const [showSource, setShowSource] = useState(comments.length > 0 || theme === "high-contrast");
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (comments.length > 0 || theme === "high-contrast") setShowSource(true);
  }, [comments.length, theme]);

  useEffect(() => {
    let cancelled = false;
    setSvg(undefined);
    setError(undefined);
    if (showSource) return () => { cancelled = true; };
    void loadMermaid()
      .then((api) => api.render(block.text, theme, themeColors()))
      .then((result) => {
        if (!cancelled) setSvg(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Mermaid could not render this diagram.");
      });
    return () => { cancelled = true; };
  }, [block.text, showSource, theme]);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(block.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="mermaid-block-shell" data-block-id={block.id} data-block-type="code">
      <div className="code-block-toolbar">
        <span>mermaid</span>
        <div>
          <button className="text-button" onClick={() => setShowSource((value) => !value)}>
            {showSource ? "Show diagram" : "Show source"}
          </button>
          <button className="text-button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
        </div>
      </div>
      {showSource || error ? (
        <>
          {error && <p className="diagram-error">{error}</p>}
          <pre><code>{annotateChildren(block.text, comments, onCommentClick, true)}</code></pre>
        </>
      ) : svg ? (
        <div className="mermaid-diagram"><img src={svgDataUri(svg)} alt="Rendered Mermaid diagram" /></div>
      ) : (
        <div className="enhancement-loading">Rendering diagram…</div>
      )}
    </div>
  );
}
