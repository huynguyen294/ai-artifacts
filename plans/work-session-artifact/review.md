# Code Review — Phase 4 Chặng 2 (Bước 3: Inspect Core, `join_session`, Context Entry & Bước 4: Chuẩn hoá Proceed)

- **Ngày review:** 2026-11-07
- **Phạm vi đối chiếu:** Working tree diff trên nền commit `777b5e5` đối chiếu với [`plan-phase-4.md`](plan-phase-4.md) (mục 3.4, 3.5, 3.7, 5.3, 5.4).

---

## 1. Findings (Sắp xếp theo mức độ ưu tiên)

### [Medium] 1. MCP Server (`join_session`) — Cho phép truyền `connection` khi `intent !== "reconnect"` (âm thầm bỏ qua) và không validate kiểu boolean cho `takeover` [ĐÃ KHẮC PHỤC]

- **Trạng thái:** ✅ **Đã xử lý & kiểm chứng.**
- **Vị trí:** [`src/integration/artifact-review-mcp-v4.ts:1985-2022`](../../src/integration/artifact-review-mcp-v4.ts#L1985-L2022) (`handleJoinSessionTool`)
- **Yêu cầu đối chiếu:** [`plan-phase-4.md` mục 3.7](plan-phase-4.md#L226):
  > *"Parser Join validate UUID Session, artifact ID và kiểu flags; chỉ derive artifact directory từ canonical collection. Flags inspect chỉ được có khi có artifact; **Join chỉ truyền `connection` khi intent reconnect.** Không thêm alias ID hoặc readonly intent để né validation; không đổi semantics của inspect cũ trong lần tách core đầu tiên."*
- **Kịch bản kích hoạt & Hệ quả:**
  1. **Âm thầm bỏ qua `connection`:** Nhánh `else` tại dòng [`1998-2011`](../../src/integration/artifact-review-mcp-v4.ts#L1998-L2011) được sao chép từ `handleInspectTool` cũ. Khi caller gọi `join_session({ sessionId, artifactId, connection: { targetMode: "explicit-window", selectionToken } })` mà không truyền `intent: "reconnect"` (hoặc truyền `intent: "explicit-chat-update"`), `explicitWindowConnectionInputSchema.safeParse(connectionRaw)` pass nhưng `reconnectConnectionInput` vẫn là `undefined` — tool trả thành công mà không báo lỗi, không consume `selectionToken` và không bind cửa sổ mục tiêu.
  2. **Thiếu validate kiểu `takeover`:** Dòng [`2017`](../../src/integration/artifact-review-mcp-v4.ts#L2017) truyền thẳng `args?.takeover` xuống `executeInspectCore` (nơi chỉ kiểm tra `takeover === true`). Do JSON-RPC dispatcher không tự validate `inputSchema` trước khi gọi handler, nếu caller truyền sai kiểu (ví dụ `takeover: "true"` hoặc `1`), parser không từ chối bằng `INVALID_ARTIFACT_INPUT` mà âm thầm xử lý như `takeover: false`.
- **Khuyến nghị sửa:**
  - Trong `handleJoinSessionTool`:
    - Kiểm tra `if (args.takeover !== undefined && typeof args.takeover !== "boolean")` → throw `new Error("INVALID_ARTIFACT_INPUT: takeover must be a boolean.")`.
    - Ở nhánh `intent !== "reconnect"`, nếu `connectionRaw !== undefined` → throw `new Error("INVALID_ARTIFACT_INPUT: connection is only supported when intent is reconnect.")`.
  - *(Đánh đổi: Giữ nguyên nhánh `else` của `handleInspectTool` để không làm đổi semantics inspect cũ theo mục 3.7, chỉ siết chặt trên tool mới `join_session`).*

---

### [Medium] 2. MCP Server (`executeInspectCore`) — Cấp `roundToken` trước các bước có thể fail và bỏ sót `readArtifactConnection` ngoài khối rollback [ĐÃ KHẮC PHỤC]

- **Trạng thái:** ✅ **Đã xử lý & kiểm chứng.**
- **Vị trí:** [`src/integration/artifact-review-mcp-v4.ts:1749-1851`](../../src/integration/artifact-review-mcp-v4.ts#L1749-L1851) (`executeInspectCore`)
- **Yêu cầu đối chiếu:**
  - [`plan-phase-4.md` mục 3.7](plan-phase-4.md#L229):
    > *"**Inspect/Join+artifact:** register → resolve context → connection commit nằm trong cùng ranh giới rollback membership/new Session hiện có. Nếu context fail, restore `previousRegisteredAt` hoặc gỡ membership mới/xoá Session vừa tạo; không xoá artifact gốc hay membership ở Session khác. **Chỉ cấp token để trả ra sau các bước có thể fail mới này; không để response lỗi đồng thời hướng dẫn retry như thể mọi side effect đều chưa ra.**"*
  - [`plan-phase-4.md` mục 5.3](plan-phase-4.md#L299):
    > *"thứ tự cuối cùng: validate handle/round/session/routing → takeover khi yêu cầu → snapshot → register/new + context + connection trong rollback → token/result."*
- **Kịch bản kích hoạt & Hệ quả:**
  1. **Cấp token sớm, không thu hồi khi fail:** [`grantInspectedRound`](../../src/integration/artifact-review-mcp-v4.ts#L1750-L1754) đang chạy **trước** `registerArtifactInSession`/`createSession`, `resolveWorkSessionContext` và `commitArtifactConnectionRequest`. Nếu một trong các bước sau throw lỗi (ví dụ `session-types.json` lỗi schema hoặc ghi connection thất bại), token đã được lưu vào `roundGrants` in-memory nhưng không được xoá khi rollback.
  2. **`readArtifactConnection` nằm ngoài rollback:** Ở nhánh `intent !== "reconnect"` (dòng [`1839-1841`](../../src/integration/artifact-review-mcp-v4.ts#L1839-L1841)), `readArtifactConnection(context.artifactDirectory, { allowMissing: true })` chạy sau khi đã tạo Session mới hoặc cập nhật membership nhưng không nằm trong `try/catch` rollback. Nếu `artifact-connection.json` tồn tại trên đĩa nhưng bị hỏng JSON/schema (`ArtifactConnectionInvalidError`), lệnh fail với `ARTIFACT_CONNECTION_INVALID` nhưng để lại Session mồ côi vừa tạo hoặc membership/`registeredAt` vừa ghi.
- **Khuyến nghị sửa:**
  - Kiểm tra điều kiện round rỗng của `intent === "explicit-chat-update"` ngay sau `readArtifactInspection(context)` (trước khi tạo/ghi Session, áp dụng cho cả khi `takeover !== true`).
  - Gom `resolveWorkSessionContext` và toàn bộ bước lấy `connection` (cả nhánh `reconnect` lẫn nhánh `else` đọc `readArtifactConnection`) vào chung một khối `try/catch` rollback Session/membership.
  - Chỉ gọi [`grantInspectedRound`](../../src/integration/artifact-review-mcp-v4.ts#L1340-L1381) sau khi Session, `sessionContext` và `connection` đều đã thành công.

---

### [Low] 3. Test Suites — Thiếu các bài kiểm chứng bắt buộc của Bước 3 & Bước 4 trong plan [ĐÃ KHẮC PHỤC]

- **Trạng thái:** ✅ **Đã xử lý & kiểm chứng.**
- **Vị trí:**
  - [`test/mcp-join-session.test.ts:223-433`](../../test/mcp-join-session.test.ts#L223-L433)
  - [`test/review-wait-mcp.test.ts:668-678`](../../test/review-wait-mcp.test.ts#L668-L678)
  - [`test/session-type-registry.test.ts`](../../test/session-type-registry.test.ts)
- **Yêu cầu đối chiếu:** [`plan-phase-4.md` mục 5.3 & Checkpoint 3b/3c](plan-phase-4.md#L307-L330) và [mục 5.4](plan-phase-4.md#L343-L345).
- **Các kịch bản chưa có test kiểm chứng:**
  1. **Checkpoint 3b.5 (dòng 322):** Fixture `session-types.json` sai schema trong isolated home:
     - `create_artifact` rollback cả artifact và Session vừa tạo;
     - `inspect_artifact_review` (hoặc `join_session` kèm artifact) vào Session có sẵn khôi phục `previousRegisteredAt` hoặc gỡ membership mới;
     - `inspect_artifact_review` New không để lại Session mồ côi;
     - `listSessionTypes({ seedIfMissing: false })` throw `SessionTypeError` khi JSON hỏng.
  2. **Entry shapes & snapshot safety (mục 3.7 / 3c):**
     - `create_artifact` và `inspect_artifact_review` trả thêm `session` (`artifactConversationId === session.sessionId`);
     - `inspect_artifact_review` và `join_session` (+ `artifactId`) đọc artifact đã có `approve` submission cũ **không** phát lại `nextAction`.
  3. **Recovery & takeover của `join_session` (mục 5.3):**
     - `join_session` gặp conversation v1 trả `CONVERSATION_MIGRATION_REQUIRED` với `expectedNextTool: "join_session"` (cả join-only và join+artifact trước takeover/mutation);
     - `join_session` + `intent: "reconnect"` gặp `WINDOW_SELECTION_REQUIRED` trả `expectedNextTool: "join_session"`;
     - `join_session` với `takeover: true` chỉ detach waiter của target artifact, giữ nguyên waiter của artifact khác trong Session và cấp `roundToken` khi có saved feedback.
  4. **Proceed qua `advance_and_wait_for_artifact` (mục 5.4 dòng 343):**
     - `advance_and_wait_for_artifact` nhận `approve` cho non-plan kind trả `nextAction.type === "approved"`.
- **Khuyến nghị sửa:** Bổ sung các test cases trên vào [`test/mcp-join-session.test.ts`](../../test/mcp-join-session.test.ts) và [`test/session-type-registry.test.ts`](../../test/session-type-registry.test.ts), sau đó chạy `npm.cmd test` để rebuild `dist/integration/` và chạy Vitest.

---

## 2. Tổng hợp theo Component (Nếu thực hiện sửa)

| Component | File dự kiến chỉnh sửa | Nội dung tác động |
| --- | --- | --- |
| **MCP Integration Server** | [`src/integration/artifact-review-mcp-v4.ts`](../../src/integration/artifact-review-mcp-v4.ts) | Siết validate `connection`/`takeover` trong `handleJoinSessionTool`; gộp `readArtifactConnection` vào khối rollback và dời `grantInspectedRound` xuống sau commit trong `executeInspectCore`. |
| **Automated Tests** | [`test/mcp-join-session.test.ts`](../../test/mcp-join-session.test.ts), [`test/session-type-registry.test.ts`](../../test/session-type-registry.test.ts) | Bổ sung regression cho rollback khi `session-types.json` hỏng, wire shape `session` trên create/inspect, v1/window recovery + selective takeover của `join_session`, và `approved` trên `advance_and_wait_for_artifact`. |

---

## 3. Thông tin tham khảo / Khả năng có thể

- **Đồng bộ trạng thái tiến độ trong tài liệu:** Bảng tiến độ và checklist tại [`plan-phase-4.md`](plan-phase-4.md#L239-L240) ([dòng 518](plan-phase-4.md#L518)), [`plan.md`](plan.md#L32) và [`docs/CHANGE_LOGS.md`](../../docs/CHANGE_LOGS.md#L17-L23) hiện vẫn ghi Bước 3–4 là `"Chưa triển khai"`.
- **Điểm nối Codex config cho Bước 7 (Chặng 3):** [`test/workspace-integration.test.ts`](../../test/workspace-integration.test.ts#L505-L557) vừa tách danh sách 5 tools trong `config.toml` khỏi 6 tools của `tools/list`; khi triển khai Bước 7 (installer/client drivers), cần kiểm tra [`src/extension/mcp-config.ts`](../../src/extension/mcp-config.ts#L133-L198) (`upsertCodexArtifactsMcp` / `hasManagedCodexArtifactsMcp`) để bổ sung `[mcp_servers.ai_artifacts.tools.join_session]`.
- **Tool descriptions của `create_artifact` / `inspect_artifact_review`:** Mô tả trong `tools/list` ([dòng 2318](../../src/integration/artifact-review-mcp-v4.ts#L2318), [dòng 2385](../../src/integration/artifact-review-mcp-v4.ts#L2385)) chưa nhắc trường `session` mới trả kèm; có thể đồng bộ cùng đợt cập nhật prose/skill ở Bước 7.

---

## 4. Trạng thái kiểm chứng (Validation Status)

- **Đã kiểm chứng (Full Regression & Fix Verification):**
  - `npx tsc --noEmit`: **Pass** (0 lỗi).
  - `npm.cmd run build`: **Pass** (mọi bundle extension, uninstall, webview, shiki, mermaid, integration MCP đều build sạch).
  - `git -c core.safecrlf=false diff --check`: **Clean**.
  - Đối chiếu SHA-256 giữa [`src/integration/artifact-review-mcp-v4.ts`](../../src/integration/artifact-review-mcp-v4.ts) và bundle `dist/integration/codex-artifacts-review-mcp.mjs`: **Khớp 100%**.
  - Toàn bộ Vitest suite: **44/44 files pass (626 tests passed, 3 skipped)**.
  - Các điểm đạt tốt theo plan: [`readSessionTypesDocument`](../../src/shared/session-type-registry.ts#L96-L112) + `seedIfMissing: false` trong [`resolveWorkSessionContext`](../../src/shared/work-session-context.ts#L43) giữ Join-only thuần đọc; `persistArtifact` đặt `resolveWorkSessionContext` đúng bên trong khối rollback trước `commitArtifactConnectionRequest`; `reviewDecisionAction` dùng `isPlanProceedKind` và trả đúng wording `approved`.
  - Cả 3 findings (Finding 1: validate takeover & strict connection; Finding 2: rollback atomicity & deferred grant; Finding 3: test coverage) đều đã được khắc phục trọn vẹn và kiểm chứng bằng test tự động.
- **Chưa kiểm chứng:** Runtime thực tế trong VS Code Extension Development Host và AI client thật (thuộc bước nghiệm thu sau Chặng 3).
