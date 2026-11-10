import * as vscode from "vscode";
import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { formatArtifactKindLabel } from "../shared/artifact-kinds";
import { validateArtifactReviewTarget } from "./artifact-review-open";
import {
  discoverSearchableArtifacts,
  filterSearchableArtifacts,
  MAX_QUICK_PICK_ITEMS,
  type SearchableArtifact,
} from "./artifact-search";

export type AddArtifactQuickPickItem = vscode.QuickPickItem & {
  artifactId: string;
  artifactPath: string;
};

export type AddArtifactToSessionQuickPickOptions = {
  sessionId: string;
  sessionArtifacts: ReadonlySet<string>;
  rootOptions?: GlobalArtifactsRootOptions;
  createQuickPick?: () => vscode.QuickPick<AddArtifactQuickPickItem>;
};

function toQuickPickItem(c: SearchableArtifact): AddArtifactQuickPickItem {
  return {
    label: c.title,
    description: formatArtifactKindLabel(c.kind),
    detail: `${c.artifactId} · ${c.updatedAt}`,
    artifactId: c.artifactId,
    artifactPath: c.artifactPath,
    alwaysShow: true,
  };
}

export async function runAddArtifactToSessionQuickPick(
  options: AddArtifactToSessionQuickPickOptions,
): Promise<string | undefined> {
  const rootOptions = options.rootOptions ?? {};
  const discovery = await discoverSearchableArtifacts(rootOptions);
  const candidates = discovery.artifacts.filter((a) => !options.sessionArtifacts.has(a.artifactId));

  if (candidates.length === 0) {
    void vscode.window.showInformationMessage("No other artifacts available to add to this session.");
    return undefined;
  }

  const quickPick = options.createQuickPick
    ? options.createQuickPick()
    : vscode.window.createQuickPick<AddArtifactQuickPickItem>();

  quickPick.title = "Add Artifact to Session";
  quickPick.placeholder = "Search by artifact title...";
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;

  const updateItems = (query: string) => {
    const filterResult = filterSearchableArtifacts(candidates, query, MAX_QUICK_PICK_ITEMS);
    quickPick.items = filterResult.items.map(toQuickPickItem);
  };

  updateItems("");

  quickPick.onDidChangeValue((value) => {
    updateItems(value);
  });

  return new Promise<string | undefined>((resolve) => {
    let resolved = false;

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (!selected) {
        if (!resolved) {
          resolved = true;
          quickPick.dispose();
          resolve(undefined);
        }
        return;
      }

      // Revalidate target on disk before returning
      try {
        await validateArtifactReviewTarget(selected.artifactPath, rootOptions);
      } catch {
        void vscode.window.showErrorMessage(
          `Artifact "${selected.artifactId}" is no longer valid or has been removed.`,
        );
        if (!resolved) {
          resolved = true;
          quickPick.dispose();
          resolve(undefined);
        }
        return;
      }

      if (!resolved) {
        resolved = true;
        quickPick.dispose();
        resolve(selected.artifactId);
      }
    });

    quickPick.onDidHide(() => {
      if (!resolved) {
        resolved = true;
        quickPick.dispose();
        resolve(undefined);
      }
    });

    quickPick.show();
  });
}

