# Product Philosophy

## Purpose: reviewable work and reusable context

AI Artifacts helps people understand and refine AI output through readable documents, keep the useful conclusions, and continue the work across chats and agents. Plans, designs, blueprints, requirements, roadmaps, and distilled conclusions should remain useful beyond the chat that produced them.

The product serves two connected needs: **confidence through review and informed decisions**, and **continuity through reusable working context**. Artifacts make one request reviewable. Work Sessions organize the documents and Instructions of a larger piece of work. Optional workflow automation connects agents working within that context while preserving the user's chosen review checkpoints.

These capabilities should fit the user's work without requiring everyone to adopt a multi-agent process. Reviewing one document is a complete use case. A Session is useful even with one agent. Workflow automation is an optional way to use a Session.

## Product structure and when to use it

| Capability | Problem it addresses | What it provides | A situation that calls for it |
| --- | --- | --- | --- |
| **Artifact review** | A substantial AI proposal is difficult to inspect and refine through chat alone; useful conclusions get buried in discussion. | Readable preview, inline comments, repeated review rounds, and a current synthesized document. | "I need to understand and refine this proposal" or "I want to keep the conclusions of this discussion." |
| **Work Session** | Related documents become scattered, and another chat needs context prepared again. | A document overview for people, plus Instructions, an organized catalog, and guided context access for agents. | "I need an overview of this work" or "I want another chat or client to continue from these documents." |
| **Workflow automation** | Moving work between agents requires repeated copying, prompting, and waiting. | Handoffs between participating agents within a shared Session, guided by the user's Instructions. | "I am relaying results between agents and want them to coordinate while keeping my review checkpoints." |

Artifact review is the foundation. A Session extends that foundation from one document to a body of related work. The Session Manager and workflow automation are parallel ways to use a Session: people can use the overview without automation, use workflows without keeping the manager open, or use both. This is a structure of capabilities, not a sequence every user must complete.

These are use cases, not claims about audience size. Developers, technical leads, solo builders, and people using AI for research or content may need different combinations depending on the work.

## Artifact: understand, refine, and retain the result of one request

An artifact turns the output of a request into a coherent document that can be improved over several review rounds. Preview and inline feedback help the user understand what the agent proposes, question specific passages, and decide what to accept. Requirements, designs, blueprints, research conclusions, and plans can all benefit from this process.

- **Read comfortably:** preview presents the document, including supported tables and diagrams, without making raw Markdown the primary reading experience.
- **Respond precisely:** inline comments attach feedback to the relevant passage instead of requiring the user to explain its location in chat.
- **Refine deliberately:** the user can ask questions, request changes, and review again before accepting the result.
- **Keep the conclusion useful:** the artifact holds the current synthesized document rather than a transcript of the discussion. It can remain standalone or become context within a Session.

The agent synthesizes the relevant conclusions when asked; the product supplies the surface to read, review, and retain that synthesis. A document can therefore serve first as a proposal under review and later as context for further work. Its value comes from useful content that people can understand and agents can reuse.

Questions are answered visibly in chat; question-only feedback preserves the document's exact Markdown. Requested edits revise the same artifact and start another round. The lifecycle retains the current document, not a revision history. Conversational answers do not accumulate inside the document itself.

The review surface is shared across supported AI clients through MCP and skills. Users should retain a familiar reading and feedback experience when choosing another supported client or model, including when using only one agent at a time.

## Work Session: give a body of work a shared context

A Work Session begins with a simple need: keep the useful artifacts of a larger piece of work together. It can contain plans, designs, requirements, roadmaps, and distilled conclusions from more than one conversation. It does not require multiple agents.

The same organized collection serves two audiences: people see the work through the manager and document previews; agents discover relevant context through Instructions and the catalog. The supplied structure and skill guidance reduce the setup users would otherwise have to design and teach to each new chat.

### A document overview for people

The Session Manager makes the body of work visible at a glance. Users can see related artifacts, open their readable previews, and organize them into **Working**, **References**, and **Archived** zones. The overview helps people understand which documents belong to the work and how they are being used.

This overview concerns the documents and context of the work. The Waiting room provides narrow visibility into active waits and lets the user stop them; it does not represent the progress, reasoning, or overall activity of every agent.

### A prepared entry point for agents

A Session combines user-authored **Instructions**, an organized artifact catalog, and a skill that guides agents in using that context. The user does not have to invent a folder convention and teach every new chat how to discover the relevant documents.

Joining the exact Session gives another chat or supported agent access to its Instructions and categorized catalog, including exact paths to available artifacts. The agent reads the documents relevant to its role and task. The same structure supports continuing in a new chat, changing clients, or bringing another model into the work.

Continuity comes from the Instructions and documents that have been saved. A Session does not transfer another chat's transcript, recover unstated decisions, or automatically load every artifact into a model's context. Important conclusions must be captured in documents to become shared context. The skill guides entry, role preparation, and context refresh; the user supplies the work-specific rules and material.

### Working documents outside the repository

Artifacts and Sessions live in the user's global AI Artifacts storage. A feature's planning and review material can remain separate from the source repository instead of adding working documents throughout the project. Users can explicitly save or export material when it belongs elsewhere.

A Markdown folder can also hold shared context. The Session packages organization, Instructions, guided agent access, readable previews, and review interaction into one working environment. This makes prepared context accessible to people who do not maintain their own folder conventions, as well as people managing many documents. Users still choose the relevant material, and agents must follow the guidance to use it correctly.

## Workflow: coordinate agents without giving up control

Shared Session context makes it possible for different chats, clients, and models to work on the same material. Optional Session waiters and requests let a participating agent wait for a handoff and another agent deliver the next request. This supports connected steps without the user manually relaying every message.

The user defines roles, handoff conditions, and review checkpoints in Instructions. They can choose different supported clients and models for different parts of the work. The extension supplies the shared context, review surface, and coordination mechanisms; the user chooses which tools suit each role.

A Coder/Reviewer loop is one possible workflow. For example, the user may review a plan in full, have one agent implement it, ask another to find issues, and have an agent assess those findings for validity, necessity, and scope before deciding what to fix. This lets the user choose where to review the full work and where to review an assessment.

**Automation is a product capability; a particular review workflow is a method the user defines.** Cross-review and filtering unnecessary findings are supported uses, not built-in quality judgments or a mandatory pipeline. Their results remain subject to the user's review.

## Human decisions and component responsibilities

Confidence should come from being able to inspect the proposal, question it, refine it, and choose what happens next. More agents or automatic handoffs do not replace those decisions.

| Participant or component | Responsibility |
| --- | --- |
| **User** | Defines the goal, scope, workflow, and approval checkpoints; makes the final decisions. |
| **Agent** | Works within its assigned role, reads relevant context, synthesizes documents or findings, and follows authorized handoffs. |
| **Artifact** | Holds the current reviewable document and its independent review lifecycle. |
| **Work Session** | Groups related artifacts and provides shared Instructions and organized context. |
| **Skills** | Guide explicit artifact operations, Session entry, context use, and the applicable workflow rules. |
| **MCP server** | Coordinates artifact lifecycle operations and Session wait/request delivery. |
| **Extension UI** | Provides document preview, human feedback and review decisions, Session organization, and visibility into active waits. |

Joining a Session, reading a document, or receiving a waiter request does not grant permission to execute an unapproved plan. Session Instructions and handoffs must preserve the user's authority and the artifact's approval rules.

## Review decisions retain their meaning

| Action | Meaning |
| --- | --- |
| **Review** | Submits feedback for another round. The agent answers questions in chat and edits the document only when changes are requested. |
| **Proceed** | Concludes review. For `plan` and `implementation-plan`, it authorizes immediate execution of the approved plan in the same turn. For other kinds, it acknowledges approval without automatically executing code. |
| **Just save** | Concludes the round and saves Markdown as requested without executing proposed work. |
| **Copy Markdown** | Copies the document without submitting a review decision. |

Proceed and Just save preserve the artifact. Explicit reconnect can reopen review later without replaying an earlier approval or save. A saved submission encountered during inspection is historical state, not a new execution directive.

Artifact creation and lifecycle work remain explicit user requests. A document type, Session membership, or a desire to track progress does not automatically create an artifact or start a review round.

## Persistence follows the user's decision to keep the work

Artifacts and Sessions remain useful beyond a chat turn. Closing a chat, cancelling a wait, changing agents, or restarting the MCP server must not discard the documents. A Session groups artifacts without taking over their independent review lifecycles; deleting a Session preserves its artifacts.

An artifact waiter is a temporary connection to a persistent document. Cancellation or takeover releases waiting state without deleting the artifact. Reconnection uses the exact retained artifact handle; it never guesses a replacement. If that artifact is permanently missing, report it rather than recreating the same identity or selecting another document.

Unarchived artifacts and Work Sessions are kept regardless of age. Global Archive marks an item as eligible for permanent deletion after the configured retention period, currently 90 days by default, measured from when it was archived. Restore removes that eligibility; archiving again starts a new period. Expired archived items are deleted during extension activation. Users can restore or export them before expiry.

Moving an artifact into a Session's **Archived** zone only organizes that Session. It does not globally archive the artifact or make it eligible for deletion. Detailed retention and recovery rules are maintained in [Architecture](ARCHITECTURE.md#lifetime-model).

## Product boundaries

- **Conversation stays in AI chat.** The product provides documents, review, shared context, and handoffs; it does not reproduce chat histories as another conversation interface.
- **The overview centers on work documents.** A general agent monitoring dashboard and a task/project management system are outside the product's focus. A user-requested checklist can still be ordinary artifact content.
- **Context is explicit.** Instructions and selected artifacts are the basis for continuity. Claims of complete agent memory or automatic knowledge of unsaved conversation are outside this model.
- **Workflows are chosen by the user.** Sample roles and cross-review recipes demonstrate possibilities without becoming required product behavior.

## UX: make it clear when each capability helps

The interface and product explanations should help users recognize their current need and choose the relevant capability. Someone reviewing one proposal should be able to complete that work without learning Sessions. Someone organizing a Session should not need to configure an automated workflow.

- **Explain the need at the point of use.** Names, entry points, and empty states should connect the capability to a concrete situation: refining a proposal, organizing related documents, continuing in another chat, or handing work to another agent.
- **Keep the document readable.** Preview, precise feedback, and an understandable overview are part of the core experience for people, including when agents automate parts of the work.
- **Let complexity follow the user's work.** Shared context and coordination should become useful as the work calls for them. These principles guide design; they do not prescribe automatic prompts, Session creation, or a fixed onboarding sequence.
- **Explain benefits before infrastructure.** Preview and precise feedback explain review; organized documents and prepared context explain Sessions; connected handoffs explain workflows. Routing, schemas, and integration receipts support those experiences.

Feature announcements and Tips should follow the same structure: show one concrete problem, the relevant capability, and its result. Workflow demonstrations and artifact-review demonstrations can complement each other without making every introduction explain the entire product. Curated announcements remain separate from exhaustive release notes; notifications remain upgrade-only and non-blocking.

## Keep product growth focused

Use the following questions when considering a new capability or a substantial UX change:

1. What concrete problem does it solve, for whom, and when does that person need it?
2. Does it improve review of one request, organization and continuity of a body of work, or coordination between agents? Which component should own it?
3. Does it need product behavior, or can the need be met by Instructions, a workflow example, or clearer guidance using existing capabilities?
4. What additional effort does it impose on people who only need a simpler use case?

These questions support product judgment without creating a checklist for every small fix. Supporting functions should make the core experiences easier to use and maintain. A useful workflow example alone is not a reason to turn its roles and steps into required product behavior.

## Technical references

This document defines product intent and user-facing commitments. Detailed lifecycle, ownership, routing, retention, installation, and compatibility rules belong in [Architecture](ARCHITECTURE.md), [Project instructions](INSTRUCTION.md), and the [artifact](../skills/create-review-artifact/SKILL.md) and [Work Session](../skills/work-session/SKILL.md) skill contracts. Implementation versions and protocol details are maintained there rather than duplicated here.

Local review content can contain sensitive project information. The extension host and MCP must share the supported user filesystem; uninstall preserves user review data. Artifact Markdown, comments, and decisions remain subject to the user's local account permissions and filesystem protections.
