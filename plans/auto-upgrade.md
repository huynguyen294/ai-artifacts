# IDEAS

- Tự động upgrade integration khi extension activate và phát hiện MCP/skill cần cập nhật; bỏ thông báo yêu cầu người dùng bấm `Run Installer`.
- Dùng auto detector hiện có để xác định các client cần xử lý; không lưu thêm danh sách client người dùng đã cài hoặc sử dụng.
- Không detect được client thì hướng người dùng về installer/hướng dẫn cài thủ công. Các lệnh install thủ công vẫn được giữ lại cho setup và sửa cấu hình.
- Tách luồng `upgrade` khỏi `install`: mỗi driver có entry point upgrade riêng, được integration manager gọi rõ ràng.
- Upgrade dùng chung hạ tầng với installer: xác định đường dẫn, đọc version receipt, triển khai asset, bảo toàn customization, ghi file và verify; không gọi lại toàn bộ luồng install.
- Integration manager cập nhật MCP runtime và hai skill dùng chung trong `.agents` một lần; driver xử lý asset riêng của client, như hai skill trong `.claude`.
- Quyết định cập nhật theo version độc lập của MCP, `create-review-artifact` và `work-session`; thay đổi version extension đơn thuần không buộc upgrade integration. Asset đã đúng version thì bỏ qua.
- Mặc định upgrade chỉ cập nhật MCP/skill cần thiết; không ghi lại MCP definition/config, không chạy lại setup hoặc cleanup legacy của luồng install.
- Driver hỗ trợ cập nhật MCP definition khi phiên bản có thay đổi cần thiết cho client đó, ví dụ thêm/đổi tool trong danh sách khai báo. Không có thay đổi definition thì mặc định không làm gì.
- Có thể dùng mốc `MCP_VERSION` để khai báo migration definition trong từng driver; xử lý các mốc nằm trong khoảng version upgrade, kể cả khi người dùng bỏ qua phiên bản trung gian. Chạy lại không ghi config nếu phần cần cập nhật đã đúng.
- Phân biệt danh sách tool được phép sử dụng với approval theo từng tool. Client dùng wildcard như `tools: ["*"]` không cần cập nhật danh sách chỉ vì thêm tool; áp dụng đúng schema của từng client, không dùng lẫn config Copilot CLI với Copilot trong VS Code.
- Chỉ patch phần definition cần thay đổi của AI Artifacts, giữ nguyên các thiết lập khác trong server entry và config người dùng; không dùng thao tác thay toàn bộ server entry cho upgrade.
- Đồng bộ verification với luồng upgrade và definition của từng client. Cần xử lý kiểm tra Codex hiện yêu cầu đủ từng tool trong config, bao gồm `join_session`.
- Giữ cơ chế bảo toàn `description` và `USER CUSTOM RULES` của review skill; Work Session skill được cập nhật bằng nội dung chính thức.
- Verify asset và các thay đổi definition bắt buộc trước khi ghi receipt hoàn tất tương ứng; lỗi một phần không được đánh dấu toàn bộ upgrade đã thành công, và phải còn khả năng retry.
- Upgrade thành công chạy im lặng; thất bại thì báo lỗi có thông tin xử lý. Việc cập nhật file không đồng nghĩa client đang chạy đã nạp bản mới: vẫn cần restart client và mở chat mới theo hướng dẫn sử dụng.
- Đây là ideas cho thay đổi sắp tới, chưa phải mô tả hành vi đã triển khai.
