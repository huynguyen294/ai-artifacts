import { describe, expect, it } from "vitest";
import { buildArtifactConnectPrompt } from "../src/shared/artifact-connect-prompt";
import { buildSessionConnectPrompt } from "../src/shared/session-connect-prompt";

describe("buildArtifactConnectPrompt", () => {
  it("identifies the exact artifact and requests inspection in 2 canonical lines", () => {
    expect(buildArtifactConnectPrompt("D:\\Users\\A User\\.ai-artifacts\\artifacts\\artifact-001")).toBe(
      "Inspect this exact AI Artifact:\n"
      + 'artifactDirectory: "D:\\\\Users\\\\A User\\\\.ai-artifacts\\\\artifacts\\\\artifact-001"',
    );
  });

  it("quotes unusual path characters safely", () => {
    const prompt = buildArtifactConnectPrompt('D:\\artifact "quoted"');
    expect(prompt).toBe(
      "Inspect this exact AI Artifact:\n"
      + 'artifactDirectory: "D:\\\\artifact \\"quoted\\""',
    );
  });
});

describe("buildSessionConnectPrompt", () => {
  it("builds session connect prompt with sessionId and title", () => {
    const prompt = buildSessionConnectPrompt({
      sessionId: "11111111-2222-4333-8444-555555555555",
      title: "My Feature Session",
    });
    expect(prompt).toBe(
      [
        "Use the work-session skill to join this work session and apply its instructions:",
        'tool: "join_session"',
        'sessionId: "11111111-2222-4333-8444-555555555555"',
        'sessionTitle: "My Feature Session"',
        "Pass only sessionId to join_session; sessionTitle is a display hint. After the call succeeds, adopt the returned session.sessionId, instructions, instructionsPath, and catalog as your active session context for future related requests.",
      ].join("\n"),
    );
  });

  it("omits sessionTitle line when title is not provided", () => {
    const prompt = buildSessionConnectPrompt({
      sessionId: "11111111-2222-4333-8444-555555555555",
    });
    expect(prompt).toBe(
      [
        "Use the work-session skill to join this work session and apply its instructions:",
        'tool: "join_session"',
        'sessionId: "11111111-2222-4333-8444-555555555555"',
        "Pass only sessionId to join_session; sessionTitle is a display hint. After the call succeeds, adopt the returned session.sessionId, instructions, instructionsPath, and catalog as your active session context for future related requests.",
      ].join("\n"),
    );
  });
});
