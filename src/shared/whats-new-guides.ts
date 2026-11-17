export type WhatsNewGuide = {
  id: string;
  title: string;
  description: string;
  url: string;
};

export const whatsNewGuides: readonly WhatsNewGuide[] = [
  {
    id: "workflow-decision-guide",
    title: "When to Use Single Review, Sessions, or Multi-Agent Workflows",
    description:
      "Choose the right level of structure for your task—from reviewing one plan to coordinating multiple AI agents.",
    url: "https://dev.to/huynguyen294/tutorial-00-ai-artifacts-workflow-guide-when-to-use-what-2hjf",
  },
  {
    id: "getting-started-artifact-review",
    title: "Getting Started: Inline Review & Second-Opinion Checks",
    description:
      "Install AI Artifacts, review your first plan in the Preview UI with inline comments, and bring in a second agent to check plans or git diff.",
    url: "https://dev.to/huynguyen294/this-extension-lets-your-ai-agent-create-artifacts-for-plans-workarounds-and-designs-in-cursor-19n3",
  },
  {
    id: "work-sessions-context-continuity",
    title: "Organizing Work Sessions: From Collections to Shared Context",
    description:
      "Group related artifacts in a Working gallery, or expand the Session Manager to manage References, Archived items, and shared Instructions.",
    url: "https://dev.to/huynguyen294/organizing-work-sessions-from-simple-collections-to-shared-context-hlk",
  },
  {
    id: "cross-client-handoffs",
    title: "Cross-Client Handoffs Without Losing Context",
    description:
      "Capture decisions in curated artifacts and continue the same work seamlessly across fresh chats or different AI clients.",
    url: "https://dev.to/huynguyen294/cross-client-handoffs-reusable-context-across-ai-agents-40d9",
  },
  {
    id: "automated-multi-agent-workflows",
    title: "Automated Multi-Agent Workflows with Session Waiters",
    description:
      "Define agent roles, handoff rules, and human approval checkpoints using Session Instructions, Session Waiters, and the Waiting Room.",
    url: "https://dev.to/huynguyen294/automated-multi-agent-workflows-43mb",
  },
];
