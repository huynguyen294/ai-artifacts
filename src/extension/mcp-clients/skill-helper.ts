import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";

export const USER_CUSTOM_RULES_BEGIN = "<!-- >>> USER CUSTOM RULES >>> -->";
export const USER_CUSTOM_RULES_END = "<!-- <<< USER CUSTOM RULES <<< -->";

export const OFFICIAL_SKILL_DESCRIPTIONS: readonly string[] = [
  "Create or update a reviewable Markdown artifact and wait for the user's decision in the same Codex turn. Use only when the user explicitly asks to create or update an artifact.",
  "Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact and coordinate its review rounds.",
  "Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact, join work sessions, and coordinate review rounds.",
  "Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact and coordinate its review rounds. Also use when explicitly asked to comment on an artifact, with or without submitting Review.",
];

export const REVIEW_SKILL_ASSETS = [
  "SKILL.md",
  path.join("references", "storage-protocol.md"),
  path.join("references", "recovery.md"),
  path.join("references", "ai-feedback.md"),
  path.join("agents", "openai.yaml"),
];

export const WORK_SESSION_SKILL_ASSETS = [
  "SKILL.md",
  path.join("agents", "openai.yaml"),
];

export type ManagedSkillName = "create-review-artifact" | "work-session";

function isDirectorySync(targetPath: string): boolean {
  try {
    return fsSync.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

export function findPackagedSkillDirectory(
  skillName: ManagedSkillName,
  baseDirectory: string = __dirname,
): string | undefined {
  const candidates = [
    path.resolve(baseDirectory, "..", "..", "..", "skills", skillName),
    path.resolve(baseDirectory, "..", "skills", skillName),
    path.resolve(baseDirectory, "..", "..", "skills", skillName),
  ];
  return candidates.find((candidate) => isDirectorySync(candidate));
}

export async function assertSkillSourceAssetsPresent(
  skillName: ManagedSkillName,
  sourceDirectory: string | undefined,
  assets: readonly string[],
  clientLabel = "integration",
): Promise<string> {
  if (!sourceDirectory) {
    throw new Error(
      `Packaged ${skillName} skill source directory is not available for ${clientLabel}.`,
    );
  }
  const missingAssets: string[] = [];
  for (const relativePath of assets) {
    try {
      await fs.access(path.join(sourceDirectory, relativePath));
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        missingAssets.push(relativePath);
      } else {
        throw error;
      }
    }
  }
  if (missingAssets.length > 0) {
    throw new Error(
      `${clientLabel} ${skillName} skill source is unavailable or incomplete at "${sourceDirectory}" (missing: ${missingAssets.join(", ")}).`,
    );
  }
  return sourceDirectory;
}

type DescriptionEntry =
  | { status: "absent" }
  | {
    status: "valid";
    rawEntry: string;
    normalizedValue: string;
    startLine: number;
    endLine: number;
  }
  | { status: "malformed"; reason: string };

type CustomRulesBlock =
  | { status: "absent" }
  | {
    status: "valid";
    content: string;
    beginLine: number;
    endLine: number;
  }
  | { status: "malformed"; reason: string };

export class SkillMarkdownValidationError extends Error {
  constructor(
    readonly scope: "source" | "target",
    message: string,
  ) {
    super(message);
    this.name = "SkillMarkdownValidationError";
  }
}

function normalizeLineEndings(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function normalizeScalarValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseInlineScalar(value: string):
  | { status: "absent" }
  | { status: "valid"; value: string }
  | { status: "malformed"; reason: string } {
  const trimmed = value.trim();
  if (!trimmed) return { status: "absent" };
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length === 1) {
      return { status: "malformed", reason: "the single-quoted YAML scalar is not closed" };
    }
    return {
      status: "valid",
      value: normalizeScalarValue(trimmed.slice(1, -1).replace(/''/g, "'")),
    };
  }
  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"') || trimmed.length === 1) {
      return { status: "malformed", reason: "the double-quoted YAML scalar is not closed" };
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "string") {
        return { status: "malformed", reason: "the quoted YAML scalar is not a string" };
      }
      return { status: "valid", value: normalizeScalarValue(parsed) };
    } catch {
      return { status: "malformed", reason: "the double-quoted YAML scalar is invalid" };
    }
  }
  return { status: "valid", value: normalizeScalarValue(trimmed) };
}

type TopLevelMappingEntry = {
  key: string;
  rawValue: string;
  lineIndex: number;
};

function parseFrontmatterMapping(
  lines: string[],
  frontmatterEndLine: number,
):
  | { status: "valid"; entries: TopLevelMappingEntry[] }
  | { status: "malformed"; reason: string } {
  const entries: TopLevelMappingEntry[] = [];
  for (let lineIndex = 1; lineIndex < frontmatterEndLine; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (line.trim() === "" || /^[ \t]+/.test(line) || line.trimStart().startsWith("#")) {
      continue;
    }

    const quotedKey = line.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:(.*)$/);
    if (quotedKey) {
      const key = parseInlineScalar(quotedKey[1]!);
      if (key.status !== "valid") {
        return {
          status: "malformed",
          reason: `the YAML frontmatter has an invalid quoted key at line ${lineIndex + 1}`,
        };
      }
      entries.push({ key: key.value, rawValue: quotedKey[2]!, lineIndex });
      continue;
    }

    const plainKey = line.match(/^([A-Za-z0-9_-]+)\s*:(.*)$/);
    if (plainKey) {
      entries.push({ key: plainKey[1]!, rawValue: plainKey[2]!, lineIndex });
      continue;
    }

    return {
      status: "malformed",
      reason: `the YAML frontmatter has an unsupported or malformed top-level entry at line ${lineIndex + 1}`,
    };
  }
  return { status: "valid", entries };
}

function frontmatterRange(lines: string[]):
  | { status: "absent" }
  | { status: "valid"; endLine: number }
  | { status: "malformed"; reason: string } {
  const firstLine = lines[0]?.replace(/^\uFEFF/, "").trim();
  if (firstLine !== "---") return { status: "absent" };
  const endLine = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endLine < 0) {
    return { status: "malformed", reason: "the YAML frontmatter closing delimiter is missing" };
  }
  return { status: "valid", endLine };
}

function parseName(entries: TopLevelMappingEntry[]):
  | { status: "valid" }
  | { status: "malformed"; reason: string } {
  const nameEntries = entries.filter((entry) => entry.key === "name");
  if (nameEntries.length !== 1) {
    return {
      status: "malformed",
      reason: nameEntries.length === 0
        ? "the YAML frontmatter is missing name: create-review-artifact"
        : "the YAML frontmatter contains duplicate name fields",
    };
  }
  const scalar = parseInlineScalar(nameEntries[0]!.rawValue);
  if (scalar.status !== "valid" || scalar.value !== "create-review-artifact") {
    return { status: "malformed", reason: "the YAML frontmatter name is not create-review-artifact" };
  }
  return { status: "valid" };
}

export function extractFrontmatterDescriptionEntry(markdown: string): DescriptionEntry {
  const lines = normalizeLineEndings(markdown).split("\n");
  const frontmatter = frontmatterRange(lines);
  if (frontmatter.status !== "valid") return frontmatter;

  const mapping = parseFrontmatterMapping(lines, frontmatter.endLine);
  if (mapping.status === "malformed") return mapping;

  const name = parseName(mapping.entries);
  if (name.status === "malformed") return name;

  const entries = mapping.entries.filter((entry) => entry.key === "description");
  if (entries.length === 0) return { status: "absent" };
  if (entries.length > 1) {
    return { status: "malformed", reason: "the YAML frontmatter contains duplicate description fields" };
  }

  const entry = entries[0]!;
  const rawValue = entry.rawValue.trim();
  let endLine = entry.lineIndex + 1;
  while (endLine < frontmatter.endLine) {
    const line = lines[endLine]!;
    if (line.trim() === "" || /^[ \t]+/.test(line)) {
      endLine += 1;
      continue;
    }
    break;
  }
  const continuationLines = lines.slice(entry.lineIndex + 1, endLine);
  const blockScalar = /^[>|](?:[+-]?\d?|\d?[+-]?)?$/.test(rawValue);
  if (blockScalar) {
    const indentation = continuationLines
      .filter((line) => line.trim() !== "")
      .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
    const minimumIndent = indentation.length > 0 ? Math.min(...indentation) : 0;
    const value = normalizeScalarValue(
      continuationLines
        .map((line) => line.slice(minimumIndent))
        .join(rawValue.startsWith(">") ? " " : "\n"),
    );
    if (!value) return { status: "absent" };
    return {
      status: "valid",
      rawEntry: lines.slice(entry.lineIndex, endLine).join("\n"),
      normalizedValue: value,
      startLine: entry.lineIndex,
      endLine,
    };
  }

  if (!rawValue && continuationLines.some((line) => line.trim() !== "")) {
    return {
      status: "malformed",
      reason: "description uses an indented value form that cannot be preserved safely",
    };
  }
  const scalar = parseInlineScalar(rawValue);
  if (scalar.status === "absent") return scalar;
  if (scalar.status === "malformed") {
    return { status: "malformed", reason: `description is malformed: ${scalar.reason}` };
  }
  return {
    status: "valid",
    rawEntry: lines.slice(entry.lineIndex, endLine).join("\n"),
    normalizedValue: normalizeScalarValue([
      scalar.value,
      ...continuationLines.map((line) => line.trim()),
    ].join(" ")),
    startLine: entry.lineIndex,
    endLine,
  };
}

export function extractCustomRulesBlock(markdown: string): CustomRulesBlock {
  const lines = normalizeLineEndings(markdown).split("\n");
  const beginLines: number[] = [];
  const endLines: number[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === USER_CUSTOM_RULES_BEGIN) beginLines.push(index);
    if (line.trim() === USER_CUSTOM_RULES_END) endLines.push(index);
  });
  if (beginLines.length === 0 && endLines.length === 0) return { status: "absent" };
  if (beginLines.length !== 1 || endLines.length !== 1) {
    return { status: "malformed", reason: "USER CUSTOM RULES markers must each appear exactly once" };
  }
  const beginLine = beginLines[0]!;
  const endLine = endLines[0]!;
  if (beginLine >= endLine) {
    return { status: "malformed", reason: "USER CUSTOM RULES markers are in the wrong order" };
  }
  return {
    status: "valid",
    content: lines.slice(beginLine + 1, endLine).join("\n"),
    beginLine,
    endLine,
  };
}

export function isOfficialDefaultDescription(
  normalizedValue: string,
  sourceNormalizedValue?: string,
): boolean {
  return normalizedValue === sourceNormalizedValue
    || OFFICIAL_SKILL_DESCRIPTIONS.includes(normalizedValue);
}

function validateSourceSkill(markdown: string): {
  description: Extract<DescriptionEntry, { status: "valid" }>;
  customRules: Extract<CustomRulesBlock, { status: "valid" }>;
} {
  const description = extractFrontmatterDescriptionEntry(markdown);
  if (description.status !== "valid") {
    const reason = description.status === "malformed" ? description.reason : "description is missing or empty";
    throw new SkillMarkdownValidationError("source", `Packaged SKILL.md is invalid: ${reason}.`);
  }
  const customRules = extractCustomRulesBlock(markdown);
  if (customRules.status !== "valid") {
    const reason = customRules.status === "malformed"
      ? customRules.reason
      : "USER CUSTOM RULES markers are missing";
    throw new SkillMarkdownValidationError("source", `Packaged SKILL.md is invalid: ${reason}.`);
  }
  return { description, customRules };
}

export function mergeSkillCustomizations(
  sourceMarkdown: string,
  existingTargetMarkdown?: string,
): string {
  let merged = normalizeLineEndings(sourceMarkdown);
  const source = validateSourceSkill(merged);
  if (existingTargetMarkdown === undefined) return merged;

  const targetDescription = extractFrontmatterDescriptionEntry(existingTargetMarkdown);
  if (targetDescription.status === "malformed") {
    throw new SkillMarkdownValidationError("target", targetDescription.reason);
  }
  const targetCustomRules = extractCustomRulesBlock(existingTargetMarkdown);
  if (targetCustomRules.status === "malformed") {
    throw new SkillMarkdownValidationError("target", targetCustomRules.reason);
  }

  if (
    targetDescription.status === "valid"
    && !isOfficialDefaultDescription(
      targetDescription.normalizedValue,
      source.description.normalizedValue,
    )
  ) {
    const lines = merged.split("\n");
    lines.splice(
      source.description.startLine,
      source.description.endLine - source.description.startLine,
      ...targetDescription.rawEntry.split("\n"),
    );
    merged = lines.join("\n");
  }

  if (targetCustomRules.status === "valid") {
    const mergedBlock = extractCustomRulesBlock(merged);
    if (mergedBlock.status !== "valid") {
      throw new SkillMarkdownValidationError("source", "Packaged SKILL.md lost its custom rules markers during merge.");
    }
    const lines = merged.split("\n");
    lines.splice(
      mergedBlock.beginLine + 1,
      mergedBlock.endLine - mergedBlock.beginLine - 1,
      ...(targetCustomRules.content === "" ? [] : targetCustomRules.content.split("\n")),
    );
    merged = lines.join("\n");
  }

  validateSourceSkill(merged);
  return merged;
}

export async function sameFile(left: string, right: string): Promise<boolean> {
  try {
    const [leftContents, rightContents] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
    return leftContents.equals(rightContents);
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function sameSkillMarkdown(sourceSkillFile: string, targetSkillFile: string): Promise<boolean> {
  try {
    const [sourceMarkdown, targetMarkdown] = await Promise.all([
      fs.readFile(sourceSkillFile, "utf8"),
      fs.readFile(targetSkillFile, "utf8"),
    ]);
    const expected = mergeSkillCustomizations(sourceMarkdown, targetMarkdown);
    return normalizeLineEndings(expected).trimEnd()
      === normalizeLineEndings(targetMarkdown).trimEnd();
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    if (error instanceof SkillMarkdownValidationError && error.scope === "target") return false;
    throw error;
  }
}

export async function skillDirectoryIsCurrent(source: string, target: string): Promise<boolean> {
  const checks = REVIEW_SKILL_ASSETS.map((relativePath) => {
    const sourcePath = path.join(source, relativePath);
    const targetPath = path.join(target, relativePath);
    return relativePath === "SKILL.md"
      ? sameSkillMarkdown(sourcePath, targetPath)
      : sameFile(sourcePath, targetPath);
  });
  return (await Promise.all(checks)).every(Boolean);
}

async function readExistingTargetSkill(targetSkillPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(targetSkillPath, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function replaceSkillDirectory(source: string, target: string): Promise<void> {
  const sourceSkillPath = path.join(source, "SKILL.md");
  const targetSkillPath = path.join(target, "SKILL.md");
  const [sourceMarkdown, existingTargetMarkdown] = await Promise.all([
    fs.readFile(sourceSkillPath, "utf8"),
    readExistingTargetSkill(targetSkillPath),
  ]);

  let mergedMarkdown: string;
  try {
    mergedMarkdown = mergeSkillCustomizations(sourceMarkdown, existingTargetMarkdown);
  } catch (error) {
    if (error instanceof SkillMarkdownValidationError && error.scope === "target") {
      throw new Error(
        `Cannot reinstall the review skill at "${target}": ${error.message} Fix "${targetSkillPath}" and run the installer command again.`,
        { cause: error },
      );
    }
    throw error;
  }

  const targetParent = path.dirname(target);
  await fs.mkdir(targetParent, { recursive: true });
  const stagingRoot = await fs.mkdtemp(path.join(targetParent, ".create-review-artifact-install-"));
  const stagedSkill = path.join(stagingRoot, "next");
  const previousSkill = path.join(stagingRoot, "previous");
  let previousMoved = false;
  let keepRecoveryDirectory = false;

  try {
    await fs.cp(source, stagedSkill, { recursive: true, force: true });
    const stagedSkillPath = path.join(stagedSkill, "SKILL.md");
    await fs.writeFile(stagedSkillPath, mergedMarkdown, "utf8");
    validateSourceSkill(await fs.readFile(stagedSkillPath, "utf8"));

    try {
      await fs.rename(target, previousSkill);
      previousMoved = true;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }

    try {
      await fs.rename(stagedSkill, target);
    } catch (error) {
      if (previousMoved) {
        try {
          await fs.rename(previousSkill, target);
        } catch (restoreError) {
          keepRecoveryDirectory = true;
          throw new AggregateError(
            [error, restoreError],
            `Failed to install the review skill and restore the previous copy. Recovery files remain at "${stagingRoot}".`,
          );
        }
      }
      throw error;
    }
  } finally {
    if (!keepRecoveryDirectory) {
      await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function officialSkillDirectoryIsCurrent(
  source: string,
  target: string,
  assets: readonly string[] = WORK_SESSION_SKILL_ASSETS,
): Promise<boolean> {
  const checks = assets.map((relativePath) => {
    const sourcePath = path.join(source, relativePath);
    const targetPath = path.join(target, relativePath);
    return sameFile(sourcePath, targetPath);
  });
  return (await Promise.all(checks)).every(Boolean);
}

export async function replaceOfficialSkillDirectory(
  source: string,
  target: string,
  assets: readonly string[] = WORK_SESSION_SKILL_ASSETS,
): Promise<void> {
  await Promise.all(assets.map((rel) => fs.access(path.join(source, rel))));

  const targetParent = path.dirname(target);
  await fs.mkdir(targetParent, { recursive: true });
  const stagingRoot = await fs.mkdtemp(path.join(targetParent, ".work-session-skill-install-"));
  const stagedSkill = path.join(stagingRoot, "next");
  const previousSkill = path.join(stagingRoot, "previous");
  let previousMoved = false;
  let keepRecoveryDirectory = false;

  try {
    await fs.mkdir(stagedSkill, { recursive: true });
    for (const rel of assets) {
      const srcFile = path.join(source, rel);
      const destFile = path.join(stagedSkill, rel);
      await fs.mkdir(path.dirname(destFile), { recursive: true });
      await fs.copyFile(srcFile, destFile);
    }

    try {
      await fs.rename(target, previousSkill);
      previousMoved = true;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }

    try {
      await fs.rename(stagedSkill, target);
    } catch (error) {
      if (previousMoved) {
        try {
          await fs.rename(previousSkill, target);
        } catch (restoreError) {
          keepRecoveryDirectory = true;
          throw new AggregateError(
            [error, restoreError],
            `Failed to install the official skill and restore the previous copy. Recovery files remain at "${stagingRoot}".`,
          );
        }
      }
      throw error;
    }
  } finally {
    if (!keepRecoveryDirectory) {
      await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}
