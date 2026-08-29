# Example plan: Luồng Artifact Review mẫu

## Mục tiêu

Tạo một luồng demo lặp lại được để contributor có thể sinh, mở và review một artifact schema-v3 trong Extension Development Host mà không phải chuẩn bị file thủ công.

## Phạm vi

- Thêm một command chỉ dùng trong môi trường development để tạo artifact mẫu dưới `.codex-artifacts/artifacts/`.
- Artifact mẫu gồm heading, paragraph, danh sách, quote và code block để kiểm tra các loại block có thể gắn comment.
- Mở artifact vừa tạo bằng custom editor `agentPlus.artifactReview`.
- Bổ sung hướng dẫn chạy demo và dọn dữ liệu phát sinh trong tài liệu phát triển.
- Không thay đổi hành vi của luồng review production hoặc đưa dữ liệu demo vào extension package.

## Kế hoạch triển khai

1. Rà soát command registration trong `src/extension/extension.ts`, logic lưu artifact và các shared contract hiện có để xác định phần có thể tái sử dụng.
2. Định nghĩa Markdown mẫu cố định, bao phủ toàn bộ loại block mà `src/shared/markdown-blocks.ts` hỗ trợ.
3. Thêm command development tạo artifact ID duy nhất, manifest schema-v3 hợp lệ và Markdown mẫu trong workspace hiện tại.
4. Tái sử dụng validator và quy tắc an toàn đường dẫn hiện có; không sao chép riêng các giả định về schema vào command demo.
5. Sau khi tạo thành công, mở `artifact.md` bằng custom editor Artifact Review và hiển thị lỗi rõ ràng nếu không có workspace hợp lệ.
6. Thêm test cho manifest, xử lý trùng ID, giới hạn workspace và thao tác mở editor.
7. Cập nhật README với cách chạy demo, review các decision và xóa state được tạo.

## Kiểm thử

- Chạy `npm test` để xác nhận test mới và regression suite đều đạt.
- Chạy `npm run build` để kiểm tra bundle extension, webview và integration.
- Mở Extension Development Host, chạy command demo và xác nhận artifact mở trong Artifact Review.
- Gắn comment vào nhiều loại Markdown block; xác nhận Review cập nhật đúng artifact, còn Proceed và Just save trả đúng decision.

## Rủi ro và giảm thiểu

- Command demo có thể lệch khỏi schema production. Giảm thiểu bằng cách dùng chung contract, validator và helper ghi file.
- Artifact mẫu có thể làm bẩn repository. Chỉ ghi dưới `.codex-artifacts/` và ghi rõ đây là operational state không commit.
- ID cố định có thể ghi đè review cũ. Sinh ID filesystem-safe duy nhất và fail closed khi gặp collision.
- Command development có thể vô tình xuất hiện trong bản phát hành. Bao command bằng điều kiện development rõ ràng và kiểm tra output package.

## Tiêu chí hoàn thành

- Contributor có thể tạo và mở artifact mẫu từ một command đã được tài liệu hóa.
- Tài liệu mẫu bao phủ mọi loại block comment được hỗ trợ.
- Không ghi đè artifact có sẵn và không ghi ra ngoài workspace đã xác minh.
- Type check, test và build đều thành công.
- Luồng review production hiện tại không thay đổi.
