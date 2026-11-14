import v2Markdown from "../content/whats-new/2.0.0.md?raw";
import tipsMarkdown from "../content/tips.md?raw";
import { whatsNewReleases, type WhatsNewRelease } from "../shared/whats-new-releases";

export type WhatsNewArticle = WhatsNewRelease & {
  markdown: string;
};

export type WhatsNewContent = {
  articles: readonly WhatsNewArticle[];
  tipsMarkdown: string;
};

const releaseMarkdownByVersion: Readonly<Record<string, string>> = {
  "2.0.0": v2Markdown,
};

export const whatsNewContent: WhatsNewContent = {
  articles: whatsNewReleases.map((release) => ({
    ...release,
    markdown: releaseMarkdownByVersion[release.version] ?? "",
  })),
  tipsMarkdown,
};

