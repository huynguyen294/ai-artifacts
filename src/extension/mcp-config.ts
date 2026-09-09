export const AI_ARTIFACTS_MCP_NAME = "ai_artifacts";
export const CODEX_ARTIFACTS_MCP_NAME = AI_ARTIFACTS_MCP_NAME;
export const AI_ARTIFACTS_MCP_MARKER = "AI Artifacts review MCP";
export const CODEX_ARTIFACTS_MCP_MARKER = AI_ARTIFACTS_MCP_MARKER;
export const CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS = 3600;

const CURRENT_BEGIN_MARKER = `# >>> ${AI_ARTIFACTS_MCP_MARKER} >>>`;
const CURRENT_END_MARKER = `# <<< ${AI_ARTIFACTS_MCP_MARKER} <<<`;
const LEGACY_BEGIN_MARKER = "# >>> Codex Artifacts review MCP >>>";
const LEGACY_END_MARKER = "# <<< Codex Artifacts review MCP <<<";
const TABLE_HEADER = `[mcp_servers.${AI_ARTIFACTS_MCP_NAME}]`;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function stripBlock(config: string, beginMarker: string, endMarker: string): string {
  const begin = config.indexOf(beginMarker);
  const end = config.indexOf(endMarker);
  if (begin === -1 && end === -1) return config;
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error("The managed AI Artifacts MCP block in config.toml is malformed.");
  }
  const after = end + endMarker.length;
  return `${config.slice(0, begin).trimEnd()}\n${config.slice(after).trimStart()}`.trim();
}

function withoutManagedBlock(config: string): string {
  let cleaned = stripBlock(config, CURRENT_BEGIN_MARKER, CURRENT_END_MARKER);
  cleaned = stripBlock(cleaned, LEGACY_BEGIN_MARKER, LEGACY_END_MARKER);
  return cleaned;
}

export function upsertCodexArtifactsMcp(config: string, serverScriptPath: string): string {
  const base = withoutManagedBlock(config);
  const tablePattern = /^\s*\[mcp_servers\.(?:ai_artifacts|codex_artifacts)\]\s*$/m;
  if (tablePattern.test(base)) {
    throw new Error(
      "config.toml already defines mcp_servers.ai_artifacts outside the managed AI Artifacts block.",
    );
  }
  const block = [
    CURRENT_BEGIN_MARKER,
    TABLE_HEADER,
    'command = "node"',
    `args = [${tomlString(serverScriptPath)}]`,
    `tool_timeout_sec = ${CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS}`,
    'default_tools_approval_mode = "approve"',
    "",
    `[mcp_servers.${AI_ARTIFACTS_MCP_NAME}.tools.resolve_artifact_workspace]`,
    'approval_mode = "approve"',
    "",
    `[mcp_servers.${AI_ARTIFACTS_MCP_NAME}.tools.create_artifact]`,
    'approval_mode = "approve"',
    "",
    `[mcp_servers.${AI_ARTIFACTS_MCP_NAME}.tools.wait_for_artifact_review]`,
    'approval_mode = "approve"',
    "",
    `[mcp_servers.${AI_ARTIFACTS_MCP_NAME}.tools.inspect_artifact_review]`,
    'approval_mode = "approve"',
    "",
    `[mcp_servers.${AI_ARTIFACTS_MCP_NAME}.tools.advance_and_wait_for_artifact]`,
    'approval_mode = "approve"',
    CURRENT_END_MARKER,
  ].join("\n");
  return base ? `${base.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

export function hasManagedCodexArtifactsMcp(config: string, serverScriptPath: string): boolean {
  const begin = config.indexOf(CURRENT_BEGIN_MARKER);
  const end = config.indexOf(CURRENT_END_MARKER);
  if (begin === -1 || end === -1 || end < begin) return false;
  const block = config.slice(begin, end + CURRENT_END_MARKER.length).replaceAll("\r\n", "\n").trim();
  const expected = upsertCodexArtifactsMcp("", serverScriptPath).replaceAll("\r\n", "\n").trim();
  return block === expected;
}
