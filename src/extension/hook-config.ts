export type HookHandler = {
  type: "command";
  command: string;
  commandWindows?: string;
  timeout?: number;
  statusMessage?: string;
};

export type HookGroup = { matcher?: string; hooks: HookHandler[] };
export type HooksFile = { description?: string; hooks?: Record<string, HookGroup[]> };

export const CODEX_ARTIFACTS_HOOK_MARKER = "codex-artifacts-stamp-origin.mjs";
export const LEGACY_AGENT_PLUS_HOOK_MARKER = "agent-plus-stamp-origin.mjs";
export const CODEX_ARTIFACTS_TOOL_MATCHER = "apply_patch";

function isCodexArtifactsHandler(handler: HookHandler): boolean {
  const commands = [handler.command, handler.commandWindows ?? ""];
  return commands.some((command) => (
    command.includes(CODEX_ARTIFACTS_HOOK_MARKER)
    || command.includes(LEGACY_AGENT_PLUS_HOOK_MARKER)
  ));
}

export function removeCodexArtifactsHooks(config: HooksFile): { config: HooksFile; changed: boolean } {
  const existingGroups = config.hooks?.PostToolUse ?? [];
  const nextGroups = existingGroups
    .map((group) => ({ ...group, hooks: group.hooks.filter((handler) => !isCodexArtifactsHandler(handler)) }))
    .filter((group) => group.hooks.length > 0);
  const changed = nextGroups.length !== existingGroups.length
    || nextGroups.some((group, index) => group.hooks.length !== existingGroups[index]?.hooks.length);
  if (changed && config.hooks) config.hooks.PostToolUse = nextGroups;
  return { config, changed };
}

export function upsertCodexArtifactsHook(config: HooksFile, scriptCommand: string): HooksFile {
  config.description ??= "Lifecycle hooks.";
  config.hooks ??= {};
  const groupsWithoutCodexArtifacts = removeCodexArtifactsHooks(config).config.hooks?.PostToolUse ?? [];

  config.hooks.PostToolUse = [
    ...groupsWithoutCodexArtifacts,
    {
      matcher: CODEX_ARTIFACTS_TOOL_MATCHER,
      hooks: [{
        type: "command",
        command: scriptCommand,
        commandWindows: scriptCommand,
        timeout: 10,
        statusMessage: "Linking Codex artifact to this chat",
      }],
    },
  ];
  return config;
}
