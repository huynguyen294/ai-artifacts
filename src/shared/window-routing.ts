import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  WINDOW_SELECTION_TTL_MS,
  WindowNotFoundError,
  WindowSelectionExpiredError,
  WindowSelectionRequiredError,
} from "./contracts";
import type { WorkspaceRegistrySnapshot } from "./workspace-registry";

export type WindowCandidate = {
  candidateId: string;
  windowInstanceId: string;
  focused: boolean;
  snapshotUpdatedAt: string;
  workspaceFile?: string;
  folders: Array<{ name: string; path: string }>;
  label: string;
  selectionToken: string;
  expiresAt: string;
};

export type WindowSelectionGrant = {
  selectionToken: string;
  candidateId: string;
  windowInstanceId: string;
  createdAt: number;
  expiresAt: number;
};

export function windowCandidateId(windowInstanceId: string): string {
  return createHash("sha256").update(windowInstanceId).digest("hex").slice(0, 16);
}

export function formatWindowCandidateLabel(snapshot: WorkspaceRegistrySnapshot): string {
  const parts: string[] = [];
  if (snapshot.workspaceFile) {
    const base = path.basename(snapshot.workspaceFile);
    parts.push(base.endsWith(".code-workspace") ? base.slice(0, -15) : base);
  } else if (snapshot.folders.length > 0) {
    const folderNames = snapshot.folders.map(
      (f) => path.basename(f.path) || path.basename(f.realPath) || f.path,
    );
    parts.push(folderNames.join(", "));
  } else {
    parts.push("Empty window");
  }

  if (snapshot.focused) {
    parts.push("focused");
  }

  return parts.join(" — ");
}

export class WindowSelectionTokenStore {
  private readonly grants = new Map<string, WindowSelectionGrant>();
  private readonly claimedTokens = new Set<string>();

  mint(
    windowInstanceId: string,
    candidateId: string,
    now = Date.now(),
    ttlMs = WINDOW_SELECTION_TTL_MS,
  ): { selectionToken: string; expiresAt: string } {
    const selectionToken = randomUUID();
    const expiresAt = now + ttlMs;
    this.grants.set(selectionToken, {
      selectionToken,
      candidateId,
      windowInstanceId,
      createdAt: now,
      expiresAt,
    });
    return {
      selectionToken,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  claim(selectionToken: string, now = Date.now()): WindowSelectionGrant {
    const grant = this.grants.get(selectionToken);
    if (!grant || grant.expiresAt <= now || this.claimedTokens.has(selectionToken)) {
      throw new WindowSelectionExpiredError("The window selection token has expired or is already in use.");
    }
    this.claimedTokens.add(selectionToken);
    return grant;
  }

  release(selectionToken: string): void {
    this.claimedTokens.delete(selectionToken);
  }

  consume(selectionToken: string): void {
    this.claimedTokens.delete(selectionToken);
    this.grants.delete(selectionToken);
  }

  getGrant(selectionToken: string): WindowSelectionGrant | undefined {
    return this.grants.get(selectionToken);
  }

  clear(): void {
    this.grants.clear();
    this.claimedTokens.clear();
  }
}

export function buildWindowCandidates(
  snapshots: readonly WorkspaceRegistrySnapshot[],
  tokenStore: WindowSelectionTokenStore,
  now = Date.now(),
): WindowCandidate[] {
  return snapshots.map((s) => {
    const candidateId = windowCandidateId(s.instanceId);
    const { selectionToken, expiresAt } = tokenStore.mint(s.instanceId, candidateId, now);
    return {
      candidateId,
      windowInstanceId: s.instanceId,
      focused: s.focused,
      snapshotUpdatedAt: s.updatedAt,
      ...(s.workspaceFile ? { workspaceFile: s.workspaceFile } : {}),
      folders: s.folders.map((f) => ({
        name: path.basename(f.path) || path.basename(f.realPath) || f.path,
        path: f.realPath,
      })),
      label: formatWindowCandidateLabel(s),
      selectionToken,
      expiresAt,
    };
  });
}

export type FocusedWindowSelectionResult =
  | { status: "matched"; targetWindow: WorkspaceRegistrySnapshot; matchReason: "focused" | "sole-live" }
  | {
      status: "selection-required";
      candidates: readonly WorkspaceRegistrySnapshot[];
      reason: "multiple-focused" | "multiple-live-none-focused";
    }
  | { status: "not-found"; reason: "no-live-windows" };

export function selectFocusedWindowTarget(
  snapshots: readonly WorkspaceRegistrySnapshot[],
): FocusedWindowSelectionResult {
  if (snapshots.length === 0) {
    return { status: "not-found", reason: "no-live-windows" };
  }

  const focusedSnapshots = snapshots.filter((s) => s.focused);
  if (focusedSnapshots.length === 1) {
    return { status: "matched", targetWindow: focusedSnapshots[0]!, matchReason: "focused" };
  }

  if (focusedSnapshots.length === 0) {
    if (snapshots.length === 1) {
      return { status: "matched", targetWindow: snapshots[0]!, matchReason: "sole-live" };
    }
    return { status: "selection-required", candidates: snapshots, reason: "multiple-live-none-focused" };
  }

  return { status: "selection-required", candidates: snapshots, reason: "multiple-focused" };
}

export type ReconnectWindowSelectionResult =
  | {
      status: "matched";
      targetWindow: WorkspaceRegistrySnapshot;
      matchReason: "sole-live" | "artifact-affinity" | "focused";
    }
  | {
      status: "selection-required";
      candidates: readonly WorkspaceRegistrySnapshot[];
      reason: "multiple-focused" | "multiple-live-none-focused";
    }
  | { status: "not-found"; reason: "no-live-windows" };

export function selectReconnectWindowTarget(
  snapshots: readonly WorkspaceRegistrySnapshot[],
  aiWindowInstanceId?: string,
  persistedWindowInstanceId?: string,
): ReconnectWindowSelectionResult {
  if (snapshots.length === 0) {
    return { status: "not-found", reason: "no-live-windows" };
  }

  if (snapshots.length === 1) {
    return { status: "matched", targetWindow: snapshots[0]!, matchReason: "sole-live" };
  }

  if (
    aiWindowInstanceId !== undefined &&
    persistedWindowInstanceId !== undefined &&
    aiWindowInstanceId === persistedWindowInstanceId
  ) {
    const affinitySnapshot = snapshots.find((s) => s.instanceId === aiWindowInstanceId);
    if (affinitySnapshot) {
      return {
        status: "matched",
        targetWindow: affinitySnapshot,
        matchReason: "artifact-affinity",
      };
    }
  }

  return selectFocusedWindowTarget(snapshots);
}

function normalizeSearchTerm(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s._/\\-]+/g, " ")
    .trim();
}

export type ResolveArtifactWindowResult =
  | {
      status: "matched";
      matchMode: "matched";
      window: WindowCandidate;
      candidates: WindowCandidate[];
    }
  | {
      status: "selection-required";
      matchMode: "matched" | "all-available";
      candidates: WindowCandidate[];
      message: string;
    }
  | {
      status: "not-found";
      matchMode: "none";
      candidates: [];
      message: string;
    };

export function resolveArtifactWindowCandidates(
  query: string | undefined,
  snapshots: readonly WorkspaceRegistrySnapshot[],
  tokenStore: WindowSelectionTokenStore,
  now = Date.now(),
): ResolveArtifactWindowResult {
  if (snapshots.length === 0) {
    return {
      status: "not-found",
      matchMode: "none",
      candidates: [],
      message: "No active VS Code windows found in the window registry.",
    };
  }

  const allCandidates = buildWindowCandidates(snapshots, tokenStore, now);
  const trimmedQuery = query?.trim();

  if (!trimmedQuery) {
    if (allCandidates.length === 1) {
      return {
        status: "matched",
        matchMode: "matched",
        window: allCandidates[0]!,
        candidates: allCandidates,
      };
    }
    return {
      status: "selection-required",
      matchMode: "all-available",
      candidates: allCandidates,
      message: "Multiple VS Code windows are open. Select the target window.",
    };
  }

  const normalizedQuery = normalizeSearchTerm(trimmedQuery);
  const matchedCandidates = allCandidates.filter((candidate) => {
    if (normalizeSearchTerm(candidate.label).includes(normalizedQuery)) return true;
    if (candidate.workspaceFile && normalizeSearchTerm(candidate.workspaceFile).includes(normalizedQuery)) return true;
    return candidate.folders.some(
      (f) => normalizeSearchTerm(f.name).includes(normalizedQuery) || normalizeSearchTerm(f.path).includes(normalizedQuery),
    );
  });

  if (matchedCandidates.length === 1) {
    return {
      status: "matched",
      matchMode: "matched",
      window: matchedCandidates[0]!,
      candidates: matchedCandidates,
    };
  }

  if (matchedCandidates.length > 1) {
    return {
      status: "selection-required",
      matchMode: "matched",
      candidates: matchedCandidates,
      message: `Multiple windows matched "${trimmedQuery}". Select the target window.`,
    };
  }

  return {
    status: "selection-required",
    matchMode: "all-available",
    candidates: allCandidates,
    message: `No window matched "${trimmedQuery}". All open windows are listed below for selection.`,
  };
}
