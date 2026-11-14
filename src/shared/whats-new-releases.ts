export type WhatsNewRelease = {
  version: string;
  title: string;
  notificationTitle?: string;
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
    version: "2.0.0",
    title: "AI Artifacts v2 is out — Work Sessions for multi-agent work",
    notificationTitle: "Work Sessions for multi-agent work",
    description:
      "You can now manage your session’s artifacts and shared instructions in one place, and continue the work across AI agents and chats.",
    features: [
      "A Session Manager for your Working, References, and Archived artifacts.",
      "Shared instructions and artifacts across multiple AI agents and chats.",
      "A dedicated sidebar with pinning, archiving, search, and session types.",
      "Agent-to-agent review: one agent waits while another submits feedback.",
    ],
    bugFixes: [
      "Search Artifact now sorts results by last updated, newest first.",
      "Open local file links directly in the editor from Artifact Review.",
      "Keep unarchived artifacts regardless of age. Automatic cleanup now removes only globally archived artifacts after their retention period expires.",
      "Use one retention setting for archived artifacts and Work Sessions, with the countdown starting when each item is archived.",
      "Keep review waits active when an artifact is updated, so the waiting agent can still receive the next submission.",
      "Keep unsaved Session Instructions intact when unrelated artifact updates refresh the Session Manager.",
      "Moved artifacts now appear at the top of their destination section, making them easier to find.",
      "Use artifact review and Work Sessions with Antigravity.",
    ],
    icon: "layers",
    publishedAt: "2026-11-14",
    notify: true,
  },
];

