import { promises as fs } from "node:fs";
import path from "node:path";
import { validateArtifactReviewTarget } from "./artifact-review-open";
import { ARTIFACT_MARKDOWN_FILE, type GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { ensureSafeGlobalArtifactsRoot } from "../shared/artifact-validation";

export const MAX_QUICK_PICK_ITEMS = 1000;
export const DISCOVERY_CONCURRENCY = 16;

export type SearchableArtifact = {
  artifactDirectory: string;
  artifactPath: string;
  artifactId: string;
  title: string;
  normalizedTitle: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  reviewRound: number;
};

export type ArtifactDiscoveryResult = {
  artifacts: SearchableArtifact[];
  skippedCount: number;
};

export type ArtifactFilterResult = {
  items: SearchableArtifact[];
  totalMatches: number;
  limited: boolean;
};

/**
 * Normalizes a string for accent-insensitive, case-insensitive title matching.
 *
 * Steps: NFD decompose → strip combining marks → đ/Đ → d → lowercase →
 * collapse whitespace → trim.
 */
export function normalizeArtifactTitleSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Enumerates and validates all schema-v6 artifacts in the canonical global
 * collection.  Returns pre-sorted results and a count of skipped entries.
 *
 * Throws if the collection root cannot be read (does not silently return empty).
 */
export async function discoverSearchableArtifacts(
  options: GlobalArtifactsRootOptions = {},
): Promise<ArtifactDiscoveryResult> {
  const collectionRoot = await ensureSafeGlobalArtifactsRoot(options);
  const entries = await fs.readdir(collectionRoot, { withFileTypes: true });

  const artifacts: SearchableArtifact[] = [];
  let skippedCount = 0;

  // Pre-filter: only direct-child directories that are not links
  const candidatePaths: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      skippedCount++;
      continue;
    }
    candidatePaths.push(
      path.join(collectionRoot, entry.name, ARTIFACT_MARKDOWN_FILE),
    );
  }

  // Validate manifests with bounded concurrency
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < candidatePaths.length) {
      const i = nextIndex++;
      const candidatePath = candidatePaths[i]!;
      try {
        const target = await validateArtifactReviewTarget(
          candidatePath,
          options,
        );
        artifacts.push({
          artifactDirectory: target.artifactDirectory,
          artifactPath: target.artifactPath,
          artifactId: target.artifactId,
          title: target.manifest.title,
          normalizedTitle: normalizeArtifactTitleSearch(target.manifest.title),
          kind: target.manifest.kind,
          createdAt: target.manifest.createdAt,
          updatedAt: target.manifest.updatedAt,
          reviewRound: target.manifest.reviewRound,
        });
      } catch {
        skippedCount++;
      }
    }
  }

  const workerCount = Math.min(DISCOVERY_CONCURRENCY, candidatePaths.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Deterministic sort: normalizedTitle → title → artifactId (ascending)
  artifacts.sort((a, b) => {
    if (a.normalizedTitle < b.normalizedTitle) return -1;
    if (a.normalizedTitle > b.normalizedTitle) return 1;
    if (a.title < b.title) return -1;
    if (a.title > b.title) return 1;
    if (a.artifactId < b.artifactId) return -1;
    if (a.artifactId > b.artifactId) return 1;
    return 0;
  });

  return { artifacts, skippedCount };
}

/**
 * Filters pre-sorted artifacts by normalized title substring match.
 * Returns at most `limit` items and reports whether the result was capped.
 */
export function filterSearchableArtifacts(
  artifacts: readonly SearchableArtifact[],
  query: string,
  limit: number = MAX_QUICK_PICK_ITEMS,
): ArtifactFilterResult {
  const normalizedQuery = normalizeArtifactTitleSearch(query);

  // Artifacts are pre-sorted from discovery; Array.filter preserves order
  const matches = artifacts.filter(
    (a) => normalizedQuery === "" || a.normalizedTitle.includes(normalizedQuery),
  );

  const totalMatches = matches.length;
  const limited = totalMatches > limit;
  const items = limited ? matches.slice(0, limit) : matches;

  return { items, totalMatches, limited };
}
