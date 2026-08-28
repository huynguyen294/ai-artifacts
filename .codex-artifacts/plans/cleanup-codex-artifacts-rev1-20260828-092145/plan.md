# Dọn sạch dữ liệu thử nghiệm trong `.codex-artifacts`

## Mục tiêu

Loại bỏ các artifact thử nghiệm hoặc đã nghỉ hưu trong repo `agent-plus` mà không ảnh hưởng plan đang review.

## Phạm vi

- Kiểm kê các thư mục trong `.codex-artifacts/plans` và `.codex-artifacts/.trash`.
- Chỉ xóa artifact được xác định rõ là dữ liệu thử nghiệm, bản thay thế đã nghỉ hưu hoặc dữ liệu không còn tham chiếu.
- Giữ nguyên revision đang review cho đến khi lifecycle hiện tại kết thúc.
- Không sửa `artifact.json`, `comments.json` hoặc `review-submission.json` của artifact còn hiệu lực.
- Không đụng đến integration toàn cục trong `~/.codex` hoặc `~/.agents`.

## Cách thực hiện

Trước tiên, đọc manifest của từng artifact và phân loại theo trạng thái: đang hoạt động, đã được thay thế, đã gửi review hoặc không hợp lệ. Lập danh sách đường dẫn sẽ bị xóa để kiểm tra trước khi thay đổi filesystem.

Sau khi xác nhận danh sách, xóa các artifact thử nghiệm đã nghỉ hưu trong `.trash` và các artifact mồ côi không còn cần thiết. Artifact của plan này chỉ được dọn ở một lifecycle sau, không tự xóa trong lúc đang review.

## An toàn dữ liệu

- Không dùng lệnh xóa đệ quy với đường dẫn động hoặc chưa được kiểm chứng.
- Mọi target phải resolve bên trong `D:\workspace\my-projects\agent-plus\.codex-artifacts`.
- Nếu không xác định chắc trạng thái của một artifact, giữ lại và báo cáo thay vì xóa.
- Ghi lại danh sách đã xóa và cho biết khả năng khôi phục sau khi hoàn tất.

## Kiểm chứng

- Xác nhận `.codex-artifacts/plans` chỉ còn các artifact đang hoạt động hoặc cần giữ.
- Xác nhận không còn dữ liệu thử nghiệm đã chọn trong `.codex-artifacts/.trash`.
- Xác nhận plan đang review vẫn mở được và manifest còn hợp lệ.
- Chạy `npm run check` để bảo đảm việc dọn dữ liệu không ảnh hưởng mã nguồn.
- Kiểm tra `git status` để xác nhận không có file ngoài phạm vi bị thay đổi.

## Tiêu chí hoàn thành

Các artifact thử nghiệm đã chọn được dọn sạch, artifact đang hoạt động vẫn nguyên vẹn và không có thay đổi ngoài `.codex-artifacts`.
