import * as vscode from "vscode";
import { type GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { resolveWorkSessionSupport } from "./work-session-support";
import type { ConversationArtifactService } from "./conversation-artifact-service";
import type { ArtifactFileUri } from "./artifact-review-open";

export type CreateSessionCommandDependencies = {
  service: ConversationArtifactService<any>;
  context: vscode.ExtensionContext;
  rootOptions?: GlobalArtifactsRootOptions;
  showInputBox?: (options: vscode.InputBoxOptions) => Thenable<string | undefined>;
  openWorkSession?: (sessionId: string) => Thenable<unknown>;
  resolveSupport?: () => Promise<{ supported: boolean; reason?: string }>;
};

export async function runCreateSessionCommand(
  deps: CreateSessionCommandDependencies,
): Promise<string | undefined> {
  const rootOptions = deps.rootOptions ?? {};
  const support = deps.resolveSupport
    ? await deps.resolveSupport()
    : await resolveWorkSessionSupport(rootOptions, deps.context);
  if (!support.supported) {
    void vscode.window.showWarningMessage(
      support.reason ?? "Work Session management requires MCP server version 12 or higher.",
    );
    return undefined;
  }

  const showInput = deps.showInputBox ?? vscode.window.showInputBox;
  const rawTitle = await showInput({
    title: "Add Session",
    prompt: "Enter a title for the new session",
    placeHolder: "Session title",
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Session title must not be blank.";
      }
      if (value.length > 200) {
        return "Session title must be at most 200 characters.";
      }
      return undefined;
    },
  });

  if (!rawTitle) return undefined;
  const title = rawTitle.trim();

  let session;
  try {
    session = await deps.service.createSession({ title });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Failed to create session: ${message}`);
    return undefined;
  }

  try {
    const openSession =
      deps.openWorkSession ??
      ((id: string) => vscode.commands.executeCommand("agentPlus.openWorkSession", id));
    await openSession(session.sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `Session "${title}" was created (${session.sessionId}), but failed to open: ${message}`,
    );
  }

  return session.sessionId;
}
