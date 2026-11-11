import previewMarkdown from "../content/whats-new/preview.md?raw";
import tipsMarkdown from "../content/tips.md?raw";

export type WhatsNewArticle = {
  version: string;
  title: string;
  description: string;
  highlights: readonly string[];
  markdown: string;
  publishedAt?: string;
  icon?: string;
};

export type WhatsNewContent = {
  articles: readonly WhatsNewArticle[];
  tipsMarkdown: string;
};

export const whatsNewContent: WhatsNewContent = {
  articles: [
    {
      version: "1.2.0",
      title: "Work Sessions are here — with multi-agent support",
      description:
        "You can now manage your session’s artifacts and shared instructions in one place, and continue the work across AI agents and chats.",
      highlights: [
        "A Session Manager for your Working, References, and Archived artifacts.",
        "Shared instructions and artifacts across multiple AI agents and chats.",
        "Agent-to-agent review: one agent waits while another submits feedback.",
        "A dedicated sidebar with pinning, archiving, search, and session types.",
      ],
      markdown: previewMarkdown,
    },
  ],
  tipsMarkdown,
};

