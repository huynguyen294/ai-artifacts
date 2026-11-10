import type * as vscode from "vscode";
import {
  baseScriptIsCurrent,
  getBaseIntegrationPaths,
  readInstalledIntegrationVersion,
} from "./workspace-integration";

export const WORK_SESSION_REQUIRED_MCP_VERSION = 12;

export type WorkSessionSupportStatus = {
  supported: boolean;
  requiredMcpVersion: number;
  installedMcpVersion?: number | undefined;
  reason?: string | undefined;
};

export async function resolveWorkSessionSupport(
  options: { userHome?: string } = {},
  context?: vscode.ExtensionContext,
): Promise<WorkSessionSupportStatus> {
  const versionResult = await readInstalledIntegrationVersion(options);

  if (versionResult.status !== "valid") {
    return {
      supported: false,
      requiredMcpVersion: WORK_SESSION_REQUIRED_MCP_VERSION,
      reason: "Integration manifest missing or invalid",
    };
  }

  const installedMcpVersion = versionResult.manifest.mcpVersion;
  if (installedMcpVersion === undefined || installedMcpVersion < WORK_SESSION_REQUIRED_MCP_VERSION) {
    return {
      supported: false,
      requiredMcpVersion: WORK_SESSION_REQUIRED_MCP_VERSION,
      installedMcpVersion,
      reason: `MCP server version ${WORK_SESSION_REQUIRED_MCP_VERSION} or higher is required (installed: ${installedMcpVersion ?? "unknown"})`,
    };
  }

  if (context) {
    try {
      const paths = getBaseIntegrationPaths(context, options);
      const isCurrent = await baseScriptIsCurrent(paths);
      if (!isCurrent) {
        return {
          supported: false,
          requiredMcpVersion: WORK_SESSION_REQUIRED_MCP_VERSION,
          installedMcpVersion,
          reason: "MCP runtime script does not match installed extension bundle",
        };
      }
    } catch {
      // If path check fails, treat as not current
      return {
        supported: false,
        requiredMcpVersion: WORK_SESSION_REQUIRED_MCP_VERSION,
        installedMcpVersion,
        reason: "Failed to verify MCP runtime script",
      };
    }
  }

  return {
    supported: true,
    requiredMcpVersion: WORK_SESSION_REQUIRED_MCP_VERSION,
    installedMcpVersion,
  };
}
