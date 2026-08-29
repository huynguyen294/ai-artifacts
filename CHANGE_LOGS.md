# Change Logs

Tất cả các thay đổi quan trọng của dự án **Codex Artifacts** (`agent-plus`) sẽ được ghi nhận tại tài liệu này.

Lịch sử phát hành được chuẩn hóa và bắt đầu ghi nhận lại từ phiên bản **0.2.6**. Các gói build mang số phiên bản thấp hơn không được xem là một phần của changelog chính thức này.

---

## [0.5.0] - 2026-08-29

### Markdown viewer

- Thay renderer thủ công bằng `react-markdown`, `remark-gfm` và remark AST có source positions dùng chung với comment blocks.
- Hỗ trợ nested list, task list, table, link, inline formatting, fenced code và Mermaid.
- Dùng Shiki fine-grained bundle cho syntax highlighting; Shiki và Mermaid chỉ tải khi artifact cần đến.
- Tự động theo theme light, dark và high contrast của VS Code.

### Contextual review

- Hiển thị comment composer bằng Floating UI popover ngay cạnh vùng chọn.
- Thay sidebar cố định bằng comments drawer có thể ẩn, điều hướng từ comment về đúng highlight.
- Nút `Review (N)` hiển thị số comment và trở thành primary khi có feedback; `Proceed` luôn primary trong toàn bộ vòng review.
- Không còn báo nhầm cross-block khi selection kết thúc tại offset đầu tiên của block kế tiếp hoặc khi click comment highlight.
- Giảm shadow/backdrop của document, popover và drawer để giao diện phẳng, sát VS Code hơn.
- Giảm padding hai lớp của workspace/document và compact popover/drawer để tăng diện tích đọc.
- Chuyển `Comments (N)` khỏi lifecycle control bar xuống utility bar riêng ngay bên dưới.
- Đổi utility action thành icon + `View comments` + count badge, kèm trạng thái drawer cho accessibility.
- Giữ nguyên inline Markdown khi highlight comment thay vì biến cả block thành plain text.

### Security và verification

- Tắt raw HTML/MDX execution, chặn unsafe URL và remote image, mở external link qua VS Code host.
- Giữ nonce-based CSP; Shiki render token bằng React, Mermaid strict SVG chạy trong data-image context.
- Bổ sung regression tests cho legacy block IDs, GFM/source positions, action state, URL policy, raw HTML và annotation qua inline markup.

## [0.4.3] - 2026-08-29

- Không còn xem Codex cwd, `environment_context` hoặc workspace folder đầu tiên là folder đang active/được chọn.
- Bắt buộc có tín hiệu UI/path tường minh và kiểm chứng bằng file dự án liên quan; nếu thiếu phải hỏi người dùng trước khi tạo Artifact.
- Chuẩn hóa thứ tự xác định workspace: path/file/attachment trong hội thoại; file có path từ IDE context; repository được nhắc đến và kiểm chứng; cuối cùng hỏi người dùng.

## [0.4.2] - 2026-08-29

- Tự động tạo Artifact Review khi người dùng yêu cầu tạo, xem hoặc cập nhật một plan, kể cả khi không nhắc đến từ "artifact".
- Phân biệt implementation plan (`implementation-plan`) với plan thông thường (`plan`).

## [0.4.1] - 2026-08-29

- Cho phép cập nhật `artifact.md` khi Windows chặn thao tác đổi tên do file đang được mở trong editor.
- Bắt buộc skill xác định workspace từ bằng chứng cụ thể; không chọn theo thứ tự workspace, kết quả tìm kiếm đầu tiên hoặc chỉ dựa vào cwd.
- Thêm regression test cho fallback cập nhật file đang mở trên Windows.

## [0.4.0] - 2026-08-28

### Breaking changes

- Chuyển sang `schemaVersion: 3` và cấu trúc `.codex-artifacts/artifacts/<id>/artifact.md`.
- Một request giữ cùng artifact ID qua nhiều review round; Review cập nhật cùng file thay vì tạo replacement artifact.
- Bỏ runtime `operation: replace`, `replacesArtifactId` và `.trash` cho artifact mới.
- Đổi skill thành `create-review-artifact` và MCP tools thành `wait_for_artifact_review`/`update_artifact`.
- Không tự migrate review schema v2 đang tồn tại.

### Artifact lifecycle

- Thêm `reviewRound`, `updatedAt` và round-aware bindings cho comments/submission.
- MCP cấp update token dùng một lần và commit Markdown/manifest/comments theo transaction có rollback.
- Review reset comments/submission trên cùng artifact; Proceed và Just save kết thúc lifecycle.

### Extension và skill

- Generic hóa Plan Review thành Artifact Review và hỗ trợ `kind` tổng quát.
- Chặn lifecycle actions khi có comment draft chưa lưu.
- Chỉ auto-trigger implementation plan; các artifact kind khác yêu cầu explicit user request.
- Installer thay skill cũ ở user scope và verify bộ asset mới.

### Verification

- Thêm regression test nhiều review round trên cùng directory/ID và token không reuse được.
- Cập nhật hook, store, MCP, multi-root và invalid-binding tests cho schema v3.

## [0.3.0] - 2026-08-28

### Breaking changes
- Chuyển toàn bộ artifact protocol sang `schemaVersion: 2`; artifact phiên bản 1 không còn được hỗ trợ hoặc tự động migrate.
- Tách `location.workspaceRoot` khỏi `origin.codexCwd`, cho phép Codex tạo và review artifact trong bất kỳ root phù hợp của multi-root workspace.
- Chuẩn hóa việc tạo `artifact.json` và `plan.md` bằng một lần `apply_patch`; Hook xác minh exact path từ patch thay vì scan theo Codex `cwd`.
- Hook chỉ xử lý `apply_patch`; MCP và replacement lifecycle xác minh artifact luôn thuộc workspace root đã khai báo.

### Build & integration
- Skill yêu cầu Codex chọn target root theo context và hỏi người dùng khi mơ hồ.
- Cài đặt, verify và legacy cleanup xử lý toàn bộ workspace roots đang mở thay vì root đầu tiên.

---

## [0.2.7] - 2026-08-28

### 🐛 Sửa lỗi
- Bỏ thông báo `Plan saved` ngay sau khi chọn **Just save**, vì ở thời điểm đó Codex chưa nhận vị trí đích và chưa tạo bản sao kế hoạch.
- Siết validation của MCP khi nhận submission: đọc lại và kiểm tra `schemaVersion`, `artifactId`, plan hash, cấu trúc comments và từng comment hiện tại trước khi trả quyết định về Codex.
- Sửa màu icon copy Markdown: dấu tích sau khi copy dùng màu thành công; màu lỗi đỏ chỉ còn áp dụng cho nút xóa comment.

### 📚 Contract & tài liệu
- Đồng bộ đầy đủ ba quyết định `revise`, `approve`, `save` trong MCP metadata, skill contract, README và tài liệu kiến trúc.
- Cập nhật hướng dẫn cho các nút **Review**, **Proceed** và **Just save** theo đúng hành vi runtime.
- Ghi nhận việc ngăn submit khi comment draft chưa được lưu vào `TODO.md`; hành vi này chưa được thay đổi trong phiên bản này.

### ✅ Kiểm thử
- Bổ sung regression test cho trường hợp `comments.json` bị thay đổi sai schema trong khi MCP đang chờ, kể cả khi submission chứa hash khớp với nội dung sai đó.

---

## [0.2.6] - 2026-08-28

### 🚀 Tính năng & Giao diện mới (Topbar UI)
- **Nút "Proceed"** *(Primary màu xanh, ngoài cùng bên phải)*:
  - Cho phép người dùng duyệt và yêu cầu Codex tiến hành thực thi kế hoạch ngay lập tức.
  - Luôn được kích hoạt (enabled) cả khi có hoặc không có comment. Nếu có để lại comment, Codex sẽ đọc và kết hợp áp dụng ngay trong quá trình code.
- **Nút "Review"** *(Thay thế cho label "Request revision")*:
  - Kích hoạt khi có ít nhất 1 comment trên tài liệu.
  - Gửi toàn bộ danh sách góp ý về cho Codex để viết lại bản kế hoạch mới.
- **Nút "Just save"** *(Style Ghost đồng bộ)*:
  - Cho phép lưu lại kế hoạch mà không tiến hành code.
  - Gửi quyết định `decision: "save"` để Codex hỏi vị trí lưu file trong workspace và dừng lại.
- **Nút Icon Copy Markdown**:
  - Tích hợp icon clipboard trên thanh Topbar giúp sao chép nhanh toàn văn Markdown gốc vào Clipboard.
  - Hiển thị hiệu ứng tích xanh ✓ trong 2 giây khi copy thành công.

### 🐛 Sửa lỗi & Nâng cấp hệ thống (Core & MCP)
- **Sửa lỗi xác thực Hash trong MCP Server (`review-wait-mcp.mjs`)**:
  - Khắc phục lỗi `"The plan or comments changed after review submission"` khi người dùng thêm comment trong quá trình mở review.
  - Cập nhật hàm `readValidatedSubmission` để đọc và tính toán mã băm SHA256 trực tiếp từ file `comments.json` và `plan.md` trên đĩa tại thời điểm submit.
- **Mở rộng Contracts & Schema (`contracts.ts`)**:
  - Bổ sung giá trị `"save"` vào `reviewDecisionSchema`: `z.enum(["revise", "approve", "save"])`.
  - Bổ sung trường `markdown: string` vào `ReviewState` để webview truy cập trực tiếp nội dung Markdown raw.
- **Nới lỏng ràng buộc Comment (`artifact-store.ts`, `review-wait-mcp.mjs`)**:
  - Bỏ kiểm tra bắt buộc xóa hết comment khi duyệt (`approve`/Proceed) và khi chỉ lưu (`save`).
- **Cập nhật Codex Skill (`create-plan-artifact`)**:
  - Hướng dẫn AI xử lý chi tiết cho cả 3 kịch bản: `revise`, `approve` (Proceed), và `save`.
