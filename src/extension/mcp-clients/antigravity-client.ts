import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IntegrationCheck } from "../global-integration-status";
import type { McpClientDriver } from "./index";
import {
  normalizePathForComparison,
  readJsonConfig,
  writeJsonConfig,
} from "./json-mcp-helper";
import {
  REVIEW_SKILL_ASSETS,
  WORK_SESSION_SKILL_ASSETS,
  officialSkillDirectoryIsCurrent,
  replaceOfficialSkillDirectory,
  replaceSkillDirectory,
  skillDirectoryIsCurrent,
} from "./skill-helper";

export const ANTIGRAVITY_MCP_TIMEOUT_SECONDS = 3600;

export type AntigravityClientDriverOptions = {
  userHome?: string | undefined;
  sourceSkillDirectory?: string | undefined;
  sourceSessionSkillDirectory?: string | undefined;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectorySync(targetPath: string): boolean {
  try {
    return fsSync.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function isFileSync(targetPath: string): boolean {
  try {
    return fsSync.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function findPackagedSkillDirectory(
  skillName: "create-review-artifact" | "work-session",
): string | undefined {
  const candidates = [
    path.resolve(__dirname, "..", "..", "..", "skills", skillName),
    path.resolve(__dirname, "..", "skills", skillName),
    path.resolve(__dirname, "..", "..", "skills", skillName),
  ];
  return candidates.find((candidate) => isDirectorySync(candidate));
}

async function assertSourceAssetsPresent(
  skillName: "create-review-artifact" | "work-session",
  sourceDirectory: string | undefined,
  assets: readonly string[],
): Promise<string> {
  if (!sourceDirectory) {
    throw new Error(
      `Packaged ${skillName} skill source directory is not available for Antigravity.`,
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
      `Antigravity ${skillName} skill source is unavailable or incomplete at "${sourceDirectory}" (missing: ${missingAssets.join(", ")}).`,
    );
  }
  return sourceDirectory;
}

async function removeTargetIfExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      await fs.unlink(targetPath);
      return true;
    }
    await fs.rm(targetPath, { recursive: true, force: true });
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export class AntigravityClientDriver implements McpClientDriver {
  readonly id = "antigravity";
  readonly name = "Antigravity";

  constructor(private readonly options: AntigravityClientDriverOptions = {}) {}

  private get homeDirectory(): string {
    return this.options.userHome || os.homedir();
  }

  private get antigravityDirectory(): string {
    return path.join(this.homeDirectory, ".gemini", "antigravity");
  }

  get configPath(): string {
    return path.join(this.homeDirectory, ".gemini", "config", "mcp_config.json");
  }

  get skillDirectory(): string {
    return path.join(this.homeDirectory, ".gemini", "config", "skills", "create-review-artifact");
  }

  get sessionSkillDirectory(): string {
    return path.join(this.homeDirectory, ".gemini", "config", "skills", "work-session");
  }

  private resolveSkillSource(explicitPath?: string): string | undefined {
    return (
      explicitPath ??
      this.options.sourceSkillDirectory ??
      findPackagedSkillDirectory("create-review-artifact")
    );
  }

  private resolveSessionSkillSource(explicitPath?: string): string | undefined {
    return (
      explicitPath ??
      this.options.sourceSessionSkillDirectory ??
      findPackagedSkillDirectory("work-session")
    );
  }

  isDetected(): boolean {
    return (
      isFileSync(this.configPath) ||
      isDirectorySync(this.antigravityDirectory)
    );
  }

  async check(mcpScriptPath: string): Promise<IntegrationCheck> {
    const config = await readJsonConfig(this.configPath);
    if (!isPlainObject(config)) {
      return { status: "missing" };
    }
    const server = isPlainObject(config.mcpServers) ? config.mcpServers.ai_artifacts : undefined;
    if (!isPlainObject(server)) {
      return { status: "missing" };
    }

    const normalizedTarget = normalizePathForComparison(mcpScriptPath);
    const existingScript =
      Array.isArray(server.args) && server.args.length === 1 && typeof server.args[0] === "string"
        ? normalizePathForComparison(server.args[0])
        : "";
    if (server.command !== "node" || existingScript !== normalizedTarget) {
      return { status: "missing" };
    }

    if (server.timeoutSeconds !== ANTIGRAVITY_MCP_TIMEOUT_SECONDS) {
      return {
        status: "outdated",
        detail: `Antigravity MCP server timeoutSeconds must be ${ANTIGRAVITY_MCP_TIMEOUT_SECONDS}. Reinstall the Antigravity integration.`,
      };
    }

    const skillMain = path.join(this.skillDirectory, "SKILL.md");
    if (!isFileSync(skillMain)) {
      return { status: "missing", detail: "Antigravity skill directory is missing SKILL.md." };
    }

    const sessionSkillMain = path.join(this.sessionSkillDirectory, "SKILL.md");
    if (!isFileSync(sessionSkillMain)) {
      return {
        status: "missing",
        detail: "Antigravity work-session skill directory is missing SKILL.md.",
      };
    }

    const source = await assertSourceAssetsPresent(
      "create-review-artifact",
      this.resolveSkillSource(),
      REVIEW_SKILL_ASSETS,
    );
    const sourceSession = await assertSourceAssetsPresent(
      "work-session",
      this.resolveSessionSkillSource(),
      WORK_SESSION_SKILL_ASSETS,
    );

    if (!(await skillDirectoryIsCurrent(source, this.skillDirectory))) {
      return { status: "outdated", detail: "Antigravity review skill assets are outdated." };
    }

    if (!(await officialSkillDirectoryIsCurrent(sourceSession, this.sessionSkillDirectory))) {
      return { status: "outdated", detail: "Antigravity work-session skill assets are outdated." };
    }

    return { status: "ready" };
  }

  async install(
    mcpScriptPath: string,
    sourceSkillPath?: string,
    sourceSessionSkillPath?: string,
  ): Promise<void> {
    const source = await assertSourceAssetsPresent(
      "create-review-artifact",
      this.resolveSkillSource(sourceSkillPath),
      REVIEW_SKILL_ASSETS,
    );
    const sourceSession = await assertSourceAssetsPresent(
      "work-session",
      this.resolveSessionSkillSource(sourceSessionSkillPath),
      WORK_SESSION_SKILL_ASSETS,
    );

    const config = await readJsonConfig(this.configPath);
    if (!isPlainObject(config)) {
      throw new Error(`Configuration file at "${this.configPath}" must contain a JSON object.`);
    }
    if (!isPlainObject(config.mcpServers)) {
      config.mcpServers = {};
    }
    const existingEntry = isPlainObject(config.mcpServers.ai_artifacts)
      ? config.mcpServers.ai_artifacts
      : {};
    const normalizedPath = mcpScriptPath.replaceAll("\\", "/");
    config.mcpServers.ai_artifacts = {
      ...existingEntry,
      command: "node",
      args: [normalizedPath],
      timeoutSeconds: ANTIGRAVITY_MCP_TIMEOUT_SECONDS,
    };
    await writeJsonConfig(this.configPath, config);

    await replaceSkillDirectory(source, this.skillDirectory);
    await replaceOfficialSkillDirectory(sourceSession, this.sessionSkillDirectory);
  }

  async uninstall(): Promise<boolean> {
    let removedMcp = false;
    const config = await readJsonConfig(this.configPath);
    if (
      isPlainObject(config) &&
      isPlainObject(config.mcpServers) &&
      Object.prototype.hasOwnProperty.call(config.mcpServers, "ai_artifacts")
    ) {
      delete config.mcpServers.ai_artifacts;
      await writeJsonConfig(this.configPath, config);
      removedMcp = true;
    }

    const removedReviewSkill = await removeTargetIfExists(this.skillDirectory);
    const removedSessionSkill = await removeTargetIfExists(this.sessionSkillDirectory);
    return removedMcp || removedReviewSkill || removedSessionSkill;
  }
}
