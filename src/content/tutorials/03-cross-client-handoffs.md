# Cross-Client Handoffs & Reusable Context Across AI Agents

Different AI coding clients and models have different strengths. You might prefer **Claude Code** or **Codex** for deep architectural analysis and bug investigation, **Cursor** or **Windsurf** for multi-file implementation, and **GitHub Copilot**, **Cline**, or **Antigravity** for targeted reviews.

Normally, switching tools mid-feature—or even opening a fresh chat in the same editor to avoid context degradation ("context rot")—means copying long chat transcripts or explaining your architecture all over again. **AI Artifacts** removes that friction: because **Preview UI** rendering, artifact lifecycles, and **Work Sessions** are shared across all 7 supported AI clients, you can hand work off between chats and agents cleanly without losing momentum.

---

## Why Synthesized Context Beats Copying Chat History

A **Work Session** does **not** transfer raw chat transcripts from one AI client to another—and that is intentional. A long chat thread is full of dead ends, rejected drafts, and back-and-forth troubleshooting that confuses the next model.

Instead, reliable handoffs come from two things you control in your Work Session:

- **Distilled documents** organized into **`Working`** (active tasks), **`References`** (agreed specs, blueprints, and session context), and **`Archived`** (finished phases).
- **Shared `Instructions`** that tell any incoming agent how the session is organized, what role to play, and where to stop for your review.

---

## Step 1: Leave a Clean Checkpoint Before Switching Chats or Clients

Before ending a long analytical chat or switching from one AI client to another, ask your current agent to capture the conclusions in a context artifact (and place it in **`References`**):

```text
Update this session's context artifact with what we decided, why we chose this approach, what remains open, and the exact next step for a new chat.
```

**Why this habit matters:**

- **Decisions stay explicit:** Marking what is settled versus what is still open prevents the next agent from treating a rough idea as an approved requirement.
- **Instant orientation:** When a new agent joins the session later, it can read your context artifact and immediately understand what is finished (in `Archived`), what is in progress (in `Working`), and what needs to happen next.
- **Reusable knowledge:** If you solved a tricky bug or edge case, capturing the final takeaway as a note or spec in `References` keeps that knowledge available for future tasks without cluttering your Git repository.

---

## Step 2: Shape `Instructions` Together with Your Agent

You do not need to write a complex workflow specification from scratch before starting. Describe how you want to work in plain language and ask your connected agent to help formulate the rules for the session:

```text
Help me define the Instructions for this session: before proposing code changes, agents should read the Architecture Design and Session Context in References, draft an implementation-plan artifact for my review, and wait for my approval before modifying source files. Save the Instructions once we agree.
```

You can also edit the **Instructions** box directly in the **Work Session Manager** (or click **Open Markdown File** to edit `instructions.md` in VS Code) and click **Save**.

> **Tip:** If you update **Instructions** while other chats are already working in the session, simply ask those existing chats to reload the session's Instructions so they pick up the latest rules.

---

## Step 3: Connect a Fresh Chat or Switch to Another AI Client

Now that your conclusions are saved in artifacts and your rules are in **Instructions**, switching to a fresh chat—or handing implementation over to another AI client—takes one step:

1. In the **Work Session Manager** header (or from the **Sessions** sidebar), click **`Connect`** to copy the session join prompt.
2. Open a new chat in your target AI client (for example, switching from **Claude Code** to **Cursor** or **GitHub Copilot**) and paste the prompt.
3. Ask the new agent to confirm the current state or start the next task:

```text
[Pasted Session Connect Prompt]
Read the Session Context and Instructions. Summarize where we are, then create an implementation-plan artifact for Phase 2 so I can review it.
```

![Two agents join the same Work Session and report its progress and next steps](URL_TO_MULTI_AGENT_SESSION_CONTEXT_GIF)
_New agents join the same Work Session, read the shared context, and pick up right where the previous chat left off._

**What happens next:**

- The built-in Work Session skill loads your **Instructions** and the categorized catalog (`Working`, `References`, `Archived`).
- The agent reads the relevant reference documents on demand—without you copying file paths or re-explaining your architecture.
- It creates the *Phase 2 Implementation Plan* inside **`Working`** and opens the rendered **Preview UI** (tables, code, Mermaid) for your inline review.
- Once you refine the plan and click **Proceed**, the agent executes the approved changes immediately. When the phase is done, ask the agent to move the completed plan into **`Archived`** to keep **`Working`** focused.

---

## Step 4: Bring in a Reviewer Agent — and Assess Findings Before Fixing

When working on an important feature, you can connect a second AI client (for example, **Codex** or **Claude**) to the same Work Session as an independent **Reviewer**—and use an **Assessment** step so you never waste time on noisy or unnecessary suggestions:

1. **Have the Reviewer inspect the work:** Click **`Connect`**, paste the prompt into your Reviewer chat, and ask it to check the active artifact in `Working` against the requirements in `References`. The Reviewer can post its findings directly as comments on the artifact (or create a findings artifact in `Working`).
2. **Assess findings before choosing fixes:** Instead of blindly applying every suggestion—or manually reading through dozens of minor nitpicks—ask your primary agent (or a dedicated Assessor agent) to evaluate the findings first:

```text
Assess these review findings for validity, necessity, scope, and regression risk. Keep the original findings visible alongside your assessment in a review artifact and wait for my decision before applying any changes.
```

3. **Decide in the Preview UI:** Open the assessment artifact in the **Preview UI** to read the original findings side by side with the assessment. Use inline comments to confirm which fixes you actually want, then let the agent apply only the approved changes.

---

## What's next?

In this guide, you stayed in the driver's seat between phases—clicking **`Connect`** when opening a new chat or bringing in a Reviewer. What if you have two or three agents open in the same Work Session and want them to **hand work off to each other automatically** while preserving your review checkpoints?

- **Workflow overview:** [Part 00: AI Artifacts Workflow Guide — When to Use What](https://dev.to/huynguyen294/tutorial-00-ai-artifacts-workflow-guide-when-to-use-what-2hjf)
- **Previous guide:** [Part 02: Organizing Work Sessions — From Simple Collections to Shared Context](https://dev.to/huynguyen294/organizing-work-sessions-from-simple-collections-to-shared-context-hlk)
- **Next guide:** [Part 04: Automated Multi-Agent Workflows with Session Waiters & Waiting Room](https://dev.to/huynguyen294/automated-multi-agent-workflows-43mb)
