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

---

## 2026-08-31 — Documentation and distribution — README onboarding

### Nội dung thay đổi

- Viết lại phần mở đầu README theo hướng người dùng, không đưa thuật ngữ waiter vào mô tả sản phẩm ban đầu.
- Bổ sung yêu cầu VS Code, Node runtime/build, đường dẫn cài VSIX và quy trình build từ source bằng `npm ci`.
- Làm rõ skill luôn nằm trong `~/.agents/skills`, còn MCP script và `config.toml` tuân theo `CODEX_HOME`.
- Mô tả auto-open là hành vi mặc định có setting và manual fallback; đồng bộ nhãn **View comments** cùng semantics Review, Proceed, Just save và Copy Markdown.
- Khôi phục compatibility guidance cho schema v4, schema-v3 read-only và dữ liệu legacy không tự migrate/xóa.
- Thêm liên kết tới Philosophy, Architecture, Components, Project Instructions, artifact contract, changelog, TODO và MIT License.
- Tài liệu hóa stable VSIX alias và versioned package; không thay đổi runtime, MCP API hoặc artifact schema.
- Khai báo Git repository từ origin hiện có trong package metadata để VSCE có thể resolve các link tương đối khi đóng gói README.

### Lý do

README trước đó giả định file VSIX đã có, thiếu prerequisite runtime, dùng thuật ngữ nội bộ quá sớm và chưa mô tả chính xác một số hành vi cài đặt/review. Onboarding mới giúp người dùng cài từ repository hoặc build từ source mà vẫn giữ phần contract chuyên sâu ở các tài liệu chuyên biệt.

### Thành phần và tài liệu bị ảnh hưởng

- `README.md`.
- `package.json` repository metadata.
- Release VSIX được tạo từ source hiện tại.
- `CHANGE_LOGS.md` và tài liệu change log này.

---

## 2026-08-31 — Proceed semantics — Runtime execution directive

### Nội dung thay đổi

- Xác định cả `plan` và `implementation-plan` là executable plan khi người dùng chọn Proceed.
- `wait_for_artifact_review` trả `nextAction.type: "execute-approved-plan"` cùng instruction bắt buộc thực thi toàn bộ code, file, workspace và command action nằm trong phạm vi plan đã duyệt ngay trong cùng turn.
- Skill không được dừng ở acknowledgement, mô tả công việc tương lai hoặc hỏi thêm xác nhận triển khai; chỉ được dừng khi có blocker thật hoặc cần authority ngoài phạm vi đã duyệt.
- Mở rộng quy tắc chọn `implementation-plan` cho plan trực tiếp hướng dẫn code, file, workspace hoặc command changes; `plan` vẫn là executable plan cho các trường hợp khác.
- Reconnect qua inspection không phát lại runtime directive, tránh coi reconnect là yêu cầu thực hiện lại hành động cũ.

### Lý do

Tool result trước đây chỉ trả `decision: "approve"` và dựa vào model tự kết hợp `kind` với skill. Artifact hành động bị phân loại thành `plan` có thể khiến AI chỉ xác nhận Proceed mà không triển khai. Runtime directive làm quyền thực thi trở thành dữ liệu rõ ràng trong kết quả MCP thay vì chỉ là prompt convention.

### Thành phần và tài liệu bị ảnh hưởng

- MCP result và initialization instructions.
- Bundled skill và artifact contract.
- README, Architecture, Philosophy, Components, project instructions và release notes 0.7.0.
- MCP lifecycle tests và skill contract tests.

---

## 2026-08-31 — Review semantics — Unified feedback handling

### Nội dung thay đổi

- Cho Review submission (`revise`) và chat inspection dùng chung một feedback classifier và action policy.
- Question-only luôn trả lời user-visible trong Codex chat rồi advance không truyền Markdown; change-only cập nhật complete Markdown; mixed vừa trả lời chat vừa cập nhật; needs-clarification chưa consume token.
- Loại bỏ hành vi tạo/cập nhật `## Review responses` trong artifact. Câu trả lời hội thoại không còn được nhúng vào tài liệu review.
- Giữ nguyên sự khác biệt transport nội bộ: Review nhận submitted-review token từ waiter, còn chat escape nhận chat-inspection token qua takeover/inspect.

### Lý do

Người dùng cần nút Review và câu lệnh “hãy đọc comment” có cùng kết quả quan sát được. Một policy duy nhất tránh hai luồng xử lý comment lệch nhau và giữ artifact tập trung vào nội dung tài liệu thay vì lưu transcript hội thoại.

### Thành phần và tài liệu bị ảnh hưởng

- Agent behavior: bundled skill và artifact contract.
- MCP guidance: initialization instructions; không đổi tool API, token validation hoặc persistent schema.
- Tài liệu: README, Architecture, Philosophy, Components, project instructions và release notes 0.7.0.
- Regression contract: skill contract và MCP initialization tests.

---

## 2026-08-31 — Lifecycle architecture và behavior — Chat escape/reconnect

### Nội dung thay đổi

- Chuẩn hóa lifetime thành `artifact lifetime > waiter lifetime > chat-turn lifetime`: artifact là persistent workspace state; waiter và round token chỉ là process state tạm thời.
- Tách lifecycle MCP thành `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review` và `advance_and_wait_for_artifact`.
- Thêm chat escape để AI có thể takeover waiter, đọc comment chưa submit, trả lời câu hỏi trong chat, sửa artifact khi cần và mở round mới.
- Cho phép question-only advancement giữ nguyên Markdown/SHA; no-comment inspection reattach cùng round.
- Xác định Proceed/Just save chỉ kết thúc round, không kết thúc artifact; reconnect là hành động explicit và không lặp lại command cũ.
- Bắt buộc exact artifact handle, không dùng latest-artifact heuristic hoặc cwd inference.
- Chuyển update grant thành exact-state round grant và làm waiter cancellation/takeover dùng chung detach semantics.

### Lý do

Lifecycle cũ gắn persistence của artifact quá chặt với một MCP tool call đang chờ, khiến comment trong UI chỉ có thể quay lại AI qua nút Review. Việc tách artifact khỏi waiter giữ nguyên default UX nhưng cho phép hội thoại tự nhiên, reconnect sau cancellation/restart và xử lý câu hỏi trực tiếp trong chat mà không cần thay schema hoặc UI.

### Thành phần và tài liệu bị ảnh hưởng

- MCP lifecycle: `src/integration/artifact-review-mcp-v4.ts`.
- Managed integration: `src/extension/mcp-config.ts`, extension `0.7.0`, MCP server `5.0.0`.
- Agent contract: `skills/create-review-artifact/SKILL.md`, `references/artifact-contract.md`, `agents/openai.yaml`.
- Tài liệu trạng thái hiện tại: `README.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`.
- Regression coverage: `test/review-wait-mcp.test.ts`, `test/mcp-config.test.ts`, `test/skill-contract.test.ts`.
- Không thay đổi artifact schema v4, webview, provider, Artifact Store, Markdown renderer hoặc workspace registry.
