# Phase 4.5 — Artifact độc lập và Work Session skill: hướng dẫn triển khai

Trạng thái: **Chưa triển khai — 6 bước / 3 chặng.** Lập ngày **2026-11-07**, trên baseline Phase 4 đã hoàn thành theo checkpoint của phase đó. Lượt này chỉ lập tài liệu và bộ wording mẫu; không thay source, installed skills/runtime hoặc dữ liệu global.

Nguồn: [plan tổng](plan.md), [Phase 4](plan-phase-4.md), [Phase 5](plan-phase-5.md), [note](note.md) và các quyết định tiếp nối của Chú. Phase 4.5 thay hành vi tự tạo Session và popup Inspect New/Join của các phase trước; không viết lại lịch sử hoàn thành Phase 4.

## 1. Quy tắc bắt buộc về wording

**Toàn văn wording đích đã có trong [phase-4.5-wording/](phase-4.5-wording/manifest.json). Implementation phải chép đúng các file mẫu, không diễn đạt lại, dịch, tự thêm ví dụ hoặc tự gộp/bỏ câu.** Chỉ cho phép chuẩn hoá CRLF thành LF khi so sánh; không trim hoặc đổi punctuation. Ngoại lệ duy nhất ở installed artifact skill là hai customization points đã được hỗ trợ; không áp ngoại lệ này cho packaged source hoặc Session skill.

| File mẫu trong thư mục wording | File đích khi triển khai |
| --- | --- |
| [create-review-artifact/SKILL.md](phase-4.5-wording/create-review-artifact/SKILL.md) | `skills/create-review-artifact/SKILL.md` |
| [create-review-artifact/references/artifact-contract.md](phase-4.5-wording/create-review-artifact/references/artifact-contract.md) | `skills/create-review-artifact/references/artifact-contract.md` |
| [create-review-artifact/agents/openai.yaml](phase-4.5-wording/create-review-artifact/agents/openai.yaml) | `skills/create-review-artifact/agents/openai.yaml` |
| [work-session/SKILL.md](phase-4.5-wording/work-session/SKILL.md) | `skills/work-session/SKILL.md` — mới |
| [work-session/references/session-contract.md](phase-4.5-wording/work-session/references/session-contract.md) | `skills/work-session/references/session-contract.md` — mới |
| [work-session/agents/openai.yaml](phase-4.5-wording/work-session/agents/openai.yaml) | `skills/work-session/agents/openai.yaml` — mới |

[manifest.json](phase-4.5-wording/manifest.json) ghi hash SHA-256 LF của từng file đích và hash baseline skill hiện tại để nhận biết drift. [agent-text.json](phase-4.5-wording/agent-text.json) chốt nguyên văn 24 chuỗi `initialize.instructions`, descriptions cần đổi trong tools/list, hai Connect/Inspect prompt templates và UI wording. Đây là tài liệu đóng băng; **runtime không import từ `plans/`**. Chép chuỗi tương ứng vào source, còn templates chỉ thay các placeholders được chỉ định.

Nếu source baseline thay đổi trước lúc áp dụng, đọc diff của phần đó và giữ thay đổi ngoài phạm vi; không dùng việc drift làm lý do tự viết lại wording mẫu. Nếu wording thật sự cần sửa để khớp API mới, trình Chú nội dung thay đổi trước, rồi mới cập nhật payload/hash. Không sửa tests chỉ để hợp thức hoá wording ngoài payload.

## 2. Phạm vi theo component và ranh giới

| Component | Kết quả cần đạt |
| --- | --- |
| MCP create/inspect | Không ID/không tên phiên → standalone; ID → đăng ký vào phiên đó; tên không ID → tạo phiên mới theo yêu cầu. Không tự sinh phiên chỉ vì artifact chưa có ID. |
| Session context | Khi chat đã kết nối S, create/inspect truyền S để tự thêm/làm mới membership, trừ explicit standalone. Chat giữ tối đa một active Session; MCP không lưu active ID hộ chat. |
| Artifact Inspect UI | Copy prompt inspect exact artifact, không chọn/tạo/chuyển Session. Bỏ popup New/Join. Prompt không nhắc Session cũng không có nghĩa standalone nếu chat đang có S. |
| Start Session UI | Artifact không có membership hiển thị **Start a work session**, nhập tên rồi tạo Session + đăng ký artifact hiện tại vào Working; mở manager và copy Connect prompt. |
| Hai skills | Artifact skill giữ lifecycle + cầu nối ngắn; Session skill giữ entry/active context/Instructions/catalog/refresh và Session recovery. |
| Version và installer | Artifact skill **7**, Session skill **1**, counter độc lập. Cài/verify cả hai theo target `.agents`/`.claude`; customize chỉ artifact skill. |

**Ngoài phạm vi:** tool MCP mới, watcher đẩy context vào chat, lưu mapping chat→Session trên đĩa, bulk backfill artifact cũ trong chat, migration/đổi artifact schema, thay ownership/token/review/Proceed, rich editor/attachments, locks/CAS/conflict/dirty recovery, generic customization framework hoặc customize Session skill. Grid, Module seed, Pin/Archive/Restore/Delete, cleanup và ZIP giữ ở Phase 5.

Làm **4 → 4.5 → 5** trên các file dùng chung. Phase 5 tiếp nhận contract, helper và UI entry đã xong của 4.5; không mang popup New/Join hoặc auto-create cũ trở lại. Artifact đã có memberships vẫn giữ nguyên; không tự xoá/gộp Session hoặc di chuyển artifacts cũ.

## 3. Hiện trạng code cần tận dụng

Snapshot đọc ngày 2026-11-07; khi bắt đầu implementation đọc lại diff vì Phase 4 vừa có thay đổi.

| Source hiện có | Điểm sửa/tận dụng |
| --- | --- |
| `src/integration/artifact-review-mcp-v4.ts` | `persistArtifact` và shared inspect core vẫn có nhánh không ID → `createSession`; kết quả hiện luôn có Session. `artifactHandle` đã nhận conversation optional; token/wait dựa trên artifact `reviewSessionId`, không phải Work Session ID. Join-only hiện trả context read-only. |
| `src/shared/contracts.ts` | MCP 12, `SKILL_VERSION` 6; artifact schema 6, Session schema 2. Receipt v1 có `skills.agents`/`skills.claude` number cho artifact skill, chưa có version Session skill. |
| `src/shared/conversation-artifact-registry.ts` | Có `createSession`, `registerArtifactInSession`, `removeConversation`, scoped membership/layout và derived recency. Dùng lại để tạo+đăng ký và rollback đúng phiên vừa tạo. |
| `src/extension/session-create-command.ts` | Tạo phiên rỗng từ sidebar, mở editor, đã tách lỗi tạo và lỗi mở; mở lỗi vẫn trả ID đã tạo. Giữ hành vi này, tận dụng phần nhập tên/tạo/mở khi thêm Start từ artifact. |
| `src/extension/conversation-artifact-service.ts` | Có create/register/getArtifactSessions và notify theo ID. `getArtifactSessions` trả cả Session v2 và legacy v1 để migration. |
| `artifact-review-provider.ts`, `ReviewApp.tsx`, `ArtifactConnectDialog.tsx` | Provider hiện gặp 0 membership thì báo chưa có Session; nút copy prompt hiện mở New/Join. Thêm Start vào vị trí nút Sessions hiện có, bỏ việc copy prompt đi qua dialog New/Join. |
| `src/shared/artifact-connect-prompt.ts`, `session-connect-prompt.ts` | Đã tách builder artifact/Session nhưng artifact builder còn mode legacy/new/join. Giản lược artifact builder; Session builder dùng wording đã đóng băng. |
| `skills/create-review-artifact/` | Một skill đang giữ cả lifecycle và Session. Bản mẫu giữ nguyên các đoạn review quan trọng, chuyển Session ra skill mới và chỉ gộp các phần lặp đã được Chú duyệt. |
| `workspace-integration.ts`, `mcp-clients/skill-helper.ts`, `claude-client.ts` | Đường dẫn source/target, asset list, name validation và merge customize đang dành cho một artifact skill. Thêm Session installer/verification riêng; không gọi artifact customization merge cho Session. |
| `integration-verification.ts`, `global-integration-status.ts`, `mcp-clients/base-cleanup.ts` | Cập nhật readiness/stale detail và cleanup đúng hai skill theo target; giữ MCP config drivers, detection và user review data. |

Baseline review trước khi lập plan: **7 suites / 87 tests pass**, gồm MCP Join, Session create/add commands, artifact prompt, skill contract, workspace integration và MCP client drivers. Đây là bằng chứng baseline, không chứng minh 4.5 hoặc agent behavior mới đã hoạt động. Lượt viết wording/plan không thay thế kiểm chứng implementation sau này.

## 4. Contract implementation đã chốt

### 4.1. Chọn Session ở create/inspect

| Arguments | Hành vi MCP | Context chat |
| --- | --- | --- |
| Không `artifactConversationId`, không `conversationName` | Tạo/inspect artifact độc lập; không đọc/ghi registry Session | Không có active thì vẫn không có; explicit standalone khi đang S vẫn giữ S |
| Có `artifactConversationId: S` | Preflight S, đăng ký hoặc làm mới membership của artifact trong S, trả context S | Giữ S; New/Join intent chỉ đổi active sau thành công |
| Có `conversationName`, không ID | Tạo Session mới, đăng ký artifact, trả context mới | Chỉ dùng nhánh này khi user yêu cầu bắt đầu phiên; thay active sau thành công |
| Có cả ID và name | Giữ ưu tiên ID như hiện tại; name không rename/tạo phiên | Skill không gửi cả hai cho yêu cầu New |

- MCP không đoán active Session từ artifact memberships hoặc process. Các artifacts được create/inspect sau khi chat có S sẽ tự được thêm vào S qua ID agent truyền; không tự nhập toàn bộ artifact cũ chỉ vì Join.
- Explicit standalone chỉ áp dụng request đó. Session skill tiếp tục giữ S cho các lượt sau; kết quả `session: null` không xoá active ID.
- Inspector UI chỉ cung cấp exact artifact handle. Session skill đang active vẫn truyền S; user phải yêu cầu standalone rõ ràng để bỏ đăng ký.
- Passed v1 ID vẫn fail trước mutation/takeover/token như hiện tại. Không ID thì không tự đọc legacy memberships để auto-migrate hoặc auto-create.
- `registeredAt` làm mới khi inspect trong S giữ đúng hành vi Chú đã chốt; đọc Markdown qua catalog path không làm mới membership/recency.

### 4.2. Result shape và ranh giới commit

```text
create standalone  -> { ...existingArtifactHandle, session: null }
inspect standalone -> { ...existingFlatInspection, session: null }
create/inspect S   -> { ...existingFlatResult, artifactConversationId, conversationName, session: SessionContext }
join-only         -> { session: SessionContext }
join+artifact     -> { session: SessionContext, inspection: existingFlatInspection }
```

- Standalone bỏ flat `artifactConversationId`/`conversationName`, không dùng empty string hoặc ID của review lifecycle để thay thế. Top-level `session` luôn có và nullable ở create/inspect; `SessionContext` schema tự nó không nullable. Join không đổi shape.
- `join+artifact.inspection` chỉ chứa artifact inspection fields như Phase 4; không lồng thêm `inspection.session` hoặc copy toàn bộ response của ordinary inspect vào đó. Session context duy nhất của Join nằm ở top-level `session`.
- Không đổi exact artifact handle, round/hash/comments/submission/token, token binding, window routing hoặc action directives. Wait/advance giữ optional echo ID như hiện tại, không tạo/thay active Session.
- Standalone không resolve Session context hoặc seed types; lỗi file registry/types không được làm standalone thất bại. Chỉ nhánh chọn/tạo S mới chạy preflight, registry và context.
- Giữ rollback hiện có cho nhánh Session: resolve context trong ranh giới rollback trước connection commit; restore registeredAt/remove new membership khi lỗi. Standalone chỉ rollback tài nguyên artifact/routing đúng như scope của nó.
- Join-only vẫn không tạo membership, takeover, window request hoặc token. Không thêm readonly inspect; đọc reference vẫn dùng exact catalog path.

### 4.3. UI entry và prompt

| Trạng thái artifact | Nút Session |
| --- | --- |
| Support đủ, membership list đã đọc thành công và không có cả v2 lẫn legacy v1 | **Start a work session**, helper từ `agent-text.json` |
| Có v2 | **Sessions**, mở/chọn phiên như hiện tại |
| Chỉ có legacy v1 | Giữ **Sessions** và migration entry hiện có, không làm mất đường migrate |
| Loading/lỗi discovery/support không đủ | Không suy ra danh sách rỗng để cho tạo phiên; giữ trạng thái disabled/error phù hợp |

- Start dùng Input Box native, prefill title artifact, validation theo shared Session title schema, type Conversation. Huỷ không ghi. Validate exact artifact trước khi tạo/đăng ký, dùng canonical validation hiện có như Add Artifact.
- Tạo xong đăng ký artifact vào cuối Working. Nếu đăng ký thất bại, dọn đúng Session vừa tạo; không đụng artifact gốc hoặc Session đã có. Không inspect/takeover hoặc viết connection/review state cho thao tác tổ chức UI này.
- Sau create+register commit, copy prompt của exact Session và mở manager. Hai việc sau commit độc lập: cố thực hiện cả hai, báo đúng kết quả qua wording đã đóng băng. Không tạo thêm Session hoặc rollback phiên đã tạo chỉ vì editor/clipboard lỗi.
- Cả mở và copy thành công dùng toast **Work session created. Connect prompt copied. Paste it into your AI chat to connect.** Copy không đồng nghĩa agent đã Join; chat nhận active ID sau tool success khi user gửi prompt.
- Auto-copy này áp dụng entry **Start từ artifact**. Add Session rỗng trên sidebar giữ workflow hiện có; không mở rộng UI ngoài quyết định đã chốt.
- Bỏ `ArtifactConnectDialog` khỏi artifact Inspect flow; xoá component/test riêng khi không còn caller. Artifact builder chỉ có prompt exact handle, không thêm `standalone`, Session ID, tên phiên hoặc mode New/Join. Tooltip nút Inspect dùng key UI trong payload. Session manager Connect tiếp tục dùng Session builder.
- Vị trí nút Sessions/Inspect hiện tại được giữ; không thiết kế lại toàn header/utility bar. Phase 5 áp Archived/Restore tại thời điểm triển khai, theo baseline mới; không dựng lại dialog cũ.

### 4.4. Hai skill và bảo toàn hành vi artifact

| Loại thay đổi | Nguồn nguyên văn | Ranh giới |
| --- | --- | --- |
| Feature 4.5 | Session bridge, optional Session arguments, toàn bộ work-session skill/reference | Đổi auto-create, entry, active context và refresh theo yêu cầu đã chốt |
| Biên tập đã duyệt | Các phần artifact còn lại trong payload | Cùng request/state phải giữ cùng tool, args, thứ tự và hành vi |

Các chỉnh sửa biên tập trong artifact payload chỉ gồm:

1. Bỏ liệt kê fields window candidate trong main; contract còn đầy đủ. Giữ default create, tiêu chí chọn candidate, hỏi khi mơ hồ và retry.
2. Dùng “complete committed connection metadata” thay danh sách fields; giữ mapping exact handle/round/window và cách dùng artifactLink.
3. Chuyển câu khẳng định cùng policy feedback về Unified feedback; nhánh revise giữ full comments/token/no-extra-inspect.
4. Fresh-decision bullet chỉ dẫn về **Create and review**, step 4; toàn bộ wording Proceed/approved/save ở đó được giữ.
5. Nhóm các bullets sau inspect vào heading **After inspection**; không sửa điều kiện empty round, takeover, chat update hoặc reconnect sau Proceed/Save.
6. Bỏ duplicate ARTIFACT_NOT_FOUND ở Lifecycle rules, giữ đầy đủ trong Structured recovery.
7. Contract dẫn về policy recovery/feedback trong main đã nạp, giữ payload/token/unique technical constraints. Không đổi điều kiện bắt đọc contract trước artifact tools.

Không lấy tỷ lệ giảm chữ làm tiêu chí hoàn thành. Không đổi kind selection, câu lệnh thực thi approved plan trong cùng turn, trả lời question-only trước advance, bảo toàn Markdown/SHA, cấm Review responses, token replay hoặc customize precedence.

Session skill chỉ nạp cho Session entry/related work; standalone artifact không cần Join tool. Đã active S thì cầu nối áp S, không cần user tag lại trước mỗi artifact. Known exact artifact đọc lại Markdown; unknown/list/overview dùng Join-only snapshot một lần; đọc Instructions mới hoặc dùng context vừa trả cho request đó. Không dựa Session.updatedAt để suy ra Instructions/artifact content chưa đổi. Payload đã ghi đủ điều kiện/đường lỗi; không thêm keyword-trigger cứng.

### 4.5. Version, receipt và customize

- Thay hằng `SKILL_VERSION` bằng **`CREATE_REVIEW_ARTIFACT_SKILL_VERSION = 7`** và **`WORK_SESSION_SKILL_VERSION = 1`**; các import/check/tests liên quan dùng đúng counter. MCP_VERSION và Session gate giữ **12** cho feature chưa release; không tăng MCP theo chặng. Package version không tự bump.
- Giữ receipt artifact ở `skills.agents`/`skills.claude`; thêm optional `sessionSkills` cùng kiểu target map. Schema receipt vẫn v1, đọc được manifest cũ thiếu Session map; thiếu entry chỉ làm Session skill stale, không làm mất receipt MCP/artifact đã hợp lệ. Writer merge từng map độc lập, không xoá target/map không có trong patch.

```json
{
  "schemaVersion": 1,
  "mcpVersion": 12,
  "skills": { "agents": 7, "claude": 7 },
  "sessionSkills": { "agents": 1, "claude": 1 },
  "updatedAt": "2026-11-07T10:00:00.000Z"
}
```

Đây là ví dụ khi cả hai targets được cài, không yêu cầu tạo receipt Claude nếu client/target đó chưa được cài.

- Chỉ commit từng skill/target receipt sau khi asset đó cài và verify thành công; một skill current không làm skill kia current. MCP receipt không dùng version skill. Overall Ready của target cần đủ assets được yêu cầu; lỗi một phần không được báo đã cài cả hai.
- Artifact tiếp tục merge `description` custom và `USER CUSTOM RULES`, preserve malformed-target fail-closed/atomic replacement như hiện tại. Giữ lịch sử `OFFICIAL_SKILL_DESCRIPTIONS` để nhận biết defaults cũ; description artifact mới đã là một entry cũ hợp lệ, không xoá history.
- Session copy/verify bản chính thức, không merge description/rules, không custom markers hoặc UI customize. Chưa tổng quát hoá artifact customization helper. Có thể dùng lại các hàm filesystem/atomic copy nhỏ đang có khi phù hợp.
- Shared `.agents/skills/` và Claude `.claude/skills/` đều có hai sibling directories để relative links resolve. Giữ detection/config driver của các client khác; không phát sinh target Claude chỉ vì base skills đã được cài.

## 5. Chia chặng và hướng dẫn từng bước

| Chặng | Bước | Kết quả để review |
| --- | --- | --- |
| **1 — Contract và MCP** | **1–2** | Đóng băng wording/result/receipt contracts; standalone, named New và reuse S hoạt động qua MCP, review regression giữ nguyên |
| **2 — UI và skills** | **3–4** | Start từ artifact + Inspect trực tiếp; sáu skill assets chép đúng payload, skill behavior được đối chiếu |
| **3 — Installer và nghiệm thu** | **5–6** | Hai counter/targets, customize artifact-only, stale/partial install rõ; docs/checks và manual evidence |

### Bước 1 — Chốt shared contracts và baseline wording

**Files:** `src/shared/contracts.ts`; các read/write types trong `workspace-integration.ts`; tests schemas; sáu payload sources trong plan dùng làm expected wording.

1. Kiểm tra source skill so với `manifest.baseline` trước khi thay. Ghi nhận drift thực tế, giữ thay đổi user; không apply payload đè lên source chưa được đối chiếu.
2. Thêm entry result types cho nullable Session, giữ `SessionContext` không nullable và flat artifact inspection. Không trộn DTO với artifact/session persisted schema.
3. Thêm hai counters và optional `sessionSkills` receipt schema/patch type theo 4.5; cập nhật writer merge và reader legacy omission. Numeric MCP 12 không thay.
4. Việc đổi số version được hoàn tất cùng packaged assets ở bước tương ứng; không đánh receipt thật hoặc coi bundle source giữa chặng là đã cài.

**Đạt được:** đọc manifest receipt cũ vẫn hợp lệ; patch Session target không đụng artifact/MCP/Claude targets khác; result type không cho nhầm reviewSessionId thành Work Session ID. Tests ở `artifact-contracts.test.ts`, `workspace-integration.test.ts` cập nhật theo contract này.

### Bước 2 — MCP standalone và đồng bộ agent-facing text

**Files:** `src/integration/artifact-review-mcp-v4.ts`; dùng registry/context helpers hiện có; `test/review-wait-mcp.test.ts`, `test/mcp-join-session.test.ts`, `test/release-contract.test.ts`.

1. Trong create/inspect core chọn nhánh bằng ID/name đã parse. Standalone để session/context null, bỏ toàn bộ registry/context calls; không đổi logic quản lý artifact/round/window.
2. Nhánh name-only tạo mới; ID branch giữ preflight trước mutation/takeover/token, đăng ký/làm mới và rollback. Giữ ID precedence khi cả hai cùng có.
3. Serialization theo 4.2; `artifactHandle` conversation optional đã có thì dùng lại. Join-only và Join+artifact không đổi; không gọi handler MCP này từ handler khác.
4. Giữ flat comments/token payload, full comments từ hai wait tools, fresh approval action theo kind và saved snapshot behavior. Không sửa token/ownership để phục vụ grouping.
5. `initialize.instructions` phải bằng `agent-text.json.mcp.initializeInstructions.join(" ")`. Create/inspect tool descriptions và cả hai cặp Session argument descriptions lấy đúng keys tương ứng. Các tool descriptions/inputSchema khác giữ nguyên.
6. Recovery hint không được nói “omit ID để tạo Session”; name-only mới yêu cầu tạo. Window retry giữ exact operation/Session intent; không thêm automatic fallback hoặc reset active context.

**Đạt được:** create standalone → inspect → wait/feedback/advance/Proceed vẫn dùng exact handle, không tạo registry/types; explicit ID/name còn đúng context/rollback. Test standalone với Session registry/types invalid để chứng minh nhánh này không còn phụ thuộc chúng. Giữ regression reconnect/takeover/empty update/old approval và hai kinds plan, không làm exhaustive ownership matrix.

### Bước 3 — Start từ artifact, Inspect trực tiếp và clipboard

**Files:** `artifact-review-provider.ts`, `conversation-artifact-service.ts`, `session-create-command.ts` (hoặc helper nhỏ tách từ nó), `extension.ts`, `src/shared/contracts.ts`, `artifact-connect-prompt.ts`, `session-connect-prompt.ts`, `ReviewApp.tsx`, `ArtifactConnectDialog.tsx`, `styles.css`.

1. Bổ sung typed action cho Start từ artifact, bound ID lấy từ provider/store; không chấp nhận arbitrary path hoặc Session ID từ webview để tạo/đăng ký. Giữ Session sidebar Add và manager Connect hiện có.
2. Start orchestrator tái sử dụng input/create/register/open/copy helpers; title initial là artifact title, type Conversation. Validate artifact còn tồn tại bằng cùng canonical validator của Add, lấy exact ID đã bind.
3. Tạo+register có rollback chỉ Session mới nếu lỗi trước commit. Notify membership/metadata đúng ID sau commit. Không đụng lifecycle state hoặc connection để mở Session Manager.
4. Sau commit mở editor và copy prompt, giữ ID dù bước phụ lỗi. UI dùng đúng success/partial-failure text keys; thêm error detail/ID qua phần detail/log hiện có, không đổi câu gốc. Huỷ Input Box không tạo gì.
5. Inspect button copy artifact template hai dòng nguyên văn; xoá các mode new/join và field tương ứng ở typed artifact prompt action. Không gắn `standalone` vào prompt; active Session vẫn do agent cung cấp. Bỏ dialog/caller/imports/tests riêng sau khi xác nhận không còn usage.
6. Session builder dùng `agent-text.json.prompts.session`; nối bằng LF. Chỉ thay placeholders bằng `JSON.stringify` của exact values; dòng sessionTitle chỉ có khi title được cung cấp, không truyền nó thành tool arg. Artifact template dùng JSON-stringified canonical directory. Không thêm lời hướng dẫn ngoài template.
7. Render entry theo 4.3; keep legacy migration, loading/error/support gate. Helper Start phải đọc được tại vị trí entry, dùng nguyên văn đã chốt; không thay layout manager hoặc các controls được Chú chấp nhận.

**Đạt được:** standalone artifact có đường Start; Start success sinh đúng một Session/membership, mở manager và clipboard đúng ID; retries sau lỗi open/copy không tự tạo thêm. Inspect không mở New/Join hoặc tự thay Session. Tests: `artifact-review-provider.test.ts`, `session-create-command.test.ts`, `artifact-connect-prompt.test.ts`; cập nhật webview tests theo entry mới, giữ unrelated UI behavior.

### Bước 4 — Chép nguyên văn skills và đối chiếu hành vi

**Files:** sáu file đích trong bảng mục 1; `test/skill-contract.test.ts`; thêm `test/work-session-skill.test.ts` cho contract mới khi cần.

1. Copy toàn bộ sáu payload files tới đúng target, giữ relative paths giữa sibling skills. Không tự sửa câu, headings, field names, examples hoặc auto-invocation policy; metadata UI cũng lấy đúng bản mẫu.
2. So hash LF của packaged targets với manifest; artifact custom markers trong packaged source phải đúng payload, không mang customization từ máy developer vào source. Installed customization xử lý ở Bước 5.
3. Đối chiếu các nhánh artifact không đổi bằng mapping mục 4.4 và tests lifecycle hiện có. Chỉ cập nhật expected prose bị thay bởi payload, giữ assertions bảo vệ đầy đủ feedback/execution/recovery; không xoá safety assertions để pass.
4. Test shape/behavior hợp thành: không active → standalone; active S → create/inspect vào S; explicit standalone giữ S; New có tên thay active sau success; lỗi giữ active; known target đọc Markdown hiện tại; unknown/overview Join-only rồi đọc chọn lọc; snapshots cũ không execution.
5. Session skill không có USER CUSTOM RULES hoặc customize claims; artifact main vẫn có markers và precedence hiện tại. Không thay điều kiện đọc artifact contract hoặc thêm reference loaders mới trong đợt rút gọn này.

**Đạt được:** frozen wording khớp chính xác; artifact lifecycle clauses không bị yếu đi; Session skill không biến mỗi từ plan/blueprint thành bắt buộc Join hoặc tự tạo artifact. Static prose/hash checks chỉ chứng minh asset đúng; manual agent check ghi riêng ở Bước 6.

### Bước 5 — Installer, version, verify và customize artifact-only

**Files:** `workspace-integration.ts`, `mcp-clients/skill-helper.ts`, `mcp-clients/claude-client.ts`, `mcp-clients/index.ts`, `mcp-clients/base-cleanup.ts`, `integration-verification.ts`, `global-integration-status.ts`, contracts/version tests; `.vscodeignore` chỉ sửa nếu package thực sự thiếu assets.

1. Thêm source/target paths riêng cho Session skill dưới packaged `skills/work-session`, `.agents/skills/work-session`, `.claude/skills/work-session`. Không đổi tên/path artifact skill hoặc legacy cleanup không liên quan.
2. Artifact tiếp tục dùng `replaceSkillDirectory`, customization merge và current verification. Giữ official-description history; không đưa Session source qua validator đang bắt `name: create-review-artifact`/custom markers.
3. Session có whitelist ba files từ manifest, normal copy/atomic replace và verification nguyên bản không customize. Có thể tái sử dụng filesystem primitives; không tổng quát hoá toàn bộ customization framework. UI customize/copy skill command hiện có chỉ quản lý artifact.
4. Mỗi skill/target install+verify xong mới ghi đúng map receipt. Session failure không được stamp Session current từ artifact result hoặc ngược lại. Khi chỉ một counter stale, không yêu cầu đổi MCP version/config chỉ để đồng bộ số.
5. Readiness giữ artifact result hiện có, bổ sung Session result và detail phân biệt asset nào thiếu/stale. Claude kiểm tra/cài hai assets dưới target riêng, giữ detection của driver và config transport hiện có. Shared agents target dùng cho các clients hiện có như trước.
6. Uninstall/removal chỉ dọn đúng hai extension-owned skill directories trong target đã xác thực; không đụng custom skills khác hoặc artifact/Session data. Không thao tác installed assets thật trong tests.
7. Package chứa đủ sáu files; relative sibling links resolve ở cả hai targets. Packaged source phải bằng frozen payload; installed artifact phải bằng kết quả merge được hỗ trợ, installed Session bằng source.

**Đạt được:** counters độc lập; custom description/rules artifact giữ nguyên qua update; Session official replacement không merge; missing Session assets không báo Ready; update/partial failure và agents/Claude target maps không ghi đè nhau. Tests: `workspace-integration.test.ts`, `mcp-client-drivers.test.ts`, `integration-verification.test.ts`, `global-integration-status.test.ts`, `release-contract.test.ts` với isolated homes.

### Bước 6 — Validation, docs và bàn giao

**Docs:** `README.md`, `docs/INSTRUCTION.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/COMPONENTS.md`, `docs/CHANGE_LOGS.md`, roadmap/note. Chỉ mô tả behavior thật khi code xong; wording skills giữ nguyên payload.

- Focused tests mỗi chặng; cuối phase chạy `npm.cmd run check`, `npm.cmd test`, `npm.cmd run build`, `git diff --check`. Ghi pass/skipped đúng thực tế, không đặt số tests mục tiêu theo lịch sử.
- Chạy skill validator/audit trên hai payload/target folders khi công cụ khả dụng; báo rõ missing dependency nếu không chạy được. Validator không chứng minh agent làm đúng.
- Manual Extension Host: artifact không membership → Start/input/cancel/create/open/copy; artifact có memberships → Sessions; legacy v1 migration vẫn truy cập được; Inspect copy trực tiếp không popup; errors open/copy giữ đúng ID; sidebar Add/manager Connect và panel/Instructions editing giữ baseline.
- Manual AI client: standalone create/inspect không tạo Session; Join → create/inspect tự vào S; explicit standalone không clear S; explicit New dùng name và thay ID sau success; Instructions update được đọc lại; known artifact đọc bản hiện tại, unknown target refresh catalog; feedback/Proceed/Save/snapshot cũ không đổi.
- Kiểm chứng installer cả hai targets bằng fixture và ít nhất client thực tế được chọn; ghi rõ client nào chưa thử. Không tuyên bố skill behavior tương đương chỉ từ tests chứa chuỗi hoặc file ngắn hơn.
- Cập nhật Phase 5 chỉ về baseline/phụ thuộc: dùng Inspect/Start mới, hai version counters và receipt mới. Không chuyển chức năng quản lý danh sách/ZIP vào 4.5; không mở lại Phase 4 để triển khai lần nữa.

## 6. Checkpoint tiến độ

- [ ] **Chặng 1:** frozen contract/result/receipt + standalone/New/reuse S MCP, lifecycle regression pass.
- [ ] **Chặng 2:** Start/open/copy/Inspect trực tiếp; six skill files khớp payload; editorial changes được đối chiếu riêng với feature changes.
- [ ] **Chặng 3:** independent artifact 7 / Session 1, targets/receipt/verify và artifact-only customize; full checks/docs/manual evidence.
- [ ] Không đổi artifact/session persisted schema, MCP 12, ownership/token/Proceed, Instructions storage hoặc Phase 5 scope.
- [ ] Skill/source hashes đúng manifest; mọi wording chỉnh thêm phải được Chú duyệt trước khi đổi payload.
- [ ] Chú review output; chỉ đánh dấu hoàn thành theo implementation/evidence thật.

## 7. Rủi ro và giới hạn đã chấp nhận

| Điểm cần rà | Xử lý trong phạm vi |
| --- | --- |
| Omit ID từng có nghĩa tạo mới, nay là standalone | Đồng bộ core, initialize/tools descriptions, builders, skills và recovery hints. Named New phải gửi tên, không chỉ bỏ ID. |
| Agent quên active ID hoặc dùng content cache | Cầu nối ngắn và Session refresh rules nguyên văn; kiểm chứng chat thật, không thêm server chat-state/background watcher. |
| Copy/open lỗi sau tạo Session | Giữ created ID, thực hiện độc lập các bước sau commit, báo kết quả đúng; không duplicate phiên khi retry. |
| Hai skill bị dùng chung counter/customize | Receipt maps/counters riêng; artifact merge giữ nguyên, Session raw install/verify. Không generic customize trong phase này. |
| Rút gọn vô tình làm yếu lifecycle | Giữ nguyên đoạn hành vi quan trọng, chỉ edits đã duyệt và payload frozen; phân biệt editorial với standalone feature changes. |
| Chạm cùng files với Phase 5 | Triển khai tuần tự trên baseline 4.5; Phase 5 giữ grid/UI state/management, không chép logic New/Join cũ. |
| File cài mới nhưng process MCP chưa restart | Giữ giới hạn đã chấp nhận: gate theo file/receipt trên đĩa, user restart client qua luồng cài đặt hiện có; không thêm process verification hoặc bump MCP theo chặng. |

**Độ khó dự kiến:** trung bình, nhỏ hơn Phase 4. Không có dữ kiện để khẳng định chất lượng continuation của mọi AI client chỉ từ source/tests; report phần đã kiểm chứng và phần còn lại. Optional hardening về cross-process ownership, conflict/merge, Session customization hoặc push notifications tiếp tục ngoài phạm vi.

## 8. Kiểm tra tài liệu/wording khi lập plan

- Audit `skill-reviewer --platform codex` trên cả hai thư mục mẫu: **PASS, 0 warnings**.
- `skill-creator/scripts/quick_validate.py` chưa chạy được vì Python thiếu **PyYAML** (`ModuleNotFoundError: No module named 'yaml'`). Không ghi nhận official validator pass. Kiểm tra bổ sung độc lập cho frontmatter, name/description, metadata interface, default prompt và relative links đã pass.
- Đã đối chiếu **7 hashes** (sáu assets + agent text), **3 baseline skill sources** không đổi, **60 relative links**, **23 đoạn lifecycle artifact giữ nguyên văn**, whitespace và `git diff --check`.
- Không chạy lại feature tests/check/build chỉ vì ghi tài liệu; không cài skills/runtime hoặc xác minh Extension Host/AI client trong lượt này. Các checklist implementation ở mục 6 vẫn chưa hoàn thành.
