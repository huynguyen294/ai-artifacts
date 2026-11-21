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
    version: "2.1.0",
    title: "Leaner MCP reads, atomic edits, and source-file artifact creation",
    description:
      "AI agents can now create, inspect, read slices of, and locally patch large Markdown artifacts without reloading the full document on every turn.",
    features: [
      "Compact ArtifactHandle metadata with lineCount and byteSize instead of repeating full Markdown on inspect and join calls.",
      "Read-only read_artifact tool with bounded range pagination, heading outline, and literal search fallback when native file access is unavailable.",
      "One-time sourcePath UTF-8 file import on create_artifact and update_artifact (with automatic leading BOM stripping).",
      "Atomic batch edits[] on update_artifact using original-text coordinates with CRLF/LF preservation.",
    ],
    bugFixes: [
      "Keep roundToken reusable (reuseRoundToken: true) across pre-commit input, sourcePath, and edits[] validation or match failures.",
      "Avoid false ARTIFACT_NOT_FOUND errors when read_artifact runs during a concurrent update lock window.",
      "Condense MCP instructions and add explicit Inspect an exact artifact only skill guidance.",
    ],
    icon: "sparkles",
    publishedAt: "2026-11-21",
    notify: false,
  },
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
      "A Waiting room to see which agents are waiting, hand off work, or stop a wait.",
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

