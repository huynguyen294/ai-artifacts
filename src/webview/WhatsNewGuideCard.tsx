import type { ReactNode } from "react";
import type { WhatsNewGuide } from "../shared/whats-new-guides";

export function WhatsNewGuideCard(props: {
  guide: WhatsNewGuide;
  onOpenExternal: (url: string) => void;
}): ReactNode {
  const { guide, onOpenExternal } = props;

  return (
    <article className="whats-new-guide-card">
      <h2 className="whats-new-guide-title">{guide.title}</h2>
      <p className="whats-new-guide-description">{guide.description}</p>
      <div className="whats-new-guide-actions">
        <button
          type="button"
          className="whats-new-guide-open-btn"
          aria-label={`Read ${guide.title} on dev.to`}
          onClick={() => onOpenExternal(guide.url)}
        >
          Read on dev.to ↗
        </button>
      </div>
    </article>
  );
}
