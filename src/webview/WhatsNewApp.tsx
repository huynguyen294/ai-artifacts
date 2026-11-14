import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WhatsNewOpenVersionMessage } from "../shared/whats-new-protocol";
import { vscode } from "./vscode-api";
import { whatsNewContent } from "./whats-new-content";
import { subscribeToWhatsNewNavigation } from "./whats-new-navigation";
import { WhatsNewDocument } from "./WhatsNewDocument";
import { WhatsNewReleaseCard, WhatsNewReleaseMeta } from "./WhatsNewReleaseCard";

export type WhatsNewView = { kind: "list" } | { kind: "article"; version: string } | { kind: "tips" };

type NavigationState = {
  view: WhatsNewView;
  hostRequest?: WhatsNewOpenVersionMessage;
};

export function WhatsNewApp(props?: { initialView?: WhatsNewView; mediaBaseUri?: string }): ReactNode {
  const [navigation, setNavigation] = useState<NavigationState>(() => ({
    view: props?.initialView ?? { kind: "list" },
  }));
  const view = navigation.view;
  const hasMountedRef = useRef(false);
  const latestRequestIdRef = useRef(0);
  const appliedRequestIdRef = useRef(0);
  const mediaBaseUri = props?.mediaBaseUri ?? "";
  const visibleArticles = whatsNewContent.articles.filter((article) => article.markdown.trim().length > 0);
  const selectedArticle =
    view.kind === "article" ? visibleArticles.find((article) => article.version === view.version) : undefined;

  const navigateLocal = (nextView: WhatsNewView): void => {
    setNavigation({ view: nextView });
  };

  useEffect(() => {
    return subscribeToWhatsNewNavigation((message) => {
      if (message.requestId < latestRequestIdRef.current) {
        return;
      }

      if (message.requestId === latestRequestIdRef.current) {
        if (appliedRequestIdRef.current === message.requestId) {
          vscode.postMessage({
            type: "whatsNewNavigationApplied",
            requestId: message.requestId,
            version: message.version,
          });
        }
        return;
      }

      latestRequestIdRef.current = message.requestId;
      setNavigation({
        view: { kind: "article", version: message.version },
        hostRequest: message,
      });
    });
  }, []);

  useEffect(() => {
    const hostRequest = navigation.hostRequest;
    if (!hostRequest) {
      return;
    }
    if (navigation.view.kind !== "article" || navigation.view.version !== hostRequest.version) {
      return;
    }
    if (hostRequest.requestId !== latestRequestIdRef.current) {
      return;
    }
    if (appliedRequestIdRef.current >= hostRequest.requestId) {
      return;
    }

    appliedRequestIdRef.current = hostRequest.requestId;
    vscode.postMessage({
      type: "whatsNewNavigationApplied",
      requestId: hostRequest.requestId,
      version: hostRequest.version,
    });
  }, [navigation]);

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
              onClick={() => navigateLocal({ kind: "list" })}
            >
              What&apos;s New
            </button>
            <button
              type="button"
              className={`whats-new-tab-btn${isTipsActive ? " is-active" : ""}`}
              aria-pressed={isTipsActive}
              onClick={() => navigateLocal({ kind: "tips" })}
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
                    onExplore={(version) => navigateLocal({ kind: "article", version })}
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
                  <button type="button" className="whats-new-back-btn" onClick={() => navigateLocal({ kind: "list" })}>
                    ← All updates
                  </button>
                  <WhatsNewReleaseMeta article={selectedArticle} />
                </div>
                <WhatsNewDocument markdown={selectedArticle.markdown} mediaBaseUri={mediaBaseUri} />
              </div>
            ) : (
              <div className="whats-new-article-view">
                <div className="whats-new-article-nav">
                  <button type="button" className="whats-new-back-btn" onClick={() => navigateLocal({ kind: "list" })}>
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
