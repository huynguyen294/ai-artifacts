import type { ArtifactDiscoveryResult, SearchableArtifact } from "./artifact-search";
import { filterSearchableArtifacts, MAX_QUICK_PICK_ITEMS } from "./artifact-search";
import { formatArtifactKindLabel, isFixedArtifactKind } from "../shared/artifact-kinds";

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

export interface ArtifactSearchCommandOptions {
  kindFilter?: string | undefined;
}

export function toQuickPickItem(artifact: SearchableArtifact): ArtifactQuickPickItem {
  const baseDescription = `${formatArtifactKindLabel(artifact.kind)} · Round ${artifact.reviewRound}`;
  const description = artifact.isArchived ? `${baseDescription} · Archived` : baseDescription;
  return {
    label: artifact.title,
    description,
    detail: `Updated ${artifact.updatedAt} · Created ${artifact.createdAt} · ${artifact.artifactId}`,
    alwaysShow: true,
    artifact,
  };
}

export function updateQuickPickState(
  quickPick: ArtifactSearchQuickPick,
  allArtifacts: readonly SearchableArtifact[],
  query: string,
  kindFilter?: string | undefined,
): void {
  const filterResult = filterSearchableArtifacts(allArtifacts, query, MAX_QUICK_PICK_ITEMS);
  quickPick.items = filterResult.items.map(toQuickPickItem);

  const filterSuffix = kindFilter
    ? ` [Type: ${kindFilter === "other" ? "Other" : formatArtifactKindLabel(kindFilter)}]`
    : "";

  if (allArtifacts.length === 0) {
    quickPick.title = `AI Artifacts: Search Artifact${filterSuffix} (0 artifacts)`;
    quickPick.placeholder = kindFilter
      ? "No artifacts match this filter"
      : "No artifacts found in ~/.ai-artifacts/artifacts/";
  } else if (filterResult.totalMatches === 0) {
    quickPick.title = `AI Artifacts: Search Artifact${filterSuffix} (0 matches)`;
    quickPick.placeholder = "No artifacts match current title query";
  } else if (filterResult.limited) {
    quickPick.title = `AI Artifacts: Search Artifact${filterSuffix} (Showing 1,000 of ${filterResult.totalMatches.toLocaleString()})`;
    quickPick.placeholder = "Type more to narrow results...";
  } else {
    quickPick.title = `AI Artifacts: Search Artifact${filterSuffix} (${filterResult.totalMatches.toLocaleString()})`;
    quickPick.placeholder = "Search artifacts by title...";
  }
}

export async function runArtifactSearchCommand(
  deps: ArtifactSearchCommandDeps,
  options?: ArtifactSearchCommandOptions,
): Promise<void> {
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
      updateQuickPickState(quickPick, cachedArtifacts, value, options?.kindFilter);
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

    let artifacts = discovery.artifacts;
    if (options?.kindFilter === "other") {
      artifacts = artifacts.filter((a) => !isFixedArtifactKind(a.kind));
    } else if (options?.kindFilter) {
      artifacts = artifacts.filter((a) => a.kind === options.kindFilter);
    }

    cachedArtifacts = artifacts;
    quickPick.busy = false;
    updateQuickPickState(quickPick, cachedArtifacts, quickPick.value, options?.kindFilter);
  } catch (err) {
    if (isDisposed) return;
    cleanup();
    deps.showErrorMessage(err instanceof Error ? err.message : String(err));
  }
}
