# Installer Antigravity — 2 phase

## Mục tiêu và lựa chọn triển khai

Chú sẽ có installer Antigravity cài MCP và cả hai skill, có kiểm tra trạng thái, version receipt và uninstall như các client hiện tại.

Tái sử dụng runtime, JSON helper, skill deployment và verification. Độ khó **nhỏ–vừa**, chủ yếu nối thêm skill target vào các luồng dùng chung. Phạm vi hồi quy tập trung ở installer, receipt và cleanup.

Các lựa chọn mặc định:

- MCP config: `~/.gemini/config/mcp_config.json`.
- Skill global: `~/.gemini/config/skills/`.
- Dùng nguyên hai skill và version source chung; thêm target `antigravity` trong receipt.
- Giữ cách khám phá tool mặc định mà Chú đã test thành công; không thêm eager declarations hoặc allowlist.
- Cấu hình `timeoutSeconds: 3600` để hỗ trợ tool chờ review, tương ứng mức hiện có của Codex.
- Global rule do người dùng thêm theo README; installer không chỉnh global rules.

## Phase 1 — Driver và installer hoàn chỉnh

Hướng dẫn chi tiết cho coder: [Phase 1 — Driver và installer Antigravity](./phase-1.md).

**Driver và asset**

- Thêm `AntigravityClientDriver`, ID `antigravity`, triển khai `isDetected`, `check`, `install`, `uninstall` theo interface hiện tại.
- Detector nhận diện khi có MCP config nói trên hoặc thư mục `~/.gemini/antigravity`; không chỉ dựa vào thư mục `.gemini`.
- Cấu hình server `ai_artifacts` dùng runtime chung; giữ các server và cấu hình không liên quan.
- Cài đầy đủ thư mục `create-review-artifact` và `work-session`, bao gồm reference files.
- Tái sử dụng cơ chế bảo toàn customization riêng của review skill; Work Session skill dùng nội dung chính thức.

**Điều phối, command và receipt**

- Đăng ký driver vào danh sách client; thêm command Install/Uninstall Integration for Antigravity và nối vào Install All, Verify All, Uninstall All cùng extension-uninstall.
- Thêm trường optional `antigravity` trong hai map `skills` và `sessionSkills`. Receipt cũ vẫn đọc được; không tạo bộ đếm version riêng.
- Chỉ ghi hai receipt Antigravity sau khi config và cả hai skill được verify thành công; bảo toàn receipt của target khác.
- Uninstall chỉ gỡ MCP entry và hai skill của mình; cleanup không xóa artifact/session hoặc global rule của người dùng.

**Chú review được:** installer thực sự dùng được qua command, trạng thái verification, receipt sau cài đặt và kết quả uninstall; kèm diff và test tập trung.

## Phase 2 — Nhận diện cập nhật, hướng dẫn và nghiệm thu

Hướng dẫn chi tiết cho coder: [Phase 2 — Notification, README và nghiệm thu Antigravity](./phase-2.md).

- Bổ sung Antigravity vào lựa chọn skill target, phép tính stale assets, nhãn thông báo và fingerprint của luồng upgrade notification hiện tại. Không triển khai auto-upgrade trong feature này.
- Thêm mục riêng cho installer Antigravity trong README: vị trí config/skill, cách cài và kiểm tra.
- README phải nhấn mạnh: **muốn yêu cầu tạo artifact bằng prompt thông thường mà không tag skill, cần global rule ưu tiên `create-review-artifact` của AI Artifacts thay cho workflow artifact mặc định của Antigravity**.
- Hướng dẫn global rule chỉ nằm trong README và là optional: cung cấp code block tiếng Anh để tạo `~/.gemini/config/rules/ai-artifacts.md`, hoặc dán phần nội dung vào `~/.gemini/GEMINI.md` không kèm frontmatter. Installer không ghi hoặc kiểm tra rule; giữ điều kiện explicit artifact request.
- Bổ sung mẹo approval policy optional trong README; không tự cấp quyền và không mặc định khẳng định tên nút `Always Allow` trên mọi client version.
- Cập nhật tài liệu kiến trúc/instructions bị ảnh hưởng và changelog đúng phạm vi.

**Chú review được:** client mới hoạt động đầy đủ với installer hiện tại, nhận diện skill stale đúng và có hướng dẫn cho cả cách tag skill lẫn prompt thông thường.

## Kiểm chứng và điều kiện hoàn tất

- Test driver: detect, install, reinstall, check và uninstall; bảo toàn server khác, reference files và customization.
- Test receipt: đọc receipt cũ, ghi target mới sau verification, không đánh dấu current khi cài lỗi.
- Test điều phối: command riêng, Install/Verify/Uninstall All và cleanup nhận diện Antigravity; các client hiện tại tiếp tục qua test.
- Test notification: thiếu hoặc lệch một trong hai skill Antigravity tạo đúng stale state; receipt current không báo cập nhật.
- Chạy `npm.cmd run check`, `npm.cmd test`, `npm.cmd run build` và `git diff --check`.
- Smoke test bằng installer mới trong Antigravity: load hai skill, tạo artifact, chờ và nhận feedback, kết nối Work Session. Thử riêng prompt không tag sau khi thêm global rule theo README.
- Phân biệt kết quả test tự động với test client thật; kết quả copy thủ công Chú đã thực hiện là bằng chứng nền, chưa thay thế kiểm chứng installer mới.

Sau mỗi phase bàn giao để Chú review. Không bump package/MCP/skill version, không thêm saved-client list hoặc luồng auto-upgrade trong feature này.
