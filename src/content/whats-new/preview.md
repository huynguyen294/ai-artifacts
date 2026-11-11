# Work Sessions are here — with multi-agent support

> **Preview content:** Sample release notes for upcoming **1.2.0 (Unreleased)** capabilities. This is preview material for renderer and media review, not a published release.

You can now manage your session’s artifacts and shared instructions in one place, and continue the work across AI agents and chats.

## Highlights in this preview

- **Session Manager:** Organize artifacts across **Working**, **References**, and **Archived** zones in one view.
- **Shared session context:** Connect multiple AI agents and chats to the same Work Session using shared `instructions.md` and categorized artifacts.
- **Agent-to-agent review:** Let one agent wait on an artifact while another posts review feedback and submits a Review decision.
- **Dedicated sidebar:** Pin, archive, filter, and search sessions and recent artifacts from the **AI Artifacts** Activity Bar view.

## Getting started

1. Open the **AI Artifacts** view from the Activity Bar and create or select a Work Session.
2. Click **Connect** to copy a join prompt for another AI chat or agent.
3. Learn more about the project at the [AI Artifacts GitHub repository](https://github.com/huynguyen294/ai-artifacts).

## Image rendering preview

The assets below are temporary Phase 2 renderer samples copied from existing repository assets (`media/icon.png` and `media/select-comment.gif`), not final release illustrations.

### Static image (PNG)

![AI Artifacts sample icon](media/samples/ai-artifacts.png "Preview content: static PNG sample")

### Animated illustration (GIF)

![Inline feedback interaction sample](media/samples/inline-feedback.gif "Preview content: animated GIF sample")

### Formatting check

| Element | Phase 2 status |
| --- | --- |
| Packaged PNG / GIF (`media/...`) | Supported in content mode |
| External HTTPS links | Opens outside VS Code via `openExternal` |

```text
Example join flow:
Session "Changelog / What's New" -> Copy Connect Prompt -> Paste into another AI agent chat
```
