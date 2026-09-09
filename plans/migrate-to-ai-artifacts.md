# Kế hoạch Triển khai: Đổi thư mục lưu trữ Artifact sang .ai-artifacts

---

## PHẦN 1: THÔNG TIN TỔNG QUAN

### 1. Bối cảnh & Vấn đề (Problem & Context)
- **Hiện trạng**: Extension đang lưu trữ toàn bộ các artifact review tại thư mục ẩn `.codex-artifacts/artifacts/<id>/` ở root của mỗi workspace folder.
- **Vấn đề**:
  - Extension đã được tái định vị thương hiệu thành **AI Artifacts** — một giải pháp đa nền tảng kết nối qua chuẩn mở MCP với nhiều AI client (Codex, Cursor, Claude Code, Windsurf, GitHub Copilot).
  - Tên thư mục `.codex-artifacts` mang tính cục bộ của riêng Codex, gây cảm giác không nhất quán cho người dùng trên các editor khác như Cursor hay Windsurf.
- **Mục tiêu**:
  - Chuyển đổi tên thư mục lưu trữ mặc định sang **`.ai-artifacts`** (`.ai-artifacts/artifacts/<id>/`).
  - **Bảo toàn tính tương thích ngược 100% (Backward Compatibility)**: Toàn bộ artifact cũ nằm trong `.codex-artifacts` vẫn phải được mở, inspect, wait, advance và review bình thường mà không bị lỗi.

### 2. Phương án Kỹ thuật & Kiến trúc (Proposed Solution & Architecture)

```
Workspace Root
├── .ai-artifacts/                  <-- THƯ MỤC MỚI (Mặc định cho các artifact mới)
│   └── artifacts/
│       └── <artifact-id>/
│           ├── artifact.md
│           ├── artifact.json
│           ├── comments.json
│           └── review-submission.json
└── .codex-artifacts/               <-- THƯ MỤC CŨ (Đọc/phục vụ bình thường, không xoá)
    └── artifacts/
        └── <legacy-artifact-id>/
```

1. **Hạ tầng hằng số cốt lõi (`src/shared/artifact-files.ts`)**:
   - `ARTIFACTS_DIRECTORY = ".ai-artifacts"`
   - `LEGACY_ARTIFACTS_DIRECTORY = ".codex-artifacts"`
   - `ARTIFACTS_DIRECTORIES = [".ai-artifacts", ".codex-artifacts"]`
2. **Validation 2 chiều (`src/shared/artifact-validation.ts`)**:
   - Hàm `assertArtifactDirectory` xác thực đường dẫn hợp lệ nếu thư mục artifact khớp với `.ai-artifacts` HOẶC `.codex-artifacts`.
3. **MCP Runtime (`src/integration/artifact-review-mcp-v4.ts`)**:
   - Tạo mới (`create_artifact`): Luôn tạo trong `.ai-artifacts/artifacts/<id>/`.
   - Vòng đời (`wait_for_artifact_review`, `inspect_artifact_review`, `advance_and_wait_for_artifact`): Tiếp nhận `artifactDirectory` trực tiếp từ client/handle, xác thực qua `assertArtifactDirectory` nên tương thích tự nhiên với cả hai đường dẫn.
4. **Extension Host & Custom Editor (`package.json`, `src/extension/extension.ts`)**:
   - `package.json`: Đăng ký Custom Editor selector nhận diện cả 2 pattern:
     - `**/.ai-artifacts/artifacts/**/artifact.md`
     - `**/.codex-artifacts/artifacts/**/artifact.md`
   - `src/extension/extension.ts`: Lắng nghe sự kiện tạo `comments.json` qua glob pattern `**/{.ai-artifacts,.codex-artifacts}/artifacts/**/comments.json`.

### 3. Lưu ý & Ràng buộc (Notes & Considerations)
- **Không tự ý di chuyển dữ liệu (Zero Data Mutation)**: Không tự động quét hay di chuyển file từ `.codex-artifacts` sang `.ai-artifacts` nhằm tránh rủi ro I/O, khóa file trên Windows hoặc gây xung đột Git không mong muốn cho người dùng.
- **Tính độc lập từng Phase**: Mỗi Phase chỉ can thiệp từ 2–3 file, hoàn thành là build được ngay (`npm run check` & `npm test` luôn xanh).

---

## PHẦN 2: KẾ HOẠCH TRIỂN KHAI THEO PHASE

### Phase 1: Core Constants & Dual-Directory Validation (ĐÃ HOÀN THÀNH)
> [!NOTE]
> - **Trạng thái:** ✅ **Đã hoàn thành**
> - **Các việc đã làm:**
>   - Đổi `ARTIFACTS_DIRECTORY` thành `".ai-artifacts"` và bổ sung `LEGACY_ARTIFACTS_DIRECTORY = ".codex-artifacts"` tại [src/shared/artifact-files.ts](file:///d:/workspace/my-projects/agent-plus/src/shared/artifact-files.ts).
>   - Cập nhật hàm `assertArtifactDirectory` trong [src/shared/artifact-validation.ts](file:///d:/workspace/my-projects/agent-plus/src/shared/artifact-validation.ts) để chấp nhận cả `.ai-artifacts` và `.codex-artifacts`.
>   - Bổ sung test cases xác thực cả 2 thư mục trong [test/artifact-store.test.ts](file:///d:/workspace/my-projects/agent-plus/test/artifact-store.test.ts).
> - **Kết quả đạt được:** Tầng core constants và validation hợp thức hóa song song cả hai thư mục artifact, pass 100% typecheck và test suite.

---

### Phase 2: MCP Server Creation & File Staging (ĐÃ HOÀN THÀNH)
> [!NOTE]
> - **Trạng thái:** ✅ **Đã hoàn thành**
> - **Các việc đã làm:**
>   - [src/integration/artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/agent-plus/src/integration/artifact-review-mcp-v4.ts): Tự động tạo thư mục gốc `.ai-artifacts/artifacts` cho artifact mới thông qua `safeArtifactCollectionRoot`.
>   - [src/integration/stamp-origin.ts](file:///d:/workspace/my-projects/agent-plus/src/integration/stamp-origin.ts): Chuẩn hóa tiền tố file tạm sang `.ai-artifacts-...tmp`.
>   - Re-bundle MCP server `dist/integration/codex-artifacts-review-mcp.mjs`.
> - **Kết quả đạt được:** MCP server tạo mới artifact vào `.ai-artifacts`, đồng thời lifecycle tools (`wait`, `inspect`, `advance`) hoạt động trơn tru cho cả artifact cũ và mới.

---

### Phase 3: Extension Host, Custom Editor & Watchers (ĐÃ HOÀN THÀNH)
> [!NOTE]
> - **Trạng thái:** ✅ **Đã hoàn thành**
> - **Các việc đã làm:**
>   - [package.json](file:///d:/workspace/my-projects/agent-plus/package.json): Bổ sung `**/.ai-artifacts/artifacts/**/artifact.md` vào selector của Custom Editor `agentPlus.artifactReview`.
>   - [src/extension/extension.ts](file:///d:/workspace/my-projects/agent-plus/src/extension/extension.ts): Cập nhật watcher `artifactReadyWatcher` bắt sự kiện `**/{.ai-artifacts,.codex-artifacts}/artifacts/**/comments.json`.
> - **Kết quả đạt được:** VS Code Custom Editor tự động nhận diện và mở giao diện Review Webview cho cả file cũ `.codex-artifacts` và file mới `.ai-artifacts`.

---

### Phase 4: Skill Contract, Test Suite & Documentation (ĐÃ HOÀN THÀNH)
> [!NOTE]
> - **Trạng thái:** ✅ **Đã hoàn thành**
> - **Các việc đã làm:**
>   - Cập nhật sơ đồ thư mục chuẩn sang `.ai-artifacts/artifacts/<id>/` trong [skills/create-review-artifact/references/artifact-contract.md](file:///d:/workspace/my-projects/agent-plus/skills/create-review-artifact/references/artifact-contract.md).
>   - Bổ sung unit/integration tests kiểm thử toàn diện tương thích ngược cho legacy `.codex-artifacts` trong [test/artifact-store.test.ts](file:///d:/workspace/my-projects/agent-plus/test/artifact-store.test.ts) và [test/review-wait-mcp.test.ts](file:///d:/workspace/my-projects/agent-plus/test/review-wait-mcp.test.ts).
>   - Đồng bộ tài liệu và cấu hình đóng gói: [README.md](file:///d:/workspace/my-projects/agent-plus/README.md), [CHANGE_LOGS.md](file:///d:/workspace/my-projects/agent-plus/CHANGE_LOGS.md), [docs/CHANGE_LOGS.md](file:///d:/workspace/my-projects/agent-plus/docs/CHANGE_LOGS.md), [docs/ARCHITECTURE.md](file:///d:/workspace/my-projects/agent-plus/docs/ARCHITECTURE.md), [docs/COMPONENTS.md](file:///d:/workspace/my-projects/agent-plus/docs/COMPONENTS.md), [.gitignore](file:///d:/workspace/my-projects/agent-plus/.gitignore), và [.vscodeignore](file:///d:/workspace/my-projects/agent-plus/.vscodeignore).
> - **Kết quả đạt được:** Hệ thống và tài liệu hoàn toàn tương thích và ổn định với `.ai-artifacts`, pass 100% 90 unit/integration tests và production build.
