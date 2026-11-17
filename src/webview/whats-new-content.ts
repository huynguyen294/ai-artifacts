import v2Markdown from "../content/whats-new/2.0.0.md?raw";
import { whatsNewGuides, type WhatsNewGuide } from "../shared/whats-new-guides";
import { whatsNewReleases, type WhatsNewRelease } from "../shared/whats-new-releases";

export type WhatsNewArticle = WhatsNewRelease & {
  markdown: string;
};

export type WhatsNewContent = {
  articles: readonly WhatsNewArticle[];
  guides: readonly WhatsNewGuide[];
};

const releaseMarkdownByVersion: Readonly<Record<string, string>> = {
  "2.0.0": v2Markdown,
};

export const whatsNewContent: WhatsNewContent = {
  articles: whatsNewReleases.map((release) => ({
    ...release,
    markdown: releaseMarkdownByVersion[release.version] ?? "",
  })),
  guides: whatsNewGuides,
};

