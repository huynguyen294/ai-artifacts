# Cải thiện contract kết quả review của các hàm wait cho mọi MCP client

## Quyết định của Technical Owner — 2026-11-04

**Đã quyết định cải thiện:** Khi nhận được review submission, các hàm wait phải trả đủ feedback và thông tin để AI xử lý ngay trong flow mặc định, không cần gọi `inspect_artifact_review` chỉ để lấy nội dung comments còn thiếu.

Quyết định này áp dụng cho cả:

- `wait_for_artifact_review`.
- Phần chờ review của round tiếp theo trong `advance_and_wait_for_artifact`.

Đây là cải thiện chung của AI Artifacts ở tầng MCP, áp dụng thống nhất cho mọi client và model sử dụng các tool này. Issue GitHub Copilot là nguồn phát hiện vấn đề và cung cấp bằng chứng thực nghiệm, không giới hạn phạm vi của cải thiện.

Quyết định và phạm vi bên dưới là cơ sở triển khai. Trạng thái code, automated validation và runtime QA được ghi riêng ở cuối tài liệu.

## Phạm vi chung

- Bổ sung dữ liệu và chỉ dẫn tại luồng trả kết quả chung của MCP server; không tạo nhánh xử lý theo tên client, model hoặc gói tài khoản.
- Cả hai hàm wait phải trả cùng cấu trúc feedback cho cùng loại quyết định và trạng thái review.
- Mục tiêu là agent nhận đủ dữ liệu để tiếp tục theo contract, giảm phụ thuộc vào khả năng tự suy ra bước inspect của từng model.
- Component dự kiến thay đổi gồm response/type của MCP, tests cho contract và tài liệu contract liên quan. Không cần logic đặc thù trong Copilot client driver.

## Cơ sở trước triển khai (MCP 10, skill 2)

- `readValidatedSubmissionOnce` đã đọc và validate nội dung `comments.json`, nhưng object trả về chỉ có `commentsPath`, `commentsSha256` và các metadata khác, không có nội dung comments.
- `grantSubmittedRound` bổ sung token cho `revise`, không bổ sung nội dung comments. Cả hai hàm wait đều sử dụng luồng trả kết quả này.
- `nextAction` hiện chỉ được tạo cho `approve` của `plan` hoặc `implementation-plan`; nhánh `revise` chưa có chỉ dẫn tương ứng.
- `inspect_artifact_review` trả nội dung Markdown, comments, submission nếu có và token khi đủ điều kiện. Theo ghi nhận trong `progress.md`, Codex đã tự dùng inspect để lấy comments rồi tiếp tục advance thành công.

Tham chiếu: [MCP implementation](../../../src/integration/artifact-review-mcp-v4.ts), [skill](../../../skills/create-review-artifact/SKILL.md), [bằng chứng được ghi nhận](./progress.md).

## Kết quả mong muốn

- Trả nội dung comments đã validate, gồm nội dung và vị trí được comment, cùng round, token và metadata cần thiết hiện có.
- Bổ sung `nextAction` cho `revise`, hướng dẫn xử lý feedback theo cùng chính sách của skill:
  - Trả lời câu hỏi trong chat.
  - Chỉ truyền Markdown thay thế khi có yêu cầu sửa; question-only advance không truyền Markdown để giữ nguyên bytes/SHA.
  - Không sửa trực tiếp các file lifecycle, bao gồm `artifact.md`.
  - Sau khi xử lý feedback, gọi `advance_and_wait_for_artifact` trong cùng turn. Nếu feedback chưa rõ, hỏi lại và giữ nguyên round/token trong lúc chờ làm rõ.
- Giữ ý nghĩa hiện tại của `approve` và `save`.

Flow mặc định mong muốn:

```text
wait → nhận đủ feedback → AI xử lý → advance_and_wait → chờ review tiếp theo
```

Lợi ích là mọi MCP client nhận đủ feedback qua cùng một contract, giảm bước lấy dữ liệu bổ sung và giảm sự phụ thuộc vào khả năng AI tự suy ra cách phục hồi. Đánh đổi là response chứa thêm nội dung comments; chỉ dẫn trong payload không bảo đảm mọi model/harness luôn tự tiếp tục.

## Vai trò của inspect

AI dùng inspect để lấy comments là thao tác hợp lệ. Giữ tool này cho đọc feedback từ chat, reconnect hoặc khôi phục trạng thái/token sau gián đoạn hay lỗi; không cấm inspect trong sử dụng bình thường. Flow mặc định không nên phụ thuộc vào inspect chỉ vì response của wait thiếu feedback.

## Kiểm chứng chung

- Automated tests kiểm tra cả `wait_for_artifact_review` và `advance_and_wait_for_artifact` trả đúng nội dung và vị trí comments của round tương ứng, cùng token và `nextAction` cho `revise`.
- Kiểm tra chính sách feedback chung: yêu cầu sửa dẫn đến thay Markdown; question-only giữ nguyên bytes/SHA; `approve` và `save` giữ đúng ý nghĩa hiện tại.
- Runtime trước/sau dùng cùng prompt, feedback, client và model trong từng phép so sánh. Phép thử cấm inspect có thể xác nhận agent xử lý được bằng response của wait; lượt chạy tự nhiên kiểm tra hành vi tiếp tục thông thường.
- Tách kết quả contract đã được automated tests xác nhận khỏi kết quả runtime của từng client/model đã thử. Bài test Copilot/MAI hiện có là một trường hợp kiểm chứng, không phải tiêu chí duy nhất hay bằng chứng cho mọi client.

## Giới hạn kết luận và phạm vi

- Bằng chứng AI tự inspect thành công xác nhận có đường phục hồi; chưa chứng minh thiếu comments là nguyên nhân duy nhất khiến agent của reporter dừng turn.
- Khi triển khai, cần kiểm chứng contract chung của cả hai hàm wait và review nhiều round trong môi trường runtime được chọn. Chỉ kết luận khả năng agent tự tiếp tục trong phạm vi môi trường đã thử.
- Không ép agent ngừng inspect trong lượt reproduce tự nhiên; phép thử giới hạn inspect chỉ dùng để cô lập sự phụ thuộc vào dữ liệu bổ sung.
- Timeout, heartbeat và thay đổi kiến trúc chờ không thuộc quyết định cải thiện này.

## Trạng thái triển khai — 2026-11-04

- Đã bổ sung `comments: CommentsDocument` vào response chung của hai hàm wait cho cả `revise`, `approve`, `save`, sử dụng đúng document vừa được validate với submission/hash.
- Đã bổ sung `nextAction.type: "process-review-feedback"` cho `revise` của mọi artifact kind, giữ nguyên action/token của các quyết định khác.
- Đã cập nhật tool descriptions, server instructions, official skill và contract, cùng tài liệu hiện hành. `MCP_VERSION = 11`, `SKILL_VERSION = 3`; package vẫn là `1.1.3`, chưa tạo release/publish.
- Chưa cài lại integration vào môi trường Copilot của Chú và chưa chạy runtime QA. Bộ công cụ của phiên triển khai không điều khiển được VS Code native/Copilot Chat; không sửa global assets hoặc receipt trực tiếp để thay installer.

### Automated validation

| Kiểm tra | Kết quả |
|---|---|
| Regression trước sửa | 8 cases thất bại trên implementation cũ vì response thiếu comments/action |
| Bộ tests liên quan | 140 passed, 1 skipped |
| Typecheck | `npm.cmd run check` đạt |
| Full suite | 32 files đạt; 523 passed, 3 skipped |
| Build | `npm.cmd run build` đạt |
| Skill metadata và references | Node/js-yaml kiểm tra frontmatter, tên, description, placeholders và local links đạt; skill-contract tests đạt |

Validator Python `quick_validate.py` chưa chạy được vì thiếu PyYAML (`ModuleNotFoundError: yaml`); không coi kiểm tra tương đương là kết quả của validator Python.

Lần full suite đầu có một assertion version cũ đã được đồng bộ và một lần thất bại ở test xóa artifact khi waiter đang chạy. Test xóa artifact không bị sửa; chạy riêng rồi chạy lại toàn bộ suite đều đạt. Chưa kết luận nguyên nhân của lần thất bại không lặp lại này.

### Runtime QA còn lại trên một client

1. Trong checkout `ai-artifacts`, nhấn F5 với cấu hình `Run Agent Plus` để mở Extension Development Host dùng bản build hiện tại.
2. Từ host đó chạy **AI Artifacts: Install Integration for GitHub Copilot**. Kiểm tra receipt `~/.ai-artifacts/managed/integration-version.json` có `mcpVersion: 11` và `skills.agents: 3`, rồi restart MCP/Copilot và mở chat mới. Khi xem được initialize response, `serverInfo.version` phải là `"11"`.
3. Dùng lại nguyên prompt baseline cấm inspect/đọc feedback qua kênh khác, cùng model MAI. Review Round 1 yêu cầu đổi `sum` thành `addNumbers`; xác nhận raw wait response có comments/action và agent sửa rồi chờ Round 2.
4. Round 2 chỉ hỏi `Why use TypeScript here?`; xác nhận agent trả lời trong chat, advance không truyền Markdown và giữ nguyên document. Bấm Proceed ở Round 3 để xác nhận action thực thi; dùng artifact khác kiểm tra Just save không thực thi kế hoạch.
5. Chạy thêm một lượt trên cùng client theo flow tự nhiên, bỏ ràng buộc thử nghiệm cấm inspect. Lưu raw response và các tool calls, không chỉ lời model mô tả kết quả.

Hiện chỉ xác nhận contract bằng automated tests. Runtime Copilot/MAI và các client/model khác vẫn chưa được nghiệm thu sau thay đổi.
