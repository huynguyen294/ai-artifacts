import { artifactKindSchema } from "./contracts";

export const FIXED_ARTIFACT_KINDS = [
  "plan",
  "implementation-plan",
  "idea",
  "analysis",
  "design",
  "spec",
  "checklist",
  "report",
  "guide",
  "note",
] as const;

export type FixedArtifactKind = (typeof FIXED_ARTIFACT_KINDS)[number];

const FIXED_KINDS_SET = new Set<string>(FIXED_ARTIFACT_KINDS);

/**
 * Checks if the kind belongs to the standard 10 fixed artifact kinds.
 */
export function isFixedArtifactKind(kind: string): kind is FixedArtifactKind {
  return FIXED_KINDS_SET.has(kind);
}

/**
 * Validates if the kind string matches the canonical artifact kind slug schema.
 */
export function isValidArtifactKind(kind: string): boolean {
  return artifactKindSchema.safeParse(kind).success;
}

/**
 * Determines whether this kind proceeds with automatic execution directives
 * ("execute-approved-plan") upon review approval vs acknowledgment only ("approved").
 */
export function isPlanProceedKind(kind: string): boolean {
  return kind === "plan" || kind === "implementation-plan";
}

/**
 * Formats an artifact kind slug into a sentence-case display label.
 * Replaces dashes with spaces and capitalizes the first character.
 * E.g., "implementation-plan" -> "Implementation plan", "meeting-note" -> "Meeting note".
 */
export function formatArtifactKindLabel(kind: string): string {
  const normalized = kind.trim().replace(/-/g, " ");
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

