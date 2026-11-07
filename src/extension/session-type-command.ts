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
  quickPick.title = "Quản lý loại phiên";
  quickPick.placeholder = "Áp dụng cho tất cả phiên làm việc";
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
          label: "$(plus) Thêm loại phiên mới...",
          isCreateButton: true,
          alwaysShow: true,
        },
      ];

      for (const t of types) {
        const count = counts[t.id] ?? 0;
        const isDefault = t.id === DEFAULT_SESSION_TYPE_ID;
        const buttons: vscode.QuickInputButton[] = [
          {
            iconPath: new vscode.ThemeIcon("edit"),
            tooltip: "Đổi tên",
          },
        ];

        if (!isDefault) {
          buttons.push({
            iconPath: new vscode.ThemeIcon("trash"),
            tooltip: "Xóa",
          });
        }

        const item: SessionTypeQuickPickItem = {
          label: t.label,
          typeId: t.id,
          detail: `Đang dùng cho ${count} phiên`,
          alwaysShow: true,
          buttons,
        };
        if (isDefault) {
          item.description = "[Mặc định]";
        }
        items.push(item);
      }

      if (!isDisposed) {
        quickPick.items = items;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      void deps.showErrorMessage(`Không thể tải danh sách loại phiên: ${msg}`);
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

      const button = e.button;
      const tooltip = button.tooltip;

      if (tooltip === "Đổi tên") {
        const newLabel = await deps.showInputBox({
          title: `Đổi tên loại phiên: ${targetItem.label}`,
          prompt: "Nhập tên hiển thị mới (không được để trống hoặc trùng lặp)",
          value: targetItem.label,
        });

        if (newLabel !== undefined && newLabel.trim().length > 0 && newLabel.trim() !== targetItem.label) {
          try {
            await renameSessionType(targetItem.typeId, newLabel.trim(), deps.rootOptions);
            deps.onDidUpdate?.();
            await loadItems();
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            void deps.showErrorMessage(`Không thể đổi tên loại phiên: ${msg}`);
          }
        }
      } else if (tooltip === "Xóa") {
        if (targetItem.typeId === DEFAULT_SESSION_TYPE_ID) {
          void deps.showErrorMessage("Không thể xóa loại phiên mặc định.");
          return;
        }

        try {
          const count = await countSessionsByType(targetItem.typeId, deps.rootOptions);

          if (count > 0) {
            const types = await listSessionTypes(deps.rootOptions);
            const defaultType = types.find((t) => t.id === DEFAULT_SESSION_TYPE_ID);
            const defaultLabel = defaultType?.label ?? "Conversation";

            const confirmAction = `Chuyển về ${defaultLabel} và xóa`;
            const selected = await deps.showWarningMessage(
              `Loại phiên "${targetItem.label}" đang được sử dụng cho ${count} phiên. Bạn có muốn chuyển các phiên này về "${defaultLabel}" và xóa không?`,
              confirmAction,
              "Hủy",
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
          void deps.showErrorMessage(`Không thể xóa loại phiên: ${msg}`);
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
          title: "Thêm loại phiên mới",
          prompt: "Nhập tên loại phiên mới (áp dụng cho tất cả phiên làm việc)",
        });

        if (newLabel !== undefined && newLabel.trim().length > 0) {
          try {
            await createSessionType(newLabel.trim(), deps.rootOptions);
            deps.onDidUpdate?.();
            await loadItems();
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            void deps.showErrorMessage(`Không thể tạo loại phiên: ${msg}`);
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
        } catch {
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
