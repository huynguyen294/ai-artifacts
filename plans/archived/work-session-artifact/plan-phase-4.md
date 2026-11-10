# Phase 4 — Agent, catalog và Instructions Markdown: hướng dẫn triển khai

Trạng thái: **Đã hoàn thành toàn bộ Phase 4 (Chặng 1, 2, 3 hoàn tất 100%).** Giữ 7 bước trong 3 chặng; Add Session/Add Artifact bổ sung tại Bước 5/Chặng 3, không mở lại Chặng 1. Hiện trạng baseline khi lập plan được đối chiếu ngày **2026-11-07**; số tests/build ghi trong các plan trước là bằng chứng của các đợt đó, không phải kết quả kiểm chứng phần còn lại của Phase 4.

Nguồn phạm vi: [plan tổng thể](plan.md), [Phase 3](plan-phase-3.md), [note](note.md), [phân tích ban đầu](analyzed.md) và các quyết định tiếp nối của Chú. Các quy tắc Instructions/Join/Kind dưới đây thay thế đề xuất cũ chưa chốt trong tài liệu trước; không coi mô tả code hiện tại là hành vi đích.

> Tiếp nối sau khi hoàn thành: [Phase 4.5](plan-phase-4.5.md) thay auto-create Session khi omit ID và bỏ popup artifact Inspect New/Join, thêm Start và hai skills/version độc lập. Các mô tả bên dưới là output/baseline Phase 4, không áp lại để ghi đè contract 4.5. Giữ progress và bằng chứng Phase 4 như lịch sử; Phase 5 triển khai trên baseline 4.5.

## 1. Phạm vi và ranh giới

| Component | Kết quả Phase 4 |
| --- | --- |
| Session context | Metadata, Instructions và catalog ba vùng; đường dẫn chính xác để AI đọc chọn lọc. Không trả toàn bộ Markdown của mọi artifact. |
| MCP `join_session` mới | Join theo Session ID; có thể nhận thêm artifact ID để trả cả kết quả inspect trong **một tool call**, dùng chung core inspect. |
| Create/inspect hiện có | Giữ exact artifact handle và contract active Session; trả thêm context để New Session không cần gọi join lần hai. |
| Instructions | `instructions.md` là nguồn chính; textarea sửa Markdown thẳng + Save, thêm **Open Markdown File**. AI sửa file này bằng công cụ file khi user yêu cầu. |
| Artifact kinds | 10 kind cố định + kind mở; dùng chung phân loại, label và contract Proceed. Không thêm field artifact type thứ hai. |
| Proceed | `plan`/`implementation-plan` → `execute-approved-plan`; mọi kind khác → `approved`. Review tiếp tục trả đủ comments và `process-review-feedback`. |
| Connect | Manager copy prompt Join Session; Review App giữ New/Join, Join dùng tool mới kèm artifact ID. Extension copy prompt, không tự gọi MCP thay AI. |
| Add Session / Add Artifact | Header Tree View Sessions có Add Session: nhập title, type mặc định Conversation, tạo phiên rỗng và mở manager. Header Working có nút ＋ Add Artifact, chọn artifact đã có qua Quick Pick và thêm vào Session. |
| Ngôn ngữ UI | Rà soát toàn bộ App UI, dialog, native Quick Input và Tree Views; chuyển các labels/messages do extension định nghĩa còn tiếng Việt sang tiếng Anh. Sửa New/Join theo đúng ngữ nghĩa tại mục 3.6. |
| Recent Artifacts | Filter native Quick Pick: All Types, từng kind cố định, Other; áp filter trước cap 20, có indicator. |
| Skill/integration | Thêm join/context/reference-read/instructions/kind/approved; đồng bộ descriptions, metadata, versions và docs liên quan. |

**Ngoài phạm vi:** menu **More → Export ZIP / Archive / Delete** của manager, toàn bộ Pin/Archive/Restore/Delete, file trạng thái UI, menu chuột phải và tooltip đầy đủ của sidebar (Phase 5); helper descriptions UI của các zone/Instructions, card grid (thay đề xuất masonry cũ), description/filter/search artifact trong manager (Phase 5; xem [hướng dẫn](plan-phase-5.md)); attach/import file/folder, rich editor, Markdown preview mới; tool readonly inspect hoặc tool đọc toàn bộ artifact; workflow engine/handoff; dirty dialog/recovery, lock/CAS/merge, ownership hardening xuyên process. Không thay các controls/menu sắp xếp đã được chấp nhận, không drag/drop.

Description **trong catalog AI** thuộc Phase 4. Description/helper text **trong UI manager** thuộc Phase 5. Session type vẫn độc lập với artifact kind.

## 2. Hiện trạng code cần tận dụng

| File/component | Source hiện tại → phần còn thiếu |
| --- | --- |
| `src/shared/contracts.ts` | Artifact schema 6, Session schema 2, layout/membership/types schema 1; MCP 12, Skill 5. Session metadata strict còn bắt buộc inline `instructions`. DTO manager có instructions nhưng chưa có AI catalog/context. |
| `src/shared/conversation-artifact-registry.ts` | Có create/read/list/update/type/register/move/remove/migrate. `updateSessionDetails` và `setSessionType` ghi instructions cùng metadata; migration v1→v2 tạo instructions rỗng trong JSON. Chuyển các producer/consumer sang file Markdown, giữ membership/layout/recency. |
| `src/shared/artifact-files.ts` | Có canonical paths và constants, chưa có instructions file/path helper. |
| `src/integration/artifact-review-mcp-v4.ts` | Chỉ có 5 tools. `handleInspectTool` trộn orchestration với JSON-RPC response; inspect có thể create/register membership, takeover và cấp token. Chưa có readonly intent, join tool hoặc Session context. |
| MCP feedback | `reviewDecisionAction` chỉ trả execution cho hai kind plan; approve kind khác chưa có nextAction. Cả hai waiting tools đã trả comments đầy đủ; inspect trả snapshot/token, không trả execution directive từ submission cũ. |
| `src/extension/conversation-artifact-service.ts` | Đã có scoped events, manager DTO và registry wrappers. URI classifier chưa nhận `instructions.md`; row lỗi hiện dùng placeholder `kind: "spec"`, không dùng DTO đó nguyên dạng làm AI catalog. |
| `src/extension/work-session-provider.ts`, `src/webview/SessionApp.tsx` | Đã có fixed-height Markdown textarea + Save, `lastPersistedInstructions` và section patches. Chưa có Open Markdown File hay Connect từ manager. |
| `src/shared/artifact-connect-prompt.ts`, `src/extension/artifact-review-provider.ts` | Legacy/New/Join prompt đã có; Join đang gọi inspect với `artifactConversationId`. Host kiểm tra đích Join thuộc artifact và là v2. |
| `src/webview/ArtifactConnectDialog.tsx`, `src/webview/ReviewApp.tsx`, `src/extension/work-session-sidebar.ts` | Còn UI tiếng Việt: dialog title/New/Join/descriptions/Cancel/Copy/empty/migration, Sessions tooltip và Recent empty/View all/timestamps. Mô tả Join hiện chỉ nói liên kết artifact, chưa nói nhận context Session. |
| `src/extension/work-session-sidebar.ts`, `src/extension/extension.ts` | Recent sort/cap 20/View all đã có, chưa có kind filter. Sessions đã dùng `createTreeView`, filter/search theo Session type; giữ nguyên luồng đó. |
| `src/extension/artifact-search*.ts` | Có validated discovery, bounded concurrency và title search. Quick Pick hiện chưa nhận kind filter từ View all. |
| `src/shared/markdown-blocks.ts`, `package.json` | Đã có unified/remark-parse/remark-gfm/mdast-util-to-string. Tận dụng cho snippet nhưng không đổi review block IDs/hashes. |
| `src/extension/work-session-support.ts` | Kiểm tra receipt MCP >= 12 và đối chiếu file runtime với bundle khi có context; không kiểm tra process đang chạy. |
| `skills/create-review-artifact/`, `src/extension/mcp-clients/skill-helper.ts` | Skill còn ép mọi artifact thành implementation-plan, assume approve luôn execute; danh mục 5 tools và description artifact-only. Có append-only official descriptions và bảo toàn user customization. |

Các điểm trong bảng là baseline lúc bắt đầu Phase 4, không phải trạng thái sau khi Chặng 1 hoàn thành hoặc lỗi yêu cầu sửa ngoài phạm vi. Khi triển khai Chặng 2–3 dùng đối chiếu cập nhật dưới đây và source thực tế, không xây lại helpers đã có.

### 2.1. Đối chiếu bổ sung trước Chặng 2–3 — 2026-11-07

| Component hiện tại | Điểm nối cần giữ rõ trong phần còn lại |
| --- | --- |
| Chặng 1 đã có | `sessionContextSchema`/catalog schemas trong contracts; `resolveWorkSessionContext`, `extractMarkdownDescription`, `FIXED_ARTIFACT_KINDS`, `isFixedArtifactKind`, `isPlanProceedKind`, `formatArtifactKindLabel`; Instructions Markdown và metadata optional legacy. Tái sử dụng, không định nghĩa một bộ schema/kind/context khác. |
| MCP create/inspect | `persistArtifact` có rollback trong thân hàm, còn `handleCreateTool` hiện chỉ serialize kết quả sau khi hàm đó trả về. `handleInspectTool` vẫn tự respond và tự quản lý register/connection rollback. Context mới phải nằm trong ranh giới thao tác tương ứng, không chỉ gắn một `await resolve...` vào wrapper sau commit. |
| MCP recovery | `RecoveryContext` đang chỉ có `isCreate`; `McpWindowSelectionRequiredError` chỉ nhận create/inspect. Thêm Join phải sửa cả typed hints lẫn nơi tạo lỗi; đổi mỗi tool dispatcher không đủ. |
| Feedback/skill | Wait/advance trả comments đầy đủ; inspect không phát lại nextAction từ submission cũ. Skill còn assume approve luôn execute và Join chưa có nested inspection. Nối UI/skill sau khi chốt một shape chung ở mục 3.7. |
| Instructions event | Classifier chưa nhận Markdown; provider dùng `changes.every(...)` để chọn summary/artifact/full refresh. Bước 5 phải xử lý cả batch trộn instructions/metadata và batch chứa Session khác, không chỉ thêm một `case`. |
| Manager UI đang được Chú chỉnh | Giữ chip Session Type có nút edit tích hợp, bố cục/spacing hiện tại trong `SessionApp.tsx`/`styles.css`. Thêm controls vào đúng header/section; không đưa markup về snapshot Phase 3 cũ. |
| Picker/filter | Search command hiện có callback Open; không gọi nguyên command đó cho Add Artifact. Recent View all hiện không truyền arguments, handler Search Artifact cũng chưa nhận kind filter. Hai đầu phải đổi cùng nhau. |

Baseline kiểm chứng lần rà soát: **8 suites / 145 tests passed, 1 skipped** (`review-wait-mcp`, connect prompt, Session provider/service/app, skill contract, artifact search command và Session context). Đây là regression của code hiện có, không chứng minh Join/controls mới đã triển khai hoặc AI/Extension Host runtime đã được kiểm chứng.

## 3. Contract đích

### 3.1. Storage và version

```text
~/.ai-artifacts/conversation-registry/<sessionId>/
  conversation.json                  # schema v2: metadata, không inline instructions
  instructions.md                    # nội dung Markdown nguyên bản
  layout.json                        # working / references / archived
  registered-artifacts/<artifactId>.json
  conversation.v1.backup.json         # chỉ khi migrate v1
```

- Metadata v2 ghi mới: `{ schemaVersion: 2, sessionId, title, typeId, createdAt }`. Schema đọc vẫn `.strict()` nhưng chấp nhận thêm `instructions: string` optional để Session v2 đang có trường cũ không bị loại. Thiếu trường, chuỗi rỗng hoặc chuỗi có nội dung đều hợp lệ; kiểu sai/trường lạ khác vẫn bị từ chối. `WorkSession`/DTO lấy instructions hiệu dụng từ Markdown, không từ field cũ.
- Định dạng Session/migration mới chưa publish: giữ schema v2, **không tạo schema v3, không fallback inline JSON, không dual-write, không tự migrate khi read/list/activation**. Read/list không xoá field cũ hoặc tạo Markdown ngầm. Writer metadata mới bỏ inline instructions. Nếu cần giữ nội dung Instructions cũ chưa có trong Markdown thì chuyển nội dung riêng theo yêu cầu user; việc này không phải điều kiện để Session xuất hiện trong danh sách.
- `instructions.md` rỗng hợp lệ. Create/migration mới tạo file rỗng hoặc nội dung đầu vào. Nếu file chưa có, read model dùng chuỗi rỗng, không tự ghi file khi read/list; Save/Open là thao tác chủ động có thể tạo file. Không đọc lại field inline cũ.
- Save ghi nguyên nội dung textarea bằng UTF-8, giữ Markdown/xuống dòng; không parse-to-text hoặc render rồi serialize. AI đọc/sửa exact `instructionsPath`; không sửa metadata chỉ để thay Instructions.
- Dùng canonical paths, kiểm tra file/directory như registry hiện tại, atomic writes và xử lý Windows editor lock hiện có. Không thêm lock hay cơ chế conflict mới.
- Phiên bản đợt: **giữ MCP_VERSION = 12** cho toàn bộ feature Work Session chưa release; không bump theo từng chặng. **SKILL_VERSION 5 → 6** vẫn là phần việc skill ở Bước 7. Artifact schema 6, Session schema 2, membership/layout/types và package version giữ nguyên. Bump 13 trước đó của Chặng 1 đã được đính chính về 12.
- Gate Session storage/actions/context dùng **WORK_SESSION_REQUIRED_MCP_VERSION = 12** và thông báo tương ứng. Giữ kiểm tra receipt + runtime file trên đĩa; runtime test thay bundle vẫn cần cài lại dù cùng numeric version, không bổ sung kiểm tra process đang chạy.

### 3.2. ID và active Session của chat

- Giữ các tên tham số hiện có `artifactConversationId`/`conversationName` trên create/inspect/wait/advance; không rename toàn bộ protocol trong đợt này. `artifactConversationId` hiện hữu và `sessionId` của tool/context mới cùng chỉ một Work Session ID.
- Một Session có nhiều chat; một chat giữ **0 hoặc 1 activeSessionId**. Default create/inspect truyền ID đó. Explicit New omit ID cũ kể cả đang có active; success mới thay ID. Explicit Join gửi exact Session ID và success mới thay active.
- Failure không đổi active, không tự fallback sang Session cũ hoặc tự tạo Session mới. Retry chọn window giữ nguyên intent New/Join và ID đích. Đồng bộ cả recovery prose cũ có thể đang hướng dẫn clear ID rồi auto-retry.
- Chuyển active không chuyển/xoá memberships, không clone artifact, không xoá handle-to-round/window mappings. Không thêm registry mapping chat-ID hoặc transcript sharing.
- Caller truyền v1 ID: create/inspect/join đều fail trước membership/takeover/token; giữ `CONVERSATION_MIGRATION_REQUIRED` và hai lựa chọn user migrate cùng ID hoặc chủ động New. Join chỉ theo Session không tự migrate.

### 3.3. Session context và catalog

Kết quả entry dùng trường `session` cùng cấu trúc dùng chung. Hình dạng đích minh hoạ:

```ts
type SessionContext = {
  sessionId: string;
  title: string;
  typeId: string;
  typeLabel: string;
  createdAt: string;
  updatedAt: string;
  instructions: string;
  instructionsPath: string;
  catalog: {
    working: SessionCatalogItem[];
    references: SessionCatalogItem[];
    archived: SessionCatalogItem[];
  };
};
type SessionCatalogItem =
  | {
      artifactId: string;
      title: string;
      kind: string;
      description: string;
      artifactDirectory: string;
      artifactPath: string;
      updatedAt: string;
      unavailable?: false;
    }
  | { artifactId: string; unavailable: true };
```

- Type/schema context/catalog và resolver shared đã có trong Chặng 1; dùng các exports hiện tại trong contracts và `work-session-context.ts`. Mục này mô tả shape phải giữ khi nối entry results, không yêu cầu viết lại hoặc nhân bản các schema. Không import VS Code/extension service vào MCP.
- Giữ thứ tự reconcile/layout của mỗi vùng. Ba vùng là tổ chức tài liệu, không phải trạng thái approval/quyền. References vẫn có thể review qua lifecycle khi user yêu cầu.
- Mỗi artifact khả dụng phải qua canonical artifact path, schema-v6 manifest và kiểm tra ID đúng directory trước khi đưa handle/path vào catalog. ID là identity, **không phải đường dẫn**. Không lấy title/ID để đoán vị trí ngoài collection.
- Description: parse Markdown AST → lấy visible text → chuẩn hoá whitespace → rút ngắn. Dùng một hằng giới hạn chung, đề xuất triển khai **200 ký tự**, chỉ thêm `…` khi thực sự cắt. Không trả raw Markdown/HTML như description, không gọi AI, không lưu thêm field description vào manifest. Chuỗi rỗng hợp lệ.
- Artifact mất/không đọc được: row `unavailable: true`, không dựng title/kind/path giả hoặc làm hỏng toàn bộ catalog. Row khả dụng không kèm comments/submission/token.
- Catalog resolver chỉ đọc; không đăng ký artifact, không làm mới `registeredAt`, không sửa layout hoặc lifecycle, không nạp tất cả artifact Markdown vào response. Đọc Markdown nội bộ để trích description không đồng nghĩa dump nội dung cho AI.
- AI chọn tài liệu phù hợp rồi đọc `artifactPath` bằng công cụ file. Đọc tham khảo không cần inspect/takeover và không cấp quyền Review/Proceed. Muốn xử lý feedback/edit lifecycle của artifact khác thì gọi inspect exact handle theo contract.

### 3.4. Tool `join_session`

```ts
// Input đích; sessionId bắt buộc, các flags inspect chỉ dùng khi có artifactId.
{
  sessionId: string;
  artifactId?: string;
  takeover?: boolean;
  expectedReviewRound?: number;
  intent?: "reconnect" | "explicit-chat-update";
  connection?: ReconnectConnectionInput;
}
```

| Lời gọi | Kết quả và side effects |
| --- | --- |
| `join_session({ sessionId })` | `{ session }`; chỉ đọc context, không chọn window, không mở/takeover artifact, không token, không register/recency write. Chat tự giữ active ID sau thành công. |
| `join_session({ sessionId, artifactId, ...inspectOptions })` | `{ session, inspection }`; inspection giữ nguyên shape handle/manifest/Markdown/comments/submission/hashes/token/connection của inspect. Register/refresh membership trong Session đích và chỉ takeover artifact mục tiêu nếu `takeover: true`. |
| Create/inspect cũ thành công | Giữ flat fields/handles hiện có, thêm `session`; inspect New không phải gọi join lần hai chỉ để lấy context. Không thêm catalog vào mỗi kết quả wait/advance. |

- Với artifact ID, dựng canonical directory từ collection + ID đã validate, rồi dùng **cùng core inspect**, không gọi nối MCP tool và không copy implementation. Review App vẫn chỉ cho Join vào đích v2 liên quan tới artifact như UI hiện tại.
- Validate input với `additionalProperties: false`/allowed keys. Không có artifact thì từ chối các tham số inspect thay vì âm thầm bỏ qua. `expectedReviewRound` vẫn bắt buộc cho `explicit-chat-update`.
- Tool có nhánh mutation nên không quảng bá toàn tool là readonly (`readOnlyHint: false`). Không thêm `intent: "readonly"` trong phase này.
- Routing/version preflight trước takeover/membership/token như inspect hiện tại; giữ rollback membership/Session khi connection commit thất bại. Retry `WINDOW_SELECTION_REQUIRED` của join phải có `expectedNextTool: "join_session"`, giữ Session/artifact/options. Không hardcode đường retry quay về inspect và làm mất Join intent.
- Inspect snapshot có submission approve/save cũ **không phát lại execute/approved directive**. Nếu user reconnect để review tiếp thì dùng token/advance flow hiện có; không thực thi lại hành động đã duyệt chỉ vì đọc snapshot.

### 3.5. Kind, label và Proceed

10 kind cố định:

```text
plan, implementation-plan, idea, analysis, design,
spec, checklist, report, guide, note
```

- Giữ slug schema hiện có cho cả kind cố định và mở. AI chọn fixed kind khi phù hợp; nếu không phù hợp được tạo kind mở, ví dụ `workaround`, `meeting-note`. Không ép mọi tài liệu thành implementation-plan, không enum-only hoặc rewrite kind của artifact cũ.
- `plan` và `implementation-plan` là **hai kind/filter riêng**, không alias, không nhóm Planning.
- Label chung: thay `-` bằng khoảng trắng và viết hoa ký tự đầu toàn chuỗi, ví dụ `implementation-plan` → **Implementation plan**, `meeting-note` → **Meeting note**. Không đổi giá trị lưu để phục vụ hiển thị.

| Decision/kind | `nextAction.type` | Token/hành vi |
| --- | --- | --- |
| `revise`, mọi kind | `process-review-feedback` | Giữ token/comments đầy đủ và unified feedback policy hiện tại. |
| `approve`, plan hoặc implementation-plan | `execute-approved-plan` | Không token; triển khai toàn bộ phần đã duyệt trong cùng lượt. |
| `approve`, mọi fixed/open kind khác | `approved` | Không token; ghi nhận được duyệt và kết thúc review, không tự triển khai hoặc mở vòng mới. |
| `save`, mọi kind | Không có nextAction | Giữ hành vi Just save hiện tại; không tự advance. |

Instruction của `approved`: **The user has approved this artifact. Acknowledge the approval and conclude the review. Do not automatically implement code or start another review round.**

Cả wait và advance-and-wait dùng cùng mapping; mọi decision vẫn có full `comments` document ở `comments.comments`, kể cả list rỗng. Inspect/join-inspection không biến snapshot cũ thành một decision mới.

### 3.6. Wording New/Join và English UI

**New** là tạo một phiên làm việc mới bắt đầu từ **cùng artifact này**; không clone artifact, không xoá memberships cũ và không cam kết xoá lịch sử chat AI. **Join** là inspect artifact này rồi tiếp tục **một Session trước đó mà artifact đã thuộc về**, nhận context Session đã chọn thay vì chỉ thêm một liên kết artifact.

| Thành phần dialog | Wording tiếng Anh đích |
| --- | --- |
| Title | **Connect AI to Artifact** |
| New label | **New Session** |
| New description | **Start a new work session from this artifact.** |
| Join label | **Join Session** |
| Join description | **Inspect this artifact and join one of its existing sessions with its full session context.** |
| Close / Cancel / Copy | **Close dialog** (aria-label), **Cancel**, **Copy Prompt** |
| Empty Session list | **This artifact does not belong to any session yet.** |
| Legacy v1 tooltip / badge | **Migrate this conversation to Session v2 before joining.** / **Migration required** |

“Full session context” là metadata, Instructions và catalog Working/References/Archived, với exact paths để AI đọc tài liệu cần thiết. Dùng chung Session có sẵn, không copy sang một Session khác; không bao gồm transcript/lịch sử chat của AI khác và không tự dump toàn bộ nội dung artifact. Giữ v1 Join disabled và chỉ chọn trong các Session liên quan tới artifact.

Rà soát tất cả đường UI trong `src/webview/`, Tree Views và UI strings của `src/extension/`, command/view contributions ở `package.json`, cùng shared strings thực sự được hiển thị. Bao gồm button/menu/label, title, description, placeholder, tooltip, aria-label, empty/loading/error/success states và native notifications/Quick Input. Dùng tìm kiếm chuỗi có dấu để lấy inventory rồi kiểm tra ngữ cảnh; không coi mọi ký tự Unicode hoặc comment là nhãn UI.

Chỉ chuyển text sản phẩm do extension định nghĩa. Giữ nguyên title, nội dung artifact/Instructions, Session type labels và dữ liệu user nhập, kể cả tiếng Việt. Không dịch tài liệu/comment/test fixture chỉ để làm sạch tìm kiếm, không thêm i18n framework hoặc thay bố cục. Dịch wording tooltip hiện có thuộc Phase 4; mở rộng tooltip thành đầy đủ Name/Kind/Type vẫn thuộc Phase 5.

### 3.7. Shape entry result và ranh giới commit của Chặng 2

Chốt shape trước khi sửa tool descriptions, prompts và skill. Tên type dưới đây là hướng dẫn cho phần bổ sung, không phải các exports đã có:

```ts
// ArtifactInspection: flat handle + manifest/markdown/comments/submission/hashes,
// optional roundToken/roundTokenSource/connection; không có nextAction mới.
type InspectOperationResult = {
  inspection: ArtifactInspection;
  session: SessionContext;
};

// Wire results:
// create_artifact           -> { ...existingHandle, session }
// inspect_artifact_review   -> { ...inspection, session }
// join_session(Session)     -> { session }
// join_session(+artifactId) -> { session, inspection }
```

- Không lồng thêm `session` lần nữa vào `inspection`, không chuyển flat fields của inspect cũ thành nested fields. `artifactConversationId` ở flat handle phải bằng `session.sessionId`. Join-only không có inspection/token giả hoặc nhánh tự wait.
- Với Join+artifact, agent lấy feedback tại `result.inspection.comments.comments`, token/round/handle tại `result.inspection.*`; lấy active Session tại `result.session.sessionId`. Inspect cũ vẫn đọc flat fields. Prompts/skill phải hướng dẫn chuẩn hoá entry trước khi dùng unified feedback, không đoán token từ nhầm cấp.
- Core dùng chung **trả value hoặc throw**, không gọi `respond`/`toolResult` hoặc gọi một handler MCP khác. Mỗi wrapper chỉ respond một lần; tool success/error vẫn có cùng text JSON và structuredContent như hiện tại.
- Parser Join validate UUID Session, artifact ID và kiểu flags; chỉ derive artifact directory từ canonical collection. Flags inspect chỉ được có khi có artifact; Join chỉ truyền `connection` khi intent reconnect. Không thêm alias ID hoặc readonly intent để né validation; không đổi semantics của inspect cũ trong lần tách core đầu tiên.
- Chọn window/v1/round preflight trước takeover/register. Với explicit-chat-update giữ yêu cầu round rỗng và expectedReviewRound. Join-only không đi vào nhánh window/connection, kể cả chat đang giữ một artifact handle khác.
- **Create:** resolve/validate Session context sau khi artifact/membership đã tồn tại nhưng **bên trong try/rollback của `persistArtifact`, trước connection commit/open request**. Trả context đã resolve cùng result; `handleCreateTool` không đọc thêm dữ liệu có thể fail chỉ để trang trí response sau commit.
- **Inspect/Join+artifact:** register → resolve context → connection commit nằm trong cùng ranh giới rollback membership/new Session hiện có. Nếu context fail, restore `previousRegisteredAt` hoặc gỡ membership mới/xoá Session vừa tạo; không xoá artifact gốc hay membership ở Session khác. Chỉ cấp token để trả ra sau các bước có thể fail mới này; không để response lỗi đồng thời hướng dẫn retry như thể mọi side effect đều chưa xảy ra.
- Không thêm transaction framework hoặc phục hồi waiter xuyên process. Việc takeover vẫn theo cơ chế hiện tại; ranh giới này chỉ giữ rollback đã có khi bổ sung một bước resolve có thể thất bại.
- `resolveWorkSessionContext` hiện dùng `listSessionTypes`, mà API đó seed `session-types.json` khi thiếu. Để Join-only thực sự chỉ đọc, thêm đường lookup type **không seed** khi dùng resolver (thiếu file dùng default types/label fallback hiện có; JSON hỏng trả lỗi). Không đổi hành vi khởi tạo registry của UI quản lý types. Đây là điểm nối cần hoàn thiện trong Chặng 2, không phải schema/migration mới.

## 4. Thứ tự triển khai và checkpoint

| Chặng | Bước | Đầu ra để review | Trạng thái |
| --- | --- | --- | --- |
| 1 — Dữ liệu dùng chung | 1. Instructions storage | Metadata v2 cuối cùng + Markdown file + create/migrate/read/save + version/gate tương ứng. | ✅ Đã hoàn thành (Bước 1) |
| 1 — Dữ liệu dùng chung | 2. Context, snippet và kind | Shared catalog/context resolver, description utility và fixed/open kind helpers. | ✅ Đã hoàn thành (Bước 2) |
| 2 — MCP contract | 3. Inspect core và Join | Tool thứ 6, join-only/join+inspect, entry responses có context, recovery giữ intent. | ✅ Đã hoàn thành (Bước 3) |
| 2 — MCP contract | 4. Proceed | Approved directive cho non-plan, giữ feedback/comments/token contract. | ✅ Đã hoàn thành (Bước 4) |
| 3 — UI, agent và nghiệm thu | 5. Instructions UI, Connect, Add và English UI | Open file/scoped sync, Connect manager, Review New/Join prompt/wording, Add Session rỗng từ Tree View, Add Artifact qua Quick Pick, rà soát toàn App UI/Tree Views. | Chưa triển khai |
| 3 — UI, agent và nghiệm thu | 6. Kind filter và labels | Recent fixed/Other filter, View all đúng filter, labels thống nhất. | Chưa triển khai |
| 3 — UI, agent và nghiệm thu | 7. Skill, docs và validation | Skill v6/installer, tài liệu canonical, checks và bằng chứng manual riêng. | Chưa triển khai |

Mỗi chặng hoàn thành bằng diff có thể review và kiểm chứng phần mình thay đổi. Không đánh dấu UI/AI runtime pass chỉ từ source assertions, server-render markup, typecheck hoặc build.

Các checkpoint dưới đây là thứ tự review bên trong bước đã có, **không tạo phase/chặng mới**. Chặng 1 và đính chính MCP 12/metadata optional giữ nguyên trạng thái; không rollback layout/types/storage để chuẩn bị Chặng 2.

## 5. Hướng dẫn theo bước

### 5.1. Bước 1 — Instructions storage và các đường ghi

**Phụ thuộc:** không. **Đầu ra:** tách instructions khỏi persisted metadata mà giữ read model/UI sử dụng chuỗi nội dung như trước.

| File/component | Sửa cụ thể |
| --- | --- |
| `src/shared/artifact-files.ts` | Thêm constant `WORK_SESSION_INSTRUCTIONS_FILE = "instructions.md"` và helper canonical instructions path theo Session ID/root options. Không nhận path tuỳ ý từ webview. |
| `src/shared/contracts.ts` | `workSessionMetadataSchema` giữ `instructions` optional để đọc metadata cũ, vẫn strict; writer mới omit field. `WorkSession` lấy instructions từ Markdown + layout/updatedAt. Giữ MCP 12; Skill tới 6 đồng bộ bước 7. |
| `src/shared/conversation-artifact-registry.ts` | Thêm read/write instructions theo helper path (tên API triển khai có thể là `readSessionInstructions`/`writeSessionInstructions`); kiểm tra regular file/path và atomic text write. `createSession` tạo Markdown, `readSession` hydrate nội dung. |
| Cùng registry | `updateSessionDetails`: title ghi metadata, instructions ghi Markdown; nếu giữ signature nhận cả hai thì không serialize instructions lại vào JSON. `setSessionType`/type reassignment chỉ ghi metadata. `registerArtifactInSession` giữ nguyên per-artifact file và `registeredAt`. |
| `migrateConversationToSession` | Giữ single/bulk coordinator và backup v1; tạo `instructions.md` rỗng khi chuyển v1 trực tiếp sang format v2 cuối cùng, không inline field. Giữ ID/memberships và layout theo contract migration hiện có; nhánh already-v2 dùng format mới, không làm converter v2-inline. |
| `src/extension/work-session-support.ts`, gate messages ở providers/sidebar | Mốc Session 12, giữ receipt/runtime-file check. MCP 11/chưa cài bị gate, MCP 12 đủ mốc; không dò process. Không thay Recent/review thành feature bắt buộc upgrade toàn bộ. |
| Fixtures/tests producers | Đổi fixtures metadata v2 và read model cùng lúc; fixtures cần Instructions dùng file thật. Không làm parser `.passthrough()` để né strict schema. |

**Khả năng phải đạt:** Save Instructions không ghi `conversation.json`; đổi title/type không ghi Markdown; create/migrate tạo format cuối cùng; read/list không chuyển đổi dữ liệu. `updatedAt` Session vẫn derive từ createdAt/registeredAt; Save/Open/metadata/layout không tăng recency.

**Kiểm chứng:** `test/artifact-contracts.test.ts`, `test/conversation-artifact-registry.test.ts`, `test/session-migration-command.test.ts`, `test/session-type-registry.test.ts`, gate/provider/sidebar tests. Kiểm tra file thật: nội dung Markdown, metadata không inline, giữ ID/membership và nhánh gate cũ. Không thêm suite conflict/locks.

#### Đính chính sau Chặng 1 — MCP 12 và metadata Instructions cũ

- [x] Giữ checkpoint triển khai Bước 1–2; sửa riêng MCP/gate/messages/assertions từ 13 về **12** theo phiên bản release đã dành cho feature chưa phát hành. Skill hiện tại vẫn 5, phần lên 6 thuộc Bước 7.
- [x] Schema đọc nhận `instructions` optional string; đọc Session/list không còn từ chối metadata chỉ vì có field cũ. Không nới các trường/schema khác bằng passthrough.
- [x] Instructions hiệu dụng vẫn từ Markdown, thiếu file thì rỗng; read/list không rewrite JSON/tạo file. Save Instructions không ghi JSON; title/type writers omit inline field, giữ nguyên Markdown/recency.
- [x] Thêm regression cho metadata không có field/có chuỗi rỗng/có nội dung; list Session cũ; Markdown thắng field cũ; không auto migration; writer title/type không ghi lại field; MCP 11 bị gate và 12 được chấp nhận.
- **Validation đính chính 2026-11-07:** focused **5 files / 93 tests pass**; `npm.cmd run check` pass; full `npm.cmd test` **43 files / 611 tests pass, 3 skipped**; `npm.cmd run build` pass cả các targets; diff check sạch. Test dùng isolated user home, xác nhận Session v2 có field cũ list/read được; không sửa dữ liệu global hoặc cài lại runtime thật. Sidebar trong Extension Host sau reload và Session thật của Chú chưa được kiểm chứng trực tiếp.

### 5.2. Bước 2 — Shared context/catalog, description và kind helpers

**Phụ thuộc:** bước 1. **Đầu ra:** một shared resolver không phụ thuộc VS Code và helpers dùng chung MCP/UI.

| File/component | Sửa cụ thể |
| --- | --- |
| `src/shared/contracts.ts` | Thêm schemas/types Session context/catalog và entry results theo mục 3.3; không trộn persisted schema với DTO. Giữ unavailable row rõ ràng. |
| `src/shared/work-session-context.ts` **(mới)** | Resolve `readSession`, type label, instructionsPath, từng vùng membership/layout, manifests và snippets; validation dựa trên `artifact-validation.ts` và canonical path helpers. Không gọi register/inspect. |
| `src/shared/markdown-description.ts` **(mới)** | Parse AST bằng các dependency đã có; nối text với khoảng trắng để không dính các block, bỏ markup/HTML, normalize và truncate với một giới hạn chung. Không thay `parseMarkdownBlocks`/block ID algorithm chỉ để làm snippet. |
| `src/shared/artifact-kinds.ts` **(mới)** | Khai báo 10 fixed kinds, kiểm tra fixed/open, label formatter và nhóm Proceed plan/non-plan. Dùng lại regex trong contracts, không siết invalidation của kind cũ ngoài yêu cầu. |
| MCP và extension consumers | Import resolver/helpers cần thiết; không kéo `vscode` hoặc discovery UI vào bundle MCP. DTO manager chưa cần description/filter/masonry Phase 5. |

**Khả năng phải đạt:** context giống nhau giữa các entry; member missing không giả kind spec; snippet cập nhật từ Markdown hiện tại; catalog read không thay lifecycle/membership. Không lưu cache/index bền vững hay copy metadata artifact vào Session.

**Kiểm chứng:** thêm `test/work-session-context.test.ts`, `test/markdown-description.test.ts`, `test/artifact-kinds.test.ts`. Cover thứ tự ba vùng, metadata/type/instructions/path, unavailable member, Markdown heading/link/list/code/HTML và truncation; đối chiếu các file quản lý không bị ghi sau resolve. Giữ regression `test/markdown-blocks.test.ts` về block IDs.

### 5.3. Bước 3 — Tách inspect core, thêm Join và context entry

**Phụ thuộc:** bước 1–2. **Đầu ra:** join-only và join+artifact dùng một MCP call với semantics đúng.

| File/component | Sửa cụ thể |
| --- | --- |
| `src/integration/artifact-review-mcp-v4.ts` — inspect | Tách core trả operation result khỏi `handleInspectTool` đang respond trực tiếp. Checkpoint đầu chỉ tách cơ học, giữ observable behavior; sau đó nối context với thứ tự cuối cùng validate handle/round/session/routing → takeover khi yêu cầu → snapshot → register/new + context + connection trong rollback → token/result. Wrapper inspect chỉ parse/call/serialize error/result. |
| Cùng MCP — join | Thêm `JOIN_SESSION_TOOL_NAME`, input parser/allowed keys, handler, `tools/list`, `tools/call`, initialize instructions. Session-only resolve context read-only; artifact branch resolve ID thành canonical handle rồi gọi core với exact Session ID. |
| Cùng MCP — entry responses | Create/inspect thêm `session`; join+artifact trả `session` cùng `inspection` từ core. Giữ flat legacy handle fields của create/inspect để consumers hiện tại không mất round/connection. Context phản ánh membership sau register. |
| Cùng MCP — recovery | Mở rộng expectedNextTool union/window error context cho join. Chỉ sửa hints phù hợp entry; recovery round/token vẫn dùng exact handle và flow hiện có. Giữ New/Join intent khi chọn lại window. |
| Registry/context boundary | Preflight v1/missing Session trước takeover/mutation; không biến Join sai ID thành create. Giữ rollback đã có khi connection commit thất bại và cleanup instructions thuộc Session mới nếu rollback xoá Session. |

**Khả năng phải đạt:** Join manager không chạm waiter; Join artifact chỉ tác động target được yêu cầu; context không khiến client phải gọi inspect lần hai. Reference reads hoàn toàn tách khỏi takeover. Không replay approval từ submission cũ và không tự wait/advance chỉ vì join-only thành công.

**Kiểm chứng:** mở rộng `test/review-wait-mcp.test.ts` hoặc tách suite join dùng cùng harness spawn MCP. Cover tools/list (6 tools), text JSON = structuredContent, join-only không ghi/cấp token, join+artifact tương đương inspect feedback/token/connection, create/inspect có context, New giữ membership cũ. Giữ regressions v1 preflight, window selection trước mutation, takeover, reconnect rollback và exact-handle rejection; không thêm framework cross-process ownership.

#### Checkpoint 3a — Tách core, chưa thêm Join hoặc context

1. Trích phần xử lý inspect thành một hàm nhận input/entry context đã chuẩn hoá và trả flat inspection + Work Session nội bộ. Wrapper giữ nguyên shape thành công/lỗi của inspect cũ.
2. Giữ `loadArtifactContext`, `readArtifactInspection`, `detachActiveArtifactWaiter`, `registerArtifactInSession`, `grantInspectedRound`, connection/rollback helpers; không viết lại các cơ chế này. Không thay wait/advance hoặc thuật toán round commit.
3. Chạy regression inspect/reconnect trước khi thêm tool thứ 6: saved comments/submission, empty round, explicit-chat-update, v1 preflight, window selection không detach waiter, reconnect rollback. Đạt checkpoint khi diff chỉ tổ chức lại và response/state effects không đổi.

#### Checkpoint 3b — Gắn context và lỗi theo entry

1. Nối resolver Chặng 1 theo vị trí commit mục 3.7, gồm lookup types không seed. Trong create phải trả context từ `persistArtifact` thay vì resolve ở `handleCreateTool` sau khi commit.
2. Với inspect, gom bước resolve mới vào cùng khối rollback đang ghi nhận Session mới/member mới/previousRegisteredAt. Dùng các API rollback đã có; không mở rộng sang xoá artifact cũ hoặc rollback việc user đã làm ở Session khác.
3. Recovery phân biệt **entry tool + có artifact handle hay không**, thay cho một boolean `isCreate` làm nguồn duy nhất. Mở rộng cả `McpWindowSelectionRequiredError`, metadata union và chỗ map các lỗi window/connection/Session. Giữ các typed round/token errors vốn đã có next-tool hint cụ thể.
4. Create vẫn retry create; Join+artifact retry Join với cùng Session/artifact/intent/options; Join-only lỗi Session không được gợi ý inspect một handle không tồn tại. `CONVERSATION_NOT_FOUND`/v1 không tự tạo Session thay thế.
   - Phân loại lỗi khi preflight Session ngay ở bước đọc Session; Session directory/metadata thiếu phải thành `CONVERSATION_NOT_FOUND`, không đi qua nhánh ENOENT chung hiện đang map thành `ARTIFACT_NOT_FOUND`. Artifact handle thiếu vẫn giữ lỗi artifact hiện có. Không map mọi lỗi của Join theo một resource duy nhất chỉ vì request có artifact ID.
5. Kiểm tra một đường lỗi context thật bằng fixture `session-types.json` sai schema trong isolated home: create rollback artifact/Session vừa tạo; inspect vào Session có sẵn giữ membership/registeredAt trước đó; inspect New không để lại Session mồ côi. Không cần thêm hệ thống fault injection chung.

#### Checkpoint 3c — Expose `join_session` và khoá wire contract

1. Join-only: validate exact Session ID → preflight/read context → `{ session }`. Không resolve window, register, takeover, token hoặc auto wait. Test cả khi types file chưa có để không seed file ngoài ý muốn.
2. Join+artifact: validate flags → derive exact global handle → gọi core với Session đích → `{ session, inspection }`. Khi `takeover:true`, chỉ target artifact bị detach; giữ cùng token source/round/hash/connection semantics như inspect cũ.
3. Đồng bộ `tools/list`, dispatcher, initialize instructions, allowed keys/types và recovery. Giữ MCP **12**; tool count mới là **6** sau checkpoint này. Chưa dùng số version để suy rằng một MCP process cũ cùng số 12 đã có Join.
4. Test text JSON bằng structuredContent và shape cả 4 entry tại mục 3.7. Round mismatch, saved approval và errors không được sinh execution directive mới từ snapshot. Dùng harness MCP đang có với `CODEX_ARTIFACTS_TEST_USER_HOME`/registry tạm; không kiểm tra trên global artifacts của user.

**Đạt Bước 3:** cả inspect cũ và Join mới cùng dùng một core; lỗi context không biến create/inspect đã mutate thành một lỗi generic ngoài rollback; recovery giữ đúng entry; Join-only không ghi; chưa đánh dấu Chặng 2 hoàn thành trước khi Bước 4 cũng đạt.

### 5.4. Bước 4 — Chuẩn hoá Proceed và feedback

**Phụ thuộc:** bước 2; có thể hoàn thiện cùng chặng MCP sau bước 3. **Đầu ra:** approve non-plan có directive rõ ràng mà không làm thay đổi inspect semantics.

| File/component | Sửa cụ thể |
| --- | --- |
| MCP `ReviewWaitResult`, `reviewDecisionAction` | Thêm `approved` vào nextAction union; dùng helper kind để phân nhánh mục 3.5. Giữ exact execution instruction của plan và unified revise policy. |
| `readValidatedSubmissionOnce`, wait/advance descriptions | Cả immediate submission và live wait trả directive mới cho non-plan; comments luôn đầy đủ. Cập nhật tool descriptions/initialize để không nói chỉ có plan nextAction. |
| Inspect/join-inspection | Giữ snapshot/token contract; không dùng mapping decision hiện tại để phát lại action của một submission đã đọc. |

**Kiểm chứng:** `test/review-wait-mcp.test.ts`, `test/review-actions.test.ts` nếu liên quan UI submission. Hai kind plan đều execute; fixed `idea`/`checklist` và open `workaround` đều approved; revise mọi loại vẫn comments/token/process-review-feedback; save không nextAction. Chạy cả đường existing submission và advance-and-wait, giữ tests reconnect không replay terminal action.

**Thứ tự sửa Bước 4:** mở rộng union `ReviewWaitResult.nextAction` → dùng `isPlanProceedKind`/mapping chung → cập nhật prose tools/initialize → sửa assertions cũ đang expect non-plan approve không có nextAction. Không bỏ assertions về full comments, exact hashes hay token state để làm tests pass. Chỉ wait/advance phát action của quyết định vừa nhận; inspect/Join-inspection chỉ cung cấp snapshot và token phục hồi theo contract. Test plan/implementation-plan riêng, một fixed non-plan và một open kind; không cần nhân toàn bộ ma trận kind/window/lifecycle.

### 5.5. Bước 5 — Instructions UI, scoped watcher, Connect, Add và English UI

**Phụ thuộc:** bước 1–3. **Đầu ra:** giữ manager hiện tại, thêm Connect/Open Instructions, Add Session/Add Artifact và đường refresh đúng phần. Dùng lại storage/API của Chặng 1 đã hoàn thành; không thay persisted schema hoặc thêm MCP tool chỉ cho các thao tác Add.

| File/component | Sửa cụ thể |
| --- | --- |
| `src/shared/contracts.ts` | Thêm event `{ kind: "instructions", sessionId }`, typed actions `openSessionInstructionsFile` và `copySessionConnectPrompt`, acknowledgement copy nếu UI cần. Bind Session từ document, không cho webview gửi file path. |
| `src/extension/conversation-artifact-service.ts` | `classifyWatcherUri` nhận exact instructions filename; `changeKey`/batch dedupe có event mới. Save Instructions phát instructions event; title/type giữ metadata event. Reuse các patches đã có. |
| `src/extension/work-session-provider.ts` | Read/Save qua file API; instructions event chỉ đọc/patch nội dung đúng Session. Giữ `lastPersistedInstructions` so với giá trị trên đĩa lần trước, không so ô đang nhập. Open xác định canonical path và mở Markdown editor; file chưa có có thể tạo rỗng sau explicit action. |
| Cùng provider | Connect manager kiểm tra Session/gate rồi copy prompt chứa exact Session ID gọi `join_session`, không có artifact/takeover. Lỗi Save/Open/Copy dùng action error hiện tại, không chuyển manager sang full-page error hoặc bỏ input. |
| `src/webview/SessionApp.tsx`, `src/webview/styles.css` | Thêm Connect ở header và Open Markdown File cạnh Instructions. Giữ textarea fixed-height/scroll + Save; Markdown source nguyên bản, không rich editor. Xử lý action/ack typed, không remount/reset input khi copy/open hoặc dữ liệu không liên quan đổi. |
| `src/shared/artifact-connect-prompt.ts` | Legacy giữ exact inspect prompt. New yêu cầu inspect omit active ID cũ, nhận `session` ngay trong response. Join prompt dùng `join_session({sessionId, artifactId, takeover:true, ...})` cho một call; exact directory có thể giữ làm evidence, không yêu cầu gọi thêm inspect để lấy cùng snapshot. |
| `src/shared/session-connect-prompt.ts` **(mới)** | Builder cho manager Join theo Session ID không artifact; hướng dẫn success-only active replacement, đọc Instructions/catalog, không takeover ngầm. |
| `src/extension/artifact-review-provider.ts`, `src/webview/ArtifactConnectDialog.tsx` | Giữ popup New/Join, v1 Join disabled và host validation đích. Host truyền exact artifact ID vào builder mới, không nhận ID tuỳ ý từ prompt UI. Nhánh MCP chưa đủ version vẫn copy legacy, không yêu cầu tool mới hoặc tạo Session format mới. |
| `src/webview/ArtifactConnectDialog.tsx` | Áp wording mục 3.6: New bắt đầu Session từ artifact này; Join inspect rồi nhận toàn bộ context Session liên quan đã chọn. Bỏ mô tả “tách biệt ngữ cảnh”/“chỉ liên kết artifact”; đổi cả title, buttons, aria-label, empty state và migration tooltip/badge sang tiếng Anh. |
| `src/webview/` toàn bộ, `src/extension/work-session-sidebar.ts`, UI-facing strings trong `src/extension/`/`src/shared/`, `package.json` | Lập inventory text sản phẩm còn tiếng Việt và chuyển sang tiếng Anh theo mục 3.6. Các điểm đã thấy: Recent **No artifacts yet**, **Create an artifact with your AI assistant**, **View all (N artifacts)...**, **Updated / Created**; Review App Sessions tooltip và gate message dùng đúng mốc version. Giữ nguyên dữ liệu user và hành vi controls. |
| `src/extension/extension.ts`, sidebar/review consumers | Watcher registry hiện có `**/*` dùng được cho Markdown; cập nhật subscribers để instructions event không refresh Recent/card/Session targets vô cớ. Không thêm watcher trên từng artifact hoặc reload cả app. |

**Hành vi refresh phải đạt:** user đang gõ → artifact/membership/layout/title/type đổi vẫn giữ input; chính Markdown trên đĩa đổi → nhận nội dung mới kể cả đang gõ; own-save có ack và không reset thừa. Không `isDirty` guard, dialog hoặc merge AI–user. Open file chỉ mở editor, không tự Save phần textarea chưa Save; hai nơi cùng sửa chấp nhận bản ghi sau cùng thắng.

**Khả năng UI phải đạt:** labels/messages do extension định nghĩa dùng tiếng Anh trên mọi App/Tree View đã rà soát; user content vẫn nguyên bản. New/Join description mô tả đúng entry và context thực tế; không quảng bá Join là chuyển lịch sử chat hoặc auto-read mọi artifact.

**Kiểm chứng:** `test/conversation-artifact-service.test.ts`, `test/work-session-provider.test.ts`, `test/session-app.test.tsx`, `test/artifact-connect-prompt.test.ts`, `test/artifact-review-provider.test.ts`; thêm test builder Session prompt nếu tách module. Test exact file action, gate cũ/mới, patch đúng Session và không đổi input khi unrelated event. Với wording, cập nhật assertions của dialog/sidebar/review có sẵn, kiểm tra New/Join labels/descriptions và giữ title/type/content tiếng Việt do user nhập; không thêm suite chỉ quét cấm mọi ký tự tiếng Việt. Manual UI mới là bằng chứng Open/clipboard/focus hoạt động.

#### Checkpoint 5a — Instructions event và host actions trước khi thêm controls

1. Thêm `instructions` vào event union và `changeKey`; classifier nhận `WORK_SESSION_INSTRUCTIONS_FILE` trong đúng thư mục Session. Watcher `**/*` đang có đủ khả năng theo dõi file; giữ ignore tmp/backup.
2. `updateSessionDetails` service phát metadata event nếu có title, instructions event nếu có Instructions; nếu cả hai thì phát cả hai trong một batch. Không đổi cách registry ghi metadata/Markdown đã hoàn thành ở Chặng 1.
3. Provider lọc các thay đổi liên quan tới document trước, rồi xác định các phần cần patch độc lập. Không dùng duy nhất `changes.every(...)` để phân nhánh: batch `metadata(S) + instructions(S)` phải gửi đúng hai phần, batch có Session khác không được ép refresh toàn app.

| Event liên quan | Kết quả ở manager S | Các consumer khác |
| --- | --- | --- |
| `instructions(S)` | Đọc nội dung persisted; khác `lastPersistedInstructions` mới gửi instructions patch, cập nhật mốc so sánh. Không phát summary/card patch chỉ vì Markdown đổi. | Sessions sidebar/Review Session targets/Recent bỏ qua nếu không có event khác liên quan. |
| `metadata(S)` / `types` | Summary/type label; không lấy snapshot này gán lại ô nhập. | Refresh danh sách/label phù hợp như hiện tại. |
| `membership(S)` / `layout(S)` / artifact là member | Artifact sections + updatedAt phù hợp; giữ draft input. | Membership/manifest refresh đúng consumer; layout không đổi recency. |
| Generic hoặc batch hỗn hợp | Có thể resolve DTO một lần rồi chọn patches; nếu gửi full state vẫn giữ reducer không reset draft và chỉ gửi instructions patch khi persisted value thực sự đổi. | Giữ cơ chế invalidation hiện có, không dựng cache/index framework. |

4. Save thành công giữ `sessionInstructionsSaved`; own-save echo không phát patch lặp vô cớ. Lỗi Save/Open/Copy/Add dùng `actionError`, không dùng full-page `error` khi document vẫn đọc được. Không thêm isDirty/conflict/recovery.
5. Host actions mới cần kiểm tra MCP/gate 12 trước thao tác; `openSessionInstructionsFile`, `copySessionConnectPrompt`, `addSessionArtifact` không nhận đường dẫn hoặc Session ID từ webview. Open lấy exact path từ document/root options, chỉ tạo rỗng khi file thật sự chưa có sau explicit action; không ghi đè file tồn tại.

**Đạt checkpoint:** test reducer/provider giữ phần user đang gõ khi title/type/membership/layout đổi; nhận giá trị mới khi chính Markdown đổi, kể cả đang gõ; batch hai loại event không rơi sang đường reset state. Giữ markup chip type và spacing đang được Chú chỉnh.

#### Checkpoint 5b — UI và prompt theo đúng entry

| Entry | Tool/options trong prompt | Sau thành công |
| --- | --- | --- |
| Manager Connect | `join_session({ sessionId })`, không artifact/intent/takeover. | Đọc context, đặt active ID; không tự wait. |
| Review New | `inspect_artifact_review` với exact directory, `takeover: true`, **omit** ID đang giữ; không tạo artifact khác. | Nhận flat inspection + `session`, thay active bằng ID mới. |
| Review Join | `join_session({ sessionId, artifactId, takeover: true })`; không tự thêm reconnect intent nếu user chỉ yêu cầu inspect/join. | Nhận `session` + nested `inspection`; chỉ target artifact bị takeover. |
| Legacy support chưa đủ | Giữ prompt inspect exact handle cũ; không gửi `join_session` hoặc yêu cầu Session controls mới. | Theo contract runtime cũ; không giả định tool Join đã có vì cùng numeric version. |

- Refine builder signature để host truyền **artifact ID từ store đã validate**, không lấy basename/title chưa kiểm chứng từ webview. Giữ unit tests legacy exact handle và success-only New/Join đã có; thêm assertions tên tool/ID/payload đúng từng entry.
- Thêm Connect ở header/Open Markdown File cạnh Instructions, giữ các controls đang có và panel preference. Copy chỉ ghi clipboard + acknowledgement UI, không mở Session khác hoặc gọi MCP tại extension.
- Áp wording New/Join/English ở mục 3.6 cùng đợt này; labels và prompt phải cùng ngữ nghĩa. Không thêm tooltip đầy đủ/More/ZIP của Phase 5.

#### Checkpoint 5c — Add Session và Add Artifact

Các phần dưới đây triển khai trong **Chặng 3**, không thay đổi checkpoint Bước 1–2 đã xong. Quyết định mới cho phép user tạo Session rỗng thay thế giới hạn cũ “không có + session”.

| File/component | Sửa cụ thể và hành vi phải đạt |
| --- | --- |
| `src/extension/extension.ts`, `package.json` | Đăng ký command dự kiến `agentPlus.createSession`, label **Add Session**, icon plus trong `view/title` của `agentPlus.sessions`. Kiểm tra gate Session hiện có trước khi ghi. |
| `src/extension/session-create-command.ts` **(mới)** | Native Input Box nhập title, validate bằng Session title contract; không yêu cầu chọn type/artifact. Huỷ không ghi. Thành công gọi `createSession` với type mặc định `conversation`, Instructions rỗng và không membership, phát thay đổi phù hợp rồi mở manager đúng ID mới. |
| `src/webview/SessionApp.tsx`, `src/shared/contracts.ts` | Header vùng Working có nút ＋, tooltip/aria-label **Add Artifact**. Typed action dự kiến `addSessionArtifact`; Session ID lấy từ document tại host, không nhận file path từ webview. |
| `src/extension/session-artifact-add-command.ts` **(mới)** | Quick Pick title **Add Artifact to Session**, dùng validated discovery/title search hiện có; loại artifact đã thuộc Session ở bất kỳ vùng nào. User chọn artifact hiện có; huỷ không ghi, không tự mở Review hoặc tạo artifact mới. Tận dụng discovery/search helpers, không dùng nguyên search command đang có side effect Open. |
| `src/extension/work-session-provider.ts`, `src/extension/conversation-artifact-service.ts` | Bind action vào Session đang mở, kiểm tra gate và artifact hợp lệ, gọi `registerArtifactInSession` đã có. Phát membership event đúng Session/artifact để Working/count/recency cập nhật, không reset input Instructions. Lỗi dùng action error hiện có. |

- Artifact được thêm xuất hiện cuối Working theo reconcile layout hiện tại; không chuyển/xoá membership ở Session khác, không inspect/takeover hoặc sửa review lifecycle.
- `registeredAt` của membership mới làm tăng recency theo công thức đã có. Add Session/Add Artifact ở extension không tự đổi active Session ID trong chat AI; Connect vẫn là thao tác riêng.
- **Kiểm chứng:** bổ sung command/provider/sidebar/service tests cho nhập title/cancel/tạo rỗng/type mặc định/mở đúng ID, picker loại member có sẵn, thêm đúng Working và không ảnh hưởng Session khác/input Instructions. Giữ gate cũ/mới; không viết lại tests storage Chặng 1 ngoài phần interface thực sự bị tác động.
- **Manual:** Add Session → mở manager rỗng → Add Artifact → chọn mục → card/count xuất hiện, reopen còn membership; đang gõ Instructions vẫn giữ phần nhập. Menu More và Export ZIP không thuộc bước này, thực hiện Phase 5.
- Trước khi register, host revalidate target đã chọn bằng validator artifact hiện có vì artifact có thể không còn tồn tại khi picker đang mở. Picker chỉ trả lựa chọn; callback mutation thuộc service/host, không tái dùng callback Open của Search Artifact.
- Nếu create Session đã thành công nhưng mở editor lỗi thì báo rõ lỗi mở, giữ Session vừa tạo và ID; không tự create lần hai. Filter Sessions có thể đang ẩn type mặc định, vì vậy create command mở theo ID trả về thay vì tìm Session mới trong danh sách đã filter.

### 5.6. Bước 6 — Recent kind filter và labels

**Phụ thuộc:** bước 2. **Đầu ra:** lọc native trên Recent, tách biệt filter Session type hiện có.

| File/component | Sửa cụ thể |
| --- | --- |
| `src/extension/artifact-kind-filter-command.ts` **(mới)** | Quick Pick một lựa chọn: **All Types**, từng fixed kind theo label, **Other**. Preselect giá trị hiện tại; cancel không đổi filter. Other là synthetic filter, không ghi kind `other` vào artifact. |
| `src/extension/work-session-sidebar.ts` | Recent giữ kind filter trong bộ nhớ cửa sổ; refresh không mất, reload về All Types. Filter full discovery trước sort/cap20; Other = kind không thuộc fixed set. Không đổi Session type filter hoặc ghi recency. |
| `src/extension/extension.ts`, `package.json` | Đăng ký command dự kiến `agentPlus.filterRecentArtifacts`, icon filter và `view/title` đúng Recent. Dùng `createTreeView` cho Recent để có indicator `Type: <Label>` như Sessions; dispose handle/subscription đúng một lần. |
| `src/extension/artifact-search.ts`, `src/extension/artifact-search-command.ts` | View all từ Recent truyền kind filter đang dùng để search cùng tập; filter kind trước title match/cap1000. Command Search Artifact gọi trực tiếp không có filter vẫn tìm toàn collection như hiện tại. Không biến query title thành parser cú pháp filter. |
| `src/webview/ReviewApp.tsx`, `src/webview/SessionApp.tsx`, sidebar/search labels | Dùng formatter chung cho artifact kind thay raw slug hoặc `.toUpperCase()`. Session type label vẫn lấy registry. Không thêm card description/manager kind filters của Phase 5. |

**Khả năng phải đạt:** fixed kinds xuất hiện riêng kể cả không có artifact; Other gom toàn bộ kind mở; View all count/results phản ánh đúng filter. UI có trạng thái không có kết quả phù hợp. Filter không sửa manifests, không migrate hoặc tạo yêu cầu upgrade MCP riêng cho Recent.

**Kiểm chứng:** `test/work-session-sidebar.test.ts`, `test/artifact-search.test.ts`, `test/artifact-search-command.test.ts`, helper/picker tests và `test/release-contract.test.ts` cho command/menu. Dùng hơn 20 artifact với kind cần tìm nằm ngoài top20 để chứng minh thứ tự filter trước cap; test Other, cancel/refresh/reload và View all filter độc lập Command Palette search.

**Thứ tự nối Bước 6:**

1. Dùng một typed filter value (All / Fixed kind ID / Other), không suy từ label UI hoặc `isPlanProceedKind`. Danh sách fixed lấy từ `FIXED_ARTIFACT_KINDS`, formatter chỉ làm display. Kind mở vẫn có label riêng trong card/search và được gom vào Other của Recent.
2. Provider Recent áp `discovery → kind filter → sort recency → cap 20 → View all count`. Không lấy top20 rồi mới filter. Giữ state trong instance provider, không ghi `globalState` hoặc manifest.
3. Khi đổi sang `createTreeView` cho Recent, bỏ registration cũ `registerTreeDataProvider` của cùng view; dispose một handle duy nhất. Đăng ký command phễu + cập nhật indicator cùng handler filter, không tác động provider Sessions.
4. View all truyền object option filter hiện tại vào command Search Artifact. Handler trong `extension.ts` phải nhận/validate option rồi truyền xuống search controller; trong controller lọc kind **trước** title matching/cap1000. Command Palette/no arguments mặc định All Types, không đọc ngầm filter sidebar.
5. Dùng fixture 25 artifact, trong đó kind cần tìm chỉ xuất hiện ngoài top20 trước filter; kiểm tra row/count/View all và Search không argument riêng. Đây là regression cho đường thực tế, không xây query language hoặc bộ filter mới cho manager.

### 5.7. Bước 7 — Skill, installer, docs và nghiệm thu

**Phụ thuộc:** bước 1–6. **Đầu ra:** AI dùng đúng entry/decision và installed assets phản ánh contract mới.

| File/component | Sửa cụ thể |
| --- | --- |
| `skills/create-review-artifact/SKILL.md` | Thêm trigger Join Session theo yêu cầu rõ ràng và availability 6 tools; Join-only không đòi artifact hoặc tự tạo lifecycle. Giữ không auto-trigger vì document type. Bỏ ép implementation-plan; hướng dẫn fixed/open choice, plan vs approved và success-only active context. |
| `references/artifact-contract.md` | Tool thứ 6/input/output, nested inspection, `session` context, exact reference paths, instructions file exception, mapping decisions và recovery. Wait/advance vẫn đủ comments; snapshot cũ không tái thực thi. |
| Cùng skill/contract | AI được đọc tài liệu tham khảo qua catalog exact path và sửa đúng `instructions.md` theo yêu cầu. Cấm sửa managed artifact lifecycle/membership/layout/metadata trực tiếp; cho phép Instructions Markdown không bị quy tắc cấm toàn bộ registry phủ định. Không tự đọc toàn bộ catalog hoặc chat transcript. |
| `skills/create-review-artifact/agents/openai.yaml` | Đồng bộ display/short description/default prompt với Join entry, không mở auto-trigger ngoài yêu cầu user. |
| `src/extension/mcp-clients/skill-helper.ts` | Append description chính thức mới vào `OFFICIAL_SKILL_DESCRIPTIONS`, giữ các entry cũ và custom rules markers; không mất user-custom description khi reinstall. Không refactor client drivers ngoài assets contract cần thiết. |
| `src/shared/contracts.ts`, support/version tests | Giữ MCP **12** / hoàn tất Skill **6** theo baseline đã nêu, `serverInfo`/tool instructions/receipts đồng bộ. Không bump MCP riêng cho Join hoặc các chặng của feature chưa release. Giữ package 1.1.4 nếu không có yêu cầu release khác. |
| Docs canonical | Cập nhật phần liên quan trong `README.md`, `docs/INSTRUCTION.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/COMPONENTS.md`, `CHANGELOG.md`, `docs/CHANGE_LOGS.md`. Sửa phát biểu cũ về 5 tools, ép implementation-plan, approve non-plan và inline instructions; không chép nguyên plan vào docs. |
| Plans | Ghi progress/checkpoint thực tế vào file này và `plan.md`; Phase 5 giữ nguyên chưa triển khai. Không đổi lịch sử kết quả của Phase 3 thành bằng chứng Phase 4. |

**Kiểm chứng:** `test/skill-contract.test.ts`, `test/workspace-integration.test.ts`, `test/mcp-client-drivers.test.ts`, `test/integration-verification.test.ts`, `test/global-integration-status.test.ts`, `test/release-contract.test.ts`. Cập nhật exact description/tool count/version assertions theo contract mới, giữ tests customization-preserving installer. Chỉ sửa test bị ảnh hưởng, không xoá assertion bảo vệ lifecycle để làm pass.

**Checkpoint 7a — Skill hiểu đúng response và quyết định**

- Bắt đầu bằng phân biệt `join-only` và artifact entry. Join-only dùng `session` rồi kết thúc thao tác entry/tiếp tục yêu cầu của user; không gọi wait/advance vì không có target artifact. Với Join+artifact, normalize `result.inspection`; inspect cũ vẫn dùng flat response, theo đúng mục 3.7.
- Chỉ sau tool success mới thay activeSessionId bằng `result.session.sessionId`; giữ các handle/round/window mappings khác. Lỗi v1/missing Session đưa lựa chọn cho user, không clear ID rồi tự tạo Session như recovery prose cũ đang ghi.
- Phân biệt **fresh decision từ wait/advance** với **saved submission snapshot từ inspect/Join**. Fresh plan approval execute; fresh non-plan approval obey `approved`/ghi nhận. Snapshot approve/save cũ không phải lệnh mới, không chạy lại hành động đã duyệt.
- Giữ `comments.comments` đầy đủ sau normalize; không gọi inspect lần hai chỉ vì đang nhìn sai cấp của Join result. Empty feedback chỉ có ý nghĩa khi đang ở artifact flow, không áp dụng cho join-only.
- Test skill/contract prose phải mô tả cùng wire shape/tool names/actions; bỏ assertion ép mọi create thành implementation-plan, thay bằng kiểm tra fixed/open selection và hai nhánh Proceed. Không xoá các kiểm tra feedback/recovery/state binding.

**Checkpoint 7b — Assets/docs và handoff**

- Append official description mới có Join trigger vào lịch sử descriptions trước khi cập nhật packaged frontmatter; giữ entry cũ và custom description/rules markers. Đồng bộ `agents/openai.yaml` với cùng entry intent.
- Giữ **MCP 12**, Skill hiện 5 cho tới khi sửa skill và bump 6 cùng nhau. Installer/verification vẫn dùng per-asset receipts và bundled-file comparison; không tăng MCP vì các chặng, không kiểm tra process đang chạy.
- Sau Chặng 2, catalog mới có 6 tools; một process test cũ cũng mang version 12 nhưng còn 5 tools cần reinstall/restart qua luồng hiện có. Availability check của skill dùng catalog thật, không suy khả năng Join từ version number.
- Chạy tập tests bị ảnh hưởng mỗi checkpoint, rồi check/full tests/build ở cuối. Ghi riêng kết quả Extension Host/AI client và phần chưa xác minh. Chặng 3 không được đóng chỉ vì các tests assert chuỗi hoặc server-render markup pass.

## 6. Validation và nghiệm thu

Trong từng bước chạy focused tests của component thay đổi. Kết thúc Phase 4 chạy từ repository root:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
git -c core.safecrlf=false diff --check
```

Không chạy thao tác install/update lên global assets thật như một phần unit test; test dùng isolated user home. Khi kiểm chứng manual cần cài runtime/skill qua luồng extension hiện có và restart AI client theo thông báo; không sửa thẳng installed bundle.

### Manual trong Extension Development Host và một AI client

1. **Instructions:** tạo Session/migrate v1, xác nhận metadata cuối cùng + `instructions.md`. Save Markdown từ textarea rồi Open Markdown File; sửa file ngoài rồi quay lại manager thấy đúng nội dung. Title/type/member/layout thay đổi không đè ô đang nhập. Chỉ chính nội dung file đổi mới thay input theo quyết định đã chốt.
2. **Manager Connect:** copy prompt → AI gọi một `join_session(sessionId)` → nhận Instructions/catalog, giữ active ID. Không tạo artifact, takeover hay thay membership chỉ để vào Session.
3. **Review Join:** chọn Session v2 → prompt có exact Session/artifact IDs → một join call trả inspection/feedback/token như inspect; không inspect lần hai chỉ để lấy dữ liệu. Các artifact khác trong catalog giữ waiter/lifecycle.
4. **Review New:** chat đang giữ S vẫn inspect omit S → nhận N + context, giữ cùng artifact ID và memberships cũ → request mặc định tiếp theo dùng N. Thử Join T thay active sau success; lỗi không tự quay về S hoặc tạo mới.
5. **Selective reads:** AI dùng catalog để đọc một reference qua artifactPath; không register/takeover/làm tăng recency. Khi thật sự xử lý saved feedback, dùng exact handle và lifecycle tool.
6. **Proceed:** plan và implementation-plan đều execute-approved-plan; idea và một kind mở đều approved/ghi nhận, không tự code. Review question-only vẫn trả lời chat, advance không đổi Markdown SHA. Reconnect artifact đã approve không thực thi lại hành động cũ.
7. **Recent:** filter fixed/Other, refresh còn filter, View all cùng tập; Search Artifact trực tiếp không bị filter sidebar áp vào. Label sentence case, Sessions type filter/search hiện có không đổi.
8. **Compatibility:** receipt/runtime trên đĩa chưa đủ mới thì Session actions gate và Review Connect dùng legacy; runtime mới + conversation v1 vẫn yêu cầu migration. Không tuyên bố đã xác minh process MCP đang chạy từ kiểm tra file cài đặt.
9. **English UI/New–Join:** duyệt Review App, Session Manager, Connect dialog, Recent/Sessions, empty/error/gate/migration states và native Quick Inputs; product-owned labels/tooltips/aria text dùng tiếng Anh. New nói bắt đầu từ artifact; Join nói inspect và tiếp tục Session có context đã chọn. Dữ liệu user bằng tiếng Việt vẫn giữ nguyên; kiểm chứng cả nút, descriptions và prompt/tool thực sự khớp nhau.

Ghi rõ môi trường/client và mục manual đã chạy hoặc chưa xác minh. Automated pass không thay thế Extension Host/clipboard/AI continuation evidence. Không đặt số tests đích cố định theo 587 tests lịch sử.

**Đạt Phase 4 khi:** ba entry cho context nhất quán; join+artifact dùng chung inspect và một call; Instructions dùng một nguồn Markdown; fixed/open kind/Proceed đúng; tạo Session rỗng và Add Artifact qua Quick Pick hoạt động; Connect/filter/skill/install đồng bộ; toàn App UI/Tree Views đã được rà soát English wording, New/Join đúng nghĩa; check/test/build pass và giới hạn manual được báo rõ. Không đưa tính năng Phase 5 vào tiêu chí hoàn thành.

## 7. Rủi ro triển khai và giới hạn chấp nhận

- **Tách inspect mất side effects hoặc thứ tự:** core phải giữ routing/v1 preflight trước takeover và rollback connection/membership. Tập trung regression vào đường đang có, không thêm hệ thống ownership khác.
- **Nhầm context với review authorization:** catalog/read/join-only không phải token hoặc approval; snapshot submission cũ không được phát lại execution directive. Đây là ranh giới bắt buộc của join+inspect.
- **Storage đổi nhưng consumer/skill còn JSON:** rà cả create/migrate/type writes/read models/watcher/fixtures và prose cấm sửa file để không dual-write hoặc hướng dẫn AI sửa sai file. Không có production fallback cho v2-inline chưa publish.
- **Lọc sau cap hoặc nhóm Other sai:** fixed set là nguồn chung; Other dựa trên set membership, không dựa vào nhóm Proceed. Hai kind plan có cùng action nhưng vẫn là hai filter.
- **Giới hạn đã chấp nhận:** file cài mới không chứng minh process đang chạy đã restart; own/external Instructions edits dùng last-write-wins, không có dirty recovery; ownership cùng artifact vẫn theo cơ chế hiện tại. Không biến các giới hạn này thành chặng hardening.
- **Độ khó dự kiến:** trung bình–khá; chặng MCP khó nhất vì giữ lifecycle/recovery khi tách core. Phase 1–3 đã có registry, active Session, migration, scoped refresh, pickers và UI nên không phải xây lại manager/navigation.

## 8. Checklist tiến độ

- [x] Chặng 1: storage Instructions + shared context/description/kind helpers và focused tests.
- [x] Chặng 2: inspect core + join tool/context entry + Proceed mapping và lifecycle regression.
- [x] Chặng 3: Instructions/Open/Connect + Add Session/Add Artifact + New/Join wording và English UI/Tree Views + Recent filter/labels + skill/versions/docs; không More/Export ZIP/Archive/Delete.
- [x] Check/test/build và diff checks; ghi bằng chứng manual hoặc phần chưa xác minh.
- [ ] Chú review kết quả từng chặng; chỉ đánh dấu hoàn thành theo công việc thực tế, không theo việc đã viết plan.

## 9. Kết quả rà soát hướng dẫn Chặng 2–3 — 2026-11-07

Các mục dưới đây là **Thông tin tham khảo / điểm cần làm rõ khi triển khai**, mức **P2**; không có kết luận lỗi nghiêm trọng mới trong runtime Join vì tool đó chưa được triển khai. Cột nguồn chỉ snapshot code lúc review, các tên hàm bền hơn số dòng khi refactor.

| Điểm/nguồn hiện có | Đường kích hoạt và hướng xử lý đã đưa vào plan |
| --- | --- |
| **P2 — Context sau commit:** `src/integration/artifact-review-mcp-v4.ts:638` (`persistArtifact`) và `:1520` (`handleCreateTool`). | Nếu chỉ resolve context ở wrapper sau create, lỗi types/context sẽ trả error khi artifact/Session đã tạo xong; retry có thể tạo thêm Session. Mục 3.7/3b đưa resolve vào try/rollback trước connection commit, không tạo một tầng transaction mới. Đây là rủi ro của cách nối mới, không phải khẳng định create hiện tại đã có bước resolve đó. |
| **P2 — Recovery chưa biết Join:** cùng file `:202`/`:246`. | Lỗi window/Session của tool mới có thể bị hint về inspect/create hoặc bị phân loại thành missing artifact. Checkpoint 3b yêu cầu entry-aware hints và phân loại Session preflight đúng resource; giữ exact ID qua retry. |
| **P2 — Response/decision chưa thống nhất:** `skills/create-review-artifact/SKILL.md:35`, `:76`, `:87`. | Skill hiện chỉ có flat inspect và assume approve execute; sau khi thêm nested Join sẽ có nguy cơ đọc sai comments/token hoặc replay saved approval. Mục 3.7/7a chốt normalize shape, active success-only và fresh decision vs snapshot. |
| **P2 — Batch Instructions chưa có nhánh:** `src/extension/conversation-artifact-service.ts:496`, `work-session-provider.ts:148`. | Markdown hiện rơi vào generic event; thêm một case mà giữ `every` trên cả batch vẫn có thể chạy full refresh. Checkpoint 5a xử lý theo phần liên quan và giữ reducer hiện có; chưa có bằng chứng rằng generic refresh hiện tại tự làm mất draft. |
| **P2 — Join-only và types bootstrap:** `src/shared/session-type-registry.ts:99`/`:125`, `work-session-context.ts` gọi `listSessionTypes`. | Khi file types chưa có, resolver hiện có thể tạo file qua API seed. Mục 3.7/3b bổ sung lookup không seed cho context và test trường hợp đó, giữ luồng init UI types như cũ. |

**Ranh giới review:** chỉ đọc source/diff, chạy 8 nhóm regression hiện có (145 pass, 1 skipped) và cập nhật tài liệu. Không sửa implementation, không cài runtime thật, không thay review Chặng 1 của user và không xác nhận các controls/Join mới hoạt động trong Extension Host. Các checkpoint mới ở Chặng 2–3 vẫn là công việc chưa triển khai.
