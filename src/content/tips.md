# AI Artifacts Tips

## Start a Work Session with your agent

### Create an artifact and start the session

Start with a feature or task you want to work on. Ask your agent to create an artifact, such as a requirements document or implementation plan, and start a new Work Session for it.

Try asking:

> Create a requirements artifact for this feature and start a new Work Session for it.

### Write and update Session Instructions

Work together to define the session’s **Instructions**: team conventions, the rules to follow, each agent’s role, the workflow, and when to hand work over or wait for feedback. Once you’ve agreed on the guidance, ask the agent to save it to the session’s Instructions so connected agents read the same rules before starting work.

As your work evolves, ask the agent to update the Instructions directly, so agents joining or continuing the session can read the latest guidance.

Try these prompts:

- **Add Instructions:** “Help me define this session’s Instructions, including roles, rules, workflow, and handoff expectations. Save the guidance once we’ve agreed on it.”
- **Update:** “Update this session’s Instructions with the review and handoff rules we just agreed on.”

### Organize the session’s artifacts

You can also ask the agent to organize your session by moving artifacts between **Working**, **References**, and **Archived**.

- Keep active plans and review outputs in **Working**.
- Place requirements and background specs in **References** so agents can read them on demand.
- Move finished artifacts to **Archived** within the session when you want a cleaner workspace without deleting history.

Try asking:

> Move the requirements artifact to References and the completed review to Archived in this Work Session.

### Connect another agent cleanly

Use **Connect** in the Work Session header (or from the Sessions sidebar) to copy a join prompt with the exact session ID rather than pasting long chat transcripts.

```text
Use the work-session skill to join this work session and apply its instructions:
tool: "join_session"
sessionId: "<your-session-id>"
```

For project documentation and updates, visit the [AI Artifacts GitHub repository](https://github.com/huynguyen294/ai-artifacts).
