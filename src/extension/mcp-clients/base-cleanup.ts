import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { managedAssetsRoot } from "../../shared/artifact-files";

async function safeRemoveTarget(targetPath: string): Promise<void> {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      await fs.unlink(targetPath);
      return;
    }
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

export async function cleanupBaseMcpServer(options?: { userHome?: string }): Promise<void> {
  const home = options?.userHome || os.homedir();
  const managedDirectory = managedAssetsRoot({ userHome: home });
  const legacyDirectory = path.join(home, ".vscode", "ai-artifacts");
  const targetSkill = path.join(home, ".agents", "skills", "create-review-artifact");
  const targetSessionSkill = path.join(home, ".agents", "skills", "work-session");
  const targetLegacySkill = path.join(home, ".agents", "skills", "create-plan-artifact");
  const claudeSkill = path.join(home, ".claude", "skills", "create-review-artifact");
  const claudeSessionSkill = path.join(home, ".claude", "skills", "work-session");
  const antigravitySkill = path.join(home, ".gemini", "config", "skills", "create-review-artifact");
  const antigravitySessionSkill = path.join(home, ".gemini", "config", "skills", "work-session");

  await Promise.allSettled([
    safeRemoveTarget(managedDirectory),
    safeRemoveTarget(legacyDirectory),
    safeRemoveTarget(targetSkill),
    safeRemoveTarget(targetSessionSkill),
    safeRemoveTarget(targetLegacySkill),
    safeRemoveTarget(claudeSkill),
    safeRemoveTarget(claudeSessionSkill),
    safeRemoveTarget(antigravitySkill),
    safeRemoveTarget(antigravitySessionSkill),
  ]);
}
