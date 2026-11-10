import * as vscode from "vscode";
import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { listSessionTypes } from "../shared/session-type-registry";

export interface SessionFilterQuickPickItem extends vscode.QuickPickItem {
  typeId?: string | undefined;
  isAllTypes?: boolean;
}

export interface SessionFilterCommandDeps {
  createQuickPick: () => vscode.QuickPick<SessionFilterQuickPickItem>;
  currentTypeId?: string | undefined;
  rootOptions?: GlobalArtifactsRootOptions;
  onFilterChanged: (selectedTypeId: string | undefined) => void;
}

export async function runSessionFilterCommand(deps: SessionFilterCommandDeps): Promise<void> {
  const types = await listSessionTypes(deps.rootOptions);
  const quickPick = deps.createQuickPick();

  quickPick.title = "Filter Sessions";
  quickPick.placeholder = "Select a session type";
  quickPick.matchOnDescription = true;

  const items: SessionFilterQuickPickItem[] = [];

  // 1. All Types option
  const isAllCurrent = !deps.currentTypeId;
  const allTypesItem: SessionFilterQuickPickItem = {
    label: "All Types",
    isAllTypes: true,
    alwaysShow: true,
  };
  if (isAllCurrent) {
    allTypesItem.description = "[Current]";
  }
  items.push(allTypesItem);

  // 2. Session types from registry
  for (const t of types) {
    const isCurrent = t.id === deps.currentTypeId;
    const item: SessionFilterQuickPickItem = {
      label: t.label,
      typeId: t.id,
    };
    if (isCurrent) {
      item.description = "[Current]";
    }
    items.push(item);
  }

  quickPick.items = items;
  const currentItem = items.find((i) =>
    deps.currentTypeId ? i.typeId === deps.currentTypeId : i.isAllTypes,
  );
  if (currentItem) {
    quickPick.activeItems = [currentItem];
  }

  return new Promise((resolve) => {
    let accepted = false;

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;

      accepted = true;
      quickPick.hide();

      if (selected.isAllTypes) {
        deps.onFilterChanged(undefined);
      } else {
        deps.onFilterChanged(selected.typeId);
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
