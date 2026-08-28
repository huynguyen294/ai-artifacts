# Change Logs

Tất cả các thay đổi quan trọng của dự án **Codex Artifacts** (`agent-plus`) sẽ được ghi nhận tại tài liệu này.

Lịch sử phát hành được chuẩn hóa và bắt đầu ghi nhận lại từ phiên bản **0.2.6**. Các gói build mang số phiên bản thấp hơn không được xem là một phần của changelog chính thức này.

---

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
