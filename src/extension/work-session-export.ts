import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import yazl from "yazl";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import {
  ensureSafeGlobalArtifactDirectory,
  ensureSafeGlobalArtifactsRoot,
  ensureSafeManagedArtifactFile,
  parseArtifactManifest,
} from "../shared/artifact-validation";
import { readSession } from "../shared/conversation-artifact-registry";

export interface ExportWorkSessionOptions extends GlobalArtifactsRootOptions {
  targetPath?: string;
  showSaveDialog?: typeof vscode.window.showSaveDialog;
}

export type ExportWorkSessionResult =
  | { success: true; targetPath: string; cancelled?: false }
  | { success: false; cancelled: true };

/**
 * Sanitizes a string for use in filename / directory name across OS platforms.
 * Replaces illegal characters, strips trailing dots/spaces, avoids Windows reserved names.
 */
export function sanitizeFilenamePart(name: string, fallback: string): string {
  let clean = name.replace(/[\x00-\x1f\x7f/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  clean = clean.replace(/[-. ]+$/, "");
  clean = clean.replace(/^[-. ]+/, "");
  const upper = clean.toUpperCase();
  if (
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/.test(upper) ||
    clean.length === 0
  ) {
    clean = fallback;
  }
  return clean || fallback;
}

export async function exportWorkSession(
  sessionId: string,
  options: ExportWorkSessionOptions = {},
): Promise<ExportWorkSessionResult> {
  const session = await readSession(sessionId, options);
  const collectionRoot = await ensureSafeGlobalArtifactsRoot(options);

  let targetPath = options.targetPath;
  if (!targetPath) {
    const defaultFilename = `${sanitizeFilenamePart(session.title, "Session")}.zip`;
    const defaultDir = options.userHome ?? process.cwd();
    const defaultUri = vscode.Uri.file(path.join(defaultDir, defaultFilename));
    const showDialog = options.showSaveDialog ?? vscode.window.showSaveDialog;
    const selectedUri = await showDialog({
      defaultUri,
      filters: { "ZIP Archive": ["zip"] },
      saveLabel: "Export",
      title: "Export session archive",
    });
    if (!selectedUri) {
      return { success: false, cancelled: true };
    }
    targetPath = selectedUri.fsPath;
  }

  const rootFolder = sanitizeFilenamePart(session.title, "Session");
  const zipfile = new yazl.ZipFile();

  // Root instructions file (present even if empty)
  zipfile.addBuffer(
    Buffer.from(session.instructions ?? "", "utf8"),
    `${rootFolder}/Instructions.md`,
  );

  // Root empty zone directories
  zipfile.addEmptyDirectory(`${rootFolder}/Working/`);
  zipfile.addEmptyDirectory(`${rootFolder}/References/`);
  zipfile.addEmptyDirectory(`${rootFolder}/Archived/`);

  const zones = [
    { key: "working", folder: "Working" },
    { key: "references", folder: "References" },
    { key: "archived", folder: "Archived" },
  ] as const;

  for (const { key, folder } of zones) {
    const items = session[key];
    for (let index = 0; index < items.length; index++) {
      const id = items[index]!;
      const candidateDir = path.join(collectionRoot, id);

      let manifestTitle = "Artifact";
      let markdownContent = "";
      try {
        const canonicalDir = await ensureSafeGlobalArtifactDirectory(id, candidateDir, options);
        const manifestPath = await ensureSafeManagedArtifactFile(
          canonicalDir,
          path.join(canonicalDir, ARTIFACT_MANIFEST_FILE),
        );
        const manifestRaw = await fs.promises.readFile(manifestPath, "utf8");
        const manifest = parseArtifactManifest(JSON.parse(manifestRaw));
        if (manifest.artifactId !== id) {
          throw new Error(`Manifest artifactId "${manifest.artifactId}" does not match member id "${id}".`);
        }
        manifestTitle = manifest.title;

        const markdownPath = await ensureSafeManagedArtifactFile(
          canonicalDir,
          path.join(canonicalDir, ARTIFACT_MARKDOWN_FILE),
        );
        markdownContent = await fs.promises.readFile(markdownPath, "utf8");
      } catch {
        throw new Error(`Failed to export session: member artifact "${id}" is missing or unreadable.`);
      }

      const prefix = String(index + 1).padStart(2, "0");
      const sanitizedTitle = sanitizeFilenamePart(manifestTitle, "Artifact");
      const filename = `${prefix} - ${sanitizedTitle}.md`;
      const entryPath = `${rootFolder}/${folder}/${filename}`;

      zipfile.addBuffer(Buffer.from(markdownContent, "utf8"), entryPath);
    }
  }

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  let tempCreated = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(tempPath);
      tempCreated = true;

      const cleanup = () => {
        writeStream.destroy();
      };
      writeStream.on("error", (err) => {
        cleanup();
        reject(err);
      });
      writeStream.on("finish", resolve);
      zipfile.outputStream.on("error", (err) => {
        cleanup();
        reject(err);
      });
      zipfile.outputStream.pipe(writeStream);
      zipfile.end();
    });

    try {
      await fs.promises.rename(tempPath, targetPath);
      tempCreated = false;
    } catch (err: any) {
      if (err?.code === "EEXIST" || err?.code === "EPERM" || err?.code === "EACCES") {
        const backupPath = `${targetPath}.bak-${process.pid}-${Date.now()}`;
        let backupCreated = false;
        try {
          await fs.promises.rename(targetPath, backupPath);
          backupCreated = true;
          await fs.promises.rename(tempPath, targetPath);
          tempCreated = false;
          await fs.promises.unlink(backupPath).catch(() => {});
          backupCreated = false;
        } catch (replaceErr) {
          if (backupCreated) {
            await fs.promises.rename(backupPath, targetPath).catch(() => {});
          }
          throw replaceErr;
        }
      } else {
        throw err;
      }
    }
  } finally {
    if (tempCreated) {
      await fs.promises.unlink(tempPath).catch(() => {});
    }
  }

  return { success: true, targetPath };
}
