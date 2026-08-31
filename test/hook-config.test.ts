import { describe, expect, it } from "vitest";
import {
  CODEX_ARTIFACTS_TOOL_MATCHER,
  removeCodexArtifactsHooks,
  upsertCodexArtifactsHook,
  type HooksFile,
} from "../src/extension/hook-config";

describe("Codex Artifacts hook config", () => {
  it("migrates the legacy Agent Plus hook and preserves unrelated hooks", () => {
    const config: HooksFile = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Bash|apply_patch|Edit|Write",
            hooks: [{
              type: "command",
              command: "node \".codex/hooks/agent-plus-stamp-origin.mjs\"",
            }],
          },
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "node .codex/hooks/other-hook.mjs" }],
          },
        ],
      },
    };

    const migrated = upsertCodexArtifactsHook(config, "node \"/home/user/.codex/codex-artifacts/codex-artifacts-stamp-origin.mjs\"");
    expect(migrated.hooks?.PostToolUse).toHaveLength(2);
    expect(migrated.hooks?.PostToolUse?.[0]).toMatchObject({ matcher: "Bash" });
    expect(migrated.hooks?.PostToolUse?.[1]).toMatchObject({ matcher: CODEX_ARTIFACTS_TOOL_MATCHER });
    expect(migrated.hooks?.PostToolUse?.[1]?.hooks[0]?.command).toContain("codex-artifacts-stamp-origin.mjs");
  });

  it("is idempotent", () => {
    const command = "node /home/user/.codex/codex-artifacts/codex-artifacts-stamp-origin.mjs";
    const first = upsertCodexArtifactsHook({}, command);
    const second = upsertCodexArtifactsHook(first, command);
    expect(second.hooks?.PostToolUse).toHaveLength(1);
    expect(second.hooks?.PostToolUse?.[0]?.matcher).toBe(CODEX_ARTIFACTS_TOOL_MATCHER);
  });

  it("removes only Codex Artifacts and legacy Agent Plus handlers", () => {
    const config = upsertCodexArtifactsHook({ hooks: {
      PostToolUse: [{
        matcher: "Bash",
        hooks: [{ type: "command", command: "node /hooks/other.mjs" }],
      }],
    } }, "node /hooks/codex-artifacts-stamp-origin.mjs");
    const removed = removeCodexArtifactsHooks(config);
    expect(removed.changed).toBe(true);
    expect(removed.config.hooks?.PostToolUse).toEqual([{
      matcher: "Bash",
      hooks: [{ type: "command", command: "node /hooks/other.mjs" }],
    }]);
  });

  it("does not mark an unrelated workspace hook configuration as managed", () => {
    const config: HooksFile = {
      hooks: {
        PostToolUse: [{
          matcher: "Bash",
          hooks: [{ type: "command", command: "node /hooks/other.mjs" }],
        }],
      },
    };

    const removed = removeCodexArtifactsHooks(config);
    expect(removed.changed).toBe(false);
    expect(removed.config).toEqual(config);
  });
});
