# Manual Test — Window-routed Artifact Open

## Mục tiêu

Xác minh exact packaged build có thể route create/reconnect tới đúng VS Code window mà không làm thay đổi sai lifecycle của artifact.

Chạy từng case theo thứ tự. Sau mỗi case, ghi `PASS`, `FAIL` hoặc `N/A` kèm evidence. Nếu một case fail, dừng matrix và chẩn đoán trên đúng installed build trước khi tiếp tục.

## Thông tin build được kiểm tra

- Package path:
- Extension version:
- MCP version:
- Source commit/build identifier:
- VSIX SHA-256:
- Ngày kiểm tra:
- AI client:

> Không dùng VSIX cũ nếu source, runtime, skill hoặc webview đã thay đổi sau khi package được tạo. Khi đó phải chạy lại full gates, rebuild, reinstall integrations và restart AI client.

## A. Chuẩn bị bản cài

1. Mở Command Palette trong VS Code.
2. Chạy **Extensions: Install from VSIX...**.
3. Chọn đúng VSIX có path và SHA-256 được ghi ở trên.
4. Reload tất cả cửa sổ VS Code đang mở.
5. Chạy **AI Artifacts: Install All Detected Integrations**.
6. Chạy **AI Artifacts: Verify All Integrations**.
7. Xác nhận các integration cần dùng ở trạng thái ready.
8. Đóng hoàn toàn AI client đang dùng.
9. Khởi động lại AI client và mở chat mới để không dùng process hoặc tool schema cũ còn cache.
10. Bật setting **AI Artifacts: Auto Open Artifact Review**.
11. Chuẩn bị hai workspace khác nhau, ví dụ:
    - Window A: `agent-plus`.
    - Window B: `script-runner`.
12. Sau mỗi lần mở hoặc reload window, chờ khoảng 5–10 giây để workspace registry cập nhật.

Với mỗi artifact được tạo, giữ lại exact `artifactDirectory` do AI trả về. Không chọn artifact theo recency và không tự sửa lifecycle files.

## Case 1 — Hai windows khác folder

### Thao tác

1. Mở Window A với `agent-plus`.
2. Mở Window B với `script-runner`.
3. Đảm bảo auto-open đang bật.
4. Mở chat mới và gửi:

   > Hãy tạo một review artifact ngắn tên “MW-01” cho workspace agent-plus, gồm tiêu đề và một checklist mẫu.

5. Chờ artifact được tạo và ghi lại exact `artifactDirectory`.

### PASS khi

- Chỉ Window A tự mở tab `Artifact Review`.
- Window B không mở artifact.
- Window B không hiện lỗi liên quan đến artifact của Window A.
- AI trả về exact artifact link/directory.

### Kết quả

- Trạng thái: `PENDING`
- Artifact directory:
- Evidence/notes:

## Case 2 — Hai windows cùng repo, có focus hint

### Thao tác

1. Mở `agent-plus` trong hai cửa sổ VS Code riêng biệt.
2. Gọi chúng là Window 1 và Window 2.
3. Focus Window 1 và chờ vài giây để trạng thái được publish.
4. Gửi:

   > Hãy tạo review artifact “MW-02” cho agent-plus trong cửa sổ VS Code đang focus.

5. Không chuyển focus sang Window 2 trong lúc tạo.

### PASS khi

- Chỉ Window 1 mở artifact.
- Window 2 hoàn toàn im lặng.
- AI không hỏi chọn window nếu focused candidate được xác định rõ từ yêu cầu.

### Kết quả

- Trạng thái: `PENDING`
- Artifact directory:
- Evidence/notes:

## Case 3 — Hai windows cùng repo nhưng thiếu evidence

### Thao tác

1. Giữ hai windows cùng mở `agent-plus`.
2. Không nhắc tới Window 1, Window 2 hoặc window đang focus.
3. Gửi:

   > Hãy tạo review artifact “MW-03” cho workspace agent-plus.

4. Quan sát phản hồi trước khi chọn window.

### PASS bước lựa chọn khi

- AI hỏi Chú chọn một trong hai windows.
- AI dùng nhãn dễ hiểu như `Window 1` và `Window 2`, không hiển thị UUID thô.
- Chưa có artifact nào được tạo hoặc tự mở trước khi có lựa chọn.

5. Sau khi xác nhận các điều kiện trên, trả lời:

   > Chọn Window 2.

### PASS toàn case khi

- Artifact chỉ được tạo sau lựa chọn.
- Chỉ Window 2 mở review.
- Window 1 không mở.

### Kết quả

- Trạng thái: `PENDING`
- Artifact directory:
- Evidence/notes:

## Case 4 — Target window không được focus

### Thao tác

1. Mở Window A và Window B.
2. Yêu cầu tạo artifact cho Window A:

   > Hãy tạo review artifact “MW-04” cho workspace trong Window A.

3. Ngay sau khi chọn Window A hoặc ngay khi AI bắt đầu create, chuyển focus sang Window B hoặc ứng dụng khác.
4. Không quay lại Window A cho tới khi AI báo đã tạo xong.

### PASS khi

- Window A vẫn nhận request dù không còn focus.
- Khi quay lại Window A, tab review đã mở.
- Window B không mở artifact.
- Việc đổi focus không làm target bị thay đổi.

### Kết quả

- Trạng thái: `PENDING`
- Artifact directory:
- Evidence/notes:

## Case 5 — Window reload và stale binding

### Thao tác

1. Dùng exact `artifactDirectory` từ một case đã tạo thành công.
2. Ghi lại window hiện đang giữ artifact.
3. Reload hoặc đóng hẳn target window.
4. Mở lại workspace tương ứng trong một VS Code window mới.
5. Chờ workspace được đăng ký lại.
6. Trong chat mới, gửi:

   > Hãy reconnect review artifact tại `<exact artifactDirectory>` và mở nó trong cửa sổ đang mở workspace tương ứng.

7. Nếu AI yêu cầu chọn window, chọn instance mới.

### PASS khi

- Instance/window cũ không được sử dụng.
- Artifact mở trong window mới đang sống.
- Không có window khác mở nhầm artifact.
- Vẫn là cùng exact artifact, không tạo artifact mới.

### Kết quả

- Trạng thái: `PENDING`
- Artifact directory:
- Evidence/notes:

## Case 6 — Auto-open disabled/enabled

Dùng một exact artifact đã có.

### Phần A — Tắt auto-open

1. Đóng tab review đang mở.
2. Tắt setting **AI Artifacts: Auto Open Artifact Review**.
3. Mở read-only `<artifactDirectory>\artifact-connection.json`.
4. Ghi lại `connectionRevision` và `openRequestId`.
5. Gửi:

   > Reconnect artifact tại `<exact artifactDirectory>`.

### PASS phần A khi

- Tab review không tự mở.
- `connectionRevision` tăng.
- `openRequestId` thay đổi.
- Không có lỗi lifecycle.

### Phần B — Bật lại auto-open

6. Bật lại setting **AI Artifacts: Auto Open Artifact Review**.
7. Gửi lại yêu cầu reconnect exact artifact.

### PASS toàn case khi

- Request mới mở đúng target window.
- `connectionRevision` tiếp tục tăng.
- `openRequestId` lại thay đổi.
- Không tạo artifact mới.

### Kết quả

- Trạng thái: `PENDING`
- Revision/request ID trước và sau:
- Evidence/notes:

## Case 7 — Reconnect giữ nguyên lifecycle

### Thao tác

1. Mở exact artifact.
2. Ghi lại:
   - Nội dung Markdown.
   - Số `ROUND` trên UI.
   - Trạng thái comments/submission.
3. Ghi SHA-256 trước reconnect:

   ```powershell
   Get-FileHash -Algorithm SHA256 "<artifactDirectory>\artifact.md"
   ```

4. Đóng tab review.
5. Gửi:

   > Reconnect artifact tại `<exact artifactDirectory>`.

6. Kiểm tra lại nội dung, SHA và trạng thái lifecycle.

### PASS khi

- Cùng artifact được mở lại.
- Markdown và SHA-256 không đổi.
- `reviewRound` không đổi.
- Comments không bị mất hoặc tự sinh thêm.
- Review/Proceed/Just save cũ không bị thực thi lại.
- Không tạo artifact directory mới.

### Kết quả

- Trạng thái: `PENDING`
- Round trước/sau:
- SHA-256 trước/sau:
- Evidence/notes:

## Case 8 — Rebind sang window khác

### Thao tác

1. Mở cùng workspace trong Window 1 và Window 2.
2. Dùng artifact hiện đang bind với Window 1.
3. Đóng tab review ở cả hai window để dễ quan sát.
4. Gửi:

   > Reconnect artifact tại `<exact artifactDirectory>` và rebind nó sang Window 2.

5. Nếu AI liệt kê candidates, chọn Window 2.

### PASS khi

- Chỉ Window 2 mở artifact.
- Window 1 không tự mở lại.
- `artifact-connection.json` đổi target window.
- `connectionRevision` tăng và `openRequestId` đổi.
- `artifact.json`, Markdown, round và comments không bị thay đổi bởi rebind.

### Kết quả

- Trạng thái: `PENDING`
- Revision/request ID trước và sau:
- Evidence/notes:

## Case 9 — Lifecycle smoke bằng Review

Nên dùng artifact mới và giữ nguyên chat đang chờ review.

### Thao tác

1. Gửi:

   > Hãy tạo review artifact “MW-09” với một kế hoạch ngắn cho workspace agent-plus.

2. Đợi review UI tự mở.
3. Ghi lại round hiện tại và SHA-256 của `artifact.md`.
4. Chọn một đoạn văn trong preview.
5. Thêm comment dạng câu hỏi, ví dụ:

   > Phần này nhằm giải quyết vấn đề gì?

6. Lưu comment.
7. Nhấn **Review**.
8. Chờ AI xử lý submission.

### PASS khi

- AI trả lời câu hỏi trực tiếp trong chat.
- Action chỉ được xử lý một lần.
- Round tăng đúng một đơn vị.
- Vì đây là question-only feedback, Markdown và SHA-256 không đổi.
- Comment cũ được reset khi sang round mới.
- Review UI tiếp tục hoạt động ở round mới.
- Không có duplicate tab, duplicate answer hoặc duplicate transition.

### Kết quả

- Trạng thái: `PENDING`
- Artifact directory:
- Round trước/sau:
- SHA-256 trước/sau:
- Evidence/notes:

## Optional diagnostics khi có lỗi

- Inspect structured `resolve_artifact_workspace` response để xác nhận folders được group theo window và duplicate workspace path không bị merge.
- Kiểm tra artifact directory có đủ core files và `artifact-connection.json`.
- Connection payload không được duplicate `artifactId` hoặc `workspaceRoot`.
- Trước và sau reconnect, kiểm tra `connectionRevision` tăng đúng một và `openRequestId` thay đổi.
- Xác nhận Markdown bytes, review round, comments và submission không đổi ngoài action được chủ động thực hiện.
- Nếu nghi ngờ cài nhầm runtime, đối chiếu installed managed runtime/skill với package/source identifier ở đầu tài liệu.

## Điều kiện kết thúc

- Nếu một case fail, dừng matrix và giữ lại exact artifact handle, prompt, window layout, screenshot/error và các lifecycle files để chẩn đoán.
- Nếu package, source, runtime hoặc installed skill thay đổi, rebuild/reinstall và chạy lại mọi case bị ảnh hưởng.
- Không xóa hoặc chỉnh tay user artifacts để làm cho test pass.
- Chỉ đánh dấu feature complete/releasable khi cả chín case bắt buộc đều `PASS` hoặc được Tech Lead chấp thuận `N/A` có lý do.
