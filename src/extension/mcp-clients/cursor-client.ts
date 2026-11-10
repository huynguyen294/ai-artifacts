import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IntegrationCheck } from "../global-integration-status";
import type { ClientUpgradeContext, ClientUpgradeResult, McpClientDriver } from "./index";
import {
  hasJsonMcpServer,
  removeJsonMcpServer,
  upsertJsonMcpServer,
} from "./json-mcp-helper";

export class CursorClientDriver implements McpClientDriver {
  readonly id = "cursor";
  readonly name = "Cursor";

  get configPath(): string {
    return path.join(os.homedir(), ".cursor", "mcp.json");
  }

  isDetected(): boolean {
    return fs.existsSync(path.join(os.homedir(), ".cursor"));
  }

  async check(mcpScriptPath: string): Promise<IntegrationCheck> {
    const configured = await hasJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
    if (configured) return { status: "ready" };
    return { status: "missing" };
  }

  async install(mcpScriptPath: string): Promise<void> {
    await upsertJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
  }

  async upgrade(context: ClientUpgradeContext): Promise<ClientUpgradeResult> {
    const configured = await hasJsonMcpServer(this.configPath, "ai_artifacts", context.mcpScriptPath);
    if (configured) {
      return { status: "unchanged" };
    }
    return {
      status: "setup-required",
      detail: `${this.name} MCP configuration is missing or needs setup.`,
    };
  }

  async uninstall(): Promise<boolean> {
    return removeJsonMcpServer(this.configPath, "ai_artifacts");
  }
}
