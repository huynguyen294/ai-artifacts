import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  artifactCollectionRoot,
  workSessionInstructionsPath,
} from "../src/shared/artifact-files";
import {
  createSession,
  moveArtifactInSession,
  registerArtifactInSession,
  setSessionType,
} from "../src/shared/conversation-artifact-registry";
import { createSessionType } from "../src/shared/session-type-registry";
import { resolveWorkSessionContext } from "../src/shared/work-session-context";

describe("resolveWorkSessionContext", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "context-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => undefined);
  });

  async function createTestArtifact(
    artifactId: string,
    title: string,
    kind: string,
    markdownContent: string,
  ): Promise<void> {
    const artDir = path.join(artifactCollectionRoot({ userHome: tempHome }), artifactId);
    await fs.mkdir(artDir, { recursive: true });

    const manifest = {
      schemaVersion: 6,
      artifactId,
      title,
      kind,
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T11:00:00.000Z",
      reviewRound: 1,
      reviewSessionId: "11111111-1111-4111-8111-111111111111",
    };
    await fs.writeFile(path.join(artDir, ARTIFACT_MANIFEST_FILE), JSON.stringify(manifest), "utf8");
    await fs.writeFile(path.join(artDir, ARTIFACT_MARKDOWN_FILE), markdownContent, "utf8");
  }

  it("resolves session context, custom type label, instructions path, and zone catalog with descriptions", async () => {
    const customType = await createSessionType("Architecture Review", { userHome: tempHome });

    const session = await createSession({
      title: "Context Feature Session",
      instructions: "## Custom Session Guidelines\nAlways write tests first.",
      userHome: tempHome,
    });
    await setSessionType(session.sessionId, customType.id, { userHome: tempHome });

    // Create 2 real artifacts
    await createTestArtifact(
      "art-work-1",
      "Implementation Blueprint",
      "implementation-plan",
      "# Overview\n\nThis is the working plan for Phase 4.\n\n- Task 1\n- Task 2",
    );
    await createTestArtifact(
      "art-ref-1",
      "System Architecture",
      "design",
      "# Architectural Design\n\nDetailed boundaries and contracts.",
    );

    // Register them in session
    await registerArtifactInSession(session.sessionId, "art-work-1", { userHome: tempHome });
    await registerArtifactInSession(session.sessionId, "art-ref-1", { userHome: tempHome });
    // Also register an artifact that does NOT exist on disk (unavailable)
    await registerArtifactInSession(session.sessionId, "art-missing", { userHome: tempHome });

    // Move art-ref-1 and art-missing to references
    await moveArtifactInSession(session.sessionId, "art-ref-1", "references", 0, { userHome: tempHome });
    await moveArtifactInSession(session.sessionId, "art-missing", "references", 1, { userHome: tempHome });

    const context = await resolveWorkSessionContext(session.sessionId, { userHome: tempHome });

    expect(context.sessionId).toBe(session.sessionId);
    expect(context.title).toBe("Context Feature Session");
    expect(context.typeId).toBe(customType.id);
    expect(context.typeLabel).toBe("Architecture Review");
    expect(context.instructions).toBe("## Custom Session Guidelines\nAlways write tests first.");
    expect(context.instructionsPath).toBe(workSessionInstructionsPath(session.sessionId, { userHome: tempHome }));

    // Catalog: Working
    expect(context.catalog.working).toHaveLength(1);
    const workingItem = context.catalog.working[0]!;
    expect(workingItem.unavailable).toBeUndefined();
    if (!workingItem.unavailable) {
      expect(workingItem.artifactId).toBe("art-work-1");
      expect(workingItem.title).toBe("Implementation Blueprint");
      expect(workingItem.kind).toBe("implementation-plan");
      expect(workingItem.description).toContain("Overview This is the working plan for Phase 4.");
      expect(workingItem.artifactPath).toContain("art-work-1");
    }

    // Catalog: References
    expect(context.catalog.references).toHaveLength(2);
    const refItem = context.catalog.references[0]!;
    expect(refItem.unavailable).toBeUndefined();
    if (!refItem.unavailable) {
      expect(refItem.artifactId).toBe("art-ref-1");
      expect(refItem.title).toBe("System Architecture");
      expect(refItem.kind).toBe("design");
      expect(refItem.description).toBe("Architectural Design Detailed boundaries and contracts.");
    }

    const missingItem = context.catalog.references[1]!;
    expect(missingItem).toEqual({
      artifactId: "art-missing",
      unavailable: true,
    });

    // Catalog: Archived
    expect(context.catalog.archived).toEqual([]);
  });

  it("falls back to Conversation for default session type and handles empty zones", async () => {
    const session = await createSession({
      title: "Simple Session",
      userHome: tempHome,
    });

    const context = await resolveWorkSessionContext(session.sessionId, { userHome: tempHome });
    expect(context.typeLabel).toBe("Conversation");
    expect(context.instructions).toBe("");
    expect(context.catalog.working).toEqual([]);
    expect(context.catalog.references).toEqual([]);
    expect(context.catalog.archived).toEqual([]);
  });

  it("marks artifacts unavailable when manifest.artifactId does not match directory name", async () => {
    const session = await createSession({
      title: "Mismatch Test Session",
      userHome: tempHome,
    });

    // Create an artifact where directory is art-dir-id but manifest has artifactId: "spoofed-id"
    const artDir = path.join(artifactCollectionRoot({ userHome: tempHome }), "art-dir-id");
    await fs.mkdir(artDir, { recursive: true });
    const manifest = {
      schemaVersion: 6,
      artifactId: "spoofed-id",
      title: "Spoofed Artifact",
      kind: "note",
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T11:00:00.000Z",
      reviewRound: 1,
      reviewSessionId: "11111111-1111-4111-8111-111111111111",
    };
    await fs.writeFile(path.join(artDir, ARTIFACT_MANIFEST_FILE), JSON.stringify(manifest), "utf8");
    await fs.writeFile(path.join(artDir, ARTIFACT_MARKDOWN_FILE), "# Spoofed", "utf8");

    await registerArtifactInSession(session.sessionId, "art-dir-id", { userHome: tempHome });

    const context = await resolveWorkSessionContext(session.sessionId, { userHome: tempHome });
    expect(context.catalog.working).toEqual([
      {
        artifactId: "art-dir-id",
        unavailable: true,
      },
    ]);
  });

  it("does not mutate or touch files on disk during context resolution", async () => {
    const session = await createSession({
      title: "Read-only Verification",
      instructions: "Keep untouched",
      userHome: tempHome,
    });
    await createTestArtifact("art-ro-1", "RO Artifact", "note", "# Content");
    await registerArtifactInSession(session.sessionId, "art-ro-1", { userHome: tempHome });

    const instructionsFile = workSessionInstructionsPath(session.sessionId, { userHome: tempHome });
    const statBefore = await fs.stat(instructionsFile);

    await new Promise((r) => setTimeout(r, 15));
    const context = await resolveWorkSessionContext(session.sessionId, { userHome: tempHome });
    expect(context.catalog.working).toHaveLength(1);

    const statAfter = await fs.stat(instructionsFile);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });
});

