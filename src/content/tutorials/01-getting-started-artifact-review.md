# This extension lets your AI agent create artifacts for plans, workarounds and designs in Cursor, Claude Code, Codex, Windsurf, GitHub Copilot, Cline and Antigravity

This guide uses an extension called AI Artifacts to let **Cursor, Claude Code, Codex, Windsurf, GitHub Copilot, Cline, or Antigravity** produce a plan, workaround note, or design as a separate document—an artifact—inside your IDE. Instead of scrolling through a narrow chat sidebar or reading raw Markdown syntax, you read a rendered preview (with formatted tables, syntax-highlighted code, and Mermaid diagrams), comment on exact passages, and send all feedback back in a single step.

## What you will need

- VS Code 1.95 or newer, or a compatible editor such as Cursor, Windsurf, Antigravity or VSCodium
- An AI agent that supports MCP and skills (Cursor, Claude Code, Codex, Windsurf, GitHub Copilot, Cline or Antigravity)
- Node.js available as `node` in your `PATH`

## Step 1: Install and connect the extension

Install **AI Artifacts** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=huynguyen294.ai-artifacts) or [Open VSX](https://open-vsx.org/extension/huynguyen294/ai-artifacts). The extension communicates with your agent through the Model Context Protocol (MCP) and a small skill that defines how documents are created and updated.

1. On first activation, click **Run Installer** in the prompt—or open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **AI Artifacts: Installer**. This preselects detected clients on the machine and leaves unrelated MCP settings and skills unchanged; press `Enter` (or click **OK**) to configure them.
2. Click **Reload Window** when prompted.
3. Restart your AI chat extension or agent, then start a **new** chat. A chat that was already open cannot load tools installed after it started.
4. Run **AI Artifacts: Verify All Integrations**. The skill and the base runtime should both report **Ready**.

![_Running AI Artifacts: Installer_](URL_TO_INSTALL_GIF)

## Step 2: Ask the agent to create an artifact

The agent creates a review document only when it is asked to. A request for "a plan" on its own produces a plan in the chat. Include the word _artifact_ in the prompt:

```text
Create a dummy plan with: a mermaid diagram, a comparison table, code blocks,
a task list, and open questions. Create an artifact for me to review.
```

You can also name the skill directly: `create-review-artifact` (in Codex, `$create-review-artifact`).

![_The agent creates the artifact and the review editor opens_](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/1tl8z3jnbhcgzi7vsve6.gif)

The review editor opens in your focused IDE window automatically, and the agent also shares a clickable link to the artifact in chat so you can open it directly.

## Step 3: Review the document with inline comments

Read the plan in the rendered preview—with formatted tables, code blocks, and Mermaid diagrams instead of raw Markdown symbols. Select any paragraph, heading, list item, quote, code block or table cell, type a comment in the popover, and press `Enter` to save it (`Shift+Enter` inserts a new line). Saved comments are listed in the **Comments** drawer, and the **Review** button shows how many are pending.

In the example plan, four comments were left:

- **Interface sketch:** add more detail.
- **Tasks:** add more detail.
- **Acceptance criteria:** delete the section, which is unnecessary for a feature this small.
- **Rollback:** delete the section for the same reason.

![_Selecting text and leaving a comment_](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/0rufkl1cf95087l83zff.gif)

Comments can also be questions, such as asking why a particular approach was chosen.

## Step 4: Submit the review

Four decisions are available in the editor header:

- **Review** sends all saved comments to the agent and starts the next round. It requires at least one comment.
- **Proceed** approves the document. For a plan, the agent begins carrying it out immediately.
- **Just save** ends the review without executing anything. It suits cases where you only want to keep an idea: the agent saves the document to a file so you do not have to copy it manually.
- **Copy Markdown** copies the raw text to the clipboard without changing anything.

The example plan still needed changes, so **Review** is the correct choice. The agent acknowledges the comments in the chat, summarizes what it is applying, and opens round 2.

## Step 5: Verify round 2

The agent answers questions in the chat and revises the document only where changes were requested. If a review contains only questions, the document stays byte-for-byte identical and the round still advances.

Round 1 of the example, with four comments saved:

![_Round 1: four comments saved. Tasks, Acceptance criteria and Rollback are highlighted; the Interface sketch comment is just above_](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/gffeaoi9v15q58wby73x.png)

Round 2, after the agent applied them:

![_Round 2: a longer, more detailed task list, and no acceptance criteria or rollback sections_](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/ro0wsxnkhi6q1fpv5bpk.png)

The task list grew from 7 items to 11 with more concrete steps, the API example gained its response, and the two sections flagged for deletion were removed. The review can continue for as many rounds as needed, ending with **Proceed** or **Just save**.

## Step 6: Resume a review

An artifact remains available after its editor tab is closed or the chat ends, so a review can be resumed without starting over.

**In the same chat**, ask the agent to reopen the artifact.

**In a new chat:**

1. Run **AI Artifacts: Search Artifact** from the Command Palette and type part of the title.
2. Select the artifact to open it in the review editor.
3. Click **Inspect artifact** in the editor header. This copies a prompt that points to that exact artifact.
4. Paste the prompt into the new chat.

The agent reads the saved state and reports the current review round. Reconnecting never repeats an action that was already approved.

![_Search an artifact, copy the Inspect prompt, paste it into a new chat, and the agent reads the saved state_](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/m56t1zvoh4jaz5hgwkpt.gif)

You can also browse and reopen recent documents directly from the **AI Artifacts** sidebar in the Activity Bar under **Recent Artifacts**.

![_Reopening an artifact from Recent Artifacts in the AI Artifacts sidebar_](URL_TO_RECENT_ARTIFACTS_IMAGE)

## Step 7: Have a second AI review your plan

Because **Inspect artifact** lets any supported AI agent read the exact same artifact, you can get a second opinion on an important plan before you click **Proceed**:

1. While viewing the plan drafted by Agent 1 (for example, in Cursor), click **Inspect artifact** in the editor header.
2. Open a chat with a second AI agent (for example, Claude Code or Codex), paste the prompt, and ask it to review the proposal:

   ```text
   [Pasted Inspect artifact prompt]
   Review this plan for edge cases, missing steps, or simpler alternatives, and write your feedback into the artifact.
   ```

3. Agent 2 reads the artifact and writes its review comments directly onto the document (or replies in chat), so you and Agent 1 can refine the plan in the next round before executing code.

## Step 8: Use artifacts for other document types as well

Artifacts are not limited to plans. You can use the same review workflow for requirements, designs, specs, analysis reports, or workaround notes:

```text
Create a requirements artifact for the webhook retry policy, including edge cases
and acceptance criteria, so I can review it.
```

You can also ask the agent to create a `design`, `spec`, `analysis`, `report`, or `workaround` artifact whenever you want to review structured documents outside the chat thread.

## What's next?

Reviewing a single artifact is all you need when a task revolves around one document. When a session produces multiple artifacts that you want to browse in one place—or when you want to carry shared instructions and context into fresh chats—move up to **Work Sessions**:

- **Workflow overview:** [Part 00: AI Artifacts Workflow Guide — When to Use What](https://dev.to/huynguyen294/tutorial-00-ai-artifacts-workflow-guide-when-to-use-what-2hjf)
- **Next guide:** [Part 02: Organizing Work Sessions — From Simple Collections to Agent Context](https://dev.to/huynguyen294/organizing-work-sessions-from-simple-collections-to-shared-context-hlk)

## Links

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=huynguyen294.ai-artifacts)
- [Open VSX](https://open-vsx.org/extension/huynguyen294/ai-artifacts)
- [GitHub](https://github.com/huynguyen294/ai-artifacts)

Feedback is welcome in the comments or as an issue on GitHub. Please include the editor and agent you are using.
