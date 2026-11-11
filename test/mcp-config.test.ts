import { describe, expect, it } from "vitest";
import {
  CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS,
  hasManagedCodexArtifactsMcp,
  needsCodexArtifactsMcpUpgrade,
  patchCodexArtifactsMcpForUpgrade,
  removeCodexArtifactsMcp,
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
    expect(second).toContain("[mcp_servers.ai_artifacts.tools.resolve_artifact_window]");
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

  it("handles displaced closing marker caused by TOML formatters and preserves intervening tables", () => {
    const displacedConfig = [
      'model = "gpt-5.6-sol"',
      "",
      "# >>> AI Artifacts review MCP >>>",
      "[mcp_servers.ai_artifacts]",
      'command = "node"',
      'args = ["C:\\\\Users\\\\Admin\\\\.ai-artifacts\\\\managed\\\\runtime\\\\ai-artifacts-review-mcp.mjs"]',
      "tool_timeout_sec = 3600",
      'default_tools_approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.resolve_artifact_window]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.create_artifact]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.wait_for_artifact_review]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.inspect_artifact_review]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.advance_and_wait_for_artifact]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.join_session]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.node_repl]",
      'command = "node_repl.exe"',
      "",
      '[plugins."test-plugin@bundled"]',
      "enabled = true",
      "# <<< AI Artifacts review MCP <<<",
    ].join("\n");

    const scriptPath = "C:/Users/Admin/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";

    // 1. Check recognizes the config as ready despite displaced marker and slash differences
    expect(hasManagedCodexArtifactsMcp(displacedConfig, scriptPath)).toBe(true);

    // 2. Removal preserves unrelated intervening tables (node_repl, plugins) and cleans orphaned end marker
    const cleaned = removeCodexArtifactsMcp(displacedConfig);
    expect(cleaned).toContain('model = "gpt-5.6-sol"');
    expect(cleaned).toContain("[mcp_servers.node_repl]");
    expect(cleaned).toContain('[plugins."test-plugin@bundled"]');
    expect(cleaned).not.toContain("[mcp_servers.ai_artifacts]");
    expect(cleaned).not.toContain("AI Artifacts review MCP");

    // 3. Upsert preserves unrelated tables and re-emits a clean block
    const updated = upsertCodexArtifactsMcp(displacedConfig, "D:/new/path/ai-artifacts-review-mcp.mjs");
    expect(updated).toContain("[mcp_servers.node_repl]");
    expect(updated).toContain('[plugins."test-plugin@bundled"]');
    expect(updated).toContain("[mcp_servers.ai_artifacts]");
    expect(hasManagedCodexArtifactsMcp(updated, "D:/new/path/ai-artifacts-review-mcp.mjs")).toBe(true);
  });

  it("checks the Codex MCP version upgrade gate around MCP 12", () => {
    expect(needsCodexArtifactsMcpUpgrade(0, 12)).toBe(true);
    expect(needsCodexArtifactsMcpUpgrade(11, 12)).toBe(true);
    expect(needsCodexArtifactsMcpUpgrade(10, 13)).toBe(true);
    expect(needsCodexArtifactsMcpUpgrade(12, 12)).toBe(false);
    expect(needsCodexArtifactsMcpUpgrade(12, 13)).toBe(false);
    expect(needsCodexArtifactsMcpUpgrade(11, 11)).toBe(false);
  });

  it("patches missing join_session into a 5-tool managed block while preserving overrides, non-standard settings, and CRLF", () => {
    const scriptPath = "C:/Users/Admin/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
    const fiveToolConfig = [
      'model = "gpt-5.6-sol"',
      "",
      "# >>> AI Artifacts review MCP >>>",
      "[mcp_servers.ai_artifacts]",
      'command = "node"',
      'args = ["C:/Users/Admin/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs"]',
      "tool_timeout_sec = 3600",
      'default_tools_approval_mode = "approve"',
      'custom_flag = "keep-me"',
      "",
      "[mcp_servers.ai_artifacts.tools.resolve_artifact_window]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.create_artifact]",
      'approval_mode = "never"',
      "",
      "[mcp_servers.ai_artifacts.tools.wait_for_artifact_review]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.inspect_artifact_review]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.advance_and_wait_for_artifact]",
      'approval_mode = "approve"',
      "# <<< AI Artifacts review MCP <<<",
      "",
      "[mcp_servers.other]",
      'command = "other"',
      "",
    ].join("\r\n");

    const patched = patchCodexArtifactsMcpForUpgrade(fiveToolConfig);
    expect(patched).not.toBe(fiveToolConfig);
    expect(patched).toContain("\r\n");
    expect(patched.replaceAll("\r\n", "")).not.toContain("\n");
    expect(patched).toContain('custom_flag = "keep-me"');
    expect(patched).toContain("[mcp_servers.ai_artifacts.tools.create_artifact]\r\napproval_mode = \"never\"");
    expect(patched).toContain("[mcp_servers.ai_artifacts.tools.join_session]\r\napproval_mode = \"approve\"\r\n# <<< AI Artifacts review MCP <<<");
    expect(patched).toContain("[mcp_servers.other]");
    expect(hasManagedCodexArtifactsMcp(patched, scriptPath)).toBe(true);

    // Preserves custom args and timeout without rewriting the managed block
    const customSettingsFiveTool = fiveToolConfig
      .replace("tool_timeout_sec = 3600", "tool_timeout_sec = 180")
      .replace(
        'args = ["C:/Users/Admin/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs"]',
        'args = ["D:/custom/other-runtime.mjs"]',
      );
    const patchedCustom = patchCodexArtifactsMcpForUpgrade(customSettingsFiveTool);
    expect(patchedCustom).toContain("tool_timeout_sec = 180");
    expect(patchedCustom).toContain('args = ["D:/custom/other-runtime.mjs"]');
    expect(patchedCustom).toContain("[mcp_servers.ai_artifacts.tools.join_session]");

    // Calling again on already 6-tool config is an exact no-op
    expect(patchCodexArtifactsMcpForUpgrade(patched)).toBe(patched);
  });

  it("handles displaced closing marker when patching join_session and leaves existing join_session or missing block untouched", () => {
    const scriptPath = "C:/Users/Admin/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
    const displacedFiveTool = [
      "# >>> AI Artifacts review MCP >>>",
      "[mcp_servers.ai_artifacts]",
      'command = "node"',
      `args = ["${scriptPath}"]`,
      "tool_timeout_sec = 3600",
      'default_tools_approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.resolve_artifact_window]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.create_artifact]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.wait_for_artifact_review]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.inspect_artifact_review]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.advance_and_wait_for_artifact]",
      'approval_mode = "approve"',
      "",
      "[mcp_servers.node_repl]",
      'command = "node_repl.exe"',
      "# <<< AI Artifacts review MCP <<<",
      "",
    ].join("\n");

    const patchedDisplaced = patchCodexArtifactsMcpForUpgrade(displacedFiveTool);
    expect(hasManagedCodexArtifactsMcp(patchedDisplaced, scriptPath)).toBe(true);
    expect(patchedDisplaced.indexOf("[mcp_servers.ai_artifacts.tools.join_session]")).toBeLessThan(
      patchedDisplaced.indexOf("[mcp_servers.node_repl]"),
    );
    expect(patchedDisplaced).toContain("[mcp_servers.node_repl]\ncommand = \"node_repl.exe\"");

    const customJoinSession = patchedDisplaced.replace(
      '[mcp_servers.ai_artifacts.tools.join_session]\napproval_mode = "approve"',
      '[mcp_servers.ai_artifacts.tools.join_session]\napproval_mode = "prompt"',
    );
    expect(patchCodexArtifactsMcpForUpgrade(customJoinSession)).toBe(customJoinSession);

    const unmanaged = '[mcp_servers.ai_artifacts]\ncommand = "node"\nargs = ["/tmp/server.mjs"]\n';
    expect(patchCodexArtifactsMcpForUpgrade(unmanaged)).toBe(unmanaged);
  });
});
