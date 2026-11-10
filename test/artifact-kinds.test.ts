import { describe, expect, it } from "vitest";
import {
  FIXED_ARTIFACT_KINDS,
  formatArtifactKindLabel,
  isFixedArtifactKind,
  isPlanProceedKind,
  isValidArtifactKind,
} from "../src/shared/artifact-kinds";

describe("artifact kinds utility", () => {
  it("contains exactly the 10 fixed artifact kinds", () => {
    expect(FIXED_ARTIFACT_KINDS).toEqual([
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
    ]);
    expect(FIXED_ARTIFACT_KINDS).toHaveLength(10);
  });

  it("identifies fixed vs open artifact kinds correctly", () => {
    for (const kind of FIXED_ARTIFACT_KINDS) {
      expect(isFixedArtifactKind(kind)).toBe(true);
      expect(isValidArtifactKind(kind)).toBe(true);
    }

    expect(isFixedArtifactKind("workaround")).toBe(false);
    expect(isValidArtifactKind("workaround")).toBe(true);

    expect(isFixedArtifactKind("meeting-note")).toBe(false);
    expect(isValidArtifactKind("meeting-note")).toBe(true);

    expect(isValidArtifactKind("INVALID_UPPERCASE")).toBe(false);
    expect(isValidArtifactKind("with spaces")).toBe(false);
  });

  it("distinguishes plan kinds for execution directives", () => {
    expect(isPlanProceedKind("plan")).toBe(true);
    expect(isPlanProceedKind("implementation-plan")).toBe(true);

    expect(isPlanProceedKind("idea")).toBe(false);
    expect(isPlanProceedKind("analysis")).toBe(false);
    expect(isPlanProceedKind("design")).toBe(false);
    expect(isPlanProceedKind("spec")).toBe(false);
    expect(isPlanProceedKind("checklist")).toBe(false);
    expect(isPlanProceedKind("report")).toBe(false);
    expect(isPlanProceedKind("guide")).toBe(false);
    expect(isPlanProceedKind("note")).toBe(false);
    expect(isPlanProceedKind("workaround")).toBe(false);
  });

  it("formats kind slugs to sentence-case labels", () => {
    expect(formatArtifactKindLabel("plan")).toBe("Plan");
    expect(formatArtifactKindLabel("implementation-plan")).toBe("Implementation plan");
    expect(formatArtifactKindLabel("meeting-note")).toBe("Meeting note");
    expect(formatArtifactKindLabel("system-architecture-overview")).toBe("System architecture overview");
    expect(formatArtifactKindLabel("idea")).toBe("Idea");
    expect(formatArtifactKindLabel("")).toBe("");
  });
});

