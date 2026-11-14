import { describe, expect, it } from "vitest";
import {
  CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS,
  CODEX_UNEXPECTED_KEY_CONFLICT,
  CodexUnexpectedKeyConflictError,
  hasManagedCodexArtifactsMcp,
  inspectCodexArtifactsMcp,
  needsCodexArtifactsMcpUpgrade,
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

  it("replaces markerless whitelisted servers and scattered tables into one canonical managed block", () => {
    const scriptPath = "C:/Users/Admin/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
    const markerlessScattered = [
      'model = "gpt-5.6-sol"',
      "",
      "[mcp_servers.ai_artifacts]",
      'command = "node"',
      "args = [",
      '  "C:\\\\Users\\\\Admin\\\\.ai-artifacts\\\\managed\\\\runtime\\\\ai-artifacts-review-mcp.mjs",',
      "]",
      "tool_timeout_sec = 3600",
      'default_tools_approval_mode = "approve"',
      "",
      "[mcp_servers.ai_artifacts.tools.resolve_artifact_window]",
      'approval_mode = "approve"',
      "",
      "# keep comment for downstream section",
      "[mcp_servers.other]",
      'command = "other"',
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
    ].join("\r\n");

    expect(inspectCodexArtifactsMcp(markerlessScattered)).toEqual({
      hasArtifactsTables: true,
      hasUnexpectedEntries: false,
      unexpectedEntries: [],
      configuredArgsList: [["C:\\Users\\Admin\\.ai-artifacts\\managed\\runtime\\ai-artifacts-review-mcp.mjs"]],
    });
    expect(hasManagedCodexArtifactsMcp(markerlessScattered, scriptPath)).toBe(true);

    const removed = removeCodexArtifactsMcp(markerlessScattered);
    expect(removed).not.toContain("[mcp_servers.ai_artifacts");
    expect(removed).toContain("# keep comment for downstream section\r\n[mcp_servers.other]\r\ncommand = \"other\"");
    expect(removed.replaceAll("\r\n", "")).not.toContain("\n");

    const customWhitelisted = [
      "[mcp_servers.ai_artifacts]",
      'command = "custom"',
      'args = ["/custom/path.mjs"]',
      "tool_timeout_sec = 180",
      'default_tools_approval_mode = "never"',
      "",
      "[mcp_servers.ai_artifacts.tools.create_artifact]",
      'approval_mode = "never"',
    ].join("\n");
    expect(hasManagedCodexArtifactsMcp(customWhitelisted, "/tmp/review-wait-mcp.mjs")).toBe(false);

    const replaced = upsertCodexArtifactsMcp(customWhitelisted, "/tmp/review-wait-mcp.mjs");
    expect(replaced).toContain('command = "node"');
    expect(replaced).toContain('args = ["/tmp/review-wait-mcp.mjs"]');
    expect(replaced).toContain(`tool_timeout_sec = ${CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS}`);
    expect(replaced).toContain('default_tools_approval_mode = "approve"');
    expect(replaced).toContain('[mcp_servers.ai_artifacts.tools.create_artifact]\napproval_mode = "approve"');
    expect(hasManagedCodexArtifactsMcp(replaced, "/tmp/review-wait-mcp.mjs")).toBe(true);

    const duplicated = `${replaced}\n\n[mcp_servers.ai_artifacts]\ncommand = "node"\n`;
    expect(hasManagedCodexArtifactsMcp(duplicated, "/tmp/review-wait-mcp.mjs")).toBe(false);
    const deduped = upsertCodexArtifactsMcp(duplicated, "/tmp/review-wait-mcp.mjs");
    expect(deduped.match(/\[mcp_servers\.ai_artifacts\]/g)).toHaveLength(1);
    expect(hasManagedCodexArtifactsMcp(deduped, "/tmp/review-wait-mcp.mjs")).toBe(true);
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

  it("fails closed with CodexUnexpectedKeyConflictError on unexpected keys or sub-tables", () => {
    const scriptPath = "C:/Users/Admin/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
    const unexpectedMainKey = [
      'model = "gpt-5.6-sol"',
      "",
      "[mcp_servers.ai_artifacts]",
      'command = "node"',
      `args = ["${scriptPath}"]`,
      "tool_timeout_sec = 3600",
      'default_tools_approval_mode = "approve"',
      'followUpQueueMode = "steer"',
    ].join("\n");

    const inspectedKey = inspectCodexArtifactsMcp(unexpectedMainKey);
    expect(inspectedKey.hasArtifactsTables).toBe(true);
    expect(inspectedKey.hasUnexpectedEntries).toBe(true);
    expect(inspectedKey.unexpectedEntries).toEqual([
      { table: "mcp_servers.ai_artifacts", key: "followUpQueueMode" },
    ]);
    expect(hasManagedCodexArtifactsMcp(unexpectedMainKey, scriptPath)).toBe(false);

    for (const run of [
      () => upsertCodexArtifactsMcp(unexpectedMainKey, scriptPath),
      () => removeCodexArtifactsMcp(unexpectedMainKey),
    ]) {
      try {
        run();
        expect.unreachable("Expected CodexUnexpectedKeyConflictError");
      } catch (err) {
        expect(err).toBeInstanceOf(CodexUnexpectedKeyConflictError);
        expect((err as CodexUnexpectedKeyConflictError).code).toBe(CODEX_UNEXPECTED_KEY_CONFLICT);
        expect((err as Error).message).toContain("followUpQueueMode");
      }
    }

    const unexpectedSubtableAndToolKey = [
      "[mcp_servers.ai_artifacts]",
      'command = "node"',
      `args = ["${scriptPath}"]`,
      "",
      "[mcp_servers.ai_artifacts.tools.create_artifact]",
      'approval_mode = "approve"',
      'custom_tool_opt = true',
      "",
      "[mcp_servers.ai_artifacts.env]",
      'FOO = "bar"',
      "",
      "[mcp_servers.codex_artifacts.extra]",
      'flag = 1',
    ].join("\n");

    const inspectedSub = inspectCodexArtifactsMcp(unexpectedSubtableAndToolKey);
    expect(inspectedSub.hasUnexpectedEntries).toBe(true);
    expect(inspectedSub.unexpectedEntries).toEqual([
      { table: "mcp_servers.ai_artifacts.tools.create_artifact", key: "custom_tool_opt" },
      { table: "mcp_servers.ai_artifacts.env" },
      { table: "mcp_servers.ai_artifacts.env", key: "FOO" },
      { table: "mcp_servers.codex_artifacts.extra" },
      { table: "mcp_servers.codex_artifacts.extra", key: "flag" },
    ]);
    try {
      upsertCodexArtifactsMcp(unexpectedSubtableAndToolKey, scriptPath);
      expect.unreachable("Expected CodexUnexpectedKeyConflictError");
    } catch (err) {
      expect(err).toBeInstanceOf(CodexUnexpectedKeyConflictError);
      expect((err as Error).message).toContain(
        "custom_tool_opt in [mcp_servers.ai_artifacts.tools.create_artifact], [mcp_servers.ai_artifacts.env], FOO in [mcp_servers.ai_artifacts.env], +2 more",
      );
      expect((err as Error).message).not.toContain("[mcp_servers.ai_artifacts.env] in [mcp_servers.ai_artifacts.env]");
    }
    expect(() => removeCodexArtifactsMcp(unexpectedSubtableAndToolKey)).toThrow(
      CodexUnexpectedKeyConflictError,
    );

    expect(() => upsertCodexArtifactsMcp("[mcp_servers.ai_artifacts.env]\n", scriptPath)).toThrow(
      "([mcp_servers.ai_artifacts.env])",
    );
  });
});
