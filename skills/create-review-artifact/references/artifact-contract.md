# Codex Artifacts MCP contract

## Tools

`create_artifact` accepts a verified absolute `workspaceRoot`, typed `workspaceEvidence`, `title`, lowercase `kind`, and complete `markdown`. It creates schema-v4 lifecycle files and immediately returns the exact persistent artifact handle.

`wait_for_artifact_review` accepts `artifactDirectory`, `expectedReviewRound`, and optional `takeover`. It returns an existing submission immediately or owns the single transient waiter until Review, Proceed, Just save, cancellation, or takeover. A `revise` result includes a one-time `roundToken`.

For an `approve` result whose artifact kind is `plan` or `implementation-plan`, the result includes `nextAction.type: "execute-approved-plan"` and an explicit instruction to execute the approved plan immediately in the same turn. Treat this as execution authorization, not an acknowledgement request.

`inspect_artifact_review` accepts the exact `artifactDirectory`, optional `expectedReviewRound`, optional `takeover`, and optional `intent`. It immediately returns the validated manifest, Markdown, comments, optional submission, round, and hashes. It returns a `roundToken` when saved comments or a submission make the round consumable, or when `intent` is `"explicit-chat-update"` on an empty round; a chat-inspection token does not require a Review submission.

`advance_and_wait_for_artifact` accepts the exact `artifactDirectory`, `expectedReviewRound`, and `roundToken`, plus optional complete replacement `markdown`. It transactionally advances the same artifact and waits for the next round. Omitting Markdown preserves the exact `artifact.md` bytes and SHA while still resetting handled comments and removing the old submission.

## Lifetime model

```text
artifact lifetime > waiter lifetime > chat-turn lifetime
```

The artifact is persistent workspace data. A waiter is only an in-memory connection owned by one MCP request. Cancellation, takeover, completion of a chat turn, or MCP restart may detach the waiter but never deletes or ends the artifact. Proceed and Just save end only the submitted round; the exact artifact may be explicitly inspected, advanced, and reconnected later.

## Directory

```text
.codex-artifacts/artifacts/<server-generated-id>/
  artifact.json
  artifact.md
  comments.json
  review-submission.json  # present only after submission
```

All lifecycle files are server- or extension-owned. Codex must not create, update, or repair them directly. Schema-v3 artifacts remain viewable but read-only.

## Workspace and handle ownership

For creation, resolve ownership in this order: an explicit user path/link/attachment, a concrete active file from IDE context, an explicitly named repository verified against relevant source, or a user clarification. Cwd, workspace ordering, the first visible repository, and matching folder names are hints only.

For wait, inspection, advance, and reconnect, use only the exact `artifactDirectory` returned by creation or retained from the interrupted waiter in the same conversation. Never select “the latest artifact” in a workspace. If the handle is missing or ambiguous, ask the user for the artifact path.

## Round tokens

A token is in-memory, single-use, expires after one hour, and is bound to the exact artifact, session, round, artifact hash, comments hash, and submission presence/hash. Any intervening change rejects it. A submitted-review token additionally requires `revise`. A chat-inspection token may consume saved comments without `review-submission.json`. A chat-update token requires non-empty replacement Markdown with a different SHA from the current artifact. Tokens are consumed only after a successful round commit. After MCP restart, a validated inspection can issue a fresh token.

## Decisions and chat feedback

- Review (`revise`) and chat-inspected feedback use the same classification and response policy. Their internal token source differs, but their user-visible result does not.
- Question-only: answer visibly in chat before advancing without Markdown, preserving artifact bytes and SHA.
- Change-only: advance with complete replacement Markdown.
- Mixed: answer visibly in chat, then advance with complete replacement Markdown.
- Needs clarification: ask in chat and leave the round unconsumed.
- No saved feedback: reattach a waiter to the same round without advancing, unless the user explicitly requested artifact changes in chat (in which case inspect with `intent: "explicit-chat-update"` to advance).
- Do not create or update `## Review responses`; conversational answers belong in chat. Remove a previously generated response section when producing a replacement document that contains one.
- Proceed (`approve`): for `plan` and `implementation-plan`, execute the complete approved plan immediately in the same turn according to `nextAction`; do not stop at acknowledgement, summarize future work, or request another confirmation. For other artifact kinds, perform only the follow-up already implied by the request. Do not auto-advance.
- Just save (`save`): save as requested and do not auto-advance.
- Explicit reconnect after Proceed/Just save: inspect, advance without Markdown, and wait. Never repeat the prior command merely because the artifact was reconnected.
