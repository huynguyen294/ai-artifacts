export type SessionConnectPromptOptions = {
  sessionId: string;
  title?: string;
};

export function buildSessionConnectPrompt(options: SessionConnectPromptOptions): string {
  const lines = [
    "Use the work-session skill to join this work session and apply its instructions:",
    `tool: "join_session"`,
    `sessionId: ${JSON.stringify(options.sessionId)}`,
  ];
  if (options.title) {
    lines.push(`sessionTitle: ${JSON.stringify(options.title)}`);
  }
  lines.push(
    "Pass only sessionId to join_session; sessionTitle is a display hint. After the call succeeds, adopt the returned session.sessionId, instructions, instructionsPath, and catalog as your active session context for future related requests.",
  );
  return lines.join("\n");
}
