# Review Phase 5 — Chặng 1–2 — 2026-11-08

## Review lại sau bản fix — 2026-11-08

**Kết luận hiện tại: F1–F6 đã được khắc phục theo source và kiểm chứng tự động; không phát hiện thêm lỗi chức năng cần xử lý trong các luồng fix đã kiểm tra.** Hai mục Low trong bảng “Thông tin tham khảo / Khả năng có thể” vẫn còn. Kết luận và findings của lượt đầu bên dưới được giữ làm lịch sử, không phải trạng thái lỗi hiện tại.

| Finding | Kết quả đối chiếu bản fix |
| --- | --- |
| F1 — Delete/cleanup Session chưa xác minh metadata | Đã sửa: `deleteSession` xác minh regular metadata file, parse JSON và `parseWorkSessionMetadata` với exact ID trước khi xoá. Cleanup skip/diagnostic target không hợp lệ; regression tests giữ Session có metadata hỏng. |
| F2 — Open từ context menu | Đã sửa: Session handler dùng `extractSessionId`; artifact handler nhận tree element chứa `artifact.artifactPath` hoặc exact ID bên cạnh URI cũ. Shape của hai tree providers khớp các nhánh mới. Chưa click native menu trên Extension Host. |
| F3 — Restore pending | Đã sửa: Session reducer quản lý/reset `restoringSession` trên patch/success/error; có regression cho failure và các lần Restore tiếp theo. Artifact host gửi error về webview, listener reset pending trên error và success. |
| F4 — Kết quả Delete/cleanup | Đã sửa: lỗi xoá staging sau rename không phủ nhận deletion commit; cleanup tiếp tục. Result phân biệt `deleted`, `error`, `cleanupError`; coordinator không báo thành công khi chưa xoá và cảnh báo cleanup chưa hoàn tất. Có regression staging failure và target thiếu. |
| F5 — UI-state linked root/file | Đã sửa đường tái hiện đã báo: patch kiểm tra parent root, child và realpath; read chặn file symlink/non-regular; copy fallback kiểm tra target. Replay fixture Windows junction → bị từ chối, `outsideChanged:false`. Không thực hiện exhaustive filesystem race/ancestor matrix ngoài phạm vi. |
| F6 — Editor sau Delete artifact | Đã sửa: refresh phân biệt thư mục thực sự mất (`ENOENT`/`ENOTDIR`) với lỗi load khác, phát `artifactDeleted`; webview render terminal thay controls. Scoped artifact event cũng gọi refresh. Có test terminal rendering; watcher delivery thực tế chưa kiểm chứng. |

**Thông tin tham khảo còn lại (Low):**

- `src/extension/extension.ts:750`: global artifact watcher vẫn chỉ theo `artifact.json`; chưa có watcher `artifact-ui-state.json` để refresh Recent ở cửa sổ khác khi Pin/Archive.
- `src/extension/artifact-review-provider.ts:442`, `src/extension/artifact-store.ts:292`, `src/extension/work-session-sidebar.ts:113,312`, `src/extension/conversation-artifact-service.ts:332`: lỗi parse/read UI state vẫn bị nuốt thành patch/default/undefined, có thể hiển thị như chưa Archive. Chưa có diagnostic cục bộ hoặc trạng thái unknown/giữ bản đã biết.

**Validation lượt review lại:** `npm.cmd run check` PASS; `npm.cmd test` PASS (**52 files, 711 passed, 3 skipped**); `npm.cmd run build` PASS; `git -c core.safecrlf=false diff --check` PASS trước khi cập nhật báo cáo. Replay fixture junction dùng temp root có guard, đã dọn; không chỉnh code sản phẩm. Chưa chạy manual Extension Host, multi-window hoặc native UI. Đây là xác nhận bản fix Chặng 1–2, không phải nghiệm thu Chặng 3 hay kết luận release-ready.

---

## Lượt review đầu — lịch sử

## Phạm vi và kết luận

- Review Bước 1–5 của `plan-phase-5.md`: persistence/UI state, Module seed, Delete artifact/Session, sidebar menus/Pin/Archive/Search, Archived/Restore headers, scoped updates và cleanup Session Archive 30 ngày.
- Baseline: `e767aa0` (trước Phase 5); đối chiếu toàn bộ thay đổi tracked và các module/test mới chưa tracked liên quan Chặng 1–2. Không review grid, edit title/kind, MCP re-read kind hoặc ZIP của Chặng 3.
- **Chưa đề nghị nghiệm thu Chặng 1–2:** còn 6 findings chức năng bên dưới và 2 thông tin tham khảo về xử lý lỗi/refresh. Không thay code sản phẩm trong lượt review này.
- **Các findings Phase 4/4.5 bên dưới là lịch sử, đã được Chú xác nhận xử lý xong trong chat.** Không mở lại hoặc tính chúng vào kết quả Phase 5. Những trạng thái “còn mở/đang chờ” trong handoff cũ không còn áp dụng.

## Findings theo component

### F1 — [High] Cleanup Archive xoá cả Session có metadata hỏng, chưa xác minh Session v2

- Vị trí: `src/extension/work-session-retention.ts:93–115`; `src/shared/conversation-artifact-registry.ts:725–729`.
- Trigger: Session đã Archive đủ 30 ngày, sau đó `conversation.json` bị hỏng JSON. Cleanup chỉ đọc UI state rồi gọi `deleteSession`; hàm này alias thẳng `removeConversation`, chỉ kiểm tra đường dẫn/thư mục, không parse metadata hoặc xác minh schema/ID của Session v2.
- Tác động: activation vẫn xoá toàn bộ thư mục gồm Instructions/layout/memberships của target chưa được xác minh. Trái yêu cầu Bước 2.5 và Bước 5.1 về chỉ xoá exact Session v2 hợp lệ.
- **Đã tái hiện bằng fixture tạm:** tạo Session hợp lệ, Archive tại `2020-01-01`, ghi `conversation.json` thành `{ malformed`, chạy cleanup với `now = 2026-11-08` → `deletedCount: 1`.
- Khuyến nghị: primitive Delete Session cần xác minh metadata v2/schema/ID qua managed-file validation trước khi xoá; cleanup skip và diagnostic cho metadata không hợp lệ. Giữ `removeConversation` phục vụ rollback riêng nếu caller rollback cần semantics khác.

### F2 — [Medium] Open trong menu chuột phải không nhận đúng tree item

- Vị trí: `package.json:367,397`; `src/extension/extension.ts:266–294,340–343`.
- Trigger: nhấn chuột phải artifact/Session → Open. Context menu truyền tree element, trong khi handler artifact chỉ nhận `vscode.Uri`, handler Session chỉ nhận string.
- Tác động: artifact Open không làm gì; Session Open mở Quick Pick chọn lại Session, không mở trực tiếp item vừa click. Click trái vẫn hoạt động vì `TreeItem.command.arguments` truyền URI/ID riêng; không chứng minh context menu đúng.
- Bằng chứng: đối chiếu trực tiếp menu contributions, shape `RecentTreeElement`/`SessionTreeElement` và hai handlers. Chưa chạy native menu trên Extension Host.
- Khuyến nghị: normalize tree item bằng exact artifact/session ID rồi gọi đường Open hiện có; vẫn giữ URI/string cho các caller cũ. Kiểm tra item A khi editor B đang active.

### F3 — [Medium] Restore có thể bị kẹt pending, không retry được

- Vị trí: `src/webview/SessionApp.tsx:259,286–299,345–347,586–589`; `src/extension/artifact-review-provider.ts:123–138`; `src/webview/ReviewApp.tsx:149–169,378–384`.
- Session: `setIsRestoring(true)` không có nhánh reset. Restore thành công → Archive lại trong cùng tab → Restore hiện disabled vĩnh viễn; nếu lần đầu lỗi hoặc support gate từ chối thì cũng kẹt ngay.
- Artifact: success patch có reset, nhưng catch phía host chỉ gọi `showErrorMessage`, không trả failure completion về webview. Lỗi ghi UI state khiến Restore giữ `Restoring...`/disabled và không thử lại được.
- Bằng chứng: truy vết message success/failure và toàn bộ call sites của `setIsRestoring`. Test UI hiện chỉ render markup/reducer, chưa mô phỏng chuỗi click/message này.
- Khuyến nghị: kết thúc pending trên cả success lẫn failure; host gửi action error cho artifact và UI giữ Archived/Restore cùng lỗi cục bộ. Bổ sung tương tác Restore → Archive → Restore và failure → retry.

### F4 — [Medium] Delete artifact trả/báo sai kết quả tại ranh giới commit và cleanup

- Vị trí: `src/extension/artifact-deletion.ts:130–139,154–176`; `src/extension/work-session-management-command.ts:116–126`.
- Trigger 1: rename sang staging thành công nhưng `fs.rm(stagedDir)` lỗi (ví dụ file bị lock). Primitive ném lỗi ra ngoài, coordinator không chạy prune dù artifact handle đã biến mất; trái commit point đã chốt ở Bước 2.3.
- **Đã tái hiện bằng fault injection trong fixture tạm:** ép riêng bước xoá staging ném `EBUSY` → lời gọi `deleteArtifactAndCleanup` throw nhưng `handleExists: false`.
- Trigger 2: target validation thất bại → `{deleted:false}`, hoặc cleanup throw → `{deleted:true}` không có cleanup result. Coordinator bỏ qua `deleted` và chỉ xem `conversationCleanup.skippedCount`, nên đều có thể báo “Artifact deleted permanently.” không đúng kết quả thực tế.
- Khuyến nghị: coi rename thành công là deleted; lỗi drain staging chỉ diagnostic, vẫn chạy cleanup. Trả status cleanup riêng và dùng đủ kết quả để phân biệt chưa xoá / đã xoá nhưng cleanup chưa hoàn tất / hoàn tất. Tách primitive dùng chung với retention như Bước 2 để giữ cùng semantics.

### F5 — [Medium] Persistence UI state không giữ boundary canonical root và regular file

- Vị trí: `src/extension/artifact-ui-state.ts:86–108,145–158,176–189`.
- Trigger: collection/registry root là junction tới nơi khác. `validateRealDirectory` chỉ kiểm tra chuỗi parent và `lstat` target child; child thật bên dưới junction vẫn vượt qua. Read helpers còn dùng `fs.readFile` trực tiếp, không chặn UI-state file symlink.
- **Đã tái hiện trên Windows bằng fixture tạm:** tạo `alias-home/.ai-artifacts/artifacts` dạng junction tới `outside`, đặt child `review-junction`, gọi `patchArtifactUiState(...,{pinned:true})` → thành công và tạo `outside/review-junction/artifact-ui-state.json`.
- Tác động: thao tác đi qua linked root, trái boundary “canonical parent đã kiểm tra, chỉ file thường, không theo symlink/junction” của Bước 1.2.
- Khuyến nghị: dùng root/directory safety helpers hiện có và regular-file validation trước read/replace, kể cả nhánh Windows copy fallback. Default chỉ dành cho file thiếu; không coi linked target là file hợp lệ.

### F6 — [Medium] Artifact editor chưa chuyển sang trạng thái terminal sau Delete

- Vị trí: `src/extension/artifact-review-provider.ts:60–70,406–415,447–465`; `src/webview/ReviewApp.tsx:208–215,347–357`.
- Trigger: artifact chưa submit đang mở, Delete từ sidebar. File watcher gọi `refresh`; `store.load` không tìm thấy artifact và host chỉ gửi `{type:"error"}`. Webview giữ nguyên snapshot cũ có `lifecycle.readOnly:false`; các nút Review/Proceed/feedback tiếp tục dựa trên snapshot đó. Event `{kind:"artifact"}` từ coordinator cũng không có nhánh terminal cho bound artifact.
- Tác động: editor vẫn cho thao tác vào artifact đã xoá, chỉ lỗi sau khi bấm; chưa đạt Bước 4.7. Phần Session đã có nhánh báo deleted, nhưng artifact chưa có.
- Bằng chứng: trace watcher → load failure → webview error handler → derive actions; chưa kiểm chứng watcher delivery thực tế trong Extension Host. Không kết luận có tái tạo dữ liệu vì store vẫn validate filesystem khi ghi.
- Khuyến nghị: khi exact artifact mất, gửi terminal deleted/unavailable hoặc read-only state và vô hiệu controls ghi. Không dùng mọi lỗi I/O làm kết luận “đã xoá”.

## Thông tin tham khảo / Khả năng có thể

| Mức | Vị trí | Trigger, ảnh hưởng và khuyến nghị |
| --- | --- | --- |
| Low | `src/extension/extension.ts:731–749` | Chưa có global watcher cho `artifact-ui-state.json`; Pin/Archive ở cửa sổ A chỉ notify service A, nên Recent ở cửa sổ B (kể cả chưa mở artifact editor) không refresh. Bổ sung watcher đúng filename, gửi scoped `artifactUiState` như Bước 4.5; không cần coordination/lock mới. |
| Low | `src/extension/artifact-review-provider.ts:433–441`; `src/extension/artifact-store.ts:285–295`; `src/extension/work-session-sidebar.ts:108–120,307–318` | UI-state JSON lỗi bị nuốt thành state trống/default: artifact đang Archived có thể hiện header thường và xuất hiện lại ở sidebar dù file chưa Restore. Giữ trạng thái đã biết/unknown và báo diagnostic cục bộ; không giả lập Restore vì parse lỗi (Bước 1, mục 3.1). |

## Validation thực hiện trong lượt review

| Kiểm chứng | Kết quả |
| --- | --- |
| `npm.cmd run check` | PASS — `tsc --noEmit`. |
| `npm.cmd test` | PASS — **52 test files, 702 passed, 3 skipped (705)**. Có build MCP trước Vitest. |
| `npm.cmd run build` | PASS — extension, uninstall, review webview, Shiki/Mermaid và MCP. |
| Fixture bổ sung | Đã tái hiện F1, F4 (staging failure) và F5 (Windows junction), chỉ trong temp root có guard đường dẫn; đã dọn fixture. Không thêm test/source vào repo. |
| `git -c core.safecrlf=false diff --check` trước khi ghi báo cáo | FAIL — `review.md:219: new blank line at EOF` có sẵn trong working tree. Đây là lỗi whitespace báo cáo, không phải lỗi feature. |
| `git -c core.safecrlf=false diff --check` sau khi ghi báo cáo | PASS — đã chuẩn hoá newline cuối chính file báo cáo. |
| Manual Extension Host | **Chưa chạy** native context menus, click Restore thực tế, multi-window watcher, clipboard hoặc editor Deleted state. Automated pass không thay bằng chứng này. |

Working tree được chỉnh tiếp trong lúc review (xuất hiện thêm thay đổi ở `skills/work-session/**`, `test/artifact-contracts.test.ts`, `test/work-session-skill.test.ts`). Kết quả test ở trên thuộc lần chạy đã ghi nhận, không phải chứng nhận cho các thay đổi đến sau hoặc Chặng 3. Các findings dựa trên file/luồng Chặng 1–2 đã đọc; chỉ file báo cáo này được reviewer chỉnh.

---

# Handoff — Code Review & Kiến trúc AI Artifacts (Phase 3 → Phase 4 → Phase 4.5) — 2026-11-08

> **Reception Rules for the Next AI:**
> 1. Inherit the decisions and analyses below according to their recorded status (`[Approved Verbatim]`, `[Decided]`, `[Verified]`, `[User-confirmed]` vs. `[AI-inferred]`, `[Unverified]`). Do not re-derive settled analysis from scratch; reopen a conclusion only when new evidence, a contradiction, or an explicit user review request requires it.
> 2. Do not re-propose directions listed under **Rejected Angles** unless their reopening condition is met.
> 3. Do not re-read workspace documents merely to reconstruct analyses already captured here. Consult files in the **Reference Map** when the next step requires unextracted detail, conflict verification, or updated scope.
> 4. Distinguish **Awaiting User Decision** (do not choose on the user's behalf) from **Unknown External Facts** and **Unverified Discrepancies**.

---

## 1. Context, History Coverage & Current Stopping Point

- **Active Objective:** Thực hiện code review sâu (theo skill `review-code`: chỉ đọc và báo cáo lỗi thực tế, không tự ý sửa code sản phẩm trừ khi Chú yêu cầu) cho dự án VS Code Extension **AI Artifacts** (`d:\workspace\my-projects\ai-artifacts`) qua chuỗi triển khai Work Sessions (Phase 3 → Phase 4 → Phase 4.5 → chuẩn bị sang Phase 5).
- **Compacted History Scope:** Toàn bộ cuộc trò chuyện từ đầu (Steps 0–792), bao gồm:
  - Review & nghiệm thu **Phase 3** (Chặng 1–3 + phần mở rộng Bước 7: Active Session contract).
  - Review & nghiệm thu **Phase 4** (Chặng 1: `instructions.md` storage & context resolver; Chặng 2: `join_session` MCP tool, shared `executeInspectCore`, Proceed directives theo kind; Chặng 3: Instructions UI, Connect, Add Session/Artifact, Recent kind filter, English UI).
  - Review wording & nghiệm thu **Phase 4.5** (Chặng 1: Standalone default MCP & contracts; Chặng 2: `Start a work session` UI, direct `Inspect artifact`, tách 2 skills `create-review-artifact` & `work-session`, README/branding; Chặng 3: Two-skill installer, independent version receipts, Claude dual-skill support, cleanup & tổng rà soát toàn diện Phase 4 + 4.5).
- **State at Pause (`[Verified (commit 882c178 + uncommitted Chặng 3 working tree, 2026-11-08)]`):**
  - **Git History:**
    - `777b5e5`: Phase 4 Chặng 1 (canonical `instructions.md` storage, session context resolver, kind helpers).
    - `cf6ed4f`: Phase 4 Chặng 2 (`join_session` tool, `executeInspectCore`, session context & Proceed directives).
    - `c339221`: Phase 4 Chặng 3 (UI adjustments, native pickers/filters, review hardening).
    - `86896ab`: Prepare Phase 4.5.
    - `1d57741`: Phase 4.5 Chặng 1 (standalone MCP & contracts).
    - `882c178`: Phase 4.5 Chặng 2 (UI `Start a work session` / direct `Inspect`, two skills split & `test/review-app.test.tsx`).
    - **Uncommitted working tree trên `882c178`:** Triển khai Phase 4.5 Chặng 3 (`src/extension/workspace-integration.ts`, `src/extension/mcp-clients/{skill-helper,claude-client,base-cleanup,index}.ts`, `test/{workspace-integration,mcp-client-drivers}.test.ts`, `docs/{ARCHITECTURE,CHANGE_LOGS,INSTRUCTION}.md`, `plans/work-session-artifact/{plan,plan-phase-5,note}.md`).
  - **Trạng thái kiểm chứng tự động ở điểm dừng:**
    - `npm.cmd run check` (`tsc --noEmit`, đã bao gồm `test/**/*.tsx`): **PASS** (exit code `0`).
    - `git -c core.safecrlf=false diff --check`: **PASS** (exit code `0`).
    - `npx vitest run`: **PASS — 48/48 test files, 665 passed, 3 skipped** (trong ~18.5s).
    - `npm.cmd run build`: **PASS** cả 5 targets (`dist/extension.cjs`, `dist/uninstall.cjs`, `dist/webview/review.js`, `dist/webview/{shiki,mermaid}.js`, `dist/integration/codex-artifacts-review-mcp.mjs`).
    - SHA-256 LF của 6 skill files + `agent-text.json` so với `plans/work-session-artifact/phase-4.5-wording/manifest.json`: **100% MATCH (7/7 files)**.
    - `audit_skill.py --platform codex`: **PASS (0 warnings)** cho cả `skills/create-review-artifact` (118 dòng, description 124 ký tự) và `skills/work-session` (41 dòng, description 124 ký tự).
  - **Bước tiếp theo ngay sau khi nhận Handoff:**
    - Chờ Chú fix **3 Actionable Findings còn mở của đợt review toàn diện Phase 4 + 4.5** (chi tiết đầy đủ tại **Mục 5.2** bên dưới: `1 Medium` ở `upgrade-notification.ts`/`extension.ts`, `1 Low` ở `checkAllIntegrations`/`summarizeIntegrationVerification`, `1 Low` ở `docs/*.md` + `README.md` + `test/release-contract.test.ts`), rồi review xác nhận bản fix hoặc tiếp tục review **Phase 5** (`plan-phase-5.md`) theo yêu cầu của Chú.

---

## 2. Valuable Synthesized Analyses

### 2.1. Bất biến Vòng đời Artifact, Waiter/Token Ownership & Ranh giới Rollback trong MCP
- **Conclusion & Metric Context (`[Verified (src/integration/artifact-review-mcp-v4.ts)]`):**
  - Hệ thống vận hành theo phân cấp vòng đời bất biến: `artifact lifetime > waiter lifetime > chat-turn lifetime`.
  - MCP server (`MCP_VERSION = 12`) cung cấp đúng **6 tools**: `resolve_artifact_window`, `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, `join_session`, `advance_and_wait_for_artifact`.
- **Mechanism / Causality / Trade-offs:**
  - **Identity vs. Routing:** `artifact.json` (schema v6, lưu tại `~/.ai-artifacts/artifacts/<artifactId>/`) là nguồn chân lý duy nhất về định danh artifact, không chứa đường dẫn workspace. `artifact-connection.json` (schema v1) chỉ lưu trạng thái điều hướng UI (`windowInstanceId`, `connectionRevision`, `openRequestId`, `source`, `updatedAt`). Các thao tác `wait_for_artifact_review`, `advance_and_wait_for_artifact`, và mọi thao tác điều hướng/tổ chức Session trên Extension Host **tuyệt đối không được ghi/sửa** `artifact-connection.json`.
  - **Thứ tự Commit & Cấp Round Token (`grantInspectedRound`):**
    - Trong [`executeInspectCore`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1560-L1765) và [`persistArtifact`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L635-L785), mọi bước có thể ném lỗi I/O hoặc schema — bao gồm: (1) đăng ký/làm mới membership (`registerArtifactInSession`), (2) resolve `SessionContext` (`resolveWorkSessionContext`), (3) đọc/ghi `artifact-connection.json` — đều phải nằm **bên trong khối `try/catch` có rollback** (`restorePreviousRegisteredAt` hoặc gỡ membership mới / `removeConversation(newSessionId)`).
    - Việc cấp round token trong bộ nhớ (`grantInspectedRound`) bắt buộc phải đặt **sau khi** toàn bộ các bước trên đã thành công. Nếu cấp token trước khi resolve context hoặc đọc connection, một lỗi ở bước sau sẽ kích hoạt rollback trên đĩa nhưng để rò rỉ một in-memory round token hợp lệ cho trạng thái đã bị hủy.

### 2.2. Kiến trúc Lưu trữ Work Session v2, Tách biệt `instructions.md` & Read-Only Context Resolver
- **Conclusion & Metric Context (`[Verified (src/shared/conversation-artifact-registry.ts, src/shared/work-session-context.ts)]`):**
  - Mỗi Work Session v2 tại `~/.ai-artifacts/conversation-registry/<sessionId>/` gồm: `conversation.json` (schema v2 metadata), `instructions.md` (nguồn nội dung Instructions duy nhất), `layout.json` (3 mảng `working`, `references`, `archived`), và `registered-artifacts/<artifactId>.json` (nguồn membership duy nhất).
- **Mechanism / Causality / Trade-offs:**
  - **Tương thích ngược không tự migrate trên `conversation.json`:**
    - `workSessionMetadataSchema` ([contracts.ts](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L221-L231)) giữ `.strict()` nhưng cho phép `instructions: z.string().optional()`. Nhờ vậy các Session v2 tạo ở Phase 1–3 (còn trường `instructions` inline trong JSON) vẫn parse hợp lệ khi đọc/list, không bị loại bỏ.
    - Tuy nhiên, nội dung `WorkSession.instructions` hiệu dụng chỉ đọc từ file `instructions.md` (nếu thiếu file thì trả `""`, không fallback sang trường JSON cũ và không tự tạo file khi read/list). Mọi hàm ghi metadata mới (`createSession`, `updateSessionDetails`, `setSessionType`, `migrateConversationToSession`) đều omit trường `instructions` khỏi `conversation.json`.
  - **Công thức `Session.updatedAt` động:**
    - `updatedAt = max(createdAt, ...registeredAt)` ([conversation-artifact-registry.ts](file:///d:/workspace/my-projects/ai-artifacts/src/shared/conversation-artifact-registry.ts#L240-L265)). Sửa title, đổi type, lưu `instructions.md`, hoặc chuyển vùng/sắp xếp trong `layout.json` **không làm tăng `updatedAt`**. Chỉ khi thêm/inspect artifact trong Session làm mới `registeredAt` thì Session mới tự nổi lên đầu danh sách mà không cần ghi lại `conversation.json`.
  - **Read-only Context & Catalog Verification (`resolveWorkSessionContext`):**
    - [`resolveWorkSessionContext`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/work-session-context.ts#L102-L170) gọi [`readSessionTypesWithoutSeeding`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/session-type-registry.ts#L98-L120) thay vì `listSessionTypes`, đảm bảo khi `join_session({ sessionId })` chạy trên máy chưa có `~/.ai-artifacts/session-types.json`, nó trả về default types trong bộ nhớ mà **không tạo file phụ trên đĩa** (nếu file đã tồn tại nhưng hỏng JSON/schema thì vẫn fail-closed ném lỗi).
    - Từng member trong catalog phải qua kiểm tra `lstat` (chặn symlink/junction), canonical path nằm trong global collection, manifest schema v6 hợp lệ và `manifest.artifactId === artifactId`. Nếu artifact bị xóa hoặc hỏng, mục đó trả `{ artifactId, unavailable: true }` thay vì làm gãy cả Session context hoặc lộ metadata giả.
    - [`extractMarkdownDescription`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/markdown-description.ts) parse AST Markdown lấy visible text, chuẩn hóa khoảng trắng và cắt ở `MAX_ARTIFACT_DESCRIPTION_LENGTH = 200` ký tự kèm `…`.

### 2.3. Hợp đồng Entry của MCP: Standalone Default vs. Session Opt-in & `join_session`
- **Conclusion & Metric Context (`[Verified (src/integration/artifact-review-mcp-v4.ts, test/mcp-join-session.test.ts)]`):**
  - Từ Phase 4.5, tạo/inspect artifact mặc định là **standalone** (`session: null`) trừ khi caller truyền `artifactConversationId` hoặc `conversationName`.
- **Mechanism / Causality / Trade-offs:**
  - **Bảng phân nhánh chính xác tại `create_artifact` & `inspect_artifact_review`:**
    1. **Không `artifactConversationId`, không `conversationName` (Standalone):** Không đọc/ghi `conversation-registry` hay `session-types.json`. Response trả `session: null` và **omit** cả hai trường flat `artifactConversationId` / `conversationName` (được khóa bởi union schema `artifactCreateResultSchema` và `artifactInspectionResultSchema` trong [contracts.ts](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L690-L735)). Kể cả khi `session-types.json` trên đĩa bị hỏng, nhánh standalone vẫn chạy thành công.
    2. **Có `artifactConversationId: S`:** Preflight `S` trước khi detach waiter hoặc ghi dữ liệu. Nếu `S` là conversation v1 → ném `CONVERSATION_MIGRATION_REQUIRED`; nếu thư mục/metadata `S` không tồn tại → hàm `preflightExistingWorkSession` bắt `ENOENT` và ném đúng `CONVERSATION_NOT_FOUND` (không để rơi vào catch `ENOENT` chung của artifact vốn map thành `ARTIFACT_NOT_FOUND`). Nếu hợp lệ → đăng ký/cập nhật `registeredAt` và trả `session: SessionContext`.
    3. **Chỉ có `conversationName` (không ID):** Tạo Session v2 mới với title đó, đăng ký artifact vào `Working`, trả `session: SessionContext`.
    4. **Có cả ID và name:** Ưu tiên `artifactConversationId`, bỏ qua `conversationName`.
  - **Cơ chế `join_session` ([artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1800-L1915)):**
    - Input parser chỉ chấp nhận `sessionId` (bắt buộc) và các tham số inspect (`artifactId`, `takeover`, `expectedReviewRound`, `intent`, `connection`).
    - Nếu **không có `artifactId`**: từ chối ngay mọi flag inspect đi kèm (`INVALID_ARTIFACT_INPUT`), chỉ gọi `resolveWorkSessionContext` và trả `{ session }`.
    - Nếu **có `artifactId`**: bắt buộc `takeover` (nếu có) phải là `boolean`, chỉ cho phép `connection` khi `intent === "reconnect"`, dựng canonical directory từ `artifactId` đã validate rồi gọi chung `executeInspectCore`, trả `{ session, inspection }` (trong đó `inspection` giữ flat fields của artifact, không lồng thêm `inspection.session`).
    - Khi gặp `WINDOW_SELECTION_REQUIRED` trong `join_session`, recovery metadata giữ nguyên `expectedNextTool: "join_session"` để AI retry đúng tool thay vì bị đẩy sang `inspect_artifact_review`.

### 2.4. Phân loại Artifact Kind & Proceed Directives (`execute-approved-plan` vs `approved`)
- **Conclusion & Metric Context (`[Verified (src/shared/artifact-kinds.ts, src/integration/artifact-review-mcp-v4.ts)]`):**
  - 10 fixed kinds: `plan`, `implementation-plan`, `idea`, `analysis`, `design`, `spec`, `checklist`, `report`, `guide`, `note`, cùng các open kinds theo regex slug.
- **Mechanism / Causality / Trade-offs:**
  - Khi người dùng bấm **Proceed** (`decision: "approve"`), cả `wait_for_artifact_review` và `advance_and_wait_for_artifact` đều dùng [`isPlanProceedKind(kind)`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/artifact-kinds.ts#L28-L30):
    - `plan` hoặc `implementation-plan` → `nextAction: { type: "execute-approved-plan", instruction: "Execute the approved plan immediately in this same turn..." }`.
    - Mọi fixed/open kind khác → `nextAction: { type: "approved", instruction: "The user has approved this artifact. Acknowledge the approval and conclude the review. Do not automatically implement code or start another review round." }`.
  - **Ranh giới an toàn:** Chỉ kết quả trả về từ `wait_for_artifact_review` và `advance_and_wait_for_artifact` mới chứa `nextAction`. Kết quả snapshot từ `inspect_artifact_review` / `join_session` chỉ chứa `submission` đã lưu trên đĩa, không bao giờ phát lại `nextAction` để tránh AI tự thực thi lại một plan cũ khi reconnect.

### 2.5. Scoped Refresh Pipeline, Bảo toàn Draft `instructions.md` & Luồng UI Extension Host
- **Conclusion & Metric Context (`[Verified (src/extension/work-session-provider.ts, src/extension/artifact-review-provider.ts, src/webview/ReviewApp.tsx)]`):**
  - Extension Host phân loại sự kiện file watcher thành các batch có kiểu (`metadata`, `instructions`, `membership`, `layout`, `artifact`, `types`, `support`) và cập nhật từng phần giao diện mà không làm mất trạng thái đang nhập của người dùng.
- **Mechanism / Causality / Trade-offs:**
  - **Xử lý Batch hỗn hợp trong `WorkSessionProvider` ([work-session-provider.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/work-session-provider.ts#L164-L227)):**
    - Không dùng `changes.every(...)`. Provider tính 3 cờ độc lập (`hasMetadataOrTypes`, `hasInstructions`, `hasArtifactsOrLayout`) sau khi đã lọc các thay đổi thuộc về `document.sessionId` (hoặc các `artifactId` đang là member của Session đó).
    - Biến `lastPersistedInstructions` lưu nội dung `instructions.md` trên đĩa lần gần nhất. Khi user bấm Save, `lastPersistedInstructions` được cập nhật ngay trước khi watcher nổ, nên sự kiện echo từ chính thao tác Save đó không sinh `workSessionInstructionsPatch` thừa. Khi AI hoặc editor bên ngoài sửa `instructions.md`, `session.instructions !== lastPersistedInstructions` kích hoạt `workSessionInstructionsPatch` cập nhật thẳng vào textarea.
  - **4 trạng thái nút Session trên `ReviewApp.tsx` ([ReviewApp.tsx](file:///d:/workspace/my-projects/ai-artifacts/src/webview/ReviewApp.tsx#L460-L502)):**
    1. `!sessionSupport.supported` → nút `Sessions` bị disable kèm tooltip lý do.
    2. `sessionSupport.supported && !sessionsLoaded` → nút `Sessions` bị disable (`Loading sessions...`).
    3. `sessionSupport.supported && sessionsLoaded && sessions.length === 0` → hiển thị cụm `.start-session-container` gồm nút `Start a work session` và helper text `"For ongoing work, keep related artifacts and shared instructions together across agents and chats."`.
    4. `sessions.length > 0` (có v2 hoặc legacy v1) → hiển thị nút `Sessions` kèm badge số lượng.
  - **Xử lý lỗi sau commit của `startWorkSession` ([artifact-review-provider.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/artifact-review-provider.ts#L176-L230)):**
    - Nếu `registerArtifactInSession` lỗi sau khi `createSession` đã tạo thư mục → gọi `removeConversation(session.sessionId, this.rootOptions)` để rollback sạch Session mới tạo.
    - Khi `createSession` + `registerArtifactInSession` đã thành công (đã qua điểm commit), hai bước phụ `openWorkSession` và `clipboard.writeText` chạy trong 2 khối `try/catch` độc lập (`openSucceeded`, `copySucceeded`), hiển thị đúng 1 trong 4 thông báo chuẩn từ `agent-text.json` và không bao giờ rollback hay tạo trùng Session khi bước phụ lỗi.

### 2.6. Cơ chế Hai Skills Độc lập, Customize Boundary & Receipt Versioning
- **Conclusion & Metric Context (`[Verified (src/extension/workspace-integration.ts, src/extension/mcp-clients/skill-helper.ts, src/extension/mcp-clients/claude-client.ts)]`):**
  - Hệ thống đóng gói 2 skills anh em dưới `skills/`:
    - `skills/create-review-artifact` (`CREATE_REVIEW_ARTIFACT_SKILL_VERSION = 4`, `SKILL_VERSION = 4`): quản lý vòng đời review artifact độc lập + mục `Work Session Bridge` ngắn gọn.
    - `skills/work-session` (`WORK_SESSION_SKILL_VERSION = 2`): quản lý kết nối Session (`join_session`), giữ active Session ID trong bộ nhớ chat, đọc chọn lọc qua catalog path và cập nhật `instructions.md`.
- **Mechanism / Causality / Trade-offs:**
  - **Customize Merge chỉ áp dụng cho `create-review-artifact`:**
    - `replaceSkillDirectory` kiểm tra nghiêm ngặt `name: create-review-artifact`, giữ lại `description:` tùy chỉnh (nếu không nằm trong `OFFICIAL_SKILL_DESCRIPTIONS`) và nội dung giữa hai marker `USER CUSTOM RULES`. Vì `OFFICIAL_SKILL_DESCRIPTIONS` ([skill-helper.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/mcp-clients/skill-helper.ts#L7-L11)) giữ cả câu description của Phase 4 (`"...join work sessions..."`), các máy đã cài bản Phase 4 sẽ tự động được nâng cấp về description mới của Phase 4.5 mà không bị nhầm là custom description của user.
    - `replaceOfficialSkillDirectory` ([skill-helper.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/mcp-clients/skill-helper.ts#L474-L526)) cài đặt `work-session` theo danh sách 3 files (`WORK_SESSION_SKILL_ASSETS`) qua thư mục staging `.work-session-skill-install-*` và hoán đổi nguyên tử mà không đi qua bộ parser custom markers.
  - **Multi-target Deployment & Cleanup:**
    - `setupBaseMcpServer` cài cả 2 skills vào `~/.agents/skills/{create-review-artifact,work-session}` và ghi receipt `skills.agents = 4`, `sessionSkills.agents = 2`.
    - `ClaudeClientDriver` cài và kiểm tra cả 2 skills vào `~/.claude/skills/{create-review-artifact,work-session}` và ghi receipt `skills.claude = 4`, `sessionSkills.claude = 2`.
    - `cleanupBaseMcpServer` ([base-cleanup.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/mcp-clients/base-cleanup.ts#L20-L39)) xóa đúng các thư mục skill do extension quản lý ở cả `.agents` và `.claude`, bảo toàn các skill khác của user và dữ liệu `~/.ai-artifacts/artifacts/`.

---

## 3. User Decisions, Verbatim Approvals & Corrections

- **[Decided & Key Correction — Version Numbers của Skills]:**
  - *Flawed prior view:* AI từng báo finding `[Medium]` vì thấy `contracts.ts` và `manifest.json` đặt `CREATE_REVIEW_ARTIFACT_SKILL_VERSION = 4`, `WORK_SESSION_SKILL_VERSION = 2`, `SKILL_VERSION = 4` thay vì `7` / `1` như ghi trong văn bản `plan-phase-4.5.md`.
  - *Corrected conclusion (`[User-confirmed]`):* Chú khẳng định: **`"cái này là quyết định của tôi, skill 7 là sai, bỏ ra khỏi review đi"`**. Bộ số chuẩn đã chốt trong code là:
    - `MCP_VERSION = 12` (giữ nguyên cho toàn bộ tính năng Work Session chưa phát hành)
    - `CREATE_REVIEW_ARTIFACT_SKILL_VERSION = 4`
    - `WORK_SESSION_SKILL_VERSION = 2`
    - `SKILL_VERSION = 4`
  - **Quy tắc cho AI tiếp theo:** Tuyệt đối không báo lỗi code về bộ số `4` / `2` / `4` này nữa; ngược lại, mọi tài liệu (`README.md`, `docs/*.md`, `test/release-contract.test.ts`) còn ghi `SKILL_VERSION = 6` hoặc `7`/`1` phải được coi là tài liệu cũ cần đồng bộ theo code `4` / `2`.
- **[Decided — Không triển khai Custom Rules cho `work-session` skill ở giai đoạn này]:**
  - *Stated Reason:* Chú chốt `"work session chưa triển khai custom, để sau"`. `work-session` được cài đặt và verify nguyên bản qua `replaceOfficialSkillDirectory`.
- **[Decided — Chấp nhận wording trong `work-session` skill và `agent-text.json`]:**
  - Chú đã xem xét và chốt bỏ qua (giữ nguyên, không sửa):
    1. Dòng `"Explicit artifact creation with a new Session"` trong `work-session/SKILL.md:16` và `references/session-contract.md:20`.
    2. Câu `"Use the work-session skill..."` trong `agent-text.json` (vì `"skill và mcp upgrade cùng lúc qua 1 nút, ko quan tâm"`).
- **[Approved Verbatim — Bộ Wording đóng băng của Phase 4.5]:**
  - Toàn bộ 6 file skill mẫu trong `plans/work-session-artifact/phase-4.5-wording/`, 24 chuỗi `initialize.instructions` + tool/arg descriptions + prompt templates + UI strings trong [agent-text.json](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/phase-4.5-wording/agent-text.json), và cấu trúc README/metadata (`displayName`, `description` 274 ký tự) trong [readme-branding.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/phase-4.5-wording/readme-branding.md) là văn bản đã khóa nguyên văn.
- **[Key Correction — Quy trình Review nhiều Chặng trong một Phase]:**
  - *Flawed prior view:* Khi Chú đã commit các chặng trước và gọi review ở chặng cuối, nếu chỉ xem `git diff HEAD` sẽ bỏ sót các lỗi tiềm ẩn nằm ở code của chặng đã commit trước đó (hoặc lỗi giao thoa giữa các chặng).
  - *Corrected conclusion:* Khi review kết thúc một Phase hoặc review tổng thể, phải đối chiếu toàn bộ diff tính từ commit gốc trước Chặng 1 của Phase đó (kết hợp đọc trực tiếp các file liên quan) để đảm bảo không lọt lỗi xuyên chặng.

---

## 4. Analyzed but Rejected Angles

| Rejected Angle / Option | Technical or Practical Reason | Reopening Condition (if any) |
| :--- | :--- | :--- |
| Tự động tạo Work Session mỗi khi `create_artifact` / `inspect_artifact_review` không truyền ID (cơ chế cũ của Phase 1–4) | Gây rác danh sách Sessions với các phiên 1-artifact khi user chỉ muốn review một tài liệu độc lập. Đã thay bằng **Standalone Default** (`session: null`) ở Phase 4.5. | Không mở lại; đã bị thay thế hoàn toàn bởi kiến trúc Phase 4.5. |
| Giữ hộp thoại `ArtifactConnectDialog.tsx` (chọn New Session vs Join Session) khi bấm nút Inspect trên Review App | Làm phức tạp thao tác inspect artifact đơn lẻ và chồng chéo với Session Manager. Đã xóa `ArtifactConnectDialog.tsx`; nút `Inspect artifact` nay copy thẳng prompt 2 dòng, còn tạo phiên mới từ artifact dùng nút `Start a work session`. | Không mở lại. |
| Lưu `instructions` inline trong `conversation.json` hoặc fallback đọc trường `instructions` cũ từ JSON khi thiếu `instructions.md` | Gây xung đột khi vừa sửa metadata vừa sửa nội dung Markdown dài, và khiến AI không thể dùng công cụ đọc/sửa file Markdown chuẩn. Đã tách hẳn sang `instructions.md`; schema đọc chỉ chấp nhận trường cũ để không crash nhưng bỏ qua giá trị đó. | Không mở lại. |
| Dùng `ArtifactReviewOpenCoordinator.open` để mở file `instructions.md` khi bấm `Open Markdown File` | `ArtifactReviewOpenCoordinator` khóa cứng validation cho `artifact.md` nằm trong `~/.ai-artifacts/artifacts/<id>/` nên sẽ từ chối `instructions.md`. Đã giải quyết bằng cách inject `openTextDocument` (`vscode.window.showTextDocument`) kèm kiểm tra symlink và tạo file `{ flag: "wx", mode: 0o600 }`. | Không mở lại. |
| Bổ sung cơ chế custom rules (`USER CUSTOM RULES` / merge frontmatter) cho skill thứ hai `work-session` | Chưa cần thiết ở Phase 4.5 và làm phức tạp hóa `skill-helper.ts`. | Chỉ mở lại ở phase tương lai khi Chú có yêu cầu rõ ràng về việc cho phép user customize `work-session` skill. |

---

## 5. Open Threads

### 5.1. `[Awaiting User Decision]`
- **Quyết định xử lý 3 Actionable Findings còn lại của Phase 4 + 4.5 (mục 5.3 bên dưới):** Chú sẽ quyết định tự sửa hoặc yêu cầu AI sửa 3 mục này trước khi đóng hoàn toàn Phase 4.5 và chuyển sang triển khai **Phase 5** ([plan-phase-5.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan-phase-5.md)).

### 5.2. `[Unknown External / Empirical Facts]`
- **Asset ảnh động `media/work-session.gif`:** Được ghi chú trong [plan-phase-4.5.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan-phase-4.5.md#L225) là chờ Chú cung cấp thực tế; hiện `README.md` chỉ đặt phần caption/text chuẩn, không chèn link ảnh hỏng.
- **Kiểm chứng thủ công (Manual Runtime Validation) trên VS Code Extension Development Host & AI Client thực tế:** Toàn bộ 48 file test tự động (`665 passed`) và build 5 targets đã pass trên môi trường cô lập, nhưng các tương tác UI thực tế (focus, clipboard, native InputBox/QuickPick, AI client continuation thực tế với 2 skills) thuộc phạm vi nghiệm thu thực tế của Chú.

### 5.3. `[Unverified Hypotheses / Discrepancies]` — 3 Actionable Findings từ đợt Review Toàn diện Phase 4 & 4.5 (Cần theo dõi khi Chú fix)

Đây là **3 findings thực tế đã xác minh (`[Verified]`)** trong working tree hiện tại mà agent tiếp theo cần nắm rõ để kiểm tra khi Chú báo `"đã fix xong, review lại"`:

#### 1. `[Medium]` `upgrade-notification.ts` và `extension.ts` chưa kiểm tra `sessionSkills` (`WORK_SESSION_SKILL_VERSION`) khi tính danh sách `staleAssets` lúc khởi động
- **Vị trí:**
  - [src/extension/upgrade-notification.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/upgrade-notification.ts#L12-L31) và [dòng 65–80](file:///d:/workspace/my-projects/ai-artifacts/src/extension/upgrade-notification.ts#L65-L80)
  - [src/extension/extension.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/extension.ts#L603-L608)
- **Cơ chế lỗi & Tác động:**
  - Theo [plan-phase-4.5.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan-phase-4.5.md#L135) (dòng 135, 149, 237) và [docs/ARCHITECTURE.md](file:///d:/workspace/my-projects/ai-artifacts/docs/ARCHITECTURE.md#L126-L130), manifest `~/.ai-artifacts/managed/integration-version.json` lưu độc lập `skills` (`create-review-artifact`) và `sessionSkills` (`work-session`) cho từng target (`agents`, `claude`); thiếu hoặc lệch `sessionSkills` phải làm target đó bị coi là stale.
  - Hiện tại `extension.ts` chỉ truyền `bundledVersions: { mcpVersion: MCP_VERSION, skillVersion: SKILL_VERSION }`, và hàm [`computeStaleIntegrationAssets`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/upgrade-notification.ts#L74-L78) chỉ kiểm tra `manifest?.skills[target] !== bundledVersions.skillVersion`, bỏ qua hoàn toàn `manifest?.sessionSkills?.[target]`.
  - Hệ quả: Máy đã có `{ mcpVersion: 12, skills: { agents: 4 } }` nhưng thiếu `sessionSkills` (hoặc khi `WORK_SESSION_SKILL_VERSION` tăng độc lập) sẽ nhận `staleAssets = []` và không được nhắc chạy Installer.
- **Hướng fix chuẩn để đối chiếu:**
  - Thêm `sessionSkillVersion: number` vào `bundledVersions` và `IntegrationNotificationState` trong `upgrade-notification.ts`, truyền `sessionSkillVersion: WORK_SESSION_SKILL_VERSION` từ `extension.ts`, và kiểm tra `manifest?.skills[target] !== bundledVersions.skillVersion || manifest?.sessionSkills?.[target] !== bundledVersions.sessionSkillVersion` trong `computeStaleIntegrationAssets` (hoặc tách asset stale riêng), kèm cập nhật `test/upgrade-notification.test.ts`.

#### 2. `[Low]` `checkAllIntegrations` và `summarizeIntegrationVerification` gộp chung trạng thái 2 skills thành một biến `skillCurrent`
- **Vị trí:**
  - [src/extension/workspace-integration.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/workspace-integration.ts#L503-L543)
  - [src/extension/integration-verification.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/integration-verification.ts#L9-L40)
- **Cơ chế lỗi & Tác động:**
  - Theo Bước 5 mục 5 ([plan-phase-4.5.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan-phase-4.5.md#L238)): *"Readiness giữ artifact result hiện có, bổ sung Session result và detail phân biệt asset nào thiếu/stale."*
  - Hiện tại `checkAllIntegrations` tính riêng `skillCurrent` và `sessionSkillCurrent` nhưng chỉ trả ra `{ skillCurrent: skillCurrent && sessionSkillCurrent, baseCurrent, clients }`, khiến `summarizeIntegrationVerification` chỉ báo chung `"Agent skill: Outdated / Missing."` mà không phân biệt được `create-review-artifact` hay `work-session` bị thiếu/outdated.
- **Hướng fix chuẩn để đối chiếu:**
  - Bổ sung `sessionSkillCurrent` vào `checkAllIntegrations` / `IntegrationVerificationReport`, hiển thị trạng thái Session skill trong `summarizeIntegrationVerification` (và `detail` khi base asset thiếu/outdated), cập nhật `test/integration-verification.test.ts`.

#### 3. `[Low]` Tài liệu canonical (`README.md`, `docs/*.md`) và `test/release-contract.test.ts` còn giữ một số đoạn mô tả cũ mâu thuẫn với code Phase 4 & 4.5
- **Vị trí & Chi tiết cần đồng bộ:**
  1. **Version numbers (`SKILL_VERSION = 6` cũ so với `4` / `2` thực tế):**
     - [README.md](file:///d:/workspace/my-projects/ai-artifacts/README.md#L139) (dòng 139, 341), [docs/PHILOSOPHY.md](file:///d:/workspace/my-projects/ai-artifacts/docs/PHILOSOPHY.md#L64) (dòng 64), [docs/ARCHITECTURE.md](file:///d:/workspace/my-projects/ai-artifacts/docs/ARCHITECTURE.md#L136) (dòng 136), và [test/release-contract.test.ts](file:///d:/workspace/my-projects/ai-artifacts/test/release-contract.test.ts#L134-L146) (dòng 134, 146) vẫn đang ghi `SKILL_VERSION = 6` / `numeric skill version 6` thay vì `CREATE_REVIEW_ARTIFACT_SKILL_VERSION = 4` (`SKILL_VERSION = 4`) và `WORK_SESSION_SKILL_VERSION = 2`.
  2. **[docs/ARCHITECTURE.md](file:///d:/workspace/my-projects/ai-artifacts/docs/ARCHITECTURE.md#L22-L118):**
     - Dòng 22, 30, 115–117: Vẫn nhắc tới `ArtifactConnectDialog` (New Session vs Join Session) đã bị xóa ở Phase 4.5.
     - Dòng 44–50 (`## Lifecycle tools`): Mới liệt kê 5 tools (thiếu tool thứ 6 `join_session`), dòng 46 vẫn ghi *"The official skill always sends `kind: "implementation-plan"`"* (mâu thuẫn với 10 fixed + open kinds), và vẫn mô tả `create_artifact` luôn đăng ký vào `conversation-registry` (mâu thuẫn với standalone default).
     - Dòng 53: Vẫn ghi *"Approve for other kinds and save return no next action"* (thực tế approve cho non-plan trả `nextAction.type: "approved"`).
     - Dòng 114: Vẫn ghi *"edited directly in `conversation.json` by an AI agent"* thay vì `instructions.md`.
  3. **[docs/INSTRUCTION.md](file:///d:/workspace/my-projects/ai-artifacts/docs/INSTRUCTION.md#L89-L92):**
     - Dòng 89 vẫn ghi `includes ReviewApp.tsx (Sessions button and ArtifactConnectDialog.tsx)`; dòng 92 thiếu `skills/work-session/`.
  4. **[docs/PHILOSOPHY.md](file:///d:/workspace/my-projects/ai-artifacts/docs/PHILOSOPHY.md#L44-L80) & [docs/COMPONENTS.md](file:///d:/workspace/my-projects/ai-artifacts/docs/COMPONENTS.md#L69-L558):**
     - `docs/PHILOSOPHY.md:72` và `docs/COMPONENTS.md:550-558` vẫn mô tả drawer v1 cũ (**Artifacts in Conversation** / `listConversationArtifacts`).
     - `docs/COMPONENTS.md` vẫn ghi 4 lifecycle tools + 1 resolver (dòng 114), `conversation.json` schema-v1 + `.conversation.lock` (dòng 124, 218–235), và vẫn liệt kê `src/webview/ArtifactConnectDialog.tsx` (dòng 364, 376).

---

## 6. Reference Map (Workspace Documents & Artifacts)

| Path & Section | Core Substance Preserved Inline | When Deeper Reading Is Needed |
| :--- | :--- | :--- |
| [plan.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan.md) | Tổng quan lộ trình 5 Phases (Phase 1+2, 3, 4, 4.5 đã triển khai; Phase 5 chưa triển khai) và các bất biến kiến trúc xuyên suốt. | Đọc mục `Phase 5` (dòng 156–250) khi bắt đầu review hoặc triển khai Phase 5. |
| [plan-phase-4.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan-phase-4.md) | Toàn bộ contract của `instructions.md`, `SessionContext`, `join_session`, 10 fixed kinds + open kinds, Proceed `approved`, Add Session/Add Artifact, Recent kind filter. | Chỉ cần tra cứu lại nếu cần đối chiếu chi tiết checklist manual (mục 6, dòng 492–506). |
| [plan-phase-4.5.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan-phase-4.5.md) | Toàn bộ contract Standalone Default, `Start a work session`, bỏ `ArtifactConnectDialog`, tách 2 skills, receipt `skills` + `sessionSkills`, customize artifact-only. *(Lưu ý: bỏ qua con số version `7`/`1` trong file này vì Chú đã chốt `4`/`2` ở Mục 3)*. | Đọc mục `Bước 5` & `Bước 6` (dòng 230–255) khi kiểm tra lại bản fix của Chặng 3 Phase 4.5. |
| [phase-4.5-wording/manifest.json](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/phase-4.5-wording/manifest.json) & [agent-text.json](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/phase-4.5-wording/agent-text.json) | Bảng SHA-256 LF của 6 skill files + 24 dòng `initialize.instructions` + tool/arg descriptions + prompt templates + UI strings. Đã verify khớp 100%. | Chỉ đọc khi có thay đổi trên `skills/**`, `artifact-review-mcp-v4.ts`, `artifact-connect-prompt.ts`, `session-connect-prompt.ts`, hoặc `ReviewApp.tsx`. |
| [plan-phase-5.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan-phase-5.md) | Kế hoạch chi tiết 8 bước / 3 chặng cho Phase 5 (UI state `artifact-ui-state.json` / `session-ui-state.json`, Pin/Archive/Restore/Delete, Card grid, sửa artifact title/kind + MCP re-read kind khi Proceed, Export ZIP). | Đọc toàn bộ file này trước khi bắt đầu review bất kỳ chặng nào của Phase 5. |
| [artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts) | Đã tóm tắt đầy đủ cơ chế `persistArtifact`, `executeInspectCore`, `handleJoinSessionTool`, standalone vs session branches và rollback boundary tại Mục 2.1 & 2.3. | Đọc trực tiếp khi review thay đổi ở MCP server (ví dụ Bước 6.2 của Phase 5 khi MCP re-read manifest kind lúc xử lý submission). |
| [workspace-integration.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/workspace-integration.ts), [upgrade-notification.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/upgrade-notification.ts), [integration-verification.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/integration-verification.ts) | Đã phân tích chi tiết cơ chế cài đặt 2 skills, ghi receipt `skills`/`sessionSkills` và 2 findings còn mở (`[Medium]` ở `upgrade-notification.ts`, `[Low]` ở `checkAllIntegrations`/`summarizeIntegrationVerification`) tại Mục 2.6 & 5.3. | Đọc trực tiếp khi review bản fix của Chú cho Chặng 3 Phase 4.5. |
