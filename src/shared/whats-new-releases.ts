export type WhatsNewRelease = {
  version: string;
  title: string;
  description: string;
  features: readonly string[];
  bugFixes: readonly string[];
  publishedAt?: string;
  icon?: "layers" | "sparkles";
  preview?: boolean;
  notify?: boolean;
};

export const whatsNewReleases: readonly WhatsNewRelease[] = [
  {
    version: "1.2.0",
    title: "Work Sessions are here — with multi-agent support",
    description:
      "You can now manage your session’s artifacts and shared instructions in one place, and continue the work across AI agents and chats.",
    features: [
      "A Session Manager for your Working, References, and Archived artifacts.",
      "Shared instructions and artifacts across multiple AI agents and chats.",
      "Agent-to-agent review: one agent waits while another submits feedback.",
      "A dedicated sidebar with pinning, archiving, search, and session types.",
    ],
    bugFixes: [],
    icon: "layers",
    preview: true,
    notify: false,
  },
];

