import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IntegrationCheck } from "../global-integration-status";
import type { McpClientDriver } from "./index";
import {
  hasManagedCodexArtifactsMcp,
  removeCodexArtifactsMcp,
  upsertCodexArtifactsMcp,
} from "../mcp-config";
import { writeTextFileAtomic } from "./json-mcp-helper";
import {
  CODEX_ARTIFACTS_HOOK_MARKER,
  removeCodexArtifactsHooks,
  type HooksFile,
} from "../hook-config";

export function getCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".codex");
}

function configurationConflict(config: string): string | undefined {
  const withoutManaged = removeCodexArtifactsMcp(config);
  return /^\s*\[mcp_servers\.(?:ai_artifacts|codex_artifacts)\]\s*$/m.test(withoutManaged)
    ? "config.toml defines mcp_servers.ai_artifacts outside the extension-managed block."
    : undefined;
}

export class CodexClientDriver implements McpClientDriver {
  readonly id = "codex";
  readonly name = "Codex";

  get configPath(): string {
    return path.join(getCodexHome(), "config.toml");
  }

  isDetected(): boolean {
    return fsSync.existsSync(getCodexHome());
  }

  async check(mcpScriptPath: string): Promise<IntegrationCheck> {
    try {
      const content = await fs.readFile(this.configPath, "utf8");
      const conflict = configurationConflict(content);
      if (conflict) return { status: "configuration-conflict", detail: conflict };
      const configured = hasManagedCodexArtifactsMcp(content, mcpScriptPath);
      return configured ? { status: "ready" } : { status: "missing" };
    } catch (error: any) {
      if (error?.code === "ENOENT") return { status: "missing" };
      throw error;
    }
  }

  async install(mcpScriptPath: string): Promise<void> {
    await fs.mkdir(getCodexHome(), { recursive: true });
    let content = "";
    try {
      content = await fs.readFile(this.configPath, "utf8");
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    const conflict = configurationConflict(content);
    if (conflict) {
      throw new Error(conflict);
    }
    const updated = upsertCodexArtifactsMcp(content, mcpScriptPath);
    await writeTextFileAtomic(this.configPath, updated);

    await this.cleanupLegacyHooks();
  }

  async uninstall(): Promise<boolean> {
    let changed = false;
    try {
      const content = await fs.readFile(this.configPath, "utf8");
      const updated = removeCodexArtifactsMcp(content);
      if (updated !== content) {
        await writeTextFileAtomic(this.configPath, updated);
        changed = true;
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }

    const hooksCleaned = await this.cleanupLegacyHooks();
    return changed || hooksCleaned;
  }

  private async cleanupLegacyHooks(): Promise<boolean> {
    let changed = false;
    const codexHome = getCodexHome();
    const hooksPath = path.join(codexHome, "hooks.json");
    try {
      const hooksContent = await fs.readFile(hooksPath, "utf8").catch(() => "");
      if (hooksContent) {
        const hooks = JSON.parse(hooksContent) as HooksFile;
        const migration = removeCodexArtifactsHooks(hooks);
        if (migration.changed) {
          await writeTextFileAtomic(hooksPath, `${JSON.stringify(migration.config, null, 2)}\n`);
          changed = true;
        }
      }
    } catch {}

    const legacyHookScript = path.join(codexHome, "codex-artifacts", CODEX_ARTIFACTS_HOOK_MARKER);
    try {
      const stat = await fs.stat(legacyHookScript).catch(() => null);
      if (stat) {
        await fs.rm(legacyHookScript, { force: true }).catch(() => {});
        changed = true;
      }
    } catch {}

    return changed;
  }
}
