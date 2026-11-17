# Automated Multi-Agent Workflows with Waiting Room & Agent Handoffs

When you run a repeatable multi-agent process—such as one agent drafting or implementing a plan, a second agent reviewing the work for issues, and a third step assessing which findings are actually worth fixing—manually relaying messages between chats (*"Hey Reviewer, the author just finished updating the artifact, please check it now"*) quickly becomes tedious.

**AI Artifacts** lets participating agents coordinate handoffs inside a shared **Work Session** without you copying and pasting between chats. You define the roles, handoff rules, and approval checkpoints in **Session Instructions**, monitor standing waits in the **Waiting room**, and step in only where human judgment matters.

---

## How Automated Coordination Works (Without Giving Up Control)

Automation in AI Artifacts is **instruction-driven, not a black-box pipeline**. The extension provides the shared **Work Session**, the rendered **Preview UI**, and the handoff mechanisms; **you** choose the roles, which AI clients to use, and where agents must stop for your decision.

Inside a Work Session, agents can hand work over in two ways:

1. **Agent-to-Agent Review Through an Artifact:** One agent waits for feedback on a specific artifact while a **Reviewer** agent inspects the document, posts findings as artifact comments, and submits **Review**. The waiting agent receives the feedback automatically and continues according to your **Instructions** (for example, preparing an assessment of the findings for your review).
2. **Standby Handoffs via the `Waiting room`:** An agent can stand by in the session's **Waiting room** for its next assignment. When another agent finishes its step, it wakes that specific waiting agent with a handoff message and target artifact.

> **You always keep final authority:** Joining a session, reading an artifact, or receiving a handoff never authorizes an agent to execute an unapproved plan. Only your explicit click on **`Proceed`** on a plan artifact authorizes code execution.

---

## Step 1: Define Roles and Checkpoints in Session `Instructions`

Open your **Work Session Manager**, expand the right-hand side panel, and define how your agents should collaborate in the **Instructions** block (or ask your connected agent in chat to help draft and save the rules for you).

Because the built-in skills already know how to use the underlying tools, you can write your **Instructions** in plain language:

```markdown
# Session Workflow Instructions

## Roles
- **Author / Implementer:** Drafts plans and documents in `Working`, evaluates review findings, and implements code changes ONLY after I click `Proceed`.
- **Reviewer:** Checks the target artifact against the requirements and design in `References`, posts each finding as a comment on the artifact, and submits Review without modifying the document directly.

## Handoff & Assessment Rules
1. When reviewing a draft artifact, the Author waits for review on that artifact while the Reviewer inspects it and submits Review.
2. When the Author receives the Reviewer's feedback, do not apply every suggestion blindly. Create a `Review Assessment` artifact in `Working` that keeps the original findings alongside an assessment of each item's validity, necessity, scope, and risk.
3. Stop and report to me so I can review the assessment in the Preview UI and decide which changes to apply.
```

Click **Save** in the Instructions panel (or edit `instructions.md` via **Open Markdown File**).

---

## Step 2: Run an Agent-to-Agent Review Handoff

With your workflow saved in **Instructions**, connect two AI chats (across the same editor or two different clients like **Cursor** and **Claude Code** / **Codex**) to the same Work Session using **`Connect`**:

1. **Assign the Author / Supporter role in Chat 1:**
   ```text
   [Pasted Session Connect Prompt]
   You are the Author. Wait for review submission on the current artifact in Working. When you receive the Reviewer's feedback, create the Review Assessment artifact according to our Session Instructions and wait for my decision.
   ```
2. **Assign the Reviewer role in Chat 2:**
   ```text
   [Pasted Session Connect Prompt]
   You are the Reviewer. Review the active artifact in Working against our Session Context and References. Post each finding as a comment on that artifact, submit Review, and stop without editing the document.
   ```

![The Reviewer submits artifact comments and the waiting agent receives the feedback](URL_TO_AGENT_REVIEW_HANDOFF_GIF)
_One agent posts comments and submits Review on the artifact; the waiting agent receives the feedback automatically without copying between chats._

**What happens next:**

- The **Reviewer** inspects the document, attaches its comments, and submits **Review**.
- The **Author** receives the submitted comments immediately, refreshes the source artifact, and creates the **Review Assessment** artifact in **`Working`**.
- You open the **Review Assessment** card in the **Preview UI** to read the Reviewer's original findings side by side with the Author's assessment—so you can approve only the changes that actually make sense.

![The waiting agent creates a review assessment artifact in the Work Session](URL_TO_AGENT_REVIEW_ASSESSMENT_GIF)
_Read the original findings and the assessment together in the Preview UI before deciding what to change._

---

## Step 3: Keep Agents on Standby in the `Waiting room`

When you want an agent to stay on standby across multiple tasks in a session—so another agent can wake it up whenever new work is ready—use the **Waiting room**:

1. **Ask an agent to wait in the session:**
   ```text
   Wait in this session for the next review handoff.
   ```
2. **Check `Waiting room (n)` in the Session Manager:** Look next to the **`＋` (Add Artifact)** button at the top of the **`Working`** column. Clicking **`Waiting room (1)`** shows every agent currently on standby, what it is waiting for, and the related artifact title on hover.
3. **Wake the waiting agent from another chat:** When the other agent finishes preparing an artifact or completing a step, ask it (or configure your **Instructions** so it knows) to send a handoff message to the waiting agent in the session. Only the targeted waiting agent is awakened to run its task.

### Stay in control at all times

- **One-click `Stop`:** Every entry in **`Waiting room (n)`** has a **`Stop`** button. Clicking **`Stop`** ends that wait cleanly without deleting any artifacts or session data, and a stopped wait never restarts on its own.
- **Works even with the manager tab closed:** Once agents are connected, background handoffs continue working even if you close the Work Session Manager tab.
- **Pause auto-open when agents are busy:** If background rounds open tabs while you are reading something else, open the **Settings (gear)** menu in the Session Manager header and choose **Turn off auto-open artifact**. You can still open any card manually in the **Preview UI** whenever you are ready.

---

## Series Summary: Choose the Workflow That Fits Your Task

You now have the complete **AI Artifacts** toolkit—from reviewing a single document to running coordinated multi-agent sessions:

| Workflow | Best For | Guide |
| :--- | :--- | :--- |
| **1. Single-Document Review** | Reviewing one plan, design, or note in the rendered **Preview UI** with inline comments—or having a 2nd AI review your plan via **`Inspect artifact`**. | [Workflow Overview](https://dev.to/huynguyen294/tutorial-00-ai-artifacts-workflow-guide-when-to-use-what-2hjf) · [Part 01](https://dev.to/huynguyen294/this-extension-lets-your-ai-agent-create-artifacts-for-plans-workarounds-and-designs-in-cursor-19n3) |
| **2. All Your Session’s Artifacts in One Place** | Storing, searching, and filtering multiple artifacts from one working session in a clean **`Working`** gallery (with the side panel collapsed). | [Part 02](https://dev.to/huynguyen294/organizing-work-sessions-from-simple-collections-to-shared-context-hlk) |
| **3. Work at a Glance & Shared Context** | Seeing a larger feature at a glance across **`Working` / `References` / `Archived`** and continuing across fresh chats or different AI clients via **`Instructions`** and **`Connect`**. | [Part 02](https://dev.to/huynguyen294/organizing-work-sessions-from-simple-collections-to-shared-context-hlk) · [Part 03](https://dev.to/huynguyen294/cross-client-handoffs-reusable-context-across-ai-agents-40d9) |
| **4. Automated Multi-Agent Workflows** | Letting connected agents hand off reviews and wake each other up through **`Instructions`** and the **`Waiting room`** while you keep final **`Proceed`** control. | **You are here (Part 04)** |
