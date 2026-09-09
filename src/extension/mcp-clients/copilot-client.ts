import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IntegrationCheck } from "../global-integration-status";
import type { McpClientDriver } from "./index";
import { hasJsonMcpServer, upsertJsonMcpServer } from "./json-mcp-helper";

export function getVsCodeUserDirectory(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Code", "User");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Code", "User");
  }
  return path.join(os.homedir(), ".config", "Code", "User");
}

export function getVsCodeUserMcpPath(): string {
  return path.join(getVsCodeUserDirectory(), "mcp.json");
}

export class CopilotClientDriver implements McpClientDriver {
  readonly id = "copilot";
  readonly name = "GitHub Copilot (VS Code)";

  constructor(private readonly customConfigPath?: string) {}

  get configPath(): string {
    return this.customConfigPath || getVsCodeUserMcpPath();
  }

  isDetected(): boolean {
    return fsSync.existsSync(path.dirname(this.configPath));
  }

  async check(mcpScriptPath: string): Promise<IntegrationCheck> {
    const configured = await hasJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
    if (configured) return { status: "ready" };
    return { status: "missing" };
  }

  async install(mcpScriptPath: string): Promise<void> {
    await upsertJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath, "servers");
  }
}
