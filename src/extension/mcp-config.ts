import { normalizePathForComparison } from "./mcp-clients/json-mcp-helper";

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

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isArtifactsTableHeader(line: string): boolean {
  const match = line.match(/^\s*\[\s*([^\]]+?)\s*\]/);
  if (!match) return false;
  const name = match[1]?.trim();
  if (!name) return false;
  return (
    name === `mcp_servers.${AI_ARTIFACTS_MCP_NAME}` ||
    name.startsWith(`mcp_servers.${AI_ARTIFACTS_MCP_NAME}.`) ||
    name === "mcp_servers.codex_artifacts" ||
    name.startsWith("mcp_servers.codex_artifacts.")
  );
}

function isAnyTableHeader(line: string): boolean {
  return /^\s*\[\s*[^\]]+?\s*\]/.test(line);
}

interface BlockBounds {
  startIndex: number;
  endIndex: number;
}

function findManagedBlockBounds(config: string, beginMarker: string, endMarker: string): BlockBounds | undefined {
  const begin = config.indexOf(beginMarker);
  if (begin === -1) return undefined;

  const remaining = config.slice(begin);
  const lines = remaining.split(/\r?\n/);
  let charOffset = 0;
  let blockEndOffset = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const matchLine = remaining.slice(charOffset).match(/^.*?(?:\r?\n|$)/);
    const lineLengthWithNewline = matchLine?.[0]?.length ?? line.length;

    if (i === 0) {
      charOffset += lineLengthWithNewline;
      continue;
    }

    if (line.includes(endMarker)) {
      blockEndOffset = charOffset + lineLengthWithNewline;
      break;
    }

    if (isArtifactsTableHeader(line)) {
      // Still inside an ai_artifacts table or sub-table
    } else if (isAnyTableHeader(line)) {
      // Encountered an unrelated table header (e.g. [mcp_servers.node_repl], [desktop])
      // The managed block boundary stops right before this line.
      blockEndOffset = charOffset;
      break;
    }

    charOffset += lineLengthWithNewline;
  }

  if (blockEndOffset === -1) {
    blockEndOffset = config.length - begin;
  }

  return {
    startIndex: begin,
    endIndex: begin + blockEndOffset,
  };
}

function stripBlock(config: string, beginMarker: string, endMarker: string): string {
  const bounds = findManagedBlockBounds(config, beginMarker, endMarker);
  if (!bounds) return config;

  let result = `${config.slice(0, bounds.startIndex).trimEnd()}\n\n${config.slice(bounds.endIndex).trimStart()}`.trim();

  // Clean up any orphaned endMarker lines displaced elsewhere in the document
  const endMarkerRegex = new RegExp(`^\\s*${escapeRegExp(endMarker)}\\s*(?:\\r?\\n|$)`, "gm");
  result = result.replace(endMarkerRegex, "").trim();

  return result;
}

export function removeCodexArtifactsMcp(config: string): string {
  const cleaned = withoutManagedBlock(config);
  if (cleaned === config) return config;
  return cleaned ? `${cleaned}\n` : "";
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
  const bounds = findManagedBlockBounds(config, CURRENT_BEGIN_MARKER, CURRENT_END_MARKER);
  if (!bounds) return false;

  const block = config.slice(bounds.startIndex, bounds.endIndex);

  // 1. Must define [mcp_servers.ai_artifacts]
  if (!/^\s*\[mcp_servers\.ai_artifacts\]\s*$/m.test(block)) {
    return false;
  }

  // 2. command must be "node"
  if (!/^\s*command\s*=\s*["']node["']\s*$/m.test(block)) {
    return false;
  }

  // 3. args must match serverScriptPath (normalized comparison)
  const argsMatch = block.match(/^\s*args\s*=\s*\[\s*(?:"([^"]+)"|'([^']+)')\s*\]/m);
  if (!argsMatch) return false;
  const configuredScript = argsMatch[1] ?? argsMatch[2] ?? "";
  if (normalizePathForComparison(configuredScript) !== normalizePathForComparison(serverScriptPath)) {
    return false;
  }

  // 4. tool timeout and default approval mode
  if (!new RegExp(`^\\s*tool_timeout_sec\\s*=\\s*${CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS}\\s*$`, "m").test(block)) {
    return false;
  }
  if (!/^\s*default_tools_approval_mode\s*=\s*["']approve["']\s*$/m.test(block)) {
    return false;
  }

  // 5. Must configure the 5 core tools
  const requiredTools = [
    "resolve_artifact_workspace",
    "create_artifact",
    "wait_for_artifact_review",
    "inspect_artifact_review",
    "advance_and_wait_for_artifact",
  ];

  for (const tool of requiredTools) {
    const toolHeader = new RegExp(`^\\s*\\[mcp_servers\\.ai_artifacts\\.tools\\.${tool}\\]\\s*$`, "m");
    if (!toolHeader.test(block)) {
      return false;
    }
  }

  return true;
}
