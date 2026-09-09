import type { IntegrationCheck } from "../global-integration-status";
import { CodexClientDriver } from "./codex-client";
import { CursorClientDriver } from "./cursor-client";
import { ClaudeClientDriver } from "./claude-client";
import { WindsurfClientDriver } from "./windsurf-client";
import { CopilotClientDriver } from "./copilot-client";

export interface McpClientDriver {
  readonly id: string;
  readonly name: string;
  readonly configPath: string;
  isDetected(): boolean;
  check(mcpScriptPath: string): Promise<IntegrationCheck>;
  install(mcpScriptPath: string): Promise<void>;
}

export { CodexClientDriver } from "./codex-client";
export { CursorClientDriver } from "./cursor-client";
export { ClaudeClientDriver } from "./claude-client";
export { WindsurfClientDriver } from "./windsurf-client";
export { CopilotClientDriver, getVsCodeUserDirectory, getVsCodeUserMcpPath } from "./copilot-client";

export function getAllClientDrivers(copilotConfigPath?: string): McpClientDriver[] {
  return [
    new CopilotClientDriver(copilotConfigPath),
    new CursorClientDriver(),
    new CodexClientDriver(),
    new ClaudeClientDriver(),
    new WindsurfClientDriver(),
  ];
}

