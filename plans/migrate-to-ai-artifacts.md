# Kế hoạch Triển khai: Đổi thư mục lưu trữ Artifact sang .ai-artifacts

---

## PHẦN 1: THÔNG TIN TỔNG QUAN

### 1. Bối cảnh & Vấn đề (Problem & Context)
- Hiện tại, repository đang sử dụng thư mục ẩn `.codex-artifacts/` tại root của từng workspace folder để lưu trữ các artifact review (`.codex-artifacts/artifacts/<id>/`).
- Với định hướng mới là **AI Artifacts** — một giải pháp độc lập nền tảng, kết nối đa client (Cursor, Codex, Claude Code, Windsurf, GitHub Copilot) qua giao thức MCP, việc giữ tiền tố `.codex-` ở cấp workspace folder gây cảm giác gắn chặt với Codex và không nhất quán với thương hiệu chung của extension.
- Mục tiêu: Chuyển đổi tên thư mục mặc định sang **`.ai-artifacts`**, đồng thời **đảm bảo tương thích ngược 100% (Backward Compatibility)** với các artifact cũ đã được tạo trong `.codex-artifacts/` để không làm mất dữ liệu của người dùng.

### 2. Phương án Kỹ thuật & Kiến trúc (Proposed Solution & Architecture)
- **Hằng số cốt lõi (`src/shared/artifact-files.ts`)**:
  - Khai báo `ARTIFACTS_DIRECTORY = ".ai-artifacts"`.
  - Khai báo hằng số tương thích `LEGACY_ARTIFACTS_DIRECTORY = ".codex-artifacts"`.
- **Validation & Contract (`src/shared/artifact-validation.ts`)**:
  - Cập nhật hàm `assertArtifactDirectory` để chấp nhận hợp lệ cả 2 định dạng đường dẫn (`.ai-artifacts` và `.codex-artifacts`), ưu tiên `.ai-artifacts`.
- **MCP Server Runtime (`src/integration/artifact-review-mcp-v4.ts`)**:
  - Khi tạo mới artifact (`create_artifact`): Luôn tạo trong thư mục `.ai-artifacts/artifacts/<id>/`.
  - Khi đọc / inspect / wait / advance: Tự động nhận diện nếu artifact cũ nằm ở `.codex-artifacts/` thì vẫn phục vụ bình thường, không báo lỗi path mismatch.
- **VS Code Extension Host (`src/extension/extension.ts` & `package.json`)**:
  - `package.json`: Mở rộng `filenamePattern` của Custom Editor để nhận diện cả hai mẫu file:
    `**/.ai-artifacts/artifacts/**/artifact.md` và `**/.codex-artifacts/artifacts/**/artifact.md`.
  - `src/extension/extension.ts`: Lắng nghe sự kiện tạo `comments.json` trên cả 2 thư mục watcher.
- **Agent Skill (`skills/create-review-artifact/`) & Tài liệu**:
  - Cập nhật tài liệu hướng dẫn và contract tham chiếu cho các AI Agent.

### 3. Lưu ý & Ràng buộc (Notes & Considerations)
- **Không di chuyển vật lý (No forced move)**: Không tự ý quét và di chuyển file cũ của người dùng từ `.codex-artifacts` sang `.ai-artifacts` để tránh rủi ro I/O hoặc xung đột Git trên máy người dùng.
- **Tương thích ngược song song**: Hệ thống đọc được cả 2, nhưng chỉ ghi mới vào `.ai-artifacts`.
- **Chia nhỏ từng Phase**: Mỗi Phase sửa tối đa 2–4 file để Chú dễ dàng review từng diff.

---

## PHẦN 2: KẾ HOẠCH TRIỂN KHAI THEO PHASE

### Phase 1: Core Constants & Dual-Directory Validation (ACTIVE - ĐANG TRIỂN KHAI)

#### Chi tiết công việc:
1. [src/shared/artifact-files.ts](file:///d:/workspace/my-projects/agent-plus/src/shared/artifact-files.ts):
   - Đổi `ARTIFACTS_DIRECTORY` thành `".ai-artifacts"`.
   - Bổ sung `LEGACY_ARTIFACTS_DIRECTORY = ".codex-artifacts"`.
2. [src/shared/artifact-validation.ts](file:///d:/workspace/my-projects/agent-plus/src/shared/artifact-validation.ts):
   - Cập nhật `assertArtifactDirectory`: chấp nhận artifact directory thuộc `.ai-artifacts` HOẶC `.codex-artifacts`.
   - Bổ sung helper `isArtifactPath(filePath: string): boolean`.

#### Hướng dẫn kiểm tra & xác minh:
- Chạy `npm run check` để đảm bảo không gãy kiểu dữ liệu TypeScript.
- Chạy `npx vitest run test/artifact-store.test.ts` để kiểm tra validation logic.

#### 📋 Tổng kết Phase 1:
> [!NOTE]
> - **Các việc đã làm:** (Đang chờ thực hiện)
> - **Kết quả đạt được:** Định nghĩa xong tên thư mục mới `.ai-artifacts` ở tầng contract chia sẻ và hỗ trợ song song thư mục cũ.

---

### Phase 2: MCP Server Creation & Lifecycle Resolution (PENDING - ĐANG CHỜ)

#### Chi tiết công việc:
1. [src/integration/artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/agent-plus/src/integration/artifact-review-mcp-v4.ts):
   - Cập nhật logic tạo thư mục: Tạo mới tại `workspaceRoot/.ai-artifacts/artifacts/<id>`.
   - Đảm bảo các tool `inspect_artifact_review`, `wait_for_artifact_review`, `advance_and_wait_for_artifact` nhận diện đúng cả 2 đường dẫn.
2. [src/integration/stamp-origin.ts](file:///d:/workspace/my-projects/agent-plus/src/integration/stamp-origin.ts):
   - Cập nhật tên file tạm nếu có liên quan.

#### Hướng dẫn kiểm tra & xác minh:
- Chạy `npm run build:integration` và `npx vitest run test/review-wait-mcp.test.ts`.

#### 📋 Tổng kết Phase 2:
> [!NOTE]
> - **Các việc đã làm:** (Chưa bắt đầu)
> - **Kết quả đạt được:** MCP runtime chính thức sinh artifact vào `.ai-artifacts/`.

---

### Phase 3: Extension Host, Custom Editor & Watchers (PENDING - ĐANG CHỜ)

#### Chi tiết công việc:
1. [package.json](file:///d:/workspace/my-projects/agent-plus/package.json):
   - Cập nhật `filenamePattern` trong `customEditors` để match cả `.ai-artifacts` và `.codex-artifacts`.
2. [src/extension/extension.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/extension.ts):
   - Thêm watcher cho `**/.ai-artifacts/artifacts/**/comments.json` bên cạnh watcher cũ.

#### Hướng dẫn kiểm tra & xác minh:
- Chạy `npm run build:extension` và kiểm tra extension bundle.

#### 📋 Tổng kết Phase 3:
> [!NOTE]
> - **Các việc đã làm:** (Chưa bắt đầu)
> - **Kết quả đạt được:** VS Code UI và Custom Editor tự động mở cho cả artifact mới và cũ.

---

### Phase 4: Skill Contract, Tests & Documentation (PENDING - ĐANG CHỜ)

#### Chi tiết công việc:
1. [skills/create-review-artifact/references/artifact-contract.md](file:///d:/workspace/my-projects/agent-plus/skills/create-review-artifact/references/artifact-contract.md) & [SKILL.md](file:///d:/workspace/my-projects/agent-plus/skills/create-review-artifact/SKILL.md):
   - Cập nhật đường dẫn mẫu sang `.ai-artifacts`.
2. [test/artifact-store.test.ts](file:///d:/workspace/my-projects/agent-plus/test/artifact-store.test.ts) & [test/review-wait-mcp.test.ts](file:///d:/workspace/my-projects/agent-plus/test/review-wait-mcp.test.ts):
   - Cập nhật test fixtures sang `.ai-artifacts` và bổ sung test case tương thích ngược.
3. [README.md](file:///d:/workspace/my-projects/agent-plus/README.md) & [docs/CHANGE_LOGS.md](file:///d:/workspace/my-projects/agent-plus/docs/CHANGE_LOGS.md):
   - Cập nhật tài liệu người dùng và ghi nhận changelog.

#### Hướng dẫn kiểm tra & xác minh:
- Chạy `npm test` toàn bộ suite và `npm run check`.

#### 📋 Tổng kết Phase 4:
> [!NOTE]
> - **Các việc đã làm:** (Chưa bắt đầu)
> - **Kết quả đạt được:** Toàn bộ test và tài liệu hoàn toàn đồng bộ với chuẩn `.ai-artifacts`.
