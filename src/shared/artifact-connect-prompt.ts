export type ArtifactConnectPromptOptions =
  | { mode?: "legacy" }
  | { mode: "new" }
  | { mode: "join"; sessionId: string; artifactId?: string };

export function buildArtifactConnectPrompt(
  artifactDirectory: string,
  options?: ArtifactConnectPromptOptions,
): string {
  if (!options || !options.mode || options.mode === "legacy") {
    return ["Inspect this exact AI Artifact:", `artifactDirectory: ${JSON.stringify(artifactDirectory)}`].join("\n");
  }

  if (options.mode === "new") {
    return [
      "Inspect this exact AI Artifact and create a new session:",
      `tool: "inspect_artifact_review"`,
      `artifactDirectory: ${JSON.stringify(artifactDirectory)}`,
      `takeover: true`,
      "Do not pass any existing artifactConversationId for this request. Omit artifactConversationId when inspecting and, after the inspect call succeeds, replace your active session context with the returned session.sessionId and context for future turns.",
    ].join("\n");
  }

  if (options.mode === "join") {
    if (options.artifactId) {
      return [
        "Join this session and inspect the artifact in a single call:",
        `tool: "join_session"`,
        `sessionId: ${JSON.stringify(options.sessionId)}`,
        `artifactId: ${JSON.stringify(options.artifactId)}`,
        `takeover: true`,
        "After the call succeeds, adopt the returned session.sessionId as your active session context and use the nested inspection object for artifact feedback.",
      ].join("\n");
    }
    return [
      "Inspect this exact AI Artifact and join the session:",
      `artifactDirectory: ${JSON.stringify(artifactDirectory)}`,
      `artifactConversationId: ${JSON.stringify(options.sessionId)}`,
      "Use this exact artifactConversationId when inspecting and, only after the inspect call succeeds, set it as your active session context for future turns.",
    ].join("\n");
  }

  return ["Inspect this exact AI Artifact:", `artifactDirectory: ${JSON.stringify(artifactDirectory)}`].join("\n");
}
