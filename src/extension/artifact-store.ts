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
  assertArtifactDirectory,
  artifactPaths,
  parseArtifactManifest,
  parseBoundCommentsDocument,
  parseBoundReviewSubmission,
} from "../shared/artifact-validation";
import { parseMarkdownBlocks } from "../shared/markdown-blocks";
import { ARTIFACT_UPDATE_LOCK_FILE } from "../shared/artifact-files";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function waitForArtifactTransaction(artifactDirectory: string): Promise<void> {
  const lockPath = path.join(artifactDirectory, ARTIFACT_UPDATE_LOCK_FILE);
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fs.access(lockPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
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

  constructor(readonly artifactPath: string) {
    this.artifactDirectory = path.dirname(artifactPath);
    const files = artifactPaths(this.artifactDirectory);
    this.manifestPath = files.manifestPath;
    this.commentsPath = files.commentsPath;
    this.submissionPath = files.submissionPath;
  }

  async load(requireOrigin = false): Promise<ReviewState> {
    await waitForArtifactTransaction(this.artifactDirectory);
    const [markdown, rawManifest] = await Promise.all([
      fs.readFile(this.artifactPath, "utf8"),
      readJson(this.manifestPath),
    ]);
    const artifact = parseArtifactManifest(rawManifest);
    assertArtifactDirectory(artifact, this.artifactDirectory);
    if (requireOrigin && !artifact.origin.threadId) {
      throw new Error("This artifact is not linked to its originating Codex chat yet.");
    }

    const artifactSha256 = sha256(markdown);
    let comments: CommentsDocument;
    try {
      comments = parseBoundCommentsDocument(await readJson(this.commentsPath), {
        artifactId: artifact.artifactId,
        reviewRound: artifact.reviewRound,
        artifactSha256,
      });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      comments = {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        artifactId: artifact.artifactId,
        reviewRound: artifact.reviewRound,
        artifactSha256,
        comments: [],
      };
      await this.writeComments(comments);
    }

    let submission: ReviewSubmission | undefined;
    try {
      const rawSubmission = await readJson(this.submissionPath);
      const commentsRaw = await fs.readFile(this.commentsPath, "utf8");
      submission = parseBoundReviewSubmission(rawSubmission, {
        artifactId: artifact.artifactId,
        reviewRound: artifact.reviewRound,
        threadId: artifact.origin.threadId,
        artifactSha256,
        commentsSha256: sha256(commentsRaw),
      });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }

    return {
      artifact,
      comments,
      blocks: parseMarkdownBlocks(markdown),
      markdown,
      ...(submission ? { submission } : {}),
    };
  }

  async addComment(draft: CommentDraft): Promise<ReviewState> {
    const state = await this.load();
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
    if (state.submission) throw new Error("This artifact review round was already submitted.");
    state.comments.comments = state.comments.comments.filter((comment) => comment.id !== commentId);
    await this.writeComments(state.comments);
    return this.load();
  }

  async submitReview(decision: ReviewDecision): Promise<ReviewState> {
    const state = await this.load(true);
    if (state.submission) throw new Error("This artifact review round was already submitted.");
    if (decision === "revise" && state.comments.comments.length === 0) {
      throw new Error("Add at least one comment before requesting a revision.");
    }
    // "approve" and "save" have no comment constraints — allowed with or without comments.
    const threadId = state.artifact.origin.threadId;
    if (!threadId) throw new Error("This artifact is not linked to its originating Codex chat yet.");
    const [markdown, commentsRaw] = await Promise.all([
      fs.readFile(this.artifactPath, "utf8"),
      fs.readFile(this.commentsPath, "utf8"),
    ]);
    const submission = reviewSubmissionSchema.parse({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: state.artifact.artifactId,
      reviewRound: state.artifact.reviewRound,
      threadId,
      submittedAt: new Date().toISOString(),
      decision,
      artifactSha256: sha256(markdown),
      commentsSha256: sha256(commentsRaw),
    });
    await this.createSubmission(submission);
    return this.load(true);
  }

  private async createSubmission(submission: ReviewSubmission): Promise<void> {
    const temporaryPath = `${this.submissionPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(submission, null, 2)}\n`, "utf8");
    try {
      try {
        await fs.link(temporaryPath, this.submissionPath);
      } catch (error: any) {
        if (error?.code === "EEXIST") throw new Error("This artifact review round was already submitted.");
        if (error?.code !== "EPERM" && error?.code !== "EACCES" && error?.code !== "ENOSYS") throw error;
        await fs.copyFile(temporaryPath, this.submissionPath, constants.COPYFILE_EXCL);
      }
    } finally {
      await fs.unlink(temporaryPath).catch(() => {});
    }
  }

  private async writeComments(comments: CommentsDocument): Promise<void> {
    const validated = commentsDocumentSchema.parse(comments);
    const temporaryPath = `${this.commentsPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.rename(temporaryPath, this.commentsPath);
          return;
        } catch (error: any) {
          if (attempt < 2 && (error?.code === "EPERM" || error?.code === "EBUSY" || error?.code === "EACCES")) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            continue;
          }
          if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EBUSY" || error?.code === "EXDEV") {
            await fs.copyFile(temporaryPath, this.commentsPath);
            return;
          }
          throw error;
        }
      }
    } finally {
      await fs.unlink(temporaryPath).catch(() => {});
    }
  }
}
