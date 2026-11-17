import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WhatsNewGuide } from "../src/shared/whats-new-guides";
import { WhatsNewGuideCard } from "../src/webview/WhatsNewGuideCard";

function createGuide(overrides: Partial<WhatsNewGuide> = {}): WhatsNewGuide {
  return {
    id: "workflow-decision-guide",
    title: "When to Use Single Review, Sessions, or Multi-Agent Workflows",
    description: "Choose the right level of structure for your current task.",
    url: "https://dev.to/huynguyen294/example-guide",
    ...overrides,
  };
}

function findButtonElement(node: ReactNode): ReactElement<{ onClick?: () => void }> | undefined {
  if (!isValidElement(node)) {
    return undefined;
  }
  if (node.type === "button") {
    return node as ReactElement<{ onClick?: () => void }>;
  }
  const props = node.props as { children?: ReactNode };
  for (const child of Children.toArray(props.children)) {
    const found = findButtonElement(child);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe("WhatsNewGuideCard", () => {
  it("renders title, description, and external CTA without release metadata or accordions", () => {
    const guide = createGuide();
    const html = renderToStaticMarkup(
      <WhatsNewGuideCard guide={guide} onOpenExternal={vi.fn<(url: string) => void>()} />,
    );

    const headingIndex = html.indexOf("<h2");
    const descriptionIndex = html.indexOf(guide.description);
    const ctaIndex = html.indexOf("<button");

    expect(headingIndex).toBeGreaterThan(-1);
    expect(descriptionIndex).toBeGreaterThan(headingIndex);
    expect(ctaIndex).toBeGreaterThan(descriptionIndex);

    expect(html).toContain('<article class="whats-new-guide-card">');
    expect(html).toContain(`<h2 class="whats-new-guide-title">${guide.title}</h2>`);
    expect(html).toContain(`aria-label="Read ${guide.title} on dev.to"`);
    expect(html).toContain("Read on dev.to ↗");

    expect(html).not.toContain("<details");
    expect(html).not.toContain("Features");
    expect(html).not.toContain("Bug fixes");
    expect(html).not.toContain("<time");
  });

  it("calls onOpenExternal with the guide URL when the CTA button is clicked", () => {
    const guide = createGuide();
    const onOpenExternal = vi.fn<(url: string) => void>();
    const element = WhatsNewGuideCard({ guide, onOpenExternal });
    const button = findButtonElement(element);

    expect(button).toBeDefined();
    button?.props.onClick?.();

    expect(onOpenExternal).toHaveBeenCalledTimes(1);
    expect(onOpenExternal).toHaveBeenCalledWith(guide.url);
  });
});
