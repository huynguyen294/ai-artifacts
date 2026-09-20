import { describe, expect, it } from "vitest";
import { buildArtifactConnectPrompt } from "../src/shared/artifact-connect-prompt";

describe("buildArtifactConnectPrompt", () => {
  it("identifies the exact artifact and requests inspection", () => {
    expect(buildArtifactConnectPrompt("D:\\Users\\A User\\.ai-artifacts\\artifacts\\artifact-001")).toBe(
      "Inspect this exact AI Artifact:\n"
      + 'artifactDirectory: "D:\\\\Users\\\\A User\\\\.ai-artifacts\\\\artifacts\\\\artifact-001"',
    );
  });

  it("quotes unusual path characters safely", () => {
    const prompt = buildArtifactConnectPrompt('D:\\artifact "quoted"');
    expect(prompt).toContain('artifactDirectory: "D:\\\\artifact \\"quoted\\""');
  });
});
