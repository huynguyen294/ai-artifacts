import { normalizePathForComparison } from "./mcp-clients/json-mcp-helper";

export const AI_ARTIFACTS_MCP_NAME = "ai_artifacts";
export const CODEX_ARTIFACTS_MCP_NAME = AI_ARTIFACTS_MCP_NAME;
export const AI_ARTIFACTS_MCP_MARKER = "AI Artifacts review MCP";
export const CODEX_ARTIFACTS_MCP_MARKER = AI_ARTIFACTS_MCP_MARKER;
export const CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS = 3600;
export const CODEX_UNEXPECTED_KEY_CONFLICT = "CODEX_UNEXPECTED_KEY_CONFLICT";
export const CODEX_TROUBLESHOOTING_GUIDE_URL =
  "https://github.com/huynguyen294/ai-artifacts#codex-toml-unexpected-keys-or-missing-section-header";

export const REQUIRED_CODEX_ARTIFACTS_TOOLS = [
  "resolve_artifact_window",
  "create_artifact",
  "wait_for_artifact_review",
  "inspect_artifact_review",
  "advance_and_wait_for_artifact",
  "join_session",
] as const;

const CURRENT_BEGIN_MARKER = `# >>> ${AI_ARTIFACTS_MCP_MARKER} >>>`;
const CURRENT_END_MARKER = `# <<< ${AI_ARTIFACTS_MCP_MARKER} <<<`;
const LEGACY_BEGIN_MARKER = "# >>> Codex Artifacts review MCP >>>";
const LEGACY_END_MARKER = "# <<< Codex Artifacts review MCP <<<";
const TABLE_HEADER = `[mcp_servers.${AI_ARTIFACTS_MCP_NAME}]`;

const MAIN_TABLE_ALLOWED_KEYS = new Set([
  "command",
  "args",
  "tool_timeout_sec",
  "default_tools_approval_mode",
]);
const TOOL_TABLE_ALLOWED_KEYS = new Set(["approval_mode"]);

export interface CodexUnexpectedEntry {
  table: string;
  key?: string;
}

function formatUnexpectedEntry(entry: CodexUnexpectedEntry): string {
  return entry.key ? `${entry.key} in [${entry.table}]` : `[${entry.table}]`;
}

/** Error raised when a Codex AI Artifacts TOML block contains keys outside the managed schema. */
export class CodexUnexpectedKeyConflictError extends Error {
  readonly code = CODEX_UNEXPECTED_KEY_CONFLICT;
  readonly unexpectedEntries: readonly CodexUnexpectedEntry[];

  constructor(unexpectedEntries: readonly CodexUnexpectedEntry[]) {
    const first = unexpectedEntries[0];
    const preview = unexpectedEntries
      .slice(0, 3)
      .map(formatUnexpectedEntry)
      .join(", ");
    const suffix = unexpectedEntries.length > 3 ? `, +${unexpectedEntries.length - 3} more` : "";
    const fallback = first ? formatUnexpectedEntry(first) : "unknown";
    super(
      `Unexpected key(s) in Codex config.toml (${preview || fallback}${suffix}). ` +
        `Restore any missing section header below [mcp_servers.ai_artifacts] or back up and remove custom keys temporarily before running "AI Artifacts: Installer", then add them back afterward.`,
    );
    this.name = "CodexUnexpectedKeyConflictError";
    this.unexpectedEntries = unexpectedEntries;
  }
}

/** Extract deterministic error code from an integration failure error if present. */
export function getIntegrationErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0 ? code : undefined;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function isManagedMarkerLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === CURRENT_BEGIN_MARKER ||
    trimmed === CURRENT_END_MARKER ||
    trimmed === LEGACY_BEGIN_MARKER ||
    trimmed === LEGACY_END_MARKER
  );
}

type MatchedTableKind =
  | { kind: "main"; legacy: boolean; rawName: string }
  | { kind: "tool"; legacy: boolean; rawName: string; toolName: string }
  | { kind: "unexpected-subtable"; rawName: string };

function classifyArtifactsTableName(tableName: string): MatchedTableKind | undefined {
  if (tableName === `mcp_servers.${AI_ARTIFACTS_MCP_NAME}`) {
    return { kind: "main", legacy: false, rawName: tableName };
  }
  if (tableName === "mcp_servers.codex_artifacts") {
    return { kind: "main", legacy: true, rawName: tableName };
  }

  const currentToolPrefix = `mcp_servers.${AI_ARTIFACTS_MCP_NAME}.tools.`;
  if (tableName.startsWith(currentToolPrefix)) {
    const toolName = tableName.slice(currentToolPrefix.length).trim();
    if (/^[A-Za-z0-9_-]+$/.test(toolName)) {
      return { kind: "tool", legacy: false, rawName: tableName, toolName };
    }
    return { kind: "unexpected-subtable", rawName: tableName };
  }

  const legacyToolPrefix = "mcp_servers.codex_artifacts.tools.";
  if (tableName.startsWith(legacyToolPrefix)) {
    const toolName = tableName.slice(legacyToolPrefix.length).trim();
    if (/^[A-Za-z0-9_-]+$/.test(toolName)) {
      return { kind: "tool", legacy: true, rawName: tableName, toolName };
    }
    return { kind: "unexpected-subtable", rawName: tableName };
  }

  if (
    tableName.startsWith(`mcp_servers.${AI_ARTIFACTS_MCP_NAME}.`) ||
    tableName.startsWith("mcp_servers.codex_artifacts.")
  ) {
    return { kind: "unexpected-subtable", rawName: tableName };
  }

  return undefined;
}

function stripTomlComment(line: string): string {
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }

  return line;
}

function countBracketDelta(code: string): number {
  let depth = 0;
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
    }
  }

  return depth;
}

function parseTableHeader(codeWithoutComment: string): string | undefined {
  const arrayMatch = codeWithoutComment.match(/^\s*\[\[\s*(.+?)\s*\]\]\s*$/);
  if (arrayMatch?.[1]) {
    return arrayMatch[1].trim();
  }
  const tableMatch = codeWithoutComment.match(/^\s*\[\s*(.+?)\s*\]\s*$/);
  return tableMatch?.[1]?.trim();
}

function parseKeyAssignment(
  codeWithoutComment: string,
): { key: string; valueRaw: string } | undefined {
  const match = codeWithoutComment.match(
    /^\s*(?:([A-Za-z0-9_-]+)|"((?:[^"\\]|\\.)+)"|'([^']+)')\s*=\s*(.*)$/,
  );
  if (!match) return undefined;
  const key = match[1] ?? match[2] ?? match[3];
  if (!key) return undefined;
  return { key, valueRaw: (match[4] ?? "").trim() };
}

function parseTomlStringValue(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1);
    return inner.includes("'") ? undefined : inner;
  }
  return undefined;
}

function parseTomlStringArray(raw: string): string[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return undefined;
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return [];
  }

  const items: string[] = [];
  let tokenStart = 0;
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (let i = 0; i <= inner.length; i++) {
    const ch = i < inner.length ? inner[i]! : ",";
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (i < inner.length && ch === '"') {
      inDouble = true;
      continue;
    }
    if (i < inner.length && ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === "," || i === inner.length) {
      const segment = inner.slice(tokenStart, i).trim();
      if (segment.length > 0) {
        const parsed = parseTomlStringValue(segment);
        if (parsed === undefined) {
          return undefined;
        }
        items.push(parsed);
      } else if (i < inner.length) {
        // Disallow empty elements like ["a", , "b"], while permitting a single trailing comma.
        if (inner.slice(i + 1).trim().length > 0 || items.length === 0) {
          return undefined;
        }
      }
      tokenStart = i + 1;
    }
  }

  return items;
}

function parseTomlInteger(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^[+-]?\d(?:_?\d)*$/.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed.replaceAll("_", ""));
  return Number.isSafeInteger(value) ? value : undefined;
}

interface ParsedMainSection {
  legacy: boolean;
  values: Record<string, string>;
}

interface ParsedToolSection {
  legacy: boolean;
  toolName: string;
  values: Record<string, string>;
}

interface CodexArtifactsScanResult {
  mainSections: ParsedMainSection[];
  toolSections: ParsedToolSection[];
  unexpectedEntries: CodexUnexpectedEntry[];
  removedLineIndices: Set<number>;
  lines: string[];
}

function scanCodexArtifactsToml(config: string): CodexArtifactsScanResult {
  const lines = config.length === 0 ? [] : config.split(/\r?\n/);
  const mainSections: ParsedMainSection[] = [];
  const toolSections: ParsedToolSection[] = [];
  const unexpectedEntries: CodexUnexpectedEntry[] = [];
  const removedLineIndices = new Set<number>();

  let activeSection:
    | { kind: "none" }
    | { kind: "main"; section: ParsedMainSection }
    | { kind: "tool"; section: ParsedToolSection }
    | { kind: "unexpected"; rawName: string } = { kind: "none" };

  let multilineKey:
    | {
        tableName: string;
        targetValues: Record<string, string>;
        key: string;
        parts: string[];
        depth: number;
      }
    | undefined;

  let pendingNonKeyLines: Array<{ index: number; isComment: boolean }> = [];

  const flushPendingAsOwned = (keepTrailingComments: boolean): void => {
    if (pendingNonKeyLines.length === 0) return;
    if (!keepTrailingComments) {
      for (const item of pendingNonKeyLines) {
        removedLineIndices.add(item.index);
      }
      pendingNonKeyLines = [];
      return;
    }

    // Preserve standalone comments that belong to a following unrelated section,
    // while removing blank separators immediately attached to our removed section.
    let trailingCommentStart = pendingNonKeyLines.length;
    for (let i = pendingNonKeyLines.length - 1; i >= 0; i--) {
      if (pendingNonKeyLines[i]!.isComment) {
        trailingCommentStart = i;
      } else if (trailingCommentStart < pendingNonKeyLines.length) {
        break;
      }
    }
    for (let i = 0; i < trailingCommentStart; i++) {
      removedLineIndices.add(pendingNonKeyLines[i]!.index);
    }
    pendingNonKeyLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (multilineKey) {
      removedLineIndices.add(i);
      const code = stripTomlComment(line);
      multilineKey.parts.push(code);
      multilineKey.depth += countBracketDelta(code);
      if (multilineKey.depth <= 0) {
        if (multilineKey.depth < 0) {
          unexpectedEntries.push({ table: multilineKey.tableName, key: multilineKey.key });
        } else {
          multilineKey.targetValues[multilineKey.key] = multilineKey.parts.join(" ");
        }
        multilineKey = undefined;
      }
      continue;
    }

    if (isManagedMarkerLine(line)) {
      removedLineIndices.add(i);
      if (activeSection.kind !== "none") {
        flushPendingAsOwned(false);
      }
      continue;
    }

    const code = stripTomlComment(line);
    const trimmedCode = code.trim();
    const isCommentLine = trimmedCode.length === 0 && line.trim().startsWith("#");

    if (trimmedCode.length === 0) {
      if (activeSection.kind !== "none") {
        pendingNonKeyLines.push({ index: i, isComment: isCommentLine });
      }
      continue;
    }

    const headerName = parseTableHeader(trimmedCode);
    if (headerName !== undefined) {
      if (activeSection.kind !== "none") {
        const classifiedNext = classifyArtifactsTableName(headerName);
        flushPendingAsOwned(classifiedNext === undefined);
      } else {
        pendingNonKeyLines = [];
      }

      const classified = classifyArtifactsTableName(headerName);
      if (!classified) {
        activeSection = { kind: "none" };
      } else if (classified.kind === "main") {
        const section: ParsedMainSection = { legacy: classified.legacy, values: {} };
        mainSections.push(section);
        activeSection = { kind: "main", section };
        removedLineIndices.add(i);
      } else if (classified.kind === "tool") {
        const section: ParsedToolSection = {
          legacy: classified.legacy,
          toolName: classified.toolName,
          values: {},
        };
        toolSections.push(section);
        activeSection = { kind: "tool", section };
        removedLineIndices.add(i);
      } else {
        activeSection = { kind: "unexpected", rawName: classified.rawName };
        unexpectedEntries.push({ table: classified.rawName });
      }
      continue;
    }

    if (activeSection.kind === "none") {
      continue;
    }

    if (activeSection.kind === "unexpected") {
      const assignment = parseKeyAssignment(trimmedCode);
      if (assignment) {
        unexpectedEntries.push({ table: activeSection.rawName, key: assignment.key });
      }
      continue;
    }

    flushPendingAsOwned(false);

    const currentTableName =
      activeSection.kind === "main"
        ? activeSection.section.legacy
          ? "mcp_servers.codex_artifacts"
          : `mcp_servers.${AI_ARTIFACTS_MCP_NAME}`
        : `${activeSection.section.legacy ? "mcp_servers.codex_artifacts" : `mcp_servers.${AI_ARTIFACTS_MCP_NAME}`}.tools.${activeSection.section.toolName}`;

    const assignment = parseKeyAssignment(trimmedCode);
    if (!assignment) {
      unexpectedEntries.push({ table: currentTableName, key: trimmedCode });
      continue;
    }

    const allowedKeys =
      activeSection.kind === "main" ? MAIN_TABLE_ALLOWED_KEYS : TOOL_TABLE_ALLOWED_KEYS;
    if (!allowedKeys.has(assignment.key)) {
      unexpectedEntries.push({ table: currentTableName, key: assignment.key });
      continue;
    }

    removedLineIndices.add(i);
    const delta = assignment.valueRaw.startsWith("[") ? countBracketDelta(assignment.valueRaw) : 0;
    if (delta > 0) {
      multilineKey = {
        tableName: currentTableName,
        targetValues: activeSection.section.values,
        key: assignment.key,
        parts: [assignment.valueRaw],
        depth: delta,
      };
    } else if (delta < 0) {
      unexpectedEntries.push({ table: currentTableName, key: assignment.key });
    } else {
      activeSection.section.values[assignment.key] = assignment.valueRaw;
    }
  }

  if (multilineKey) {
    unexpectedEntries.push({ table: multilineKey.tableName, key: multilineKey.key });
  }

  if (activeSection.kind !== "none") {
    flushPendingAsOwned(true);
  }

  return {
    mainSections,
    toolSections,
    unexpectedEntries,
    removedLineIndices,
    lines,
  };
}

function stripArtifactsFromScan(scan: CodexArtifactsScanResult, newline: string): string {
  const surviving: string[] = [];
  let removedSinceLastKept = false;

  for (let i = 0; i < scan.lines.length; i++) {
    if (scan.removedLineIndices.has(i)) {
      removedSinceLastKept = true;
      continue;
    }
    const line = scan.lines[i]!;
    if (removedSinceLastKept && line.trim().length === 0) {
      const prev = surviving[surviving.length - 1];
      if (prev === undefined || prev.trim().length === 0) {
        continue;
      }
    }
    if (line.trim().length > 0) {
      removedSinceLastKept = false;
    }
    surviving.push(line);
  }

  while (surviving.length > 0 && surviving[0]!.trim().length === 0) {
    surviving.shift();
  }
  while (surviving.length > 0 && surviving[surviving.length - 1]!.trim().length === 0) {
    surviving.pop();
  }

  return surviving.length > 0 ? `${surviving.join(newline)}${newline}` : "";
}

function buildCanonicalBlock(serverScriptPath: string, newline: string): string {
  const lines = [
    CURRENT_BEGIN_MARKER,
    TABLE_HEADER,
    'command = "node"',
    `args = [${tomlString(serverScriptPath)}]`,
    `tool_timeout_sec = ${CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS}`,
    'default_tools_approval_mode = "approve"',
  ];

  for (const toolName of REQUIRED_CODEX_ARTIFACTS_TOOLS) {
    lines.push("", `[mcp_servers.${AI_ARTIFACTS_MCP_NAME}.tools.${toolName}]`, 'approval_mode = "approve"');
  }

  lines.push(CURRENT_END_MARKER);
  return lines.join(newline);
}

export interface CodexArtifactsInspection {
  hasArtifactsTables: boolean;
  hasUnexpectedEntries: boolean;
  unexpectedEntries: readonly CodexUnexpectedEntry[];
  configuredArgsList: readonly string[][];
}

/**
 * Inspect Codex TOML configuration for AI Artifacts tables, parsed `args`, and unexpected keys.
 */
export function inspectCodexArtifactsMcp(config: string): CodexArtifactsInspection {
  const scan = scanCodexArtifactsToml(config);
  const configuredArgsList: string[][] = [];
  for (const main of scan.mainSections) {
    const parsedArgs = main.values.args ? parseTomlStringArray(main.values.args) : undefined;
    if (parsedArgs) {
      configuredArgsList.push(parsedArgs);
    }
  }
  return {
    hasArtifactsTables: scan.mainSections.length > 0 || scan.toolSections.length > 0,
    hasUnexpectedEntries: scan.unexpectedEntries.length > 0,
    unexpectedEntries: scan.unexpectedEntries,
    configuredArgsList,
  };
}

export function removeCodexArtifactsMcp(config: string): string {
  const scan = scanCodexArtifactsToml(config);
  if (scan.unexpectedEntries.length > 0) {
    throw new CodexUnexpectedKeyConflictError(scan.unexpectedEntries);
  }
  if (scan.removedLineIndices.size === 0) {
    return config;
  }
  const newline = config.includes("\r\n") ? "\r\n" : "\n";
  return stripArtifactsFromScan(scan, newline);
}

export function upsertCodexArtifactsMcp(config: string, serverScriptPath: string): string {
  const scan = scanCodexArtifactsToml(config);
  if (scan.unexpectedEntries.length > 0) {
    throw new CodexUnexpectedKeyConflictError(scan.unexpectedEntries);
  }
  const newline = config.includes("\r\n") ? "\r\n" : "\n";
  const base =
    scan.removedLineIndices.size > 0
      ? stripArtifactsFromScan(scan, newline).trimEnd()
      : config.trimEnd();
  const block = buildCanonicalBlock(serverScriptPath, newline);
  return base ? `${base}${newline}${newline}${block}${newline}` : `${block}${newline}`;
}

export function hasManagedCodexArtifactsMcp(config: string, serverScriptPath: string): boolean {
  const scan = scanCodexArtifactsToml(config);
  if (scan.unexpectedEntries.length > 0) {
    return false;
  }
  if (scan.mainSections.length !== 1) {
    return false;
  }
  const main = scan.mainSections[0]!;
  if (main.legacy) {
    return false;
  }
  if (parseTomlStringValue(main.values.command ?? "") !== "node") {
    return false;
  }
  const args = parseTomlStringArray(main.values.args ?? "");
  if (!args || args.length !== 1 || !args[0]) {
    return false;
  }
  if (normalizePathForComparison(args[0]) !== normalizePathForComparison(serverScriptPath)) {
    return false;
  }
  if (parseTomlInteger(main.values.tool_timeout_sec ?? "") !== CODEX_ARTIFACTS_MCP_TIMEOUT_SECONDS) {
    return false;
  }
  if (parseTomlStringValue(main.values.default_tools_approval_mode ?? "") !== "approve") {
    return false;
  }

  if (scan.toolSections.some((tool) => tool.legacy)) {
    return false;
  }
  if (scan.toolSections.length !== REQUIRED_CODEX_ARTIFACTS_TOOLS.length) {
    return false;
  }

  const toolsByName = new Map<string, ParsedToolSection>();
  for (const section of scan.toolSections) {
    if (toolsByName.has(section.toolName)) {
      return false;
    }
    toolsByName.set(section.toolName, section);
  }

  for (const tool of REQUIRED_CODEX_ARTIFACTS_TOOLS) {
    const section = toolsByName.get(tool);
    if (!section) {
      return false;
    }
    if (parseTomlStringValue(section.values.approval_mode ?? "") !== "approve") {
      return false;
    }
  }

  return true;
}

export function needsCodexArtifactsMcpUpgrade(
  previousMcpVersion: number,
  targetMcpVersion: number,
): boolean {
  return previousMcpVersion < 12 && targetMcpVersion >= 12;
}
