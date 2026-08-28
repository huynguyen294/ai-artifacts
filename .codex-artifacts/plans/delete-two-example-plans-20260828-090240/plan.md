# Kế hoạch mẫu: xóa hai plan artifact cũ

## Mục tiêu

Xóa đúng hai plan artifact cũ đang nằm trong `.codex-artifacts/plans` và giữ nguyên artifact dùng để review kế hoạch này.

## Phạm vi xóa

- `.codex-artifacts/plans/example-plan-empty-state-20260828-085547`
- `.codex-artifacts/plans/example-plan-empty-state-20260828-085824`

Không xóa `.codex-artifacts/plans/delete-two-example-plans-20260828-090240` hoặc bất kỳ plan nào khác xuất hiện sau khi kế hoạch được tạo.

## Cách thực hiện

1. Liệt kê lại thư mục `.codex-artifacts/plans` ngay trước khi xóa.
2. Xác nhận hai đường dẫn mục tiêu tồn tại, là thư mục trực tiếp bên dưới `.codex-artifacts/plans`, và tên khớp chính xác với phạm vi trên.
3. Ghi nhận các file hiện có trong từng mục tiêu để có thể báo cáo rõ nội dung bị xóa.
4. Xóa đệ quy từng thư mục bằng đường dẫn tuyệt đối đã xác minh, không dùng wildcard hoặc biến đường dẫn chưa được kiểm tra.
5. Liệt kê lại thư mục cha để xác nhận hai mục tiêu đã biến mất và artifact review hiện tại vẫn còn.

## Rủi ro và biện pháp giảm thiểu

- Việc xóa là không thể hoàn tác bằng ứng dụng. Chỉ thực hiện sau khi kế hoạch được duyệt.
- Đường dẫn sai có thể ảnh hưởng artifact khác. Dùng tên chính xác, `LiteralPath` và kiểm tra đường dẫn tuyệt đối trước khi xóa.
- Một plan mới có thể xuất hiện trong lúc review. Không mở rộng phạm vi sang bất kỳ thư mục nào ngoài hai mục tiêu đã nêu.

## Xác minh

- Hai thư mục mục tiêu không còn tồn tại.
- Artifact `delete-two-example-plans-20260828-090240` vẫn tồn tại cùng manifest, nội dung plan và dữ liệu review của nó.
- Không có thư mục nào khác trong `.codex-artifacts/plans` bị thay đổi.

## Kết quả bàn giao

Báo cáo hai đường dẫn đã xóa, các file chính từng có trong đó và xác nhận thao tác không thể phục hồi trực tiếp từ workspace.
