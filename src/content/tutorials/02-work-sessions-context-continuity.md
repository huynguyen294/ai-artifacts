# Organizing Work Sessions — From Simple Collections to Shared Context

Sometimes a single artifact is not enough. Even in one coding session, you might generate an investigation note, an API design, and an implementation plan. And when a feature stretches across multiple days, fresh chats, or different AI clients, keeping track of which documents are active, which are reference specs, and which are finished becomes a chore.

**Work Sessions** scale naturally with your task so you only use as much structure as you need:

1. **All Your Session’s Artifacts in One Place:** Start a session and **collapse the side panel** for a clean, full-width **`Working`** gallery with 2-line previews, instant title search, and type filters—where every card opens directly in the rendered **Preview UI**.
2. **Work at a Glance & Shared Context:** Expand the **two-column Session Manager** to organize documents across `Working`, `References`, and `Archived` zones, write shared **`Instructions`**, and click **`Connect`** so any new chat or AI client picks up your project context immediately—without cluttering your Git repository with ad-hoc Markdown folders.

---

## 1. All Your Session’s Artifacts in One Place

If you just want one visual place to store, search, and reopen all the artifacts created during a working session—without setting up multi-zone rules or agent instructions—a Work Session takes seconds to use.

### Start a session (from chat or from an open artifact)

You can start a Work Session in two ways:

- **Ask your AI directly in chat:** Ask the agent to start a new Work Session for your task:
  ```text
  Start a Work Session named "Auth Token Refresh" and create an API design artifact for me to review.
  ```
  The agent creates the session, connects automatically, and places every artifact created during that conversation into the session's **`Working`** view.
- **From an existing artifact in the IDE:** While viewing an artifact in the **Preview UI**, click **`Start a work session`** in the top header (or click **`+`** in the **Sessions** section of the AI Artifacts sidebar), enter a title, and paste the copied connect prompt into your chat so future artifacts in that thread are added automatically.

### Collapse the side panel for a focused `Working` gallery

If you do not need `Instructions`, `References`, or `Archived` zones yet, click the **Side Panel Toggle** button in the Session Manager header to collapse the right-hand panel.

![Work Session Manager with the side panel collapsed showing the Working grid](URL_TO_COLLAPSED_SESSION_IMAGE)
_Collapse the side panel to turn the Work Session Manager into a focused, multi-column Working gallery._

With the side panel hidden, the Session Manager acts as a clean visual dashboard for your session:

- **Responsive Card Grid:** Your **`Working`** artifacts expand across up to 3 columns, showing each document's title, type badge, 2-line preview snippet, and date.
- **Instant Search & Type Filtering:** Use the **Filter** input at the top to search cards by title, or use the **Type Filter** dropdown (`Implementation plan`, `Design`, `Spec`, `Note`, etc.) to narrow down documents immediately.
- **Add Existing Artifacts Anytime:** Click the **`＋` (Add Artifact)** button beside `Working` to pull in any standalone artifact from your global library.
- **One-Click Preview UI:** Click any card to open its rendered **Preview UI** with formatted tables, Mermaid diagrams, Shiki code blocks, and inline comments—no hunting through raw Markdown files.

---

## 2. Work at a Glance & Shared Context

Managing a larger feature through ad-hoc Markdown folders inside your repository gets messy fast—you end up reading dry raw `.md` files, inventing a different folder convention and prompt template every time, polluting `git status`, and re-explaining the project whenever you open a fresh chat.

When your work grows beyond a few files, click the **Side Panel Toggle** to expand the right-hand panel. Now the **Work Session** gives both **you** and **your AI agents** a complete, ready-made environment stored outside your Git repository:

| Who It Serves        | What You Get                                                                                                                                                                                                           | Why It Matters                                                                                                                                                        |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **You (In the IDE)** | **Two-Column Session Manager & Preview UI:** `Working` cards on the left; `Session Type`, `Instructions`, `References`, and `Archived` on the right. Every card across all zones opens in the rendered **Preview UI**. | You see the entire state of a feature **at a glance** and read formatted previews instead of managing raw `.md` files in your repo.                                   |
| **Your AI Agents**   | **Built-In Skill & Prepared Context (`Connect`):** The bundled Work Session skill reads your Markdown `Instructions` and the categorized catalog of `Working`, `References`, and `Archived` documents.                 | Any new chat or supported AI client knows your rules and reads the exact reference documents it needs without you inventing folder conventions or pasting file paths. |

### Organize documents across `Working`, `References`, and `Archived`

Use the card menu in the Session Manager—or simply ask your connected AI in chat—to move and reorder documents across the three zones as your feature evolves:

| Zone           | Location in UI            | Purpose for You                                                                                              | How Agents Use It                                                                                                               |
| :------------- | :------------------------ | :----------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| **Working**    | Main left column          | Active documents currently being drafted, reviewed, or implemented (e.g., _Phase 2 Implementation Plan_).    | Treated as the current work in progress.                                                                                        |
| **References** | Right side panel          | Stable, approved context that governs the work (e.g., _Architecture Blueprint_, _API Spec_, _Requirements_). | Consulted on demand so the agent stays aligned with your design decisions.                                                      |
| **Archived**   | Right side panel (bottom) | Completed or superseded documents from earlier steps (e.g., _Phase 1 Plan_ once Phase 1 is finished).        | Kept accessible for historical lookup, but separated from active work so agents do not waste context tokens on finished phases. |

> **Tip: Let your AI tidy the session for you**
> When `Working` gets crowded, you do not have to move every card manually. Just tell your connected agent in chat:
> _"Move the API Spec artifact to References and the completed Phase 1 Plan to this session's Archived zone."_

> **Good to know:** Moving a card into a Session's **Archived** zone only organizes that session's layout—it does **not** globally archive the artifact or schedule it for deletion. Active (unarchived) artifacts and sessions are kept indefinitely in `~/.ai-artifacts/`; only items explicitly moved to the global **Archive** are automatically cleaned up after **90 days** (`agentPlus.artifactRetentionDays`).

### Write Session Instructions (Your Agent's Onboarding Brief)

In the right-hand panel under **Session Type**, you will find the **Instructions** block:

- Type your project rules, coding conventions, or which `References` documents an agent should read before starting work, then click **Save** (or ask your AI in chat to help draft and save the Instructions with you).
- Prefer a full editor tab? Click **Open Markdown File** to edit the session's `instructions.md` file directly in VS Code—changes sync back to the Session Manager automatically.

When an agent joins the session, it keeps these **Instructions** in memory and checks them before starting related tasks.

### Connect a fresh chat or another AI client

When your current chat thread gets long—or when you want to open a second chat to continue the next phase—you do not need to re-explain your setup:

1. Click **`Connect`** in the **Work Session Manager** header (or from the session's item in the **Sessions** sidebar) to copy the join prompt.
2. Open a **new chat** in any supported AI client and paste the prompt with your next task:

```text
[Pasted Session Connect Prompt]
Read the Architecture Blueprint in References, then create an implementation-plan artifact for Phase 2 so I can review it.
```

The new agent joins the session, reads your **Instructions** and the categorized document catalog, consults the blueprint in `References`, creates the new plan in **`Working`**, and opens the **Preview UI** for your review.

---

## Handy Session Controls

- **Pause Auto-Open Temporarily:** In the Session Manager header, open the **Settings (gear)** menu and choose **Turn off auto-open artifact** if you want agents to create or update artifacts in the background without interrupting your reading.
- **Export a Portable ZIP:** From the **Settings (gear)** menu, choose **Export** to save a `.zip` archive containing `Instructions.md` and organized `Working/`, `References/`, and `Archived/` folders with numbered Markdown files—ready to share with teammates or store outside the IDE.
- **Find Sessions Quickly from the Sidebar:** In the **AI Artifacts** view in the Activity Bar under **Sessions**, you can **Pin** active sessions to the top, filter by **Session Type** (`Conversation`, `Project`, `Feature`, `Fix`, or custom types), or search sessions by title.

---

## What's next?

Once your project context and instructions live in a **Work Session**, you can hand work off across different AI coding clients—or let multiple agents coordinate automatically:

- **Workflow overview:** [Part 00: AI Artifacts Workflow Guide — When to Use What](https://dev.to/huynguyen294/tutorial-00-ai-artifacts-workflow-guide-when-to-use-what-2hjf)
- **Next guide:** [Part 03: Cross-Client Handoffs & Reusable Context Across AI Agents](https://dev.to/huynguyen294/cross-client-handoffs-reusable-context-across-ai-agents-40d9)
- **Automated workflows:** [Part 04: Automated Multi-Agent Workflows with Session Waiters & Waiting Room](https://dev.to/huynguyen294/automated-multi-agent-workflows-43mb)
