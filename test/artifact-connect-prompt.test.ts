import { describe, expect, it } from "vitest";
import { buildArtifactConnectPrompt } from "../src/shared/artifact-connect-prompt";

describe("buildArtifactConnectPrompt", () => {
  it("identifies the exact artifact and requests a reconnect in the current window", () => {
    expect(buildArtifactConnectPrompt("D:\\Users\\A User\\.ai-artifacts\\artifacts\\artifact-001")).toBe(
      "Inspect and reconnect to this exact AI Artifact in the current VS Code window:\n"
      + 'artifactDirectory: "D:\\\\Users\\\\A User\\\\.ai-artifacts\\\\artifacts\\\\artifact-001"',
    );
  });

  it("quotes unusual path characters safely", () => {
    const prompt = buildArtifactConnectPrompt('D:\\artifact "quoted"');
    expect(prompt).toContain('artifactDirectory: "D:\\\\artifact \\"quoted\\""');
  });
});
