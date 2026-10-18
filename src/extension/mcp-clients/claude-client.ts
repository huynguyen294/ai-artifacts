import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IntegrationCheck } from "../global-integration-status";
import type { McpClientDriver } from "./index";
import {
  hasJsonMcpServer,
  removeJsonMcpServer,
  upsertJsonMcpServer,
} from "./json-mcp-helper";
import { replaceSkillDirectory } from "./skill-helper";

export class ClaudeClientDriver implements McpClientDriver {
  readonly id = "claude";
  readonly name = "Claude";

  constructor(
    private readonly customConfigPath?: string,
    private readonly customSkillDirectory?: string,
    private readonly sourceSkillDirectory?: string,
  ) {}

  get configPath(): string {
    return this.customConfigPath || path.join(os.homedir(), ".claude.json");
  }

  get skillDirectory(): string {
    if (this.customSkillDirectory) return this.customSkillDirectory;
    const baseHome = path.dirname(this.configPath);
    return path.join(baseHome, ".claude", "skills", "create-review-artifact");
  }

  get sourceSkill(): string {
    if (this.sourceSkillDirectory) return this.sourceSkillDirectory;
    const baseHome = path.dirname(this.configPath);
    const deployedSkill = path.join(baseHome, ".agents", "skills", "create-review-artifact");
    if (fsSync.existsSync(deployedSkill)) return deployedSkill;
    const candidates = [
      path.resolve(__dirname, "..", "..", "..", "skills", "create-review-artifact"),
      path.resolve(__dirname, "..", "skills", "create-review-artifact"),
      path.resolve(__dirname, "..", "..", "skills", "create-review-artifact"),
    ];
    for (const candidate of candidates) {
      if (fsSync.existsSync(candidate)) return candidate;
    }
    return deployedSkill;
  }

  isDetected(): boolean {
    if (this.customConfigPath || this.customSkillDirectory) {
      return (
        fsSync.existsSync(this.configPath) ||
        fsSync.existsSync(this.skillDirectory) ||
        fsSync.existsSync(path.dirname(this.skillDirectory))
      );
    }
    return (
      fsSync.existsSync(path.join(os.homedir(), ".claude.json")) ||
      fsSync.existsSync(path.join(os.homedir(), ".claude"))
    );
  }

  async check(mcpScriptPath: string): Promise<IntegrationCheck> {
    const configured = await hasJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
    if (!configured) return { status: "missing" };

    const skillMain = path.join(this.skillDirectory, "SKILL.md");
    if (!fsSync.existsSync(skillMain)) {
      return { status: "missing", detail: "Claude skill directory is missing SKILL.md." };
    }

    return { status: "ready" };
  }

  async install(mcpScriptPath: string, sourceSkillPath?: string): Promise<void> {
    await upsertJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
    const source = sourceSkillPath || this.sourceSkill;
    if (source && fsSync.existsSync(source)) {
      await replaceSkillDirectory(source, this.skillDirectory);
    }
  }

  async uninstall(): Promise<boolean> {
    const removedMcp = await removeJsonMcpServer(this.configPath, "ai_artifacts");
    let removedSkill = false;
    if (fsSync.existsSync(this.skillDirectory)) {
      await fs.rm(this.skillDirectory, { recursive: true, force: true });
      removedSkill = true;
    }
    return removedMcp || removedSkill;
  }
}
