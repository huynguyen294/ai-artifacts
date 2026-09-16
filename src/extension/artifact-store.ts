import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import {
  ARTIFACT_SCHEMA_VERSION,
  commentsDocumentSchema,
  reviewSubmissionSchema,
  type CommentDraft,
  type CommentsDocument,
  type ReviewDecision,
  type ReviewComment,
  type ReviewState,
  type ReviewSubmission,
} from "../shared/contracts";
import {
  assertManagedArtifactFilePath,
  artifactPaths,
  ensureSafeGlobalArtifactDirectory,
  ensureSafeManagedArtifactFile,
  parseArtifactManifest,
  parseBoundCommentsDocument,
  parseBoundReviewSubmission,
  sameFilesystemPath,
} from "../shared/artifact-validation";
import { parseMarkdownBlocks } from "../shared/markdown-blocks";
import {
  ARTIFACT_UPDATE_LOCK_FILE,
  OWNER_ONLY_FILE_MODE,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isWindowsReplaceBlock(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

async function writeNewManagedFile(
  artifactDirectory: string,
  filePath: string,
  contents: string,
): Promise<void> {
  const safeFilePath = await ensureSafeManagedArtifactFile(
    artifactDirectory,
    filePath,
    { allowMissing: true },
  );
  await fs.writeFile(safeFilePath, contents, {
    encoding: "utf8",
    flag: "wx",
    mode: OWNER_ONLY_FILE_MODE,
  });
  await ensureSafeManagedArtifactFile(artifactDirectory, safeFilePath);
}

async function copyManagedFile(
  artifactDirectory: string,
  source: string,
  target: string,
  exclusive = false,
): Promise<void> {
  const safeSource = await ensureSafeManagedArtifactFile(artifactDirectory, source);
  const safeTarget = await ensureSafeManagedArtifactFile(
    artifactDirectory,
    target,
    { allowMissing: true },
  );
  await fs.copyFile(safeSource, safeTarget, exclusive ? constants.COPYFILE_EXCL : 0);
  await ensureSafeManagedArtifactFile(artifactDirectory, safeTarget);
}

async function linkManagedFileToMissingTarget(
  artifactDirectory: string,
  source: string,
  target: string,
): Promise<void> {
  const safeSource = await ensureSafeManagedArtifactFile(artifactDirectory, source);
  const safeTarget = await ensureSafeManagedArtifactFile(
    artifactDirectory,
    target,
    { allowMissing: true },
  );
  await fs.link(safeSource, safeTarget);
  await ensureSafeManagedArtifactFile(artifactDirectory, safeTarget);
}

async function replaceManagedFile(
  artifactDirectory: string,
  source: string,
  target: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const safeSource = await ensureSafeManagedArtifactFile(artifactDirectory, source);
    const safeTarget = await ensureSafeManagedArtifactFile(
      artifactDirectory,
      target,
      { allowMissing: true },
    );
    try {
      await fs.rename(safeSource, safeTarget);
      await ensureSafeManagedArtifactFile(artifactDirectory, safeTarget);
      return;
    } catch (error) {
      if (attempt < 2 && isWindowsReplaceBlock(error)) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      if (isWindowsReplaceBlock(error) || errorCode(error) === "EXDEV") {
        await copyManagedFile(artifactDirectory, safeSource, safeTarget);
        return;
      }
      throw error;
    }
  }
}

async function removeCreatedManagedFile(
  artifactDirectory: string,
  filePath: string,
): Promise<void> {
  const safeFilePath = assertManagedArtifactFilePath(artifactDirectory, filePath);
  try {
    const stat = await fs.lstat(safeFilePath);
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new Error("UNSAFE_ARTIFACT_PATH: managed cleanup targets must be regular files or symbolic links.");
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  await fs.unlink(safeFilePath);
}

async function waitForArtifactTransaction(artifactDirectory: string): Promise<void> {
  const lockPath = path.join(artifactDirectory, ARTIFACT_UPDATE_LOCK_FILE);
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await ensureSafeManagedArtifactFile(artifactDirectory, lockPath);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The artifact is still completing a review update. Try again shortly.");
}

export class ArtifactStore {
  readonly artifactDirectory: string;
  readonly manifestPath: string;
  readonly commentsPath: string;
  readonly submissionPath: string;
  private readonly globalRootOptions: GlobalArtifactsRootOptions;

  constructor(
    readonly artifactPath: string,
    globalRootOptions: GlobalArtifactsRootOptions = {},
  ) {
    this.artifactDirectory = path.dirname(artifactPath);
    const files = artifactPaths(this.artifactDirectory);
    this.manifestPath = files.manifestPath;
    this.commentsPath = files.commentsPath;
    this.submissionPath = files.submissionPath;
    this.globalRootOptions = globalRootOptions;
  }

  async load(): Promise<ReviewState> {
    if (!path.isAbsolute(this.artifactPath)) {
      throw new Error("The artifact handle must be an absolute path to artifact.md.");
    }
    const candidateArtifactId = path.basename(this.artifactDirectory);
    const { artifactDirectory: safeArtifactDirectory, files } = await this.safeArtifactFiles(candidateArtifactId);

    await waitForArtifactTransaction(safeArtifactDirectory);
    const [markdown, rawManifest] = await Promise.all([
      this.readManagedText(safeArtifactDirectory, files.artifactPath),
      this.readManagedJson(safeArtifactDirectory, files.manifestPath),
    ]);
    const artifact = parseArtifactManifest(rawManifest);
    if (artifact.artifactId !== candidateArtifactId) {
      throw new Error("artifact.json does not belong to this global artifact directory.");
    }
    const artifactSha256 = sha256(markdown);
    let comments: ReviewState["comments"];
    let commentsRaw: string;
    try {
      commentsRaw = await this.readManagedText(safeArtifactDirectory, files.commentsPath);
      comments = parseBoundCommentsDocument(JSON.parse(commentsRaw), {
        schemaVersion: artifact.schemaVersion,
        artifactId: artifact.artifactId,
        reviewRound: artifact.reviewRound,
        artifactSha256,
      });
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      const createdComments = commentsDocumentSchema.parse({
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        artifactId: artifact.artifactId,
        reviewRound: artifact.reviewRound,
        artifactSha256,
        comments: [],
      });
      await this.writeComments(createdComments);
      commentsRaw = await this.readManagedText(safeArtifactDirectory, files.commentsPath);
      comments = createdComments;
    }

    let submission: ReviewState["submission"];
    try {
      const rawSubmission = await this.readManagedJson(safeArtifactDirectory, files.submissionPath);
      submission = parseBoundReviewSubmission(rawSubmission, {
        schemaVersion: artifact.schemaVersion,
        artifactId: artifact.artifactId,
        reviewRound: artifact.reviewRound,
        reviewSessionId: artifact.reviewSessionId,
        artifactSha256,
        commentsSha256: sha256(commentsRaw),
      });
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }

    return {
      artifact,
      comments,
      blocks: parseMarkdownBlocks(markdown),
      markdown,
      lifecycle: { readOnly: false },
      ...(submission ? { submission } : {}),
    };
  }

  async addComment(draft: CommentDraft): Promise<ReviewState> {
    const state = await this.load();
    this.assertWritableState(state);
    if (state.submission) throw new Error("This artifact review round was already submitted.");
    const block = state.blocks.find((candidate) => candidate.id === draft.blockId);
    if (!block) throw new Error("The selected Markdown block no longer exists.");
    if (!draft.body.trim()) throw new Error("Comment cannot be empty.");
    const { start, end, quote } = draft.selection;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
      throw new Error("Invalid selection range.");
    }
    if (block.text.slice(start, end) !== quote) {
      throw new Error("The selected text no longer matches the plan.");
    }

    const comment: ReviewComment = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      block: { id: block.id, type: block.type, heading: block.heading },
      selection: {
        quote,
        start,
        end,
        prefix: block.text.slice(Math.max(0, start - 40), start),
        suffix: block.text.slice(end, end + 40),
      },
      body: draft.body.trim(),
    };
    state.comments.comments.push(comment);
    await this.writeComments(state.comments);
    return this.load();
  }

  async removeComment(commentId: string): Promise<ReviewState> {
    const state = await this.load();
    this.assertWritableState(state);
    if (state.submission) throw new Error("This artifact review round was already submitted.");
    state.comments.comments = state.comments.comments.filter((comment) => comment.id !== commentId);
    await this.writeComments(state.comments);
    return this.load();
  }

  async submitReview(decision: ReviewDecision): Promise<ReviewState> {
    const state = await this.load();
    this.assertWritableState(state);
    if (state.submission) throw new Error("This artifact review round was already submitted.");
    if (decision === "revise" && state.comments.comments.length === 0) {
      throw new Error("Add at least one comment before requesting a revision.");
    }
    // "approve" and "save" have no comment constraints — allowed with or without comments.
    const { artifactDirectory, files } = await this.safeArtifactFiles(state.artifact.artifactId);
    const [markdown, commentsRaw] = await Promise.all([
      this.readManagedText(artifactDirectory, files.artifactPath),
      this.readManagedText(artifactDirectory, files.commentsPath),
    ]);
    const artifactSha256 = sha256(markdown);
    parseBoundCommentsDocument(JSON.parse(commentsRaw), {
      schemaVersion: state.artifact.schemaVersion,
      artifactId: state.artifact.artifactId,
      reviewRound: state.artifact.reviewRound,
      artifactSha256,
    });
    const submission = reviewSubmissionSchema.parse({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: state.artifact.artifactId,
      reviewRound: state.artifact.reviewRound,
      reviewSessionId: state.artifact.reviewSessionId,
      submittedAt: new Date().toISOString(),
      decision,
      artifactSha256,
      commentsSha256: sha256(commentsRaw),
    });
    await this.createSubmission(submission);
    return this.load();
  }

  private assertWritableState(state: ReviewState): void {
    if (state.lifecycle.readOnly) {
      throw new Error(state.lifecycle.message ?? "This artifact is read-only.");
    }
  }

  private async safeArtifactFiles(artifactId: string): Promise<{
    artifactDirectory: string;
    files: ReturnType<typeof artifactPaths>;
  }> {
    const artifactDirectory = await ensureSafeGlobalArtifactDirectory(
      artifactId,
      this.artifactDirectory,
      this.globalRootOptions,
    );
    const files = artifactPaths(artifactDirectory);
    if (!sameFilesystemPath(this.artifactPath, files.artifactPath)) {
      throw new Error("The artifact handle must point to artifact.md in the global artifact directory.");
    }
    return { artifactDirectory, files };
  }

  private async readManagedText(artifactDirectory: string, filePath: string): Promise<string> {
    const safeFilePath = await ensureSafeManagedArtifactFile(artifactDirectory, filePath);
    return fs.readFile(safeFilePath, "utf8");
  }

  private async readManagedJson(artifactDirectory: string, filePath: string): Promise<unknown> {
    return JSON.parse(await this.readManagedText(artifactDirectory, filePath));
  }

  private async createSubmission(submission: ReviewSubmission): Promise<void> {
    const { artifactDirectory, files } = await this.safeArtifactFiles(submission.artifactId);
    const temporaryPath = `${files.submissionPath}.tmp-${process.pid}-${Date.now()}`;
    let temporaryCreated = false;
    try {
      await writeNewManagedFile(
        artifactDirectory,
        temporaryPath,
        `${JSON.stringify(submission, null, 2)}\n`,
      );
      temporaryCreated = true;
      try {
        await linkManagedFileToMissingTarget(artifactDirectory, temporaryPath, files.submissionPath);
      } catch (error) {
        if (errorCode(error) === "EEXIST") throw new Error("This artifact review round was already submitted.");
        if (!isWindowsReplaceBlock(error) && errorCode(error) !== "ENOSYS") throw error;
        try {
          await copyManagedFile(artifactDirectory, temporaryPath, files.submissionPath, true);
        } catch (copyError) {
          if (errorCode(copyError) === "EEXIST") {
            throw new Error("This artifact review round was already submitted.");
          }
          throw copyError;
        }
      }
    } finally {
      if (temporaryCreated) await removeCreatedManagedFile(artifactDirectory, temporaryPath);
    }
  }

  private async writeComments(comments: CommentsDocument): Promise<void> {
    const validated = commentsDocumentSchema.parse(comments);
    const { artifactDirectory, files } = await this.safeArtifactFiles(validated.artifactId);
    const temporaryPath = `${files.commentsPath}.tmp-${process.pid}-${Date.now()}`;
    let temporaryCreated = false;
    try {
      await writeNewManagedFile(
        artifactDirectory,
        temporaryPath,
        `${JSON.stringify(validated, null, 2)}\n`,
      );
      temporaryCreated = true;
      await replaceManagedFile(artifactDirectory, temporaryPath, files.commentsPath);
    } finally {
      if (temporaryCreated) await removeCreatedManagedFile(artifactDirectory, temporaryPath);
    }
  }
}
