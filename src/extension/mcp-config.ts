export const CODEX_ARTIFACTS_MCP_NAME = "codex_artifacts";
export const CODEX_ARTIFACTS_MCP_MARKER = "Codex Artifacts review MCP";
export const CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS = 3600;

const BEGIN_MARKER = `# >>> ${CODEX_ARTIFACTS_MCP_MARKER} >>>`;
const END_MARKER = `# <<< ${CODEX_ARTIFACTS_MCP_MARKER} <<<`;
const TABLE_HEADER = `[mcp_servers.${CODEX_ARTIFACTS_MCP_NAME}]`;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function withoutManagedBlock(config: string): string {
  const begin = config.indexOf(BEGIN_MARKER);
  const end = config.indexOf(END_MARKER);
  if (begin === -1 && end === -1) return config;
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error("The managed Codex Artifacts MCP block in config.toml is malformed.");
  }
  const after = end + END_MARKER.length;
  return `${config.slice(0, begin).trimEnd()}\n${config.slice(after).trimStart()}`.trim();
}

export function upsertCodexArtifactsMcp(config: string, serverScriptPath: string): string {
  const base = withoutManagedBlock(config);
  const tablePattern = /^\s*\[mcp_servers\.codex_artifacts\]\s*$/m;
  if (tablePattern.test(base)) {
    throw new Error(
      "config.toml already defines mcp_servers.codex_artifacts outside the managed Codex Artifacts block.",
    );
  }
  const block = [
    BEGIN_MARKER,
    TABLE_HEADER,
    'command = "node"',
    `args = [${tomlString(serverScriptPath)}]`,
    `tool_timeout_sec = ${CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS}`,
    'default_tools_approval_mode = "approve"',
    "",
    `[mcp_servers.${CODEX_ARTIFACTS_MCP_NAME}.tools.resolve_artifact_workspace]`,
    'approval_mode = "approve"',
    "",
    `[mcp_servers.${CODEX_ARTIFACTS_MCP_NAME}.tools.create_artifact]`,
    'approval_mode = "approve"',
    "",
    `[mcp_servers.${CODEX_ARTIFACTS_MCP_NAME}.tools.wait_for_artifact_review]`,
    'approval_mode = "approve"',
    "",
    `[mcp_servers.${CODEX_ARTIFACTS_MCP_NAME}.tools.inspect_artifact_review]`,
    'approval_mode = "approve"',
    "",
    `[mcp_servers.${CODEX_ARTIFACTS_MCP_NAME}.tools.advance_and_wait_for_artifact]`,
    'approval_mode = "approve"',
    END_MARKER,
  ].join("\n");
  return base ? `${base.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

export function hasManagedCodexArtifactsMcp(config: string, serverScriptPath: string): boolean {
  const begin = config.indexOf(BEGIN_MARKER);
  const end = config.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) return false;
  const block = config.slice(begin, end + END_MARKER.length).replaceAll("\r\n", "\n").trim();
  const expected = upsertCodexArtifactsMcp("", serverScriptPath).replaceAll("\r\n", "\n").trim();
  return block === expected;
}
