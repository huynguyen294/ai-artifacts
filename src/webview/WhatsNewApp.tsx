import { useEffect, useRef, useState, type ReactNode } from "react";
import { whatsNewContent } from "./whats-new-content";
import { WhatsNewDocument } from "./WhatsNewDocument";
import { WhatsNewReleaseCard, WhatsNewReleaseMeta } from "./WhatsNewReleaseCard";

export type WhatsNewView = { kind: "list" } | { kind: "article"; version: string } | { kind: "tips" };

export function WhatsNewApp(props?: { initialView?: WhatsNewView; mediaBaseUri?: string }): ReactNode {
  const [view, setView] = useState<WhatsNewView>(props?.initialView ?? { kind: "list" });
  const hasMountedRef = useRef(false);
  const mediaBaseUri = props?.mediaBaseUri ?? "";
  const visibleArticles = whatsNewContent.articles.filter((article) => article.markdown.trim().length > 0);
  const selectedArticle =
    view.kind === "article" ? visibleArticles.find((article) => article.version === view.version) : undefined;

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      window.scrollTo(0, 0);
    }
  }, [view]);

  const isTipsActive = view.kind === "tips";
  const isWhatsNewActive = !isTipsActive;

  return (
    <div className="whats-new-shell">
      <div className="whats-new-container">
        <header className="whats-new-header">
          <div className="whats-new-title-group">
            <h1 className="whats-new-title">What&apos;s New &amp; Tips</h1>
            <p className="whats-new-subtitle">AI Artifacts product updates and usage guides</p>
          </div>
          <nav className="whats-new-tabs" aria-label="What's New sections">
            <button
              type="button"
              className={`whats-new-tab-btn${isWhatsNewActive ? " is-active" : ""}`}
              aria-pressed={isWhatsNewActive}
              onClick={() => setView({ kind: "list" })}
            >
              What&apos;s New
            </button>
            <button
              type="button"
              className={`whats-new-tab-btn${isTipsActive ? " is-active" : ""}`}
              aria-pressed={isTipsActive}
              onClick={() => setView({ kind: "tips" })}
            >
              Tips
            </button>
          </nav>
        </header>

        <main className="whats-new-content">
          {view.kind === "list" ? (
            visibleArticles.length > 0 ? (
              <div className="whats-new-release-list">
                {visibleArticles.map((article) => (
                  <WhatsNewReleaseCard
                    key={article.version}
                    article={article}
                    onExplore={(version) => setView({ kind: "article", version })}
                  />
                ))}
              </div>
            ) : (
              <div className="whats-new-empty">No updates to show yet.</div>
            )
          ) : view.kind === "article" ? (
            selectedArticle ? (
              <div className="whats-new-article-view">
                <div className="whats-new-article-nav">
                  <button type="button" className="whats-new-back-btn" onClick={() => setView({ kind: "list" })}>
                    ← All updates
                  </button>
                  <WhatsNewReleaseMeta article={selectedArticle} />
                </div>
                <WhatsNewDocument markdown={selectedArticle.markdown} mediaBaseUri={mediaBaseUri} />
              </div>
            ) : (
              <div className="whats-new-article-view">
                <div className="whats-new-article-nav">
                  <button type="button" className="whats-new-back-btn" onClick={() => setView({ kind: "list" })}>
                    ← All updates
                  </button>
                </div>
                <div className="whats-new-empty" role="status">
                  Release notes for version {view.version} were not found.
                </div>
              </div>
            )
          ) : (
            <WhatsNewDocument markdown={whatsNewContent.tipsMarkdown} mediaBaseUri={mediaBaseUri} />
          )}
        </main>
      </div>
    </div>
  );
}
