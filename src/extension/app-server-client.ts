import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

type JsonObject = Record<string, unknown>;
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export type AppServerLaunch = { executable: string; args: string[] };

function resolveWindowsCommand(
  command: string,
  pathValue: string,
  pathExtValue: string,
  fileExists: (candidate: string) => boolean,
): string {
  if (path.win32.extname(command) || /[\\/]/.test(command)) return command;
  const extensions = pathExtValue.split(";").filter(Boolean);
  for (const directoryValue of pathValue.split(";").filter(Boolean)) {
    const directory = directoryValue.replace(/^"|"$/g, "");
    for (const extension of extensions) {
      const candidate = path.win32.join(directory, `${command}${extension.toLowerCase()}`);
      if (fileExists(candidate)) return candidate;
    }
  }
  return command;
}

export function createAppServerLaunch(
  command: string,
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  fileExists: (candidate: string) => boolean = existsSync,
): AppServerLaunch {
  if (platform !== "win32") return { executable: command, args: ["app-server"] };
  const executable = resolveWindowsCommand(
    command,
    environment.PATH ?? "",
    environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
    fileExists,
  );
  if (!/\.(?:cmd|bat)$/i.test(executable)) return { executable, args: ["app-server"] };
  return {
    executable: environment.ComSpec ?? environment.COMSPEC ?? "cmd.exe",
    args: ["/d", "/s", "/c", "call", executable, "app-server"],
  };
}

export type CodexHookDescriptor = {
  command?: string;
  commandWindows?: string;
  enabled: boolean;
  source?: string;
  sourcePath?: string;
  trustStatus?: string;
};

export function parseHookListResult(value: unknown): CodexHookDescriptor[] {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data)) return [];
  const hooks: CodexHookDescriptor[] = [];
  for (const entry of value.data) {
    if (!entry || typeof entry !== "object" || !("hooks" in entry) || !Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (!hook || typeof hook !== "object" || !("enabled" in hook) || typeof hook.enabled !== "boolean") continue;
      hooks.push({
        enabled: hook.enabled,
        ...(typeof hook.command === "string" ? { command: hook.command } : {}),
        ...(typeof hook.commandWindows === "string" ? { commandWindows: hook.commandWindows } : {}),
        ...(typeof hook.source === "string" ? { source: hook.source } : {}),
        ...(typeof hook.sourcePath === "string" ? { sourcePath: hook.sourcePath } : {}),
        ...(typeof hook.trustStatus === "string" ? { trustStatus: hook.trustStatus } : {}),
      });
    }
  }
  return hooks;
}

export class AppServerRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, readonly code?: number | string, readonly data?: unknown) {
    super(message);
    this.name = "AppServerRequestError";
    this.retryable = /active writer|already.*(?:running|active)|turn.*(?:running|active)|\bbusy\b/i.test(message);
  }
}

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private initialized: Promise<void> | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stderrTail = "";

  constructor(
    private readonly command = "codex",
    private readonly clientVersion = "0.1.0",
  ) {}

  async listHooks(cwds: readonly string[]): Promise<CodexHookDescriptor[]> {
    await this.ensureInitialized();
    return parseHookListResult(await this.request("hooks/list", { cwds: [...cwds] }));
  }

  dispose(): void {
    this.process?.kill();
    this.process = undefined;
    this.initialized = undefined;
  }

  private ensureInitialized(): Promise<void> {
    this.initialized ??= this.initialize().catch((error: unknown) => {
      this.initialized = undefined;
      throw error;
    });
    return this.initialized;
  }

  private async initialize(): Promise<void> {
    const launch = createAppServerLaunch(this.command);
    this.stderrTail = "";
    this.process = spawn(launch.executable, launch.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const lines = createInterface({ input: this.process.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.process.stderr.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-4000);
    });
    this.process.on("error", (error) => {
      this.failAll(error);
      this.process = undefined;
      this.initialized = undefined;
    });
    this.process.on("exit", (code) => {
      const detail = this.stderrTail.trim();
      this.failAll(new Error(
        `Codex App Server exited unexpectedly (${code ?? "unknown"}).${detail ? ` ${detail}` : ""}`,
      ));
      this.process = undefined;
      this.initialized = undefined;
    });

    await this.request("initialize", {
      clientInfo: { name: "codex-artifacts", title: "Codex Artifacts", version: this.clientVersion },
    });
    this.notify("initialized");
  }

  private request(method: string, params: JsonObject): Promise<unknown> {
    if (!this.process) return Promise.reject(new Error("Codex App Server is not running."));
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private notify(method: string, params?: JsonObject): void {
    this.write(params ? { method, params } : { method });
  }

  private write(message: JsonObject): void {
    this.process?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonObject;
    try {
      message = JSON.parse(line) as JsonObject;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error && typeof message.error === "object") {
      const error = message.error as JsonObject;
      pending.reject(new AppServerRequestError(
        typeof error.message === "string" ? error.message : "Codex App Server request failed.",
        typeof error.code === "number" || typeof error.code === "string" ? error.code : undefined,
        error.data,
      ));
      return;
    }
    pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
