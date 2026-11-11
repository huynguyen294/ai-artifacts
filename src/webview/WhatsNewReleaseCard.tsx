import type { ReactNode } from "react";
import type { WhatsNewArticle } from "./whats-new-content";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELEASE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatVersionLabel(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function formatPublishedDate(
  publishedAt?: string,
): { dateTime: string; label: string } | undefined {
  if (!publishedAt) return undefined;
  const trimmed = publishedAt.trim();
  const match = ISO_DATE_PATTERN.exec(trimmed);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  try {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return undefined;
    }

    return {
      dateTime: trimmed,
      label: RELEASE_DATE_FORMATTER.format(date),
    };
  } catch {
    return undefined;
  }
}

function ReleaseIcon(props: { icon?: WhatsNewArticle["icon"] }): ReactNode {
  if (props.icon === "layers") {
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2 2 7l10 5 10-5-10-5Z" />
        <path d="m2 12 10 5 10-5" />
        <path d="m2 17 10 5 10-5" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3 13.9 8.1 19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
    </svg>
  );
}

function ChevronIcon(): ReactNode {
  return (
    <svg
      className="whats-new-release-chevron"
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

export function WhatsNewReleaseMeta(props: {
  article: WhatsNewArticle;
}): ReactNode {
  const { article } = props;
  const formattedDate = formatPublishedDate(article.publishedAt);

  return (
    <div className="whats-new-release-meta">
      <span className="whats-new-version-label">{formatVersionLabel(article.version)}</span>
      {formattedDate && (
        <>
          <span className="whats-new-meta-separator" aria-hidden="true">
            ·
          </span>
          <time className="whats-new-release-date" dateTime={formattedDate.dateTime}>
            {formattedDate.label}
          </time>
        </>
      )}
      {article.preview && (
        <>
          <span className="whats-new-meta-separator" aria-hidden="true">
            ·
          </span>
          <span className="whats-new-preview-badge">Preview content</span>
        </>
      )}
    </div>
  );
}

export function WhatsNewReleaseCard(props: {
  article: WhatsNewArticle;
  onExplore: (version: string) => void;
}): ReactNode {
  const { article, onExplore } = props;
  const hasGroups = article.features.length > 0 || article.bugFixes.length > 0;

  return (
    <article className="whats-new-release-card">
      <WhatsNewReleaseMeta article={article} />

      <div className="whats-new-release-header">
        <span className="whats-new-release-icon" aria-hidden="true">
          <ReleaseIcon icon={article.icon} />
        </span>
        <h2 className="whats-new-release-title">{article.title}</h2>
      </div>

      <p className="whats-new-release-description">{article.description}</p>

      {hasGroups && (
        <div className="whats-new-release-groups">
          {article.features.length > 0 && (
            <details className="whats-new-release-group">
              <summary className="whats-new-release-summary">
                <span className="whats-new-release-summary-label">
                  Features{" "}
                  <span className="whats-new-release-group-count">({article.features.length})</span>
                </span>
                <ChevronIcon />
              </summary>
              <ul className="whats-new-release-items">
                {article.features.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </details>
          )}

          {article.bugFixes.length > 0 && (
            <details className="whats-new-release-group">
              <summary className="whats-new-release-summary">
                <span className="whats-new-release-summary-label">
                  Bug fixes{" "}
                  <span className="whats-new-release-group-count">({article.bugFixes.length})</span>
                </span>
                <ChevronIcon />
              </summary>
              <ul className="whats-new-release-items">
                {article.bugFixes.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="whats-new-release-actions">
        <button
          type="button"
          className="whats-new-explore-btn"
          aria-label={`View more details for ${article.title} (${formatVersionLabel(article.version)})`}
          onClick={() => onExplore(article.version)}
        >
          View more details →
        </button>
      </div>
    </article>
  );
}

