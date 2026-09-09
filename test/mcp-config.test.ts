import { describe, expect, it } from "vitest";
import {
  CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS,
  hasManagedCodexArtifactsMcp,
  upsertCodexArtifactsMcp,
} from "../src/extension/mcp-config";

describe("Codex Artifacts MCP config", () => {
  it("adds an idempotent managed server block and preserves unrelated config", () => {
    const original = 'model = "gpt-test"\n\n[mcp_servers.other]\ncommand = "other"\n';
    const first = upsertCodexArtifactsMcp(original, "C:\\Codex Artifacts\\review-wait-mcp.mjs");
    const second = upsertCodexArtifactsMcp(first, "D:\\Codex Artifacts\\review-wait-mcp.mjs");
    expect(second).toContain('model = "gpt-test"');
    expect(second).toContain("[mcp_servers.other]");
    expect(second.match(/\[mcp_servers\.ai_artifacts\]/g)).toHaveLength(1);
    expect(second).toContain('args = ["D:\\\\Codex Artifacts\\\\review-wait-mcp.mjs"]');
    expect(second).toContain(`tool_timeout_sec = ${CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS}`);
    expect(second).toContain('default_tools_approval_mode = "approve"');
    expect(second).toContain("[mcp_servers.ai_artifacts.tools.resolve_artifact_workspace]");
    expect(second).toContain("[mcp_servers.ai_artifacts.tools.create_artifact]");
    expect(second).toContain("[mcp_servers.ai_artifacts.tools.wait_for_artifact_review]");
    expect(second).toContain("[mcp_servers.ai_artifacts.tools.inspect_artifact_review]");
    expect(second).toContain("[mcp_servers.ai_artifacts.tools.advance_and_wait_for_artifact]");
    expect(second).not.toContain("create_and_wait_for_artifact");
    expect(second).not.toContain("update_and_wait_for_artifact");
    expect(hasManagedCodexArtifactsMcp(second, "D:\\Codex Artifacts\\review-wait-mcp.mjs")).toBe(true);
    expect(hasManagedCodexArtifactsMcp(
      second.replace('command = "node"', 'command = "other"'),
      "D:\\Codex Artifacts\\review-wait-mcp.mjs",
    )).toBe(false);
  });

  it("migrates legacy Codex Artifacts review MCP block to AI Artifacts review MCP block", () => {
    const legacyConfig = [
      'model = "gpt-test"',
      "",
      "# >>> Codex Artifacts review MCP >>>",
      "[mcp_servers.codex_artifacts]",
      'command = "node"',
      'args = ["C:\\\\old\\\\path.mjs"]',
      "tool_timeout_sec = 3600",
      'default_tools_approval_mode = "approve"',
      "# <<< Codex Artifacts review MCP <<<",
    ].join("\n");

    const migrated = upsertCodexArtifactsMcp(legacyConfig, "C:\\new\\ai-artifacts-review-mcp.mjs");
    expect(migrated).toContain("# >>> AI Artifacts review MCP >>>");
    expect(migrated).toContain("[mcp_servers.ai_artifacts]");
    expect(migrated).not.toContain("# >>> Codex Artifacts review MCP >>>");
    expect(migrated).not.toContain("[mcp_servers.codex_artifacts]");
    expect(migrated).toContain('model = "gpt-test"');
  });

  it("refuses to overwrite an unmanaged server with the same name", () => {
    expect(() => upsertCodexArtifactsMcp(
      '[mcp_servers.ai_artifacts]\ncommand = "custom"\n',
      "/tmp/review-wait-mcp.mjs",
    )).toThrow("outside the managed");

    expect(() => upsertCodexArtifactsMcp(
      '[mcp_servers.codex_artifacts]\ncommand = "custom"\n',
      "/tmp/review-wait-mcp.mjs",
    )).toThrow("outside the managed");
  });
});
