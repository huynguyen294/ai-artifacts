import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_TYPES,
  SessionTypeError,
  countSessionsByType,
  createSessionType,
  deleteSessionType,
  ensureSessionTypesDocument,
  listSessionTypes,
  renameSessionType,
} from "../src/shared/session-type-registry";
import { createSession } from "../src/shared/conversation-artifact-registry";
import { sessionTypesFilePath } from "../src/shared/artifact-files";

const temporaryDirectories: string[] = [];
let userHome: string;

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

beforeEach(async () => {
  const tmp = await makeTemporaryDirectory("session-type-home-");
  userHome = await fs.realpath(tmp);
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("session-type-registry", () => {
  it("initializes default types when file is missing", async () => {
    const doc = await ensureSessionTypesDocument({ userHome });
    expect(doc.types).toEqual(DEFAULT_SESSION_TYPES);
    expect(doc.types.map((t) => t.id)).toEqual(["conversation", "project", "feature", "fix"]);
  });

  it("lists existing session types", async () => {
    const types = await listSessionTypes({ userHome });
    expect(types.length).toBe(4);
    expect(types[0]).toEqual({ id: "conversation", label: "Conversation" });
  });

  it("creates a new custom session type and prevents duplicates", async () => {
    const created = await createSessionType("Research", { userHome });
    expect(created.label).toBe("Research");
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const types = await listSessionTypes({ userHome });
    expect(types.some((t) => t.id === created.id && t.label === "Research")).toBe(true);

    // Duplicate check case-insensitive
    await expect(createSessionType("research", { userHome })).rejects.toThrow(
      'Session type with label "research" already exists.',
    );
    await expect(createSessionType("   ", { userHome })).rejects.toThrow(
      "Session type label must not be blank.",
    );
  });

  it("renames a session type preserving its ID", async () => {
    const created = await createSessionType("Bugfix", { userHome });
    const renamed = await renameSessionType(created.id, "Bug Fixes", { userHome });
    expect(renamed.id).toBe(created.id);
    expect(renamed.label).toBe("Bug Fixes");

    const types = await listSessionTypes({ userHome });
    expect(types.find((t) => t.id === created.id)?.label).toBe("Bug Fixes");

    // Rejects duplicate label
    await expect(renameSessionType(created.id, "Conversation", { userHome })).rejects.toThrow(
      'Session type with label "Conversation" already exists.',
    );
  });

  it("rejects deletion of default conversation type", async () => {
    await expect(deleteSessionType("conversation", undefined, { userHome })).rejects.toThrow(
      'Default session type "conversation" cannot be deleted.',
    );
  });

  it("deletes a custom type and reassigns existing sessions to default", async () => {
    const custom = await createSessionType("Spike", { userHome });

    // Create session using this type
    const session = await createSession({
      title: "Spike Session",
      typeId: custom.id,
      userHome,
    });
    expect(session.typeId).toBe(custom.id);

    const countBefore = await countSessionsByType(custom.id, { userHome });
    expect(countBefore).toBe(1);

    const result = await deleteSessionType(custom.id, undefined, { userHome });
    expect(result.affectedSessionsCount).toBe(1);

    const types = await listSessionTypes({ userHome });
    expect(types.some((t) => t.id === custom.id)).toBe(false);

    // Count after deletion should be 0, session should be reassigned to conversation
    const countAfter = await countSessionsByType(custom.id, { userHome });
    expect(countAfter).toBe(0);

    const convCount = await countSessionsByType("conversation", { userHome });
    expect(convCount).toBe(1);
  });

  it("throws SessionTypeError when session-types.json contains invalid JSON, even with seedIfMissing: false", async () => {
    const filePath = sessionTypesFilePath({ userHome });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{ invalid json", "utf8");

    await expect(listSessionTypes({ userHome, seedIfMissing: false })).rejects.toThrow(SessionTypeError);
    await expect(listSessionTypes({ userHome, seedIfMissing: true })).rejects.toThrow(SessionTypeError);
  });
});

