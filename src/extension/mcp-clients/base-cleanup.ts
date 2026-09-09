import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function cleanupBaseMcpServer(options?: { userHome?: string }): Promise<void> {
  const home = options?.userHome || os.homedir();
  const targetDirectory = path.join(home, ".vscode", "ai-artifacts");
  const targetSkill = path.join(home, ".agents", "skills", "create-review-artifact");
  const targetLegacySkill = path.join(home, ".agents", "skills", "create-plan-artifact");

  await Promise.all([
    fs.rm(targetDirectory, { recursive: true, force: true }).catch(() => {}),
    fs.rm(targetSkill, { recursive: true, force: true }).catch(() => {}),
    fs.rm(targetLegacySkill, { recursive: true, force: true }).catch(() => {}),
  ]);
}
