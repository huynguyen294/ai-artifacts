export type SessionConnectPromptOptions = {
  sessionId: string;
  title?: string;
};

export function buildSessionConnectPrompt(options: SessionConnectPromptOptions): string {
  const lines = [
    "Join this work session to access its full context and instructions:",
    `tool: "join_session"`,
    `sessionId: ${JSON.stringify(options.sessionId)}`,
  ];
  if (options.title) {
    lines.push(`sessionTitle: ${JSON.stringify(options.title)}`);
  }
  lines.push(
    "After the call succeeds, adopt the returned session.sessionId as your active session context for future turns. Read the session instructions and catalog to guide your work.",
  );
  return lines.join("\n");
}

