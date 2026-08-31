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
    expect(second.match(/\[mcp_servers\.codex_artifacts\]/g)).toHaveLength(1);
    expect(second).toContain('args = ["D:\\\\Codex Artifacts\\\\review-wait-mcp.mjs"]');
    expect(second).toContain(`tool_timeout_sec = ${CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS}`);
    expect(second).toContain('default_tools_approval_mode = "approve"');
    expect(second).toContain("[mcp_servers.codex_artifacts.tools.create_and_wait_for_artifact]");
    expect(second).toContain("[mcp_servers.codex_artifacts.tools.update_and_wait_for_artifact]");
    expect(hasManagedCodexArtifactsMcp(second, "D:\\Codex Artifacts\\review-wait-mcp.mjs")).toBe(true);
    expect(hasManagedCodexArtifactsMcp(
      second.replace('command = "node"', 'command = "other"'),
      "D:\\Codex Artifacts\\review-wait-mcp.mjs",
    )).toBe(false);
  });

  it("refuses to overwrite an unmanaged server with the same name", () => {
    expect(() => upsertCodexArtifactsMcp(
      '[mcp_servers.codex_artifacts]\ncommand = "custom"\n',
      "/tmp/review-wait-mcp.mjs",
    )).toThrow("outside the managed");
  });
});
