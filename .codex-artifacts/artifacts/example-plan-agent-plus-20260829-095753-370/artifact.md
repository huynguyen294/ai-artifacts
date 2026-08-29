# Example plan for Agent Plus

## Mục tiêu

Tạo một thay đổi mẫu nhỏ trong Agent Plus để minh họa đầy đủ quy trình: lập plan, nhận phản hồi trực tiếp trên artifact, chỉnh sửa plan nếu cần, rồi mới bắt đầu triển khai.

## Phạm vi mẫu

- Thêm một tài liệu hướng dẫn ngắn giải thích cách tạo và review artifact.
- Bổ sung một ví dụ prompt để người dùng có thể thử luồng Review, Proceed và Just save.
- Không thay đổi hành vi runtime, cấu hình phát hành hoặc dữ liệu người dùng.

## Các bước dự kiến

1. Kiểm tra README và tài liệu hiện có để tránh lặp nội dung.
2. Xác định vị trí phù hợp cho hướng dẫn và prompt mẫu.
3. Viết nội dung ngắn gọn, dùng đúng thuật ngữ đang xuất hiện trong giao diện Agent Plus.
4. Kiểm tra các đường dẫn, lệnh và tên nút được nhắc đến trong tài liệu.
5. Chạy các kiểm tra tài liệu hoặc kiểm tra dự án sẵn có, nếu có.

## Tiêu chí hoàn thành

- Người mới có thể tạo một artifact review từ prompt mẫu mà không cần đoán thêm bước.
- Tài liệu phân biệt rõ Review, Proceed và Just save.
- Không có liên kết nội bộ hoặc lệnh mẫu bị sai.
- Thay đổi chỉ nằm trong phạm vi tài liệu đã nêu.

## Rủi ro và cách giảm thiểu

- Nội dung có thể lệch với giao diện hiện tại: đối chiếu trực tiếp tên lệnh và nút trong source trước khi viết.
- Ví dụ có thể quá dài: giữ một luồng tối thiểu, đưa chi tiết nâng cao sang tài liệu tham khảo.
- Tài liệu có thể trùng README: ưu tiên cập nhật phần phù hợp thay vì tạo thêm tệp không cần thiết.

## Xác minh

- Đọc lại artifact ở chế độ rendered Markdown.
- Thử prompt mẫu trong một chat mới có tích hợp Codex Artifacts.
- Xác nhận artifact mở đúng workspace và nhận được quyết định review.

## Ngoài phạm vi

- Không triển khai tính năng mới cho extension.
- Không thay đổi schema artifact hoặc giao thức MCP.
- Không đóng gói hay phát hành VSIX mới.
