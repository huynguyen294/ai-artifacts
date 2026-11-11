import { useState, type ReactNode } from "react";
import { whatsNewContent } from "./whats-new-content";
import { WhatsNewDocument } from "./WhatsNewDocument";

export type WhatsNewTab = "whats-new" | "tips";

export function WhatsNewApp(props?: {
  initialTab?: WhatsNewTab;
}): ReactNode {
  const [activeTab, setActiveTab] = useState<WhatsNewTab>(props?.initialTab ?? "whats-new");
  const previewArticle = whatsNewContent.articles[0];

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
              className={`whats-new-tab-btn${activeTab === "whats-new" ? " is-active" : ""}`}
              aria-pressed={activeTab === "whats-new"}
              onClick={() => setActiveTab("whats-new")}
            >
              What&apos;s New
            </button>
            <button
              type="button"
              className={`whats-new-tab-btn${activeTab === "tips" ? " is-active" : ""}`}
              aria-pressed={activeTab === "tips"}
              onClick={() => setActiveTab("tips")}
            >
              Tips
            </button>
          </nav>
        </header>

        <main className="whats-new-content">
          {activeTab === "whats-new" ? (
            previewArticle ? (
              <div className="whats-new-preview-view">
                <section className="whats-new-article-meta" aria-label="Release preview metadata">
                  <div className="whats-new-meta-badges">
                    <span className="whats-new-preview-badge">Preview content</span>
                    <span className="whats-new-version-badge">Version {previewArticle.version}</span>
                  </div>
                  <h2 className="whats-new-meta-title">{previewArticle.title}</h2>
                  <p className="whats-new-meta-description">{previewArticle.description}</p>
                  {previewArticle.highlights.length > 0 && (
                    <ul className="whats-new-highlights">
                      {previewArticle.highlights.map((highlight, index) => (
                        <li key={index}>{highlight}</li>
                      ))}
                    </ul>
                  )}
                </section>
                <WhatsNewDocument markdown={previewArticle.markdown} />
              </div>
            ) : (
              <div className="whats-new-empty">No updates to show yet.</div>
            )
          ) : (
            <WhatsNewDocument markdown={whatsNewContent.tipsMarkdown} />
          )}
        </main>
      </div>
    </div>
  );
}

