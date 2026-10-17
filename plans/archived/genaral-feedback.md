# General Feedback — Tóm tắt phân tích đã chốt

## Mục tiêu

- **General feedback** là một comment áp dụng cho toàn bộ artifact.
- Đây không phải overall review note, collection mới hay lifecycle riêng.
- Tài liệu này là source analysis cho implementation plan; tính năng chưa được triển khai.

## UX

- Thêm outline button **General feedback** cạnh **View comments**.
- Button mở lại comment composer/popover hiện có.
- Vùng selected text hiển thị virtual text cố định: `Applies to the entire artifact`.
- Comment được hiển thị trong Comments drawer cùng inline comments, được tính vào comment/review count và được gửi cho AI trong cùng review submission.
- Click vào general feedback không jump tới Markdown selection; có thể focus lại nút hoặc đầu artifact.

## Comment action và dữ liệu

General feedback dùng đúng action của comment thông thường:

```text
addComment
  -> ArtifactStore.addComment()
  -> comments[]
  -> comments.json
  -> Comments drawer
  -> Review submission
```

Không tạo action, file hay collection riêng cho general feedback.

Comment vẫn giữ shape `ReviewComment`, nhưng target một reserved virtual block:

- `block.id`: `__artifact_root__`
- `block.type`: `artifact`
- `selection.quote`: `Applies to the entire artifact`
- `selection.start`: `0`
- `selection.end`: độ dài của virtual text
- `selection.prefix` và `selection.suffix`: chuỗi rỗng

Không dùng `start: 0, end: 0` vì đó là zero-length range. Khác biệt so với inline comment chỉ nằm ở cách tạo và resolve target; phần append, persist, render list và submit review vẫn dùng lại flow hiện tại.

## Virtual block và DOM

- Virtual block không nằm trong parsed Markdown blocks hoặc `state.blocks`.
- Không render block này vào DOM và không gắn ID của nó lên root `<article>`.
- Inline annotation renderer phải bỏ qua comment có `block.type === "artifact"`.
- Vì không có DOM range tương ứng, general feedback không highlight hoặc đổi style toàn bộ artifact.

Extension Host/Store nhận biết reserved block ID và canonicalize block type, virtual text cùng offsets trước khi lưu; webview không được gửi tùy ý virtual target.

## Phạm vi thay đổi

- `ReviewApp`: button và mở comment composer với virtual selection.
- Shared schema: cho phép semantic block type `artifact` nếu enum hiện tại là strict.
- `ArtifactStore.addComment()`: resolve reserved virtual block rồi tiếp tục flow lưu comment hiện có.
- Comments drawer: render comment bình thường nhưng dùng navigation behavior riêng.
- Inline annotations và tests: bỏ qua virtual target, bảo đảm inline-comment behavior không đổi.

Đây là thay đổi nhỏ và tương đối cô lập vì không tạo lifecycle mới. Tuy nhiên nó không chỉ là thay đổi CSS: persisted contract cần nhận diện target `artifact` một cách có kiểm soát.

## Acceptance criteria

1. General feedback được tạo bằng cùng `addComment` flow với inline comment.
2. Comment xuất hiện trong Comments drawer và được tính vào review count.
3. Chỉ có general feedback cũng đủ để enable Review và feedback được trả cho AI.
4. Không tạo DOM selection, inline highlight hoặc style trên toàn artifact.
5. Existing inline-comment behavior và persisted comments cũ vẫn hoạt động như trước.
