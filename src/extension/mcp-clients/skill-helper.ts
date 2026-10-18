import { promises as fs } from "node:fs";
import path from "node:path";

export const REVIEW_SKILL_ASSETS = [
  "SKILL.md",
  path.join("references", "artifact-contract.md"),
  path.join("agents", "openai.yaml"),
];

export async function sameFile(left: string, right: string): Promise<boolean> {
  try {
    const [leftContents, rightContents] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
    return leftContents.equals(rightContents);
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function replaceSkillDirectory(source: string, target: string): Promise<void> {
  const targetParent = path.dirname(target);
  await fs.mkdir(targetParent, { recursive: true });
  const stagingRoot = await fs.mkdtemp(path.join(targetParent, ".create-review-artifact-install-"));
  const stagedSkill = path.join(stagingRoot, "next");
  const previousSkill = path.join(stagingRoot, "previous");
  let previousMoved = false;
  let keepRecoveryDirectory = false;

  try {
    await fs.cp(source, stagedSkill, { recursive: true, force: true });
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
