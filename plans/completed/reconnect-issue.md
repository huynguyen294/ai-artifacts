# Reconnect và cập nhật artifact từ chat trên round trống

> Tài liệu bàn giao điều tra và đề xuất. Chưa phải mô tả hành vi đã triển khai.

- Ngày ghi nhận: 2026-09-06
- Phiên bản được phân tích: Codex Artifacts `0.7.0`, MCP server `5.0.0`
- Phạm vi: schema-v4 artifact lifecycle, waiter, inspection, round token và skill orchestration
- Trạng thái: Đã xác định nguyên nhân; chưa sửa code

## Tóm tắt vấn đề

Artifact không bị mất hay kết thúc khi chat/waiter bị ngắt. Vấn đề chỉ xuất hiện khi người dùng yêu cầu **sửa artifact trực tiếp qua chat**, trong khi review round hiện tại không có comment đã lưu và cũng chưa có submission.

Ở trạng thái đó:

1. `inspect_artifact_review` đọc được artifact nhưng không cấp `roundToken`.
2. `advance_and_wait_for_artifact` bắt buộc có `roundToken` mới được sửa Markdown và tăng round.
3. Agent vì vậy không thể áp dụng yêu cầu từ chat vào artifact.

Đây là khoảng trống giữa skill và MCP API, không phải lỗi persistence hoặc reconnect. Skill cho phép kích hoạt khi người dùng yêu cầu cập nhật artifact rõ ràng, nhưng MCP chưa có token source dành cho yêu cầu cập nhật chỉ tồn tại trong chat.

## Cách hiểu ngắn gọn

- **Reconnect:** nối lại việc chờ ở round hiện tại; không sửa nội dung và không tăng round.
- **Review feedback:** xử lý comment/submission đã được lưu rồi mở round mới.
- **Chat update:** sửa artifact từ yêu cầu rõ ràng trong chat rồi mở round mới. Nhánh này hiện chưa được MCP hỗ trợ khi round đang trống.

Mục tiêu của thay đổi đề xuất là làm cho **Review trở thành một cách gửi feedback, không phải điều kiện bắt buộc để cập nhật hoặc reconnect artifact**.

## So sánh hành vi hiện tại và hành vi đề xuất

| Tình huống                                                                               | Hành vi hiện tại                                                                       | Hành vi đề xuất                                                                                      |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Waiter bị hủy, round vẫn mở và chưa có feedback                                          | Attach lại `wait_for_artifact_review` vào cùng round                                   | Giữ nguyên; đây là reconnect thuần túy                                                               |
| Người dùng chỉ nói “kết nối lại”                                                         | Chờ lại cùng round, nếu agent tuân thủ skill                                           | Giữ nguyên và ghi rõ không được sửa Markdown hoặc tăng round                                         |
| Có comment đã lưu nhưng chưa bấm **Review**                                              | `inspect_artifact_review(takeover: true)` cấp token; agent xử lý comment và advance    | Giữ nguyên                                                                                           |
| Đã bấm **Review** với ít nhất một comment                                                | Submission `revise` cấp token; agent xử lý feedback và advance                         | Giữ nguyên                                                                                           |
| Bấm **Review** khi không có comment                                                      | UI disable; extension và MCP cũng từ chối                                              | Giữ nguyên; không dùng Review trống làm workaround                                                   |
| Đã **Proceed** hoặc **Just save**, sau đó yêu cầu reconnect                              | Inspect submission, lấy token, advance không đổi Markdown rồi chờ round mới            | Giữ nguyên; không lặp lại hành động Proceed/Just save trước đó                                       |
| Người dùng nói trong chat “thêm phase X vào artifact”, round không có comment/submission | Inspect không cấp token; agent bị chặn và thường yêu cầu người dùng tạo review/comment | Cấp token loại `chat-update`; agent sửa Markdown, tăng round và chờ tiếp mà không cần comment/Review |
| Inspect round trống nhưng người dùng không yêu cầu sửa                                   | Không cấp token                                                                        | Vẫn không cấp token mặc định; tránh vô tình advance round trống                                      |
| MCP restart hoặc token hết hạn                                                           | Artifact còn nguyên; inspect lại exact handle để lấy token nếu state cho phép          | Giữ nguyên                                                                                           |

## Biểu hiện đã quan sát

Agent báo rằng round hiện tại chưa có submission/comment nên chưa thể ghi revision mới vào lifecycle, sau đó hướng dẫn người dùng bấm **Review** mà không cần nhập lại nội dung.

Hướng dẫn này không khả thi khi round có 0 comment:

- Webview disable nút Review nếu không có comment: `src/webview/review-actions.ts`.
- Extension từ chối submission `revise` không có comment: `src/extension/artifact-store.ts`.
- MCP cũng validate rằng review request phải có ít nhất một comment.

Workaround thực tế của phiên bản hiện tại là lưu ít nhất một comment rồi nhắn “hãy xem review”, hoặc bấm Review sau khi đã lưu comment. Tuy nhiên đây chỉ là workaround; người dùng không nên phải tạo comment giả cho một yêu cầu đã nói rõ trong chat.

## Nguyên nhân kỹ thuật

### Điều kiện cấp token hiện tại

Trong `src/integration/artifact-review-mcp-v4.ts`, `grantInspectedRound` trả về `undefined` khi đồng thời:

```ts
inspection.comments.comments.length === 0 && !inspection.submission;
```

Trong khi đó, `advance_and_wait_for_artifact` luôn yêu cầu `roundToken`. Vì vậy một round trống có thể được attach waiter lại, nhưng không thể được cập nhật và advance.

### Khoảng trống trong contract

Contract hiện có hai nguồn token:

- `submitted-review`: phát sinh từ submission `revise`.
- `chat-inspection`: phát sinh khi inspection thấy comment hoặc submission đã lưu.

Contract chưa có nguồn token biểu diễn: “người dùng vừa yêu cầu rõ ràng trong chat rằng artifact này phải được sửa”.

### “Review qua chat” hiện có nghĩa gì

Trong v0.7.0, chat escape có nghĩa là:

1. Người dùng lưu comment trong artifact.
2. Người dùng nhắn “hãy xem review”.
3. Agent takeover waiter, inspect comment đã lưu, xử lý và advance.

Nó chưa có nghĩa là feedback chỉ được nhập trong chat cũng có thể tạo revision trên một round trống.

## Hành vi mới đề xuất

### 1. Reconnect thuần túy

Khi người dùng chỉ yêu cầu reconnect:

```text
wait_for_artifact_review(exact artifact, current round)
```

- Không cấp token.
- Không sửa Markdown.
- Không tăng `reviewRound`.

### 2. Cập nhật artifact từ chat

Khi người dùng yêu cầu rõ ràng sửa exact artifact, ví dụ “thêm phase rollout vào artifact này”:

```text
inspect exact artifact với intent explicit-chat-update
→ cấp token chat-update dù round không có comment/submission
→ agent tạo complete replacement Markdown
→ advance_and_wait
→ tăng round, reset review state và attach waiter mới
```

Người dùng không cần tạo comment hoặc bấm Review.

### 3. Feedback đã lưu

Luồng comment/submission hiện tại không đổi. Saved comment vẫn có thể được xử lý qua chat mà không cần bấm Review.

## Thiết kế API khuyến nghị

Mở rộng `inspect_artifact_review` thay vì luôn cấp token hoặc thêm một tool hoàn toàn mới:

```ts
inspect_artifact_review({
  artifactDirectory,
  takeover: true,
  expectedReviewRound: 2,
  intent: "explicit-chat-update",
});
```

Inspection có thể trả:

```ts
{
  reviewRound: 2,
  markdown: "...",
  comments: { comments: [] },
  submission: undefined,
  roundToken: "...",
  roundTokenSource: "chat-update"
}
```

Sau đó agent gọi:

```ts
advance_and_wait_for_artifact({
  artifactDirectory,
  expectedReviewRound: 2,
  roundToken,
  markdown: completeUpdatedMarkdown,
});
```

Tên field cuối cùng có thể được điều chỉnh khi triển khai. Điểm quan trọng là intent cập nhật phải tường minh và token phải phân biệt được với token feedback/reconnect.

## Ràng buộc an toàn cho token `chat-update`

- Chỉ dùng exact `artifactDirectory` còn trong conversation hoặc do người dùng cung cấp; không scan “artifact mới nhất”.
- Chỉ cấp cho schema v4 và current round đã validate.
- Bind token với artifact ID, review session, round, artifact SHA, comments SHA và submission presence/hash như token hiện tại.
- Token dùng một lần, có TTL và chỉ consume sau khi transaction commit thành công.
- Nếu artifact/comment/submission thay đổi sau inspection, advance phải bị từ chối.
- `chat-update` token bắt buộc truyền complete replacement `markdown`.
- Markdown mới phải khác Markdown hiện tại; không dùng token này để advance một round trống mà không tạo thay đổi.
- Không dùng reconnect/chat-update để thực thi lại hành động đã được Proceed trước đó.
- Cancellation và takeover chỉ tác động waiter; không được sửa lifecycle files.

Không khuyến nghị đổi `inspect_artifact_review` thành luôn cấp token. Cách đó làm mất semantic gate và cho phép agent vô tình advance một round trống ngay cả khi người dùng chỉ muốn reconnect.

## Components cần thay đổi

### 1. MCP lifecycle server

File chính: `src/integration/artifact-review-mcp-v4.ts`

Cần thay đổi:

- Mở rộng input schema của `inspect_artifact_review` với intent cập nhật tường minh và, nếu chọn, `expectedReviewRound`.
- Bổ sung source mới cho `RoundGrant`, ví dụ `chat-update`.
- Cho phép `grantInspectedRound` cấp token trên round trống chỉ khi intent là `explicit-chat-update`.
- Giữ hành vi mặc định: inspect round trống không intent vẫn không có token.
- Trong `advance_and_wait_for_artifact`, bắt buộc token `chat-update` phải có Markdown mới và thực sự thay đổi nội dung.
- Giữ nguyên exact-state binding, TTL, replay protection, concurrency lock, transaction rollback và Windows editor-lock fallback.
- Cập nhật tool descriptions/instructions trả về khi MCP initialize.

### 2. Codex skill

Files:

- `skills/create-review-artifact/SKILL.md`
- `skills/create-review-artifact/references/artifact-contract.md`
- `skills/create-review-artifact/agents/openai.yaml` nếu metadata cần phản ánh khả năng mới

Cần phân biệt rõ:

- “Reconnect” → wait lại cùng round.
- “Đọc comment/review” → inspect feedback theo luồng hiện tại.
- “Sửa/cập nhật artifact này từ chat” → inspect với `explicit-chat-update`, tạo replacement Markdown, advance và wait.
- Nếu thiếu exact handle → hỏi artifact path, không suy luận từ cwd/workspace.

### 3. Tests

Files chính:

- `test/review-wait-mcp.test.ts`
- `test/skill-contract.test.ts`

Coverage cần bổ sung:

- Round trống + inspect mặc định → không có token.
- Round trống + `explicit-chat-update` → có token `chat-update`.
- Token chat-update thiếu Markdown → bị từ chối.
- Markdown không thay đổi → bị từ chối.
- Markdown thay đổi hợp lệ → tăng round, reset comment/submission và attach waiter.
- State đổi sau inspection → token bị từ chối.
- Replay và concurrent consumption → chỉ một lần thành công.
- Cancellation sau commit → round mới vẫn tồn tại và reconnect được.
- Reconnect thuần túy → không tăng round.
- Reconnect sau Proceed/Just save → không lặp lại hành động trước đó.
- Skill không yêu cầu người dùng bấm Review hoặc tạo comment giả cho explicit chat update.

### 4. Tài liệu sản phẩm và kiến trúc

Vì đây là thay đổi hành vi và contract, khi triển khai cần cập nhật phần liên quan trong:

- `README.md`
- `docs/PHILOSOPHY.md`
- `docs/ARCHITECTURE.md`
- `docs/COMPONENTS.md`
- `CHANGE_LOGS.md`
- `TODO.md` nếu mục chat review hiện tại cần đóng hoặc viết lại

Tài liệu phải nói rõ rằng “feedback qua chat” hỗ trợ cả saved-comment escape và explicit chat update; reconnect đơn thuần không tạo revision.

### 5. Versioning, build và cài đặt

- Cân nhắc bump extension/package version và MCP server version vì tool input contract thay đổi.
- Không sửa trực tiếp `dist/`, VSIX hoặc global installed assets.
- Build lại integration/webview/extension theo quy trình repository.
- Sau khi phát hành, chạy lại **Codex Artifacts: Install Global Codex Integration**, restart Codex và bắt đầu chat mới để tool schema/skill mới được load.

## Components dự kiến không cần thay đổi

Nếu dùng thiết kế mở rộng MCP inspection như trên, các phần sau không cần đổi hành vi:

- `src/extension/artifact-store.ts`: vẫn quản lý comment và submission từ webview.
- `src/webview/`: không cần nút mới; Review trống vẫn bị chặn.
- Artifact schema v4 và các lifecycle files: không thêm file, không migration.
- Workspace registry và workspace evidence gate.
- Custom editor/provider và Markdown renderer.

`src/shared/` chỉ cần thay đổi nếu project quyết định đưa intent/token source vào shared type thay vì giữ chúng trong MCP integration contract.

## Tiêu chí chấp nhận

1. Người dùng có thể nói “thêm phase X vào artifact này” trên round trống và nhận round mới mà không tạo comment hoặc bấm Review.
2. Người dùng nói “kết nối lại” chỉ attach waiter vào cùng round.
3. Inspect bình thường trên round trống vẫn không cho phép advance.
4. Existing Review, saved-comment chat escape, Proceed và Just save không bị regression.
5. Exact-handle, state binding, token TTL, one-time use, rollback và cancellation invariants vẫn được giữ.
6. Agent không còn đưa ra hướng dẫn bất khả thi “bấm Review khi không có comment”.

## Các quyết định cần chốt trước khi triển khai

1. Dùng `intent` trong `inspect_artifact_review` như đề xuất, hay tạo tool riêng cho explicit chat update?
2. Có bắt buộc `expectedReviewRound` trong inspection intent mới không?
3. Có trả `roundTokenSource` ra public response để dễ debug, hay chỉ giữ source nội bộ?
4. Có yêu cầu Markdown mới khác SHA hiện tại, hay chỉ yêu cầu field `markdown` tồn tại?
5. Version mới là patch hay minor cho extension và MCP server?

Khuyến nghị mặc định:

- Mở rộng `inspect_artifact_review` bằng `intent: "explicit-chat-update"`.
- Bắt buộc `expectedReviewRound` cho intent này.
- Giữ token source trong response để quan sát/debug.
- Bắt buộc Markdown mới khác SHA hiện tại.
- Không thay artifact schema và không thay webview.

## Validation khi triển khai

Chạy từ repository root:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Ngoài automated tests, nên chạy manual flow:

1. Tạo artifact và để round 1 không có comment.
2. Hủy waiter hoặc chuyển sang chat.
3. Yêu cầu “thêm một phase rollout vào artifact này”.
4. Xác nhận artifact được cập nhật thành round 2 mà không cần Review/comment.
5. Hủy waiter lần nữa và chỉ yêu cầu reconnect.
6. Xác nhận vẫn ở round 2 và Markdown không đổi.

## Tài liệu/source đã đối chiếu

- `AGENTS.md`
- `docs/INSTRUCTION.md`
- `docs/PHILOSOPHY.md`
- `docs/ARCHITECTURE.md`
- `skills/create-review-artifact/SKILL.md`
- `skills/create-review-artifact/references/artifact-contract.md`
- `src/integration/artifact-review-mcp-v4.ts`
- `src/extension/artifact-store.ts`
- `src/webview/review-actions.ts`
- `test/review-wait-mcp.test.ts`
- `test/skill-contract.test.ts`
- `README.md`
- `CHANGE_LOGS.md`
- `TODO.md`

## Triển khai thực tế (Implemented)

- **Ngày hoàn thành:** 2026-09-06
- **Phiên bản:** Extension `0.8.0`, MCP Server `5.1.0`
- **Trạng thái:** Đã hoàn thành triển khai, kiểm thử và đồng bộ tài liệu

### 1. Thành phần MCP Server (`src/integration/`)

File: [`src/integration/artifact-review-mcp-v4.ts`](src/integration/artifact-review-mcp-v4.ts)

- Nâng `SERVER_VERSION` từ `5.0.0` lên `5.1.0`.
- Bổ sung `source: "chat-update"` cho type `RoundGrant`.
- Mở rộng `handleInspectTool` và `grantInspectedRound`:
  - Nhận tham số `intent: "explicit-chat-update"` và `expectedReviewRound`.
  - Validate: bắt buộc phải có `expectedReviewRound` khi truyền `intent: "explicit-chat-update"` và phải khớp với `context.reviewRound`.
  - Cấp round token loại `chat-update` khi `intent === "explicit-chat-update"`, kể cả khi round hiện tại trống (0 comment và không có submission).
  - Trả về `roundTokenSource: "chat-update"` trong payload kết quả inspection.
  - Khi inspect bình thường không có intent: giữ nguyên hành vi fail-closed (không cấp token trên round trống).
- Siết chặt an toàn trong `handleAdvanceAndWaitTool`:
  - Bắt buộc token `chat-update` phải truyền `markdown` mới và `sha256(markdown) !== grant.artifactSha256` (ngăn chặn advance rỗng hoặc không thay đổi nội dung).
- Cập nhật schema tool `inspect_artifact_review` trong `tools/list` và instructions khi `initialize`.

### 2. Thành phần Package & Extension Metadata

File: [`package.json`](package.json)

- Nâng version extension từ `0.7.0` lên `0.8.0`.

### 3. Thành phần Agent Skill & Contract (`skills/`)

Files:

- [`skills/create-review-artifact/SKILL.md`](skills/create-review-artifact/SKILL.md)
- [`skills/create-review-artifact/references/artifact-contract.md`](skills/create-review-artifact/references/artifact-contract.md)

- Chuẩn hóa 4 kịch bản tương tác:
  1. **Pure reconnect:** Chỉ nối lại việc chờ ở round hiện tại qua `wait_for_artifact_review`. Không advance, không đổi Markdown.
  2. **Chat escape khi có saved comment:** Gọi `inspect_artifact_review(takeover: true)` và áp dụng Unified feedback handling cho các comment đã lưu.
  3. **Explicit chat update trên round trống:** Gọi `inspect_artifact_review(takeover: true, expectedReviewRound, intent: "explicit-chat-update")`, nhận token `chat-update`, sinh replacement Markdown và gọi `advance_and_wait_for_artifact`. Không hướng dẫn sai người dùng bấm nút Review khi round trống.
  4. **Reconnect sau Proceed/Just save:** Inspect để lấy fresh token và advance không đổi Markdown sang round mới.

### 4. Thành phần Kiểm thử (`test/`)

Files:

- [`test/review-wait-mcp.test.ts`](test/review-wait-mcp.test.ts)
- [`test/skill-contract.test.ts`](test/skill-contract.test.ts)

- Cập nhật expected version `5.1.0`.
- Thêm test case validate tham số: thiếu `expectedReviewRound`, sai round hoặc sai intent đều bị từ chối.
- Thêm test case end-to-end cho `explicit-chat-update`:
  - Cấp token `chat-update` trên round 1 trống.
  - Từ chối advance nếu thiếu `markdown`.
  - Từ chối advance nếu Markdown không đổi SHA.
  - Advance thành công sang round 2 với Markdown mới, reset comment và tiếp tục chờ submission của round 2.
- Bổ sung assertion kiểm tra hợp đồng skill mới.

### 5. Thành phần Tài liệu & Kiến trúc (`docs/` & Root)

Files:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): Bổ sung mô tả về intent `explicit-chat-update`, token source `chat-update`, và cập nhật mục Compatibility `0.8.0` / MCP `5.1.0`.
- [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md): Cập nhật triết lý luồng chat escape và trạng thái triển khai `0.8.0`.
- [`CHANGE_LOGS.md`](CHANGE_LOGS.md) & [`docs/CHANGE_LOGS.md`](docs/CHANGE_LOGS.md): Ghi nhận toàn văn release `0.8.0`.

### 6. Kết quả xác thực (Validation)

Toàn bộ quy trình xác thực đã hoàn thành thành công:

- `npm.cmd run check`: Pass (`tsc --noEmit` 0 lỗi).
- `npm.cmd test`: Pass toàn bộ 67/67 tests trên 12 test files sau hardening.
- `npm.cmd run build`: Build thành công extension, webview, shiki/mermaid enhancements và MCP integration bundle.

### 7. Hardening sau code review

- Enforce `explicit-chat-update` chỉ được cấp token trên round thực sự trống; saved comment hoặc submission phải đi qua lifecycle tương ứng và không bị reset ngoài ý muốn.
- Validate `expectedReviewRound` trước takeover, sau đó reload/revalidate sau takeover để request stale không hủy waiter hợp lệ.
- Đồng bộ `package-lock.json`, README và component documentation cho release 0.8.0.
- Bổ sung regression tests cho empty-round eligibility, stale-round waiter safety, chat-update state binding, Windows atomic-write fallback và Enter/Shift+Enter/IME.
- Validation cuối: `npm.cmd run check`, 67/67 tests và `npm.cmd run build` đều pass; `git diff --check` sạch.
