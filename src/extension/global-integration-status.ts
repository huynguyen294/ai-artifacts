import type { CodexHookDescriptor } from "./app-server-client";
import {
  CODEX_ARTIFACTS_HOOK_MARKER,
  LEGACY_AGENT_PLUS_HOOK_MARKER,
} from "./hook-config";

export type IntegrationStatus = "trusted" | "untrusted" | "disabled" | "missing" | "outdated" | "unknown";

export type IntegrationCheck = {
  status: IntegrationStatus;
  hook?: CodexHookDescriptor;
};

function isCodexArtifactsHook(hook: CodexHookDescriptor): boolean {
  const commands = [hook.command ?? "", hook.commandWindows ?? ""];
  return commands.some((command) => (
    command.includes(CODEX_ARTIFACTS_HOOK_MARKER)
    || command.includes(LEGACY_AGENT_PLUS_HOOK_MARKER)
  ));
}

export function classifyGlobalIntegration(hooks: CodexHookDescriptor[]): IntegrationCheck {
  const hook = hooks.find((candidate) => (
    candidate.source?.toLowerCase() === "user" && isCodexArtifactsHook(candidate)
  ));
  if (!hook) return { status: "missing" };
  if (!hook.enabled) return { status: "disabled", hook };
  if (hook.trustStatus === "trusted") return { status: "trusted", hook };
  if (hook.trustStatus === "untrusted") return { status: "untrusted", hook };
  return { status: "unknown", hook };
}
