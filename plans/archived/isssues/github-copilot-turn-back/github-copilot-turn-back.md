### Problem summary

The AI Artifacts review editor works well, including inline comments and review submission. However, the review lifecycle does not reliably continue automatically after the user clicks Review.

The agent sometimes terminates its chat turn instead of advancing to the next review round, leaving the artifact with submitted feedback but no active agent processing it.

This has been reproduced in multiple fresh Copilot conversations using simple implementation plans.

### Affected area

Artifact review editor

### Steps to reproduce

Start a new GitHub Copilot Agent conversation.

Use the create-review-artifact skill to generate an implementation plan.

The agent successfully calls create_artifact followed by wait_for_artifact_review.

Open the interactive review editor.

Add an inline comment requesting a change.

Click Review.

The waiting MCP tool successfully returns decision: "revise".

Copilot sometimes finishes the conversation instead of processing the feedback and calling advance_and_wait_for_artifact.

### Expected behavior

After Review:

All submitted comments should be processed.

The agent should revise the plan.

The updated plan should appear as Round 2.

The review cycle should continue until the user chooses Proceed.

### Actual behavior

Three distinct failure modes were observed.

1. MCP request timeout

Initially, wait_for_artifact_review failed with:

MCP server 'ai_artifacts': McpError:
MCP error -32001: Request timed out

After migrating the MCP server into Copilot's native configuration and setting timeout: 3600000, a review lasting approximately 10 minutes successfully returned feedback.

This suggests the increased timeout may have addressed the initial issue, although it has not been fully validated for 60 minutes.

2. Artifact integrity error

In another session, Copilot edited the managed artifact.md directly before invoking advance_and_wait_for_artifact.

The tool rejected the update:

artifact.md changed outside the artifact
review update protocol.

Additional Copilot instructions were added to prohibit direct modification of managed artifact files and require passing the complete revised Markdown through the MCP tool.

3. Agent finishes after a successful Review submission

In the latest reproduction, wait_for_artifact_review successfully returned:

{
"reviewRound": 1,
"decision": "revise"
}

Despite receiving the review decision, Copilot ended the conversation with a plan summary instead of advancing the review.

A follow-up user prompt explicitly requesting recovery successfully made Copilot inspect the saved feedback and advance the existing artifact to Round 2.

However, Copilot then ended its turn again, stating that Round 2 was waiting for review.

After adding another comment and clicking Review in Round 2, the review controls became disabled but Copilot did not resume automatically.

This suggests that artifact persistence and MCP recovery work, but the automatic continuation of the agent's review lifecycle is unreliable.

### Reproduction frequency

Every time

### Environment

OS: Windows

Editor: Visual Studio Code

Agent: GitHub Copilot Chat (Copilot SDK harness)

Model tested: MAI-Code-1.1-Flash

Extension: AI Artifacts – Interactive Planning & Review

Extension version: To be confirmed

MCP server: ai_artifacts, using Node.js

MCP configuration: Copilot native mcp-config.json

Configured MCP timeout: 3600000 ms (60 minutes)

All five AI Artifacts MCP tools are connected and available.

### Artifact context

_No response_

### Logs and error output

_No response_

### Screenshots or recordings

_No response_

### Additional context

**Workarounds attempted**

Installed and verified the GitHub Copilot MCP integration.

Confirmed Node.js is available and all five AI Artifacts tools are exposed.

Migrated the MCP configuration into Copilot's native mcp-config.json.

Increased the MCP request timeout to 60 minutes.

Added explicit Copilot instructions to call wait_for_artifact_review and continue after decision: "revise".

Added instructions prohibiting direct edits to managed artifact files.

Reproduced the problem in new conversations and with different simple plans.

Successfully recovered a stalled artifact through inspect_artifact_review and advance_and_wait_for_artifact.

**Questions for the developer**

Is the GitHub Copilot SDK harness fully supported for automatic multi-round reviews?

Is the agent expected to remain in an active MCP waiting call between every review round?

Is there a known problem with Copilot ending its turn after a successful revise response?

Could the extension support a more robust review handoff that resumes Copilot without depending on a continuously running MCP request?

Is there a recommended configuration or supported model/harness combination for reliable multi-round reviews and automatic implementation after Proceed?

**Additional information**

The artifact editor itself works well. Inline comments are saved, and the MCP tools can recover existing reviews.

The principal problem is the reliability of the automatic transition between review rounds and the ability to resume the agent after user feedback.

Screenshots showing the successful revise response, timeout error, artifact-integrity error and interrupted review lifecycle are available.

Happy to provide diagnostic logs or test a proposed fix.

### Pre-submission checklist

- [x] I searched existing issues for the same problem.
- [x] I removed secrets and sensitive information from this report.
