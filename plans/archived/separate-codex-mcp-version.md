# Separate Codex MCP Version Plan

## Goal

- Tách trạng thái nâng cấp/migration MCP của Codex (`codexMcpVersion`) khỏi `mcpVersion` dùng chung trong `~/.ai-artifacts/managed/integration-version.json`.
- Không để lỗi migration ở Codex (như `CODEX_UNEXPECTED_KEY_CONFLICT`) block `mcpVersion` chung lên `MCP_VERSION` (`12`), tránh khóa Work Session / Session Manager và tránh làm kẹt các client khác khi runtime `.mjs` trên đĩa đã lên bản mới.

## Scope & Requirements

- **Schema (`src/shared/contracts.ts`):**
  - Bổ sung optional field `codexMcpVersion: z.number().int().nonnegative().optional()` vào `integrationVersionManifestSchema` (`.strict()`, giữ nguyên `INTEGRATION_VERSION_SCHEMA_VERSION = 1`).
  - Dùng `.nonnegative()` để cho phép giá trị `0` khi migration Codex lỗi trên receipt cũ `invalid`.
  - Giữ nguyên 1 file MCP server runtime dùng chung (`~/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs`), không tách file server riêng cho Codex.

- **Fallback cho receipt cũ & Helper ghi receipt (`src/extension/workspace-integration.ts`):**
  - Với các receipt cũ chưa có `codexMcpVersion`, tính `previousCodexMcpVersion = manifest?.codexMcpVersion ?? manifest?.mcpVersion ?? 0`.
  - Cập nhật `writeInstalledIntegrationVersion` để hỗ trợ patch `codexMcpVersion?: number | null` (`null` xóa field, `number` ghi đè field, `undefined` giữ nguyên giá trị hiện có trong manifest hợp lệ).

- **Auto-Upgrade Flow (`upgradeDetectedIntegrations`):**
  - Xác định `codexNeedsMigration = clientIdSet.has("codex") && needsCodexArtifactsMcpUpgrade(previousCodexMcpVersion, MCP_VERSION)`.
  - Truyền `previousCodexMcpVersion` vào `driver.upgrade(...)` riêng cho `driver.id === "codex"`; các driver còn lại giữ `previousMcpVersion`.
  - Luôn commit `mcpVersion: MCP_VERSION` ngay khi `syncMcp` đã sync file `.mjs` dùng chung, kể cả khi `CodexClientDriver.upgrade()` thất bại.
  - Nếu `codexNeedsMigration` và Codex thất bại (`codexDefinitionMigrationFailed`), ghi rõ `codexMcpVersion: previousCodexMcpVersion` (giữ trạng thái chưa nâng cấp cho riêng Codex trong 1 lần ghi receipt cuối cùng) để các lần khởi động sau vẫn phát hiện và nhắc/thử lại.
  - Nếu `codexNeedsMigration` và Codex thành công, ghi `codexMcpVersion: MCP_VERSION` kể cả khi `syncMcp === false` (retry lần 2 sau khi `.mjs` đã ở bản 12).
  - Giữ nguyên invariant zero-I/O khi mọi field trong receipt (`mcpVersion`, `codexMcpVersion` hoặc fallback `mcpVersion >= 12`, `skills`, `sessionSkills`) đã bằng version mục tiêu.

- **Manual Install Flow (`installSelectedIntegrations` / `setupBaseMcpServer` / `installClientAndRecordState`):**
  - Nếu receipt hợp lệ trước đó đang ở `mcpVersion < MCP_VERSION` và chưa có `codexMcpVersion`, khi `syncSharedIntegrationAssets` nâng `mcpVersion` lên `MCP_VERSION` thì bảo toàn `codexMcpVersion: previousMcpVersion` (không tạo giả field này khi cài mới trên trạng thái `missing`).
  - Trong `installClientAndRecordState`, khi cài `codex` thành công thì ghi `codexMcpVersion: MCP_VERSION`.
  - Trong `installSelectedIntegrations`, nếu cài `codex` thất bại và `previousCodexMcpVersion < MCP_VERSION`, ghi `codexMcpVersion: previousCodexMcpVersion` để auto-upgrade tiếp tục nhắc/retry cho đến khi user xử lý conflict hoặc gỡ Codex.

- **Manual Uninstall Flow (`uninstallSelectedIntegrations`):**
  - Nếu user gỡ Codex thành công và `cleanupBase` không chạy (còn client khác hoặc user chỉ gỡ Codex), dọn trạng thái pending của `codexMcpVersion` trên manifest hợp lệ (xóa field nếu `mcpVersion >= MCP_VERSION`, hoặc đặt `MCP_VERSION` nếu cần giữ schema) để không nhắc lỗi Codex nữa; không tạo file receipt mới nếu manifest đang `missing`/`invalid`.

- **Notifications & Work Session Support:**
  - Giữ nguyên `upgrade-notification.ts`, `install-notification.ts`, `resolveWorkSessionSupport()`, `mcp-config.ts`, `codex-client.ts`, và 6 JSON drivers còn lại (`copilot`, `cursor`, `claude`, `windsurf`, `cline`, `antigravity`).

## Out of Scope

- Không tạo file MCP server script riêng cho Codex.
- Không sửa TOML conflict guard của Codex (`mcp-config.ts`, `codex-client.ts`) hay logic khóa/mở `work-session-support.ts`.
- Không tự ý sửa docs trước khi hỏi Chú theo quy tắc repo.

## Verification

- `npm.cmd run check`
- `npm.cmd test`
- `npm.cmd run build`
- `git diff --check`
