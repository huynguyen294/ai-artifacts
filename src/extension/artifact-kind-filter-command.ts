import * as vscode from "vscode";
import { FIXED_ARTIFACT_KINDS, formatArtifactKindLabel } from "../shared/artifact-kinds";

export type ArtifactKindFilter = (typeof FIXED_ARTIFACT_KINDS)[number] | "other";

export function isArtifactKindFilter(value: unknown): value is ArtifactKindFilter {
  return typeof value === "string" && (value === "other" || (FIXED_ARTIFACT_KINDS as readonly string[]).includes(value));
}

export interface ArtifactKindFilterQuickPickItem extends vscode.QuickPickItem {
  artifactKind?: string | undefined;
  isAllTypes?: boolean;
  isOther?: boolean;
}

export interface ArtifactKindFilterCommandDeps {
  createQuickPick: () => vscode.QuickPick<ArtifactKindFilterQuickPickItem>;
  currentKindFilter?: string | undefined;
  onFilterChanged: (selectedKind: string | undefined) => void;
}

export async function runArtifactKindFilterCommand(deps: ArtifactKindFilterCommandDeps): Promise<void> {
  const quickPick = deps.createQuickPick();

  quickPick.title = "Filter Recent Artifacts by Type";
  quickPick.placeholder = "Select an artifact type";
  quickPick.matchOnDescription = true;

  const items: ArtifactKindFilterQuickPickItem[] = [];

  // 1. All Types option
  const isAllCurrent = !deps.currentKindFilter;
  const allTypesItem: ArtifactKindFilterQuickPickItem = {
    label: "All Types",
    isAllTypes: true,
    alwaysShow: true,
  };
  if (isAllCurrent) {
    allTypesItem.description = "[Current]";
  }
  items.push(allTypesItem);

  // 2. 10 Fixed artifact kinds
  for (const kind of FIXED_ARTIFACT_KINDS) {
    const isCurrent = deps.currentKindFilter === kind;
    const item: ArtifactKindFilterQuickPickItem = {
      label: formatArtifactKindLabel(kind),
      artifactKind: kind,
    };
    if (isCurrent) {
      item.description = "[Current]";
    }
    items.push(item);
  }

  // 3. Other (synthetic filter for non-fixed/open kinds)
  const isOtherCurrent = deps.currentKindFilter === "other";
  const otherItem: ArtifactKindFilterQuickPickItem = {
    label: "Other",
    artifactKind: "other",
    isOther: true,
    detail: "Custom kinds outside the 10 standard types",
  };
  if (isOtherCurrent) {
    otherItem.description = "[Current]";
  }
  items.push(otherItem);

  quickPick.items = items;
  const currentItem = items.find((i) =>
    deps.currentKindFilter ? i.artifactKind === deps.currentKindFilter : i.isAllTypes,
  );
  if (currentItem) {
    quickPick.activeItems = [currentItem];
  }

  return new Promise((resolve) => {
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;

      quickPick.hide();

      if (selected.isAllTypes) {
        deps.onFilterChanged(undefined);
      } else if (selected.isOther) {
        deps.onFilterChanged("other");
      } else {
        deps.onFilterChanged(selected.artifactKind);
      }
      resolve();
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve();
    });

    quickPick.show();
  });
}
