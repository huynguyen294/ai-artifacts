# Kế hoạch Triển khai: Tính năng Uninstall MCP Integrations

---

## PHẦN 1: THÔNG TIN TỔNG QUAN

### 1. Bối cảnh & Vấn đề (Problem & Context)
- **Hiện trạng**: Extension `ai-artifacts` đã trang bị các lệnh cài đặt MCP server tự động cho 5 AI client: GitHub Copilot, Cursor, Codex, Claude Code và Windsurf.
- **Vấn đề**:
  - Chưa có cơ chế **Uninstall** (Gỡ bỏ tích hợp) tương ứng.
  - Khi người dùng muốn gỡ bỏ tích hợp hoặc chuyển sang cấu hình khác, họ buộc phải tự mở từng file cấu hình (`Code/User/mcp.json`, `~/.cursor/mcp.json`, `~/.codex/config.toml`, `~/.claude.json`, `~/.codeium/windsurf/mcp_config.json`) để xóa thủ công bằng tay. Điều này dễ gây lỗi cú pháp JSON/TOML hoặc để sót các tài nguyên thừa tại `~/.vscode/ai-artifacts/` và `~/.agents/skills/`.
- **Mục tiêu**:
  - Xây dựng tính năng Uninstall an toàn, tự động bóc tách cấu hình MCP server khỏi các AI client.
  - Cung cấp tùy chọn gỡ toàn bộ (All Detected) và gỡ lẻ theo từng client.
  - **Bảo toàn dữ liệu dự án (Zero Data Loss)**: Chỉ gỡ cấu hình kết nối MCP client và dọn file script runtime/skill; tuyệt đối không đụng vào các thư mục `.ai-artifacts/` hay `.codex-artifacts/` của người dùng.

### 2. Phương án Kỹ thuật & Kiến trúc (Proposed Solution & Architecture)

```
Extension Command ("AI Artifacts: Uninstall All Integrations")
                     │
                     ▼
       Workspace Integration Orchestrator
         (workspace-integration-v4.ts)
                     │
         ┌───────────┴────────────────────────┐
         ▼                                    ▼
McpClientDrivers (uninstall)         Base Assets Cleanup
 ├── CopilotClientDriver              ├── Xóa ~/.vscode/ai-artifacts/
 ├── CursorClientDriver               └── Xóa ~/.agents/skills/create-review-artifact/
 ├── CodexClientDriver (withoutManagedBlock)
 ├── ClaudeClientDriver
 └── WindsurfClientDriver
```

- **Tầng Driver (`src/extension/mcp-clients/`)**:
  - Mở rộng interface `McpClientDriver`: Thêm method `uninstall(): Promise<boolean>`.
  - JSON Clients (Copilot, Cursor, Claude, Windsurf): Viết helper `removeJsonMcpServer` bóc tách key `ai_artifacts` (và fallback `codex_artifacts`) ra khỏi `mcpServers` hoặc `servers` một cách atomic.
  - Codex TOML Client: Tận dụng `withoutManagedBlock` để gỡ bỏ toàn bộ khối cấu hình nằm giữa cặp marker `# >>> AI Artifacts review MCP >>>`.
- **Tầng Orchestrator (`src/extension/workspace-integration-v4.ts`)**:
  - `uninstallAllDetectedIntegrations(context)`: Lặp qua các client đã detected để gỡ bỏ, sau đó dọn dẹp thư mục triển khai gốc nếu không còn client nào sử dụng.
  - Cung cấp các hàm gỡ đơn lẻ: `uninstallCopilotIntegration`, `uninstallCodexIntegration`, v.v.
- **Tầng UI & Commands (`package.json`, `src/extension/extension.ts`)**:
  - Đăng ký command tổng: `agentPlus.uninstallAllIntegrations`.
  - Đăng ký các command đơn lẻ theo từng editor để người dùng linh hoạt.
  - Thông báo pop-up rõ ràng danh sách các client đã gỡ và hướng dẫn restart editor nếu cần.

### 3. Lưu ý & Ràng buộc (Notes & Considerations)
- **An toàn tệp cấu hình**:
  - Với file JSON, nếu sau khi xóa mà `mcpServers` hoặc `servers` rỗng (`{}`), ta giữ nguyên object rỗng thay vì xóa hẳn key để tránh làm ảnh hưởng các thiết lập khác của người dùng.
  - Ghi file luôn luôn thực hiện theo cơ chế Atomic Write (ghi vào file `.tmp` rồi rename/replace) để tránh hỏng file nếu tiến trình bị ngắt đột ngột.

---

## PHẦN 2: KẾ HOẠCH TRIỂN KHAI THEO PHASE

### Phase 1: Client Driver Uninstallation Engine (ACTIVE - ĐANG TRIỂN KHAI)

#### Chi tiết công việc:
1. [src/extension/mcp-clients/json-mcp-helper.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/json-mcp-helper.ts):
   - Viết hàm `removeJsonMcpServer(filePath: string, serverName: string): Promise<boolean>`:
     - Đọc file JSON, kiểm tra sự tồn tại của serverName (và alias `codex_artifacts`) trong `mcpServers` và `servers`.
     - Xóa key tương ứng và ghi lại file atomic.
2. [src/extension/mcp-clients/index.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/index.ts):
   - Thêm `uninstall(): Promise<boolean>` vào interface `McpClientDriver`.
3. [src/extension/mcp-clients/codex-client.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/codex-client.ts):
   - Cài đặt `uninstall()`: Sử dụng `withoutManagedBlock` và `writeTextFileAtomic`.
4. [src/extension/mcp-clients/copilot-client.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/copilot-client.ts), [cursor-client.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/cursor-client.ts), [claude-client.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/claude-client.ts), [windsurf-client.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/mcp-clients/windsurf-client.ts):
   - Cài đặt `uninstall()`: Gọi `removeJsonMcpServer`.
5. [test/mcp-client-drivers.test.ts](file:///d:/workspace/my-projects/agent-plus/test/mcp-client-drivers.test.ts):
   - Thêm unit test kiểm tra luồng `install()` sau đó `uninstall()` cho cả 5 client drivers.

#### Hướng dẫn kiểm tra & xác minh:
- Chạy typecheck: `npm run check`
- Chạy unit tests: `npx vitest run test/mcp-client-drivers.test.ts`

#### 📋 Tổng kết Phase 1:
> [!NOTE]
> - **Các việc đã làm:** (Đang chờ duyệt để tiến hành)
> - **Kết quả đạt được:** Tầng drivers độc lập có khả năng gỡ bỏ cấu hình MCP sạch sẽ cho từng editor riêng biệt.

---

### Phase 2: Orchestration & Base Assets Cleanup (PENDING - ĐANG CHỜ)

#### Chi tiết công việc:
1. [src/extension/workspace-integration-v4.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/workspace-integration-v4.ts):
   - Thêm hàm `cleanupBaseMcpServer(context)`: Dọn dẹp script tại `~/.vscode/ai-artifacts/` và skill tại `~/.agents/skills/create-review-artifact/`.
   - Thêm hàm `uninstallAllDetectedIntegrations(context)`: Lặp qua các detected drivers, gọi `uninstall()`, và gọi `cleanupBaseMcpServer`.
   - Thêm các hàm gỡ lẻ: `uninstallCopilotIntegration`, `uninstallCodexIntegration`, `uninstallCursorIntegration`, `uninstallClaudeIntegration`, `uninstallWindsurfIntegration`.

#### Hướng dẫn kiểm tra & xác minh:
- Kiểm tra typecheck: `npm run check`
- Chạy integration test xác thực luồng gỡ toàn bộ.

#### 📋 Tổng kết Phase 2:
> [!NOTE]
> - **Các việc đã làm:** (Chưa bắt đầu)
> - **Kết quả đạt được:** Tầng điều phối sẵn sàng cho việc gỡ bỏ đồng loạt và dọn dẹp tài nguyên trung tâm.

---

### Phase 3: VS Code Commands & User Interface (PENDING - ĐANG CHỜ)

#### Chi tiết công việc:
1. [package.json](file:///d:/workspace/my-projects/agent-plus/package.json):
   - Khai báo các commands trong `contributes.commands`:
     - `agentPlus.uninstallAllIntegrations` ("AI Artifacts: Uninstall All Detected Integrations")
     - `agentPlus.uninstallCopilotIntegration` ("AI Artifacts: Uninstall Integration for GitHub Copilot")
     - `agentPlus.uninstallCodexIntegration` ("AI Artifacts: Uninstall Integration for Codex")
     - `agentPlus.uninstallCursorIntegration` ("AI Artifacts: Uninstall Integration for Cursor")
     - `agentPlus.uninstallClaudeIntegration` ("AI Artifacts: Uninstall Integration for Claude")
     - `agentPlus.uninstallWindsurfIntegration` ("AI Artifacts: Uninstall Integration for Windsurf")
   - Thêm vào `activationEvents`.
2. [src/extension/extension.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/extension.ts):
   - Đăng ký handlers cho các commands trên.
   - Hiển thị pop-up thông báo kết quả gỡ bỏ và nhắc người dùng khởi động lại AI client nếu cần.

#### Hướng dẫn kiểm tra & xác minh:
- Build extension: `npm run build:extension`
- Kiểm tra danh sách command trong Command Palette trên VS Code Development Host.

#### 📋 Tổng kết Phase 3:
> [!NOTE]
> - **Các việc đã làm:** (Chưa bắt đầu)
> - **Kết quả đạt được:** Người dùng có thể thực hiện gỡ bỏ trực tiếp từ Command Palette của VS Code một cách tiện lợi.

---

### Phase 4: Test Suite, Documentation & Packaging (PENDING - ĐANG CHỜ)

#### Chi tiết công việc:
1. [README.md](file:///d:/workspace/my-projects/agent-plus/README.md):
   - Thêm phần hướng dẫn gỡ bỏ cài đặt trong mục Getting Started.
2. [CHANGE_LOGS.md](file:///d:/workspace/my-projects/agent-plus/CHANGE_LOGS.md) & [docs/CHANGE_LOGS.md](file:///d:/workspace/my-projects/agent-plus/docs/CHANGE_LOGS.md):
   - Ghi nhận chi tiết tính năng Uninstall vào changelog.
3. Chạy full build & test:
   - Chạy `npm test` (đảm bảo 100% tests pass).
   - Chạy `npm run package`.

#### Hướng dẫn kiểm tra & xác minh:
- Toàn bộ test suite chạy thành công không có regression.
- Đóng gói VSIX thành công.

#### 📋 Tổng kết Phase 4:
> [!NOTE]
> - **Các việc đã làm:** (Chưa bắt đầu)
> - **Kết quả đạt được:** Hoàn tất trọn vẹn tính năng Uninstall với đầy đủ kiểm thử, tài liệu hướng dẫn và đóng gói phát hành.
