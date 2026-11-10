# Ý tưởng: Cập nhật artifact không chờ review

- **Mục tiêu:** Cho phép agent cập nhật artifact trong lúc tiếp tục công việc, ví dụ tick checklist hoặc ghi tiến độ đã được cho phép, mà không phải dừng chờ người dùng duyệt sau mỗi lần cập nhật.
- **Hiện trạng:** `create_artifact` trả về ngay ở mức tool; `advance_and_wait_for_artifact` hiện gắn commit round mới với việc chờ review. Skill vẫn yêu cầu wait ngay sau create.
- **Hướng đề xuất:** Thêm `noWait?: boolean` vào `advance_and_wait_for_artifact`, mặc định `false`. Giữ nguyên tên tool và luồng review mặc định.
- **Khi `noWait: true`:** Dùng nguyên cơ chế xác thực và transaction hiện có để cập nhật Markdown, tăng round, reset feedback đã xử lý và consume token; sau commit thì trả về ngay, không tạo waiter.
- **Kết quả trả về:** Có handle, round mới, hash, link và `waited: false`; không có `decision`, `comments` hoặc `nextAction`. Đây là xác nhận commit, không phải approval hay quyền thực thi kế hoạch.
- **Token và state:** Giữ nguyên tính dùng một lần, ràng buộc hash/state, rollback và chống replay. Bảo toàn các nguồn token hiện có: `chat-update`, `chat-inspection`, `submitted-review`. Kiểm tra `noWait` đúng kiểu boolean.
- **Luồng cập nhật round trống:** Inspect đúng handle với `intent: "explicit-chat-update"`, round hiện tại và takeover khi cập nhật đã được cho phép; dùng token trả về để advance với Markdown mới và `noWait: true`.
- **Khi có comment/submission:** Không ép dùng `explicit-chat-update` vì intent này hiện chỉ chấp nhận round trống. Xử lý feedback hoặc trạng thái đã submit theo flow hiện hữu trước khi cập nhật tiếp; không bỏ guard hay xoá feedback để lấy token.
- **Quyền cập nhật:** Chỉ dùng luồng không chờ khi yêu cầu của người dùng hoặc Instructions đã cho phép. Việc tham gia Work Session tự nó không cấp quyền tạo hoặc cập nhật tracker.
- **Điểm cần chốt về sản phẩm:** Skill hiện cấm task tracker/progress report. Nếu giữ use case này, cần xác định ngoại lệ phù hợp và quy tắc bỏ wait sau create trong phạm vi đã được cho phép.
- **Đồng bộ contract:** Cập nhật schema, handler, tool descriptions/runtime instructions, artifact skill/contract và Session skill để phân biệt commit không chờ với review mặc định.
- **UI:** Watcher hiện có là cơ sở để nhận nội dung mới mà chưa cần sửa Extension/Webview; cần kiểm tra hiển thị thực tế trước khi khẳng định runtime.
- **Kiểm chứng trọng tâm:** Hai lần cập nhật không chờ liên tiếp; chờ review lại ở round mới; mặc định vẫn wait; token consume đúng và không để lại waiter.
- **Đánh đổi và trạng thái:** Giữ tên tool giúp tránh thay đổi cấu hình client, nhưng tên vẫn chứa “and_wait” nên mô tả phải rõ ngoại lệ. Đây là ý tưởng đề xuất, chưa phải quyết định triển khai.
