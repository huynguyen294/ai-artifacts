# AI Artifacts Tips

Small habits that make reviews easier and shared context more useful.

## Use a review round to resolve uncertainty

You can ask about a proposal before deciding whether it needs a change. When submitted comments contain only questions, the agent answers in chat and opens another review round with the document unchanged. Make a requested edit explicit when you want one.

> Why does this design need a background process? Explain the trade-off before changing the proposal.

## Leave a useful checkpoint before switching chats

After a long discussion, capture the decisions, their reasons, unresolved questions, and next step in a context artifact. A new chat can continue from those saved conclusions; joining a Session does not transfer the previous chat's history. Keeping pending choices clearly marked helps the next agent avoid treating a suggestion as an approved decision.

> Update this Session's context artifact with what we decided, why, and what remains open. Include the next step for a new chat.

## Shape Instructions together with your agent

You do not need to write a complete workflow upfront. Describe how you want to work and ask the agent to help formulate the rules, including where it should stop for your decision. Save the agreed guidance in Instructions; keep the work's findings and changing progress in artifacts. After changing Instructions, ask agents already working in the Session to reload them.

> Help me define when agents should hand work over and when they should wait for me. Save the Instructions once we agree.

## Let your agent tidy the Session

When Working becomes crowded, ask the agent to move or reorder existing artifacts instead of arranging every card yourself. Name the documents and destinations so the intended organization is clear. Moving a document into a Session's **Archived** zone keeps it available as context; it does not globally archive it or schedule its deletion.

> Move the requirements artifact to References and the completed review to this Session's Archived zone. Keep the current plan first in Working.

## Assess review findings before choosing fixes

For work with a separate reviewer, you can ask another agent to assess the findings before you choose changes. Keep the original findings alongside the assessment so you can judge whether each issue is valid, necessary to address, and within scope. This is a workflow you choose, not an automatic product judgment.

> Assess these findings for validity, necessity, scope, and regression risk. Keep the original findings visible and wait for my decision before applying fixes.

## Pause automatic opening during a busy workflow

If incoming artifacts interrupt your reading, use **Turn off auto-open artifact** in the Session Manager's **Settings** menu. You can still open documents manually, and review waits remain active. The pause applies to the current IDE window and resets when that window reloads.

For setup and step-by-step usage, see the [AI Artifacts guide](https://github.com/huynguyen294/ai-artifacts#readme).
