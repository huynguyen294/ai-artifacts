# Documentation change logs

Tài liệu này ghi lại các thay đổi có ý nghĩa đối với cách dự án hoạt động và cách dự án được mô tả. Mục đích là giúp người duy trì và AI nhanh chóng nhận biết những quyết định nào đã làm thay đổi trạng thái hiện tại của hệ thống, đồng thời giữ code, hành vi và tài liệu nhất quán với nhau.

Các thay đổi cần ghi nhận gồm:

- Hành vi của sản phẩm, extension, MCP, webview hoặc Codex skill.
- Kiến trúc, ownership boundary, lifecycle, data flow, schema hoặc contract.
- Product intent, philosophy, non-goal hoặc ý nghĩa của các quyết định review.
- Quy tắc workspace, filesystem safety, compatibility hoặc migration.
- Nội dung tài liệu và instruction làm thay đổi cách con người hoặc AI hiểu và làm việc với dự án.

Không cần ghi các chỉnh sửa chính tả, format hoặc diễn đạt nhỏ không làm thay đổi ý nghĩa. Release notes theo phiên bản vẫn được lưu trong `CHANGE_LOGS.md` ở root; file này tập trung vào thay đổi hành vi, kiến trúc và tài liệu, kể cả khi thay đổi đó chưa thuộc một bản phát hành.

Mỗi mục mới nên nêu ngày thay đổi, loại thay đổi, nội dung đã đổi, lý do và các file hoặc thành phần bị ảnh hưởng.
