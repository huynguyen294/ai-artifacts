import * as vscode from "vscode";
import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { DEFAULT_SESSION_TYPE_ID } from "../shared/contracts";
import {
  countSessionsByType,
  createSessionType,
  deleteSessionType,
  listSessionTypes,
  renameSessionType,
} from "../shared/session-type-registry";

export interface SessionTypeActionButton extends vscode.QuickInputButton {
  readonly actionId: "rename" | "delete";
}

export interface SessionTypeQuickPickItem extends vscode.QuickPickItem {
  typeId?: string;
  isCreateButton?: boolean;
}

export interface SessionTypeCommandDeps {
  createQuickPick: () => vscode.QuickPick<SessionTypeQuickPickItem>;
  showInputBox: (options: vscode.InputBoxOptions) => Thenable<string | undefined>;
  showWarningMessage: (message: string, ...items: string[]) => Thenable<string | undefined>;
  showErrorMessage: (message: string) => Thenable<unknown>;
  rootOptions?: GlobalArtifactsRootOptions;
  onDidUpdate?: () => void;
}

export async function runManageSessionTypesCommand(deps: SessionTypeCommandDeps): Promise<void> {
  const quickPick = deps.createQuickPick();
  quickPick.title = "Manage Session Types";
  quickPick.placeholder = "Session types are shared across all sessions";
  quickPick.busy = true;

  const disposables: vscode.Disposable[] = [];
  let isDisposed = false;

  const loadItems = async (): Promise<void> => {
    quickPick.busy = true;
    try {
      const types = await listSessionTypes(deps.rootOptions);
      const counts: Record<string, number> = {};
      for (const t of types) {
        counts[t.id] = await countSessionsByType(t.id, deps.rootOptions);
      }

      const items: SessionTypeQuickPickItem[] = [
        {
          label: "$(plus) Add new session type...",
          isCreateButton: true,
          alwaysShow: true,
        },
      ];

      for (const t of types) {
        const count = counts[t.id] ?? 0;
        const isDefault = t.id === DEFAULT_SESSION_TYPE_ID;
        const renameButton: SessionTypeActionButton = {
          iconPath: new vscode.ThemeIcon("edit"),
          tooltip: "Rename",
          actionId: "rename",
        };
        const buttons: SessionTypeActionButton[] = [renameButton];

        if (!isDefault) {
          const deleteButton: SessionTypeActionButton = {
            iconPath: new vscode.ThemeIcon("trash"),
            tooltip: "Delete",
            actionId: "delete",
          };
          buttons.push(deleteButton);
        }

        const item: SessionTypeQuickPickItem = {
          label: t.label,
          typeId: t.id,
          detail: `Used by ${count} session${count !== 1 ? "s" : ""}`,
          alwaysShow: true,
          buttons,
        };
        if (isDefault) {
          item.description = "[Default]";
        }
        items.push(item);
      }

      if (!isDisposed) {
        quickPick.items = items;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      void deps.showErrorMessage(`Failed to load session types: ${msg}`);
    } finally {
      if (!isDisposed) {
        quickPick.busy = false;
      }
    }
  };

  disposables.push(
    quickPick.onDidTriggerItemButton(async (e) => {
      const targetItem = e.item;
      if (!targetItem.typeId) return;

      const button = e.button as Partial<SessionTypeActionButton>;
      const isEdit = button.actionId === "rename";
      const isDelete = button.actionId === "delete";

      if (isEdit) {
        const newLabel = await deps.showInputBox({
          title: `Rename Session Type: ${targetItem.label}`,
          prompt: "Enter a new display name (cannot be empty or duplicate)",
          value: targetItem.label,
        });

        if (newLabel !== undefined && newLabel.trim().length > 0 && newLabel.trim() !== targetItem.label) {
          try {
            await renameSessionType(targetItem.typeId, newLabel.trim(), deps.rootOptions);
            deps.onDidUpdate?.();
            await loadItems();
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            void deps.showErrorMessage(`Failed to rename session type: ${msg}`);
          }
        }
      } else if (isDelete) {
        if (targetItem.typeId === DEFAULT_SESSION_TYPE_ID) {
          void deps.showErrorMessage("The default session type cannot be deleted.");
          return;
        }

        try {
          const count = await countSessionsByType(targetItem.typeId, deps.rootOptions);

          if (count > 0) {
            const types = await listSessionTypes(deps.rootOptions);
            const defaultType = types.find((t) => t.id === DEFAULT_SESSION_TYPE_ID);
            const defaultLabel = defaultType?.label ?? "Conversation";

            const confirmAction = "Delete Type";
            const selected = await deps.showWarningMessage(
              `Session type "${targetItem.label}" is used by ${count} session${count !== 1 ? "s" : ""}. These sessions will be reverted to "${defaultLabel}". Are you sure you want to delete this type?`,
              confirmAction,
              "Cancel",
            );

            if (selected === confirmAction) {
              await deleteSessionType(targetItem.typeId, undefined, deps.rootOptions);
              deps.onDidUpdate?.();
              await loadItems();
            }
          } else {
            await deleteSessionType(targetItem.typeId, undefined, deps.rootOptions);
            deps.onDidUpdate?.();
            await loadItems();
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          void deps.showErrorMessage(`Failed to delete session type: ${msg}`);
        }
      }
    }),
  );

  disposables.push(
    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;

      if (selected.isCreateButton) {
        const newLabel = await deps.showInputBox({
          title: "Add New Session Type",
          prompt: "Enter a name for the new session type (shared across all sessions)",
        });

        if (newLabel !== undefined && newLabel.trim().length > 0) {
          try {
            await createSessionType(newLabel.trim(), deps.rootOptions);
            deps.onDidUpdate?.();
            await loadItems();
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            void deps.showErrorMessage(`Failed to create session type: ${msg}`);
          }
        }
      }
    }),
  );

  disposables.push(
    quickPick.onDidHide(() => {
      isDisposed = true;
      for (const d of disposables) {
        d.dispose();
      }
      quickPick.dispose();
    }),
  );

  quickPick.show();
  await loadItems();
}

export interface SelectSessionTypeDeps {
  createQuickPick: () => vscode.QuickPick<SessionTypeQuickPickItem>;
  currentTypeId?: string;
  rootOptions?: GlobalArtifactsRootOptions;
  showErrorMessage?: (message: string) => void | Thenable<unknown>;
}

export async function runSelectSessionTypeQuickPick(
  deps: SelectSessionTypeDeps,
): Promise<{ typeId: string; created?: boolean } | undefined> {
  const types = await listSessionTypes(deps.rootOptions);
  const quickPick = deps.createQuickPick();
  quickPick.title = "Select Session Type";
  quickPick.placeholder = "Search or create a type";
  quickPick.matchOnDescription = true;

  const buildItems = (filter = ""): SessionTypeQuickPickItem[] => {
    const items: SessionTypeQuickPickItem[] = [];
    const trimmed = filter.trim();

    const matchesExisting = types.some((t) => t.label.toLowerCase() === trimmed.toLowerCase());
    if (trimmed.length > 0 && !matchesExisting) {
      items.push({
        label: `$(plus) Create type "${trimmed}"`,
        description: "Add new session type",
        isCreateButton: true,
        alwaysShow: true,
      });
    }

    for (const t of types) {
      const isCurrent = t.id === deps.currentTypeId;
      const item: SessionTypeQuickPickItem = {
        label: t.label,
        typeId: t.id,
      };
      if (isCurrent) {
        item.description = "[Current]";
      }
      items.push(item);
    }

    return items;
  };

  quickPick.items = buildItems();
  const currentItem = quickPick.items.find((i) => i.typeId === deps.currentTypeId);
  if (currentItem) {
    quickPick.activeItems = [currentItem];
  }

  return new Promise((resolve) => {
    let accepted = false;

    quickPick.onDidChangeValue((val) => {
      quickPick.items = buildItems(val);
    });

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;

      accepted = true;
      quickPick.hide();

      if (selected.isCreateButton) {
        const rawLabel = quickPick.value.trim();
        try {
          const created = await createSessionType(rawLabel, deps.rootOptions);
          resolve({ typeId: created.id, created: true });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          void (deps.showErrorMessage ? deps.showErrorMessage(msg) : vscode.window.showErrorMessage(msg));
          resolve(undefined);
        }
      } else if (selected.typeId) {
        resolve({ typeId: selected.typeId });
      } else {
        resolve(undefined);
      }
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
      if (!accepted) resolve(undefined);
    });

    quickPick.show();
  });
}
