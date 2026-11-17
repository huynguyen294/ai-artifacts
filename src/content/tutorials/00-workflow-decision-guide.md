# Tutorial 00: AI Artifacts Workflow Guide — When to Use What

Not every coding task needs a multi-document workspace or automated multi-agent handoffs. Sometimes you just want to read a 200-line implementation plan in a clean **Preview UI** instead of squinting at a narrow chat sidebar or raw Markdown syntax. Other times, you want a simple place to collect the 3–4 documents created during a feature, or you need a structured workspace that multiple chats and AI agents can join.

**AI Artifacts** is designed so that **complexity follows real need**. Use this guide to choose the exact level of structure your current task requires.

---

## Comparison at a Glance

| Workflow                                                                                                                                       | Best For                                                                                             | What you get                                                                                                                                                                                                              |
| :--------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Single-Document Review**<br/>👉 [Part 01](https://dev.to/huynguyen294/this-extension-lets-your-ai-agent-create-artifacts-for-plans-workarounds-and-designs-in-cursor-19n3)                                                        | Reviewing one plan, design, or note—or having a 2nd AI review your plan.                             | Opens documents in a rendered **Preview UI** (tables, code, Mermaid) instead of raw Markdown. Highlight any block to leave inline comments, click **Proceed** to execute, or use **Inspect artifact** for a 2nd AI check. |
| **2. All Your Session’s Artifacts in One Place**<br/>👉 [Part 02](https://dev.to/huynguyen294/organizing-work-sessions-from-simple-collections-to-shared-context-hlk)                                    | Storing and browsing multiple artifacts created during a single working session.                     | Collects your session's artifacts into one visual **Working** gallery (with the side panel collapsed) featuring 2-line previews, instant title search, and type filters.                                                  |
| **3. Work at a Glance & Shared Context**<br/>👉 [Part 02](https://dev.to/huynguyen294/organizing-work-sessions-from-simple-collections-to-shared-context-hlk) · [Part 03](https://dev.to/huynguyen294/cross-client-handoffs-reusable-context-across-ai-agents-40d9) | Seeing a larger piece of work at a glance and continuing across fresh chats or different AI clients. | Organizes documents into **Working**, **References**, and **Archived** with shared **Instructions**. Click **Connect** so any new chat or AI client picks up the context immediately without re-explaining.               |
| **4. Automated Multi-Agent Workflows**<br/>👉 [Part 04](https://dev.to/huynguyen294/automated-multi-agent-workflows-43mb)                                               | Running repeatable multi-agent loops (e.g., _Coder ↔ Reviewer_) without copy-pasting between chats.  | Agents follow your **Instructions** to stand by in the **Waiting room** and wake each other up—or hand off review feedback through artifacts—while you keep final **Proceed** control.                                    |

## Detailed Breakdown: Which Workflow Fits Your Task?

### 1. Single-Document Review

**Why it matters:** Scrolling through a 200-line plan in a narrow chat sidebar is cramped, and opening a raw `.md` file forces you to read unrendered syntax (`|---|---|`, raw `mermaid` fences, and heading hashes) while manually quoting lines back into chat.

**What you get:**

- **A rich reading and commenting UI:** Every artifact opens in a dedicated **Preview UI** with rendered tables, syntax-highlighted code, and visual Mermaid diagrams. Highlight any rendered block to attach inline comments or questions, then choose **Review**, **Proceed**, or **Just save**.
- **Easy second-AI review on a single plan:** Click **`Inspect artifact`** in the preview header and paste the prompt into a second AI agent so it can read the proposal and leave review feedback directly on the artifact.

👉 **Read the guide:** [Part 01: Getting Started, Inline Review & Cross-Agent Checks](https://dev.to/huynguyen294/this-extension-lets-your-ai-agent-create-artifacts-for-plans-workarounds-and-designs-in-cursor-19n3)

### 2. All Your Session’s Artifacts in One Place

**Why it matters:** During a single coding session, you might generate 3 or 4 artifacts (an investigation note, an API design, a migration checklist). Instead of scrolling up and down a long chat thread to find links, you want one visual place to store, search, and reopen them.

**What you get:**

- **Automatic collection in one session:** Ask your AI to start a Work Session for your task—it connects automatically and places every artifact created during the conversation into the session's **`Working`** view.
- **A focused visual gallery:** Collapse the right-hand side panel in the Session Manager for a full-width, multi-column **`Working`** grid showing 2-line previews, instant title search, and type filters (`Implementation plan`, `Design`, `Spec`, `Note`, etc.).
- **Instant rendered previews:** Click any card in the gallery to open its **Preview UI** immediately—no hunting through raw Markdown files.

👉 **Read the guide:** [Part 02: Organizing Work Sessions — From Simple Collections to Agent Context](https://dev.to/huynguyen294/organizing-work-sessions-from-simple-collections-to-shared-context-hlk)

### 3. Work at a Glance & Shared Context

**Why it matters:** Managing a larger feature through ad-hoc Markdown folders in your repo is messy—you end up reading dry raw `.md` files, inventing a new folder structure and workflow prompt every time, cluttering your Git tree, and re-explaining everything when switching chats or AI clients.

**What you get:**

- **Rich UI to see your work at a glance:** Instead of a raw Markdown folder, the two-column **Session Manager** organizes your work into **`Working`** (active drafts), **`References`** (specs and blueprints), and **`Archived`** (completed work). Click any card across any zone to read it in the rendered **Preview UI**.
- **Built-in structure & AI skill (no DIY setup):** Write your rules or workflow once in **`Instructions`**. When you click **`Connect`** in a fresh chat or another AI client, the built-in Work Session skill automatically guides the agent to follow your **Instructions** and read the exact reference documents it needs.
- **Zero repo clutter:** All working documents and session context live outside your repository in global storage (with 1-click **Export ZIP** whenever you want a portable copy).

👉 **Read the guides:** [Part 02: Organizing Work Sessions](https://dev.to/huynguyen294/organizing-work-sessions-from-simple-collections-to-shared-context-hlk) · [Part 03: Cross-Client Handoffs & Reusable Context](https://dev.to/huynguyen294/cross-client-handoffs-reusable-context-across-ai-agents-40d9)

### 4. Automated Multi-Agent Workflows

**Why it matters:** Acting as a manual messenger between two agents in the same session (*"Agent A finished updating the plan, now tell Agent B to review it"*) gets repetitive when you run structured review loops.

**What you get:**

- **Role-based coordination:** Define roles and handoff rules in **Session Instructions** (for example, *Coder*, *Reviewer*, and *Assessor*).
- **Automated handoffs:** Participating agents stand by in the **Waiting room** and wake each other up automatically when work is ready—or hand review feedback directly from one agent to another through the artifact.
- **Human control where it counts:** Monitor active waits in **`Waiting room (n)`**, stop any wait with one click, and keep final authority over **Review** and **Proceed**.

👉 **Read the guide:** [Part 04: Automated Multi-Agent Workflows with Session Waiters & Waiting Room](https://dev.to/huynguyen294/automated-multi-agent-workflows-43mb)
