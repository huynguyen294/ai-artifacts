import type { ArtifactDiscoveryResult, SearchableArtifact } from "./artifact-search";
import { filterSearchableArtifacts, MAX_QUICK_PICK_ITEMS } from "./artifact-search";

export interface ArtifactQuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  alwaysShow: boolean;
  artifact: SearchableArtifact;
}

export interface ArtifactSearchQuickPick {
  title: string | undefined;
  placeholder: string | undefined;
  busy: boolean;
  enabled: boolean;
  value: string;
  items: readonly ArtifactQuickPickItem[];
  selectedItems: readonly ArtifactQuickPickItem[];
  show(): void;
  hide(): void;
  dispose(): void;
  onDidChangeValue(listener: (value: string) => any): { dispose(): void };
  onDidAccept(listener: () => any): { dispose(): void };
  onDidHide(listener: () => any): { dispose(): void };
}

export interface ArtifactSearchCommandDeps {
  createQuickPick: () => ArtifactSearchQuickPick;
  discoverArtifacts: () => Promise<ArtifactDiscoveryResult>;
  openArtifact: (artifactPath: string) => Promise<void>;
  showErrorMessage: (message: string) => void | Thenable<unknown>;
}

export function toQuickPickItem(artifact: SearchableArtifact): ArtifactQuickPickItem {
  return {
    label: artifact.title,
    description: `${artifact.kind} · Round ${artifact.reviewRound}`,
    detail: `Updated ${artifact.updatedAt} · Created ${artifact.createdAt} · ${artifact.artifactId}`,
    alwaysShow: true,
    artifact,
  };
}

export function updateQuickPickState(
  quickPick: ArtifactSearchQuickPick,
  allArtifacts: readonly SearchableArtifact[],
  query: string,
): void {
  const filterResult = filterSearchableArtifacts(allArtifacts, query, MAX_QUICK_PICK_ITEMS);
  quickPick.items = filterResult.items.map(toQuickPickItem);

  if (allArtifacts.length === 0) {
    quickPick.title = "AI Artifacts: Search Artifact (0 artifacts)";
    quickPick.placeholder = "No artifacts found in ~/.ai-artifacts/artifacts/";
  } else if (filterResult.totalMatches === 0) {
    quickPick.title = "AI Artifacts: Search Artifact (0 matches)";
    quickPick.placeholder = "No artifacts match current title query";
  } else if (filterResult.limited) {
    quickPick.title = `AI Artifacts: Search Artifact (Showing 1,000 of ${filterResult.totalMatches.toLocaleString()})`;
    quickPick.placeholder = "Type more to narrow results...";
  } else {
    quickPick.title = `AI Artifacts: Search Artifact (${filterResult.totalMatches.toLocaleString()})`;
    quickPick.placeholder = "Search artifacts by title...";
  }
}

export async function runArtifactSearchCommand(deps: ArtifactSearchCommandDeps): Promise<void> {
  const quickPick = deps.createQuickPick();
  quickPick.title = "AI Artifacts: Search Artifact";
  quickPick.placeholder = "Search artifacts by title...";
  quickPick.busy = true;

  let isDisposed = false;
  let cachedArtifacts: SearchableArtifact[] | null = null;
  const disposables: { dispose(): void }[] = [];

  const cleanup = () => {
    if (isDisposed) return;
    isDisposed = true;
    for (const d of disposables) {
      try {
        d.dispose();
      } catch {
        // ignore disposal errors
      }
    }
    disposables.length = 0;
    try {
      quickPick.dispose();
    } catch {
      // ignore disposal errors
    }
  };

  disposables.push(
    quickPick.onDidChangeValue((value) => {
      if (isDisposed || cachedArtifacts === null) return;
      updateQuickPickState(quickPick, cachedArtifacts, value);
    }),
    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;

      quickPick.busy = true;
      quickPick.enabled = false;
      quickPick.hide();

      try {
        await deps.openArtifact(selected.artifact.artifactPath);
      } catch (err) {
        deps.showErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }),
    quickPick.onDidHide(() => {
      cleanup();
    }),
  );

  quickPick.show();

  try {
    const discovery = await deps.discoverArtifacts();
    if (isDisposed) return;

    cachedArtifacts = discovery.artifacts;
    quickPick.busy = false;
    updateQuickPickState(quickPick, cachedArtifacts, quickPick.value);
  } catch (err) {
    if (isDisposed) return;
    cleanup();
    deps.showErrorMessage(err instanceof Error ? err.message : String(err));
  }
}
