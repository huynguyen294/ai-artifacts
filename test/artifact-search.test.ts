import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DISCOVERY_CONCURRENCY,
  MAX_QUICK_PICK_ITEMS,
  discoverSearchableArtifacts,
  filterSearchableArtifacts,
  normalizeArtifactTitleSearch,
  type SearchableArtifact,
} from "../src/extension/artifact-search";
import { globalArtifactsRoot } from "../src/shared/artifact-files";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const dir of temporaryDirectories.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeUserHome(): Promise<string> {
  const userHome = await mkdtemp(path.join(tmpdir(), "agent-plus-search-"));
  temporaryDirectories.push(userHome);
  return userHome;
}

async function writeArtifact(
  userHome: string,
  artifactId: string,
  options: {
    title?: string;
    kind?: string;
    reviewRound?: number;
    schemaVersion?: number;
    createdAt?: string;
    updatedAt?: string;
    markdown?: string;
  } = {},
): Promise<string> {
  const collectionRoot = globalArtifactsRoot({ userHome });
  const artifactDir = path.join(collectionRoot, artifactId);
  await mkdir(artifactDir, { recursive: true });

  const manifest = {
    schemaVersion: options.schemaVersion ?? 6,
    kind: options.kind ?? "plan",
    artifactId,
    title: options.title ?? `Title for ${artifactId}`,
    createdAt: options.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: options.updatedAt ?? "2026-01-01T00:00:00.000Z",
    reviewRound: options.reviewRound ?? 1,
    reviewSessionId: randomUUID(),
  };

  await writeFile(
    path.join(artifactDir, "artifact.json"),
    JSON.stringify(manifest),
  );
  await writeFile(
    path.join(artifactDir, "artifact.md"),
    options.markdown ?? "# Test artifact",
  );
  return artifactDir;
}

function makeSearchable(
  artifactId: string,
  title: string,
  overrides: Partial<SearchableArtifact> = {},
): SearchableArtifact {
  return {
    artifactDirectory: `/fake/${artifactId}`,
    artifactPath: `/fake/${artifactId}/artifact.md`,
    artifactId,
    title,
    normalizedTitle: normalizeArtifactTitleSearch(title),
    kind: "plan",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    reviewRound: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeArtifactTitleSearch
// ---------------------------------------------------------------------------

describe("normalizeArtifactTitleSearch", () => {
  it("lowercases ASCII text", () => {
    expect(normalizeArtifactTitleSearch("Hello WORLD")).toBe("hello world");
  });

  it("removes Vietnamese diacritics via NFD and combining mark strip", () => {
    expect(normalizeArtifactTitleSearch("Lập kế hoạch")).toBe("lap ke hoach");
  });

  it("converts đ to d", () => {
    expect(normalizeArtifactTitleSearch("đề xuất")).toBe("de xuat");
  });

  it("converts Đ to d", () => {
    expect(normalizeArtifactTitleSearch("Đánh giá")).toBe("danh gia");
  });

  it("collapses multiple whitespace into single space", () => {
    expect(normalizeArtifactTitleSearch("hello   world\t\nnew")).toBe(
      "hello world new",
    );
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeArtifactTitleSearch("  hello  ")).toBe("hello");
  });

  it("handles combined normalization", () => {
    expect(normalizeArtifactTitleSearch("  Đổi Mới   Kế Hoạch  ")).toBe(
      "doi moi ke hoach",
    );
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeArtifactTitleSearch("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// filterSearchableArtifacts
// ---------------------------------------------------------------------------

describe("filterSearchableArtifacts", () => {
  // Pre-sorted by normalizedTitle ascending (as discoverSearchableArtifacts returns)
  const artifacts: SearchableArtifact[] = [
    makeSearchable("a-004", "Đánh giá kết quả"),      // "danh gia ket qua"
    makeSearchable("a-003", "Implementation Plan"),     // "implementation plan"
    makeSearchable("a-001", "Lập kế hoạch"),            // "lap ke hoach"
    makeSearchable("a-002", "Lập kế hoạch triển khai"), // "lap ke hoach trien khai"
  ];

  it("empty query matches all artifacts", () => {
    const result = filterSearchableArtifacts(artifacts, "");
    expect(result.totalMatches).toBe(4);
    expect(result.items).toHaveLength(4);
    expect(result.limited).toBe(false);
  });

  it("matches case-insensitively", () => {
    const result = filterSearchableArtifacts(artifacts, "IMPLEMENTATION");
    expect(result.items.map((a) => a.artifactId)).toEqual(["a-003"]);
  });

  it("matches accent-insensitively (query without diacritics, title with)", () => {
    const result = filterSearchableArtifacts(artifacts, "lap ke hoach");
    expect(result.items.map((a) => a.artifactId)).toEqual(["a-001", "a-002"]);
  });

  it("matches đ/Đ as d in query and title", () => {
    const result = filterSearchableArtifacts(artifacts, "danh gia");
    expect(result.items.map((a) => a.artifactId)).toEqual(["a-004"]);
  });

  it("matches with collapsed whitespace in query", () => {
    const result = filterSearchableArtifacts(artifacts, "ke   hoach");
    expect(result.items.map((a) => a.artifactId)).toEqual(["a-001", "a-002"]);
  });

  it("does not match reversed token order", () => {
    const result = filterSearchableArtifacts(artifacts, "hoach lap");
    expect(result.items).toHaveLength(0);
  });

  it("does not match by artifactId when title does not contain query", () => {
    const result = filterSearchableArtifacts(artifacts, "a-001");
    expect(result.items).toHaveLength(0);
  });

  it("does not match by kind when title does not contain query", () => {
    const result = filterSearchableArtifacts(artifacts, "plan");
    // Only "Implementation Plan" contains "plan" in its title
    expect(result.items.map((a) => a.artifactId)).toEqual(["a-003"]);
  });

  it("does not match by dates when title does not contain query", () => {
    const result = filterSearchableArtifacts(artifacts, "2026");
    expect(result.items).toHaveLength(0);
  });

  it("preserves input order (pre-sorted from discovery)", () => {
    const result = filterSearchableArtifacts(artifacts, "");
    expect(result.items.map((a) => a.artifactId)).toEqual([
      "a-004", // "danh gia ket qua"
      "a-003", // "implementation plan"
      "a-001", // "lap ke hoach"
      "a-002", // "lap ke hoach trien khai"
    ]);
  });

  it("reports totalMatches before slicing", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      makeSearchable(`b-${String(i).padStart(3, "0")}`, "Same Title"),
    );
    const result = filterSearchableArtifacts(many, "same", 3);
    expect(result.totalMatches).toBe(5);
    expect(result.items).toHaveLength(3);
    expect(result.limited).toBe(true);
  });

  it("limits items to MAX_QUICK_PICK_ITEMS by default", () => {
    const many = Array.from({ length: MAX_QUICK_PICK_ITEMS + 50 }, (_, i) =>
      makeSearchable(`c-${String(i).padStart(5, "0")}`, `Item ${i}`),
    );
    const result = filterSearchableArtifacts(many, "item");
    expect(result.items).toHaveLength(MAX_QUICK_PICK_ITEMS);
    expect(result.totalMatches).toBe(MAX_QUICK_PICK_ITEMS + 50);
    expect(result.limited).toBe(true);
  });

  it("does not set limited flag when totalMatches is within limit", () => {
    const result = filterSearchableArtifacts(artifacts, "");
    expect(result.limited).toBe(false);
  });

  it("handles duplicate titles as separate items", () => {
    const dupes = [
      makeSearchable("d-001", "Same Title"),
      makeSearchable("d-002", "Same Title"),
    ];
    const result = filterSearchableArtifacts(dupes, "same");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.artifactId).not.toBe(result.items[1]!.artifactId);
  });
});

// ---------------------------------------------------------------------------
// discoverSearchableArtifacts
// ---------------------------------------------------------------------------

describe("discoverSearchableArtifacts", () => {
  it("discovers valid schema-v6 artifacts", async () => {
    const userHome = await makeUserHome();
    await writeArtifact(userHome, "artifact-001", { title: "First" });
    await writeArtifact(userHome, "artifact-002", { title: "Second" });

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts).toHaveLength(2);
    expect(result.skippedCount).toBe(0);
  });

  it("precomputes normalizedTitle for each artifact", async () => {
    const userHome = await makeUserHome();
    await writeArtifact(userHome, "artifact-001", {
      title: "Lập Kế Hoạch Đổi Mới",
    });

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts[0]!.normalizedTitle).toBe("lap ke hoach doi moi");
  });

  it("returns deterministic sort order by normalizedTitle, title, artifactId", async () => {
    const userHome = await makeUserHome();
    await writeArtifact(userHome, "z-last", { title: "Zebra" });
    await writeArtifact(userHome, "a-first", { title: "Alpha" });
    await writeArtifact(userHome, "m-mid", { title: "Middle" });

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts.map((a) => a.artifactId)).toEqual([
      "a-first",
      "m-mid",
      "z-last",
    ]);
  });

  it("orders duplicate titles deterministically by artifactId", async () => {
    const userHome = await makeUserHome();
    await writeArtifact(userHome, "b-second", { title: "Same Title" });
    await writeArtifact(userHome, "a-first", { title: "Same Title" });

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts.map((a) => a.artifactId)).toEqual([
      "a-first",
      "b-second",
    ]);
  });

  it("skips non-directory entries", async () => {
    const userHome = await makeUserHome();
    await writeArtifact(userHome, "artifact-001", { title: "Valid" });

    const collectionRoot = globalArtifactsRoot({ userHome });
    await writeFile(path.join(collectionRoot, "stray-file.txt"), "not a dir");

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts).toHaveLength(1);
    expect(result.skippedCount).toBe(1);
  });

  it("skips linked directories", async () => {
    const userHome = await makeUserHome();
    const realDir = await writeArtifact(userHome, "artifact-001", {
      title: "Real",
    });

    const collectionRoot = globalArtifactsRoot({ userHome });
    const linkPath = path.join(collectionRoot, "linked-artifact");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(realDir, linkPath, linkType);

    const result = await discoverSearchableArtifacts({ userHome });
    // Real artifact discovered; link skipped (at readdir or validation level)
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.artifactId).toBe("artifact-001");
    expect(result.skippedCount).toBeGreaterThanOrEqual(1);
  });

  it("skips entries with missing artifact.md", async () => {
    const userHome = await makeUserHome();
    const collectionRoot = globalArtifactsRoot({ userHome });
    const dirPath = path.join(collectionRoot, "no-markdown");
    await mkdir(dirPath, { recursive: true });
    await writeFile(
      path.join(dirPath, "artifact.json"),
      JSON.stringify({
        schemaVersion: 6,
        kind: "plan",
        artifactId: "no-markdown",
        title: "Missing MD",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        reviewRound: 1,
        reviewSessionId: randomUUID(),
      }),
    );

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("skips entries with missing artifact.json", async () => {
    const userHome = await makeUserHome();
    const collectionRoot = globalArtifactsRoot({ userHome });
    const dirPath = path.join(collectionRoot, "no-manifest");
    await mkdir(dirPath, { recursive: true });
    await writeFile(path.join(dirPath, "artifact.md"), "# No manifest");

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("skips entries with malformed manifest", async () => {
    const userHome = await makeUserHome();
    const collectionRoot = globalArtifactsRoot({ userHome });
    const dirPath = path.join(collectionRoot, "bad-manifest");
    await mkdir(dirPath, { recursive: true });
    await writeFile(path.join(dirPath, "artifact.json"), "not valid json {{{");
    await writeFile(path.join(dirPath, "artifact.md"), "# Bad");

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("skips entries with legacy schema version", async () => {
    const userHome = await makeUserHome();
    await writeArtifact(userHome, "legacy-001", {
      title: "Legacy",
      schemaVersion: 5,
    });

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("skips entries where manifest artifactId does not match directory name", async () => {
    const userHome = await makeUserHome();
    const collectionRoot = globalArtifactsRoot({ userHome });
    const dirPath = path.join(collectionRoot, "dir-name");
    await mkdir(dirPath, { recursive: true });
    await writeFile(
      path.join(dirPath, "artifact.json"),
      JSON.stringify({
        schemaVersion: 6,
        kind: "plan",
        artifactId: "different-id",
        title: "ID Mismatch",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        reviewRound: 1,
        reviewSessionId: randomUUID(),
      }),
    );
    await writeFile(path.join(dirPath, "artifact.md"), "# Mismatch");

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("reports accurate aggregate skippedCount", async () => {
    const userHome = await makeUserHome();
    await writeArtifact(userHome, "valid-001", { title: "Valid" });
    // Create two invalid entries
    await writeArtifact(userHome, "legacy-001", {
      title: "Legacy",
      schemaVersion: 5,
    });
    const collectionRoot = globalArtifactsRoot({ userHome });
    await writeFile(path.join(collectionRoot, "stray.txt"), "file");

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts).toHaveLength(1);
    expect(result.skippedCount).toBe(2);
  });

  it("enumerates only direct children of collection root", async () => {
    const userHome = await makeUserHome();
    await writeArtifact(userHome, "top-level", { title: "Top Level" });

    // Nested directory that looks like an artifact but is not a direct child
    const collectionRoot = globalArtifactsRoot({ userHome });
    const nestedDir = path.join(collectionRoot, "top-level", "nested-artifact");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(
      path.join(nestedDir, "artifact.json"),
      JSON.stringify({
        schemaVersion: 6,
        kind: "plan",
        artifactId: "nested-artifact",
        title: "Nested",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        reviewRound: 1,
        reviewSessionId: randomUUID(),
      }),
    );
    await writeFile(path.join(nestedDir, "artifact.md"), "# Nested");

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.artifactId).toBe("top-level");
  });

  it("throws on inaccessible collection root instead of returning empty", async () => {
    const userHome = await mkdtemp(
      path.join(tmpdir(), "agent-plus-search-gone-"),
    );
    await rm(userHome, { recursive: true, force: true });

    await expect(
      discoverSearchableArtifacts({ userHome }),
    ).rejects.toThrow();
  });

  it("returns empty result for empty collection", async () => {
    const userHome = await makeUserHome();

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts).toHaveLength(0);
    expect(result.skippedCount).toBe(0);
  });

  it("does not read or mutate artifact-connection.json", async () => {
    const userHome = await makeUserHome();
    const artifactDir = await writeArtifact(userHome, "conn-test", {
      title: "Connection Test",
    });

    // Write a deliberately malformed connection file
    const connectionPath = path.join(artifactDir, "artifact-connection.json");
    const connectionContent = JSON.stringify({
      schemaVersion: 999,
      broken: true,
    });
    await writeFile(connectionPath, connectionContent);

    const result = await discoverSearchableArtifacts({ userHome });

    // Discovery succeeds (connection file is not read for validation)
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.artifactId).toBe("conn-test");

    // Connection file is not mutated
    const afterContent = await readFile(connectionPath, "utf8");
    expect(afterContent).toBe(connectionContent);
  });

  it("populates all SearchableArtifact fields from manifest", async () => {
    const userHome = await makeUserHome();
    await writeArtifact(userHome, "full-001", {
      title: "Full Artifact",
      kind: "implementation-plan",
      reviewRound: 3,
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-15T14:30:00.000Z",
    });

    const result = await discoverSearchableArtifacts({ userHome });
    const artifact = result.artifacts[0]!;

    expect(artifact.artifactId).toBe("full-001");
    expect(artifact.title).toBe("Full Artifact");
    expect(artifact.normalizedTitle).toBe("full artifact");
    expect(artifact.kind).toBe("implementation-plan");
    expect(artifact.reviewRound).toBe(3);
    expect(artifact.createdAt).toBe("2026-06-01T10:00:00.000Z");
    expect(artifact.updatedAt).toBe("2026-06-15T14:30:00.000Z");
    expect(artifact.artifactDirectory).toBeTruthy();
    expect(artifact.artifactPath).toContain("artifact.md");
  });

  it("does not expose reviewSessionId in SearchableArtifact", async () => {
    const userHome = await makeUserHome();
    await writeArtifact(userHome, "session-test", { title: "Session Test" });

    const result = await discoverSearchableArtifacts({ userHome });
    expect(result.artifacts[0]!).not.toHaveProperty("reviewSessionId");
  });

  it("exports DISCOVERY_CONCURRENCY as a testable constant", () => {
    expect(DISCOVERY_CONCURRENCY).toBe(16);
  });

  it("exports MAX_QUICK_PICK_ITEMS as a testable constant", () => {
    expect(MAX_QUICK_PICK_ITEMS).toBe(1000);
  });
});
