# Codex Plan Artifacts — MVP

## Mục tiêu

Tạo VS Code extension cho phép Codex ghi một plan Markdown thành artifact, mở plan bằng review view dễ đọc, chọn text trong từng block để comment, rồi gửi toàn bộ review về đúng Codex chat đã tạo plan.

## Phạm vi MVP

1. Artifact được lưu trong `.codex-artifacts/plans/<artifact-id>/` với ba file:
   - `artifact.json`: danh tính, lifecycle và origin Codex thread.
   - `plan.md`: nội dung plan.
   - `comments.json`: comment riêng của đúng revision này.
2. Custom editor render `plan.md` thành review view.
3. Chỉ cho phép chọn text trong cùng một paragraph, heading, list item, quote hoặc code block.
4. Comment một cấp; có thể thêm và xóa trước khi gửi.
5. `Send review`:
   - Validate artifact và comment.
   - Resume `origin.threadId` qua Codex App Server.
   - Gửi một turn mới chứa đường dẫn plan, file comment và nội dung review.
   - Nếu origin chat đang process/giữ active writer: báo lỗi retryable; không queue và không gửi sang chat khác.
6. Lifecycle:
   - `operation: create` tạo một plan độc lập.
   - `operation: replace` tạo revision mới; chỉ xóa revision cũ sau khi revision mới đã được validate.
   - Mỗi revision mới bắt đầu review lifecycle mới, không giữ trạng thái outdated/resolve/history.

## Thiết kế kỹ thuật

- VS Code extension host: TypeScript, build bằng esbuild.
- Shared contract: TypeScript + Zod runtime validation cho artifact/comment/message.
- Review UI: React + Vite; webview có CSP và renderer kiểm soát để không thực thi HTML từ Markdown.
- Persistence: ghi `comments.json` atomic bằng temporary file + rename.
- Origin binding: Codex lifecycle hook đóng dấu `session_id`/`turn_id` vào artifact mới tạo; MVP dùng `session_id` làm App Server thread id và báo lỗi rõ nếu client/runtime không tương thích.
- Codex transport: JSONL client chạy `codex app-server`, dùng `initialize`, `thread/resume`, `turn/start` và giữ process sống trong extension host.
- Tests: Vitest cho parser, schema/store, prompt và App Server protocol/error mapping.

## Trình tự triển khai

1. Dựng extension manifest, schema và Markdown block parser.
2. Xây custom plan review view, selection validation và comment editor.
3. Lưu comment theo artifact và triển khai Send Review.
4. Thêm origin-stamping hook và tài liệu để Codex tạo `create`/`replace` artifact đúng contract.
5. Bundle `create-plan-artifact` trong extension, cài skill và hook ở user scope, rồi xác minh hook đã được trust qua App Server `hooks/list`.
6. Đóng gói `.vsix`, test, type-check và chạy Extension Host smoke test nếu môi trường cho phép.

## Ngoài MVP / backlog

- `Attach to Codex composer`: thêm review vào ô soạn thảo native rồi để người dùng bấm Send. API hiện chỉ thêm được vào chat đang mở, chưa target một origin thread bất kỳ.
- `Proceed`: xác nhận plan đã chốt và lập tức gửi turn yêu cầu triển khai plan.
- `Copy plan`: copy Markdown thuần.
- Threaded comments, resolve/outdated, task/checklist/progress và revision history UI.

## Tiêu chí hoàn thành

- Mở đúng `plan.md` bằng Plan Review.
- Selection xuyên hai block bị từ chối; selection trong một block tạo comment được.
- Reload view vẫn đọc đúng comments từ file riêng.
- Send Review gửi đúng origin thread khi idle.
- Busy/active-writer không làm mất comment, hiển thị lỗi và nút Send có thể bấm lại.
- Không có fallback tạo chat mới.
