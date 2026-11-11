import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WhatsNewArticle } from "../src/webview/whats-new-content";
import { WhatsNewReleaseCard, WhatsNewReleaseMeta } from "../src/webview/WhatsNewReleaseCard";

function createArticle(overrides: Partial<WhatsNewArticle> = {}): WhatsNewArticle {
  return {
    version: "1.2.0",
    title: "Work Sessions are here",
    description: "Manage your session artifacts and instructions in one place.",
    features: ["Feature one", "Feature two"],
    bugFixes: ["Fix one"],
    markdown: "# Release Notes",
    ...overrides,
  };
}

describe("WhatsNewReleaseMeta & WhatsNewReleaseCard", () => {
  it("renders metadata before the heading, description without clipping, icon without extra text, and CTA outside details", () => {
    const html = renderToStaticMarkup(
      <WhatsNewReleaseCard
        article={createArticle({
          publishedAt: "2026-04-15",
          preview: true,
          icon: "layers",
        })}
        onExplore={vi.fn<(version: string) => void>()}
      />,
    );

    const versionIndex = html.indexOf("v1.2.0");
    const dateIndex = html.indexOf('<time class="whats-new-release-date" dateTime="2026-04-15">Apr 15, 2026</time>');
    const previewIndex = html.indexOf("Preview content");
    const headingIndex = html.indexOf("<h2");
    const descriptionIndex = html.indexOf("Manage your session artifacts and instructions in one place.");
    const firstDetailsIndex = html.indexOf("<details");
    const lastDetailsCloseIndex = html.lastIndexOf("</details>");
    const ctaIndex = html.indexOf("<button");

    expect(versionIndex).toBeGreaterThan(-1);
    expect(dateIndex).toBeGreaterThan(versionIndex);
    expect(previewIndex).toBeGreaterThan(dateIndex);
    expect(headingIndex).toBeGreaterThan(previewIndex);
    expect(descriptionIndex).toBeGreaterThan(headingIndex);
    expect(firstDetailsIndex).toBeGreaterThan(descriptionIndex);
    expect(lastDetailsCloseIndex).toBeGreaterThan(firstDetailsIndex);
    expect(ctaIndex).toBeGreaterThan(lastDetailsCloseIndex);

    expect(html).toContain("<article");
    expect(html).toContain('class="whats-new-release-icon" aria-hidden="true"');
    expect(html).toContain('<h2 class="whats-new-release-title">Work Sessions are here</h2>');
    expect(html).toContain('aria-label="View more details for Work Sessions are here (v1.2.0)"');
    expect(html).toContain("View more details →");
  });

  it("renders collapsed independent native details accordions with accurate group counts and escaped bullet text", () => {
    const html = renderToStaticMarkup(
      <WhatsNewReleaseCard
        article={createArticle({
          features: ["First <script>feature</script>", "Second feature", "Third feature"],
          bugFixes: ["Resolved race condition"],
        })}
        onExplore={vi.fn<(version: string) => void>()}
      />,
    );

    expect(html).toContain("Features");
    expect(html).toContain("(3)");
    expect(html).toContain("Bug fixes");
    expect(html).toContain("(1)");
    expect(html).toContain("<li>First &lt;script&gt;feature&lt;/script&gt;</li>");
    expect(html).toContain("<li>Second feature</li>");
    expect(html).toContain("<li>Third feature</li>");
    expect(html).toContain("<li>Resolved race condition</li>");

    // Both details must be closed by default and independent (no open attr, no shared name attr)
    expect(html).not.toMatch(/<details[^>]*\bopen\b/i);
    expect(html).not.toMatch(/<details[^>]*\bname=/i);
    expect(html).not.toContain("aria-expanded");
  });

  it("hides empty accordion groups without displaying zero counts and hides preview badge when flag is unset", () => {
    const featuresOnlyHtml = renderToStaticMarkup(
      <WhatsNewReleaseCard
        article={createArticle({ bugFixes: [] })}
        onExplore={vi.fn<(version: string) => void>()}
      />,
    );
    expect(featuresOnlyHtml).toContain("Features");
    expect(featuresOnlyHtml).toContain("(2)");
    expect(featuresOnlyHtml).not.toContain("Bug fixes");
    expect(featuresOnlyHtml).not.toContain("(0)");
    expect(featuresOnlyHtml).not.toContain("Preview content");

    const fixesOnlyHtml = renderToStaticMarkup(
      <WhatsNewReleaseCard
        article={createArticle({ features: [], bugFixes: ["Fixed crash on close"] })}
        onExplore={vi.fn<(version: string) => void>()}
      />,
    );
    expect(fixesOnlyHtml).not.toContain("Features");
    expect(fixesOnlyHtml).toContain("Bug fixes");
    expect(fixesOnlyHtml).toContain("(1)");
    expect(fixesOnlyHtml).not.toContain("(0)");

    const noGroupsHtml = renderToStaticMarkup(
      <WhatsNewReleaseCard
        article={createArticle({ features: [], bugFixes: [] })}
        onExplore={vi.fn<(version: string) => void>()}
      />,
    );
    expect(noGroupsHtml).not.toContain("<details");
    expect(noGroupsHtml).toContain("View more details →");
  });

  it("formats publishedAt in UTC without crashing or rendering invalid dates, and defaults to sparkles icon", () => {
    const validBoundaryDate = renderToStaticMarkup(
      <WhatsNewReleaseMeta article={createArticle({ publishedAt: "2026-01-01" })} />,
    );
    expect(validBoundaryDate).toContain('<time class="whats-new-release-date" dateTime="2026-01-01">Jan 1, 2026</time>');

    for (const invalidDate of [undefined, "", "not-a-date", "2026-13-01", "2026-02-30"]) {
      const html = renderToStaticMarkup(
        <WhatsNewReleaseMeta
          article={createArticle(invalidDate === undefined ? {} : { publishedAt: invalidDate })}
        />,
      );
      expect(html).toContain("v1.2.0");
      expect(html).not.toContain("<time");
    }

    const defaultIconCard = renderToStaticMarkup(
      <WhatsNewReleaseCard
        article={createArticle()}
        onExplore={vi.fn<(version: string) => void>()}
      />,
    );
    expect(defaultIconCard).toContain("whats-new-release-icon");
    expect(defaultIconCard).toContain("<svg");
  });
});

