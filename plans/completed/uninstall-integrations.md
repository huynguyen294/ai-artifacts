# Kế hoạch Triển khai: Tính năng Uninstall MCP Integrations (2 Phương án: Hook & Command)

---

## PHẦN 1: THÔNG TIN TỔNG QUAN

### 1. Bối cảnh & Vấn đề (Problem & Context)
- **Hiện trạng**: Extension `ai-artifacts` đã trang bị các lệnh cài đặt MCP server tự động cho 5 AI client: GitHub Copilot, Cursor, Codex, Claude Code và Windsurf.
- **Vấn đề**:
  - Chưa có cơ chế **Uninstall** (Gỡ bỏ tích hợp) tương ứng.
  - Khi người dùng muốn gỡ bỏ tích hợp hoặc xóa hẳn extension, họ buộc phải tự mở từng file cấu hình (`Code/User/mcp.json`, `~/.cursor/mcp.json`, `~/.codex/config.toml`, `~/.claude.json`, `~/.codeium/windsurf/mcp_config.json`) để xóa thủ công bằng tay. Điều này dễ gây lỗi cú pháp JSON/TOML hoặc để sót các tài nguyên thừa tại `~/.vscode/ai-artifacts/` và `~/.agents/skills/`.
- **Mục tiêu**:
  - Kết hợp đồng thời **2 phương án gỡ bỏ toàn diện**:
    1. **Phương án A (Tự động - Extension Lifecycle Hook `vscode:uninstall`)**: Khi người dùng bấm Uninstall extension trong tab Extensions của VS Code, một standalone script sẽ tự động chạy ngầm, bóc tách cấu hình MCP khỏi toàn bộ AI clients và xóa sạch runtime assets (`~/.vscode/ai-artifacts/`, `~/.agents/skills/create-review-artifact/`). Không để lại bất kỳ file rác nào trên máy.
    2. **Phương án B (Chủ động - Command Palette Commands)**: Người dùng có thể chủ động gỡ cấu hình MCP khỏi một editor cụ thể hoặc toàn bộ các editor thông qua Command Palette mà **vẫn giữ lại extension trong VS Code** (để tiếp tục đọc/review artifact).
  - **Bảo toàn dữ liệu dự án (Zero Project Data Loss)**: Cả 2 phương án đều tuyệt đối không đụng vào thư mục `.ai-artifacts/` và `.codex-artifacts/` trong các repository của người dùng.

### 2. Phương án Kỹ thuật & Kiến trúc (Proposed Solution & Architecture)

```
[Phương án A: Hook tự động khi gỡ Extension]     [Phương án B: Command Palette thủ công]
     VS Code Extensions -> Uninstall               Command: "Uninstall All Integrations"
                   │                                             │
                   ▼                                             ▼
          dist/uninstall.cjs                          src/extension/extension.ts
     (Node.js standalone process)                   (VS Code extension runtime)
                   │                                             │
                   └──────────────────────┬──────────────────────┘
                                          ▼
                         Workspace Integration Orchestrator
                           (workspace-integration-v4.ts)
                                          │
                  ┌───────────────────────┴────────────────────────┐
                  ▼                                                ▼
     McpClientDrivers (uninstall)                         Base Assets Cleanup
       ├── CopilotClientDriver (removeJsonMcpServer)        ├── Xóa ~/.vscode/ai-artifacts/
       ├── CursorClientDriver  (removeJsonMcpServer)        └── Xóa ~/.agents/skills/create-review-artifact/
       ├── CodexClientDriver   (withoutManagedBlock)
       ├── ClaudeClientDriver  (removeJsonMcpServer)
       └── WindsurfClientDriver(removeJsonMcpServer)
```

- **Tầng Driver (`src/extension/mcp-clients/`)**:
  - Mở rộng interface `McpClientDriver`: Thêm method `uninstall(): Promise<boolean>`.
  - JSON Clients (Copilot, Cursor, Claude, Windsurf): Viết helper `removeJsonMcpServer` bóc tách key `ai_artifacts` ra khỏi `mcpServers` hoặc `servers` một cách atomic (không cần xử lý alias cũ).
  - Codex TOML Client: Tận dụng `withoutManagedBlock` để gỡ bỏ toàn bộ khối cấu hình nằm giữa cặp marker `# >>> AI Artifacts review MCP >>>`.

---

## PHẦN 2: KẾ HOẠCH TRIỂN KHAI THEO PHASE

### Phase 1: Client Driver Uninstallation Engine (COMPLETED)

#### Chi tiết công việc:
1. [src/extension/mcp-clients/json-mcp-helper.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/json-mcp-helper.ts):
   - Viết hàm `removeJsonMcpServer(filePath: string, serverName: string = "ai_artifacts"): Promise<boolean>` bóc tách key `ai_artifacts` atomic.
2. [src/extension/mcp-clients/index.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/index.ts):
   - Thêm `uninstall(): Promise<boolean>` vào interface `McpClientDriver`.
3. [src/extension/mcp-clients/codex-client.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/codex-client.ts) & [src/extension/mcp-config.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-config.ts):
   - Export `removeCodexArtifactsMcp` và cài đặt `uninstall()` cho Codex.
4. [src/extension/mcp-clients/copilot-client.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/copilot-client.ts), [cursor-client.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/cursor-client.ts), [claude-client.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/claude-client.ts), [windsurf-client.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/windsurf-client.ts):
   - Cài đặt `uninstall()` gọi `removeJsonMcpServer`.
5. [test/mcp-client-drivers.test.ts](file:///d:/workspace/my-projects/agent-plus/test/mcp-client-drivers.test.ts):
   - Thêm unit test kiểm tra luồng `install()` sau đó `uninstall()` cho cả 5 client drivers (tất cả tests passed).

#### 📋 Tổng kết Phase 1:
> [!NOTE]
> - **Các việc đã làm:** Đã hoàn thành toàn bộ 5 client drivers và helper bóc tách cấu hình JSON/TOML an toàn.
> - **Kết quả đạt được:** Tầng drivers độc lập có khả năng gỡ bỏ cấu hình MCP sạch sẽ cho từng editor riêng biệt.

---

### Phase 2: Orchestration & Standalone Uninstall Script (COMPLETED)

#### Chi tiết công việc:
1. [src/extension/mcp-clients/base-cleanup.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/base-cleanup.ts):
   - Viết hàm `cleanupBaseMcpServer`: Dọn dẹp script tại `~/.vscode/ai-artifacts/` và skill tại `~/.agents/skills/create-review-artifact/`.
2. [src/extension/workspace-integration-v4.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/workspace-integration-v4.ts):
   - Thêm hàm `uninstallAllDetectedIntegrations()` và các hàm gỡ lẻ (`uninstallCopilotIntegration`, `uninstallCodexIntegration`, `uninstallCursorIntegration`, `uninstallClaudeIntegration`, `uninstallWindsurfIntegration`).
3. [src/extension/uninstall-entry.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/uninstall-entry.ts):
   - Entry point độc lập thuần Node.js không import `vscode`, dùng cho `vscode:uninstall` hook.
4. [package.json](file:///d:/workspace/my-projects/agent-plus/package.json):
   - Thêm build script `"build:uninstall"` đóng gói `dist/uninstall.cjs` (10KB) và tích hợp vào `"build"`.

#### 📋 Tổng kết Phase 2:
> [!NOTE]
> - **Các việc đã làm:** Xây dựng xong tầng điều phối `workspace-integration-v4.ts` và standalone Node script `dist/uninstall.cjs`.
> - **Kết quả đạt được:** Standalone script sẵn sàng để VS Code thực thi ngầm mà không cần `vscode` runtime.

---

### Phase 3: Extension Lifecycle Hook & VS Code Commands (COMPLETED)

#### Chi tiết công việc:
1. [package.json](file:///d:/workspace/my-projects/agent-plus/package.json):
   - Đăng ký hook `"vscode:uninstall": "node ./dist/uninstall.cjs"` trong `scripts`.
   - Khai báo 6 commands trong `contributes.commands` và `activationEvents`:
     - `agentPlus.uninstallAllIntegrations`
     - `agentPlus.uninstallCopilotIntegration`
     - `agentPlus.uninstallCodexIntegration`
     - `agentPlus.uninstallCursorIntegration`
     - `agentPlus.uninstallClaudeIntegration`
     - `agentPlus.uninstallWindsurfIntegration`
2. [src/extension/extension.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/extension.ts):
   - Đăng ký handlers cho toàn bộ 6 commands trên kèm thông báo UI rõ ràng.

#### 📋 Tổng kết Phase 3:
> [!NOTE]
> - **Các việc đã làm:** Đã đăng ký lifecycle hook và 6 command gỡ bỏ tích hợp trên Command Palette.
> - **Kết quả đạt được:** Cả 2 phương án (hook tự động khi gỡ extension và command chủ động từ Command Palette) đều hoạt động hoàn chỉnh.

---

### Phase 4: Test Suite, Documentation & Packaging (COMPLETED)

#### Chi tiết công việc:
1. [README.md](file:///d:/workspace/my-projects/agent-plus/README.md):
   - Bổ sung mục "Uninstalling and cleanup" với hướng dẫn chi tiết cả 2 phương án tự động và chủ động, nêu rõ cam kết Zero Project Data Loss.
2. [CHANGE_LOGS.md](file:///d:/workspace/my-projects/agent-plus/CHANGE_LOGS.md) & [docs/CHANGE_LOGS.md](file:///d:/workspace/my-projects/agent-plus/docs/CHANGE_LOGS.md):
   - Ghi nhận chi tiết tính năng Uninstall MCP Integrations vào changelog.
3. Test suite & Packaging:
   - Full test suite: 13 test files, 100/100 tests passed.
   - Đóng gói VSIX thành công.

#### 📋 Tổng kết Phase 4:
> [!NOTE]
> - **Các việc đã làm:** Đã cập nhật đầy đủ tài liệu, changelog, pass 100/100 tests và build package VSIX.
> - **Kết quả đạt được:** Hoàn tất trọn vẹn tính năng Uninstall MCP Integrations đạt độ tin cậy và ổn định tuyệt đối.

