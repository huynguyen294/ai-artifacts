import * as vscode from "vscode";
import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";
import type { SessionType, WorkSession } from "../shared/contracts";
import { compareIsoTimestampsAsc } from "../shared/conversation-artifact-registry";
import { listSessionTypes } from "../shared/session-type-registry";
import { normalizeArtifactTitleSearch } from "./artifact-search";

export interface SessionSearchItem extends vscode.QuickPickItem {
  sessionId: string;
}

export interface SessionSearchCommandDeps {
  createQuickPick: () => vscode.QuickPick<SessionSearchItem>;
  listSessions: () => Promise<readonly WorkSession[]>;
  listTypes?: () => Promise<readonly SessionType[]>;
  openSession: (sessionId: string) => Promise<void>;
  rootOptions?: GlobalArtifactsRootOptions;
}

export async function runSessionSearchCommand(deps: SessionSearchCommandDeps): Promise<void> {
  const quickPick = deps.createQuickPick();

  quickPick.title = "Search Sessions";
  quickPick.placeholder = "Search sessions by name";
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;
  quickPick.busy = true;
  quickPick.show();

  const disposables: vscode.Disposable[] = [];
  let isDisposed = false;

  const cleanup = () => {
    if (isDisposed) return;
    isDisposed = true;
    for (const d of disposables) d.dispose();
    quickPick.dispose();
  };

  const [sessions, types] = await Promise.all([
    deps.listSessions(),
    deps.listTypes ? deps.listTypes() : listSessionTypes(deps.rootOptions),
  ]);

  if (isDisposed) return;

  quickPick.busy = false;

  const typeMap = new Map<string, string>();
  for (const t of types) {
    typeMap.set(t.id, t.label);
  }

  // Sort initially by recency (updatedAt descending)
  const sortedSessions = [...sessions].sort((a, b) => {
    const diff = compareIsoTimestampsAsc(b.updatedAt, a.updatedAt);
    if (diff !== 0) return diff;
    return a.sessionId.localeCompare(b.sessionId);
  });

  if (sortedSessions.length === 0) {
    quickPick.placeholder = "No sessions found";
  }

  const allItems: SessionSearchItem[] = sortedSessions.map((s) => ({
    label: s.title,
    description: typeMap.get(s.typeId) ?? s.typeId,
    detail: `Updated: ${s.updatedAt} · ${s.sessionId}`,
    sessionId: s.sessionId,
    alwaysShow: true,
  }));

  quickPick.items = allItems;

  return new Promise((resolve) => {
    let accepted = false;

    disposables.push(
      quickPick.onDidChangeValue((query) => {
        const normalized = normalizeArtifactTitleSearch(query);
        if (!normalized) {
          quickPick.items = allItems;
        } else {
          quickPick.items = allItems.filter((item) =>
            normalizeArtifactTitleSearch(item.label).includes(normalized),
          );
        }
      }),
      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (!selected) return;

        accepted = true;
        quickPick.hide();
        cleanup();

        try {
          await deps.openSession(selected.sessionId);
        } finally {
          resolve();
        }
      }),
      quickPick.onDidHide(() => {
        cleanup();
        if (!accepted) resolve();
      }),
    );
  });
}
