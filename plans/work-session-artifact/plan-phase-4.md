# Phase 4 — Agent, catalog và Instructions Markdown: hướng dẫn triển khai

Trạng thái: **Chưa triển khai — 7 bước trong 3 chặng.** Hiện trạng source được đối chiếu ngày **2026-11-07**. Phase 1+2 và Phase 3 là nền đã có; số tests/build ghi trong các plan trước là bằng chứng của các đợt đó, không phải kết quả kiểm chứng Phase 4.

Nguồn phạm vi: [plan tổng thể](plan.md), [Phase 3](plan-phase-3.md), [note](note.md), [phân tích ban đầu](analyzed.md) và các quyết định tiếp nối của Chú. Các quy tắc Instructions/Join/Kind dưới đây thay thế đề xuất cũ chưa chốt trong tài liệu trước; không coi mô tả code hiện tại là hành vi đích.

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
| Ngôn ngữ UI | Rà soát toàn bộ App UI, dialog, native Quick Input và Tree Views; chuyển các labels/messages do extension định nghĩa còn tiếng Việt sang tiếng Anh. Sửa New/Join theo đúng ngữ nghĩa tại mục 3.6. |
| Recent Artifacts | Filter native Quick Pick: All Types, từng kind cố định, Other; áp filter trước cap 20, có indicator. |
| Skill/integration | Thêm join/context/reference-read/instructions/kind/approved; đồng bộ descriptions, metadata, versions và docs liên quan. |

**Ngoài phạm vi:** toàn bộ Pin/Archive/Restore/Delete, file trạng thái UI, menu chuột phải và tooltip đầy đủ của sidebar (Phase 5); helper descriptions UI của các zone/Instructions, masonry, description/filter/search artifact trong manager (Phase 5); attach/import file/folder, rich editor, Markdown preview mới; tool readonly inspect hoặc tool đọc toàn bộ artifact; workflow engine/handoff; dirty dialog/recovery, lock/CAS/merge, ownership hardening xuyên process. Không thay các controls/menu sắp xếp đã được chấp nhận, không drag/drop.

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

Các điểm này là baseline source, không phải lỗi yêu cầu sửa ngoài phạm vi Phase 4.

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

- Metadata v2 đích: `{ schemaVersion: 2, sessionId, title, typeId, createdAt }`, giữ strict validation. `WorkSession`/DTO tổng hợp vẫn có chuỗi `instructions`, nhưng giá trị được đọc từ Markdown; phân biệt persisted schema với read model.
- Định dạng Session/migration mới chưa publish: sửa trực tiếp contract v2, **không tạo schema v3, không fallback inline JSON, không dual-write, không tự migrate khi read/list/activation**. Dữ liệu v2 inline/fixtures trong development phải được chuẩn bị lại trước khi test; nếu cần giữ dữ liệu dev thì chuyển thủ công một lần, không biến thành runtime compatibility branch.
- `instructions.md` rỗng hợp lệ. Create/migration mới tạo file rỗng hoặc nội dung đầu vào. Nếu file chưa có, read model dùng chuỗi rỗng, không tự ghi file khi read/list; Save/Open là thao tác chủ động có thể tạo file. Không đọc lại field inline cũ.
- Save ghi nguyên nội dung textarea bằng UTF-8, giữ Markdown/xuống dòng; không parse-to-text hoặc render rồi serialize. AI đọc/sửa exact `instructionsPath`; không sửa metadata chỉ để thay Instructions.
- Dùng canonical paths, kiểm tra file/directory như registry hiện tại, atomic writes và xử lý Windows editor lock hiện có. Không thêm lock hay cơ chế conflict mới.
- Mục tiêu phiên bản của đợt: **MCP_VERSION 12 → 13**, **SKILL_VERSION 5 → 6**; artifact schema vẫn 6, Session schema vẫn 2, membership/layout/types không đổi, package version không tự tăng trong phase này. Nếu source đã được bump bởi công việc khác khi bắt đầu thì đối chiếu lại trước khi chốt số mới.
- Gate Session storage/actions/context dùng MCP đã cài đủ phiên bản mới, đồng bộ `WORK_SESSION_REQUIRED_MCP_VERSION` tới 13 và mọi thông báo liên quan. Giữ kiểm tra receipt + runtime file trên đĩa; không bổ sung kiểm tra process đang chạy.

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

- Các type/schema này là **đầu ra cần bổ sung**, chưa tồn tại. Một resolver shared đọc registry + types + artifact files, dùng được từ Node MCP; không import VS Code/extension service vào MCP.
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

## 4. Thứ tự triển khai và checkpoint

| Chặng | Bước | Đầu ra để review | Trạng thái |
| --- | --- | --- | --- |
| 1 — Dữ liệu dùng chung | 1. Instructions storage | Metadata v2 cuối cùng + Markdown file + create/migrate/read/save + version/gate tương ứng. | Chưa triển khai |
| 1 — Dữ liệu dùng chung | 2. Context, snippet và kind | Shared catalog/context resolver, description utility và fixed/open kind helpers. | Chưa triển khai |
| 2 — MCP contract | 3. Inspect core và Join | Tool thứ 6, join-only/join+inspect, entry responses có context, recovery giữ intent. | Chưa triển khai |
| 2 — MCP contract | 4. Proceed | Approved directive cho non-plan, giữ feedback/comments/token contract. | Chưa triển khai |
| 3 — UI, agent và nghiệm thu | 5. Instructions UI, Connect và English UI | Open file/scoped sync, Connect manager, Review New/Join prompt/wording, rà soát toàn App UI/Tree Views. | Chưa triển khai |
| 3 — UI, agent và nghiệm thu | 6. Kind filter và labels | Recent fixed/Other filter, View all đúng filter, labels thống nhất. | Chưa triển khai |
| 3 — UI, agent và nghiệm thu | 7. Skill, docs và validation | Skill v6/installer, tài liệu canonical, checks và bằng chứng manual riêng. | Chưa triển khai |

Mỗi chặng hoàn thành bằng diff có thể review và kiểm chứng phần mình thay đổi. Không đánh dấu UI/AI runtime pass chỉ từ source assertions, server-render markup, typecheck hoặc build.

## 5. Hướng dẫn theo bước

### 5.1. Bước 1 — Instructions storage và các đường ghi

**Phụ thuộc:** không. **Đầu ra:** tách instructions khỏi persisted metadata mà giữ read model/UI sử dụng chuỗi nội dung như trước.

| File/component | Sửa cụ thể |
| --- | --- |
| `src/shared/artifact-files.ts` | Thêm constant `WORK_SESSION_INSTRUCTIONS_FILE = "instructions.md"` và helper canonical instructions path theo Session ID/root options. Không nhận path tuỳ ý từ webview. |
| `src/shared/contracts.ts` | Bỏ inline instructions khỏi `workSessionMetadataSchema`; `WorkSession` là metadata + instructions đọc từ file + layout/updatedAt. Giữ chuỗi instructions ở DTO/UI. Bump MCP tới 13; Skill tới 6 đồng bộ bước 7. |
| `src/shared/conversation-artifact-registry.ts` | Thêm read/write instructions theo helper path (tên API triển khai có thể là `readSessionInstructions`/`writeSessionInstructions`); kiểm tra regular file/path và atomic text write. `createSession` tạo Markdown, `readSession` hydrate nội dung. |
| Cùng registry | `updateSessionDetails`: title ghi metadata, instructions ghi Markdown; nếu giữ signature nhận cả hai thì không serialize instructions lại vào JSON. `setSessionType`/type reassignment chỉ ghi metadata. `registerArtifactInSession` giữ nguyên per-artifact file và `registeredAt`. |
| `migrateConversationToSession` | Giữ single/bulk coordinator và backup v1; tạo `instructions.md` rỗng khi chuyển v1 trực tiếp sang format v2 cuối cùng, không inline field. Giữ ID/memberships và layout theo contract migration hiện có; nhánh already-v2 dùng format mới, không làm converter v2-inline. |
| `src/extension/work-session-support.ts`, gate messages ở providers/sidebar | Mốc Session mới 13, giữ receipt/runtime-file check. Không cho thao tác storage mới ghi lên dữ liệu qua nhánh MCP cũ; không dò process. Không thay Recent/review thành feature bắt buộc upgrade toàn bộ. |
| Fixtures/tests producers | Đổi fixtures metadata v2 và read model cùng lúc; fixtures cần Instructions dùng file thật. Không làm parser `.passthrough()` để né strict schema. |

**Khả năng phải đạt:** Save Instructions không ghi `conversation.json`; đổi title/type không ghi Markdown; create/migrate tạo format cuối cùng; read/list không chuyển đổi dữ liệu. `updatedAt` Session vẫn derive từ createdAt/registeredAt; Save/Open/metadata/layout không tăng recency.

**Kiểm chứng:** `test/artifact-contracts.test.ts`, `test/conversation-artifact-registry.test.ts`, `test/session-migration-command.test.ts`, `test/session-type-registry.test.ts`, gate/provider/sidebar tests. Kiểm tra file thật: nội dung Markdown, metadata không inline, giữ ID/membership và nhánh gate cũ. Không thêm suite conflict/locks.

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
| `src/integration/artifact-review-mcp-v4.ts` — inspect | Tách core trả inspection value khỏi `handleInspectTool` đang respond trực tiếp. Giữ thứ tự validate handle/round/session/routing → takeover khi yêu cầu → snapshot/token → register/new → connection/rollback. Wrapper inspect chỉ parse/call/serialize error/result. |
| Cùng MCP — join | Thêm `JOIN_SESSION_TOOL_NAME`, input parser/allowed keys, handler, `tools/list`, `tools/call`, initialize instructions. Session-only resolve context read-only; artifact branch resolve ID thành canonical handle rồi gọi core với exact Session ID. |
| Cùng MCP — entry responses | Create/inspect thêm `session`; join+artifact trả `session` cùng `inspection` từ core. Giữ flat legacy handle fields của create/inspect để consumers hiện tại không mất round/connection. Context phản ánh membership sau register. |
| Cùng MCP — recovery | Mở rộng expectedNextTool union/window error context cho join. Chỉ sửa hints phù hợp entry; recovery round/token vẫn dùng exact handle và flow hiện có. Giữ New/Join intent khi chọn lại window. |
| Registry/context boundary | Preflight v1/missing Session trước takeover/mutation; không biến Join sai ID thành create. Giữ rollback đã có khi connection commit thất bại và cleanup instructions thuộc Session mới nếu rollback xoá Session. |

**Khả năng phải đạt:** Join manager không chạm waiter; Join artifact chỉ tác động target được yêu cầu; context không khiến client phải gọi inspect lần hai. Reference reads hoàn toàn tách khỏi takeover. Không replay approval từ submission cũ và không tự wait/advance chỉ vì join-only thành công.

**Kiểm chứng:** mở rộng `test/review-wait-mcp.test.ts` hoặc tách suite join dùng cùng harness spawn MCP. Cover tools/list (6 tools), text JSON = structuredContent, join-only không ghi/cấp token, join+artifact tương đương inspect feedback/token/connection, create/inspect có context, New giữ membership cũ. Giữ regressions v1 preflight, window selection trước mutation, takeover, reconnect rollback và exact-handle rejection; không thêm framework cross-process ownership.

### 5.4. Bước 4 — Chuẩn hoá Proceed và feedback

**Phụ thuộc:** bước 2; có thể hoàn thiện cùng chặng MCP sau bước 3. **Đầu ra:** approve non-plan có directive rõ ràng mà không làm thay đổi inspect semantics.

| File/component | Sửa cụ thể |
| --- | --- |
| MCP `ReviewWaitResult`, `reviewDecisionAction` | Thêm `approved` vào nextAction union; dùng helper kind để phân nhánh mục 3.5. Giữ exact execution instruction của plan và unified revise policy. |
| `readValidatedSubmissionOnce`, wait/advance descriptions | Cả immediate submission và live wait trả directive mới cho non-plan; comments luôn đầy đủ. Cập nhật tool descriptions/initialize để không nói chỉ có plan nextAction. |
| Inspect/join-inspection | Giữ snapshot/token contract; không dùng mapping decision hiện tại để phát lại action của một submission đã đọc. |

**Kiểm chứng:** `test/review-wait-mcp.test.ts`, `test/review-actions.test.ts` nếu liên quan UI submission. Hai kind plan đều execute; fixed `idea`/`checklist` và open `workaround` đều approved; revise mọi loại vẫn comments/token/process-review-feedback; save không nextAction. Chạy cả đường existing submission và advance-and-wait, giữ tests reconnect không replay terminal action.

### 5.5. Bước 5 — Instructions UI, scoped watcher, Connect và English UI

**Phụ thuộc:** bước 1–3. **Đầu ra:** giữ manager hiện tại, thêm hai entry actions và đường refresh Instructions đúng file.

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

### 5.6. Bước 6 — Recent kind filter và labels

**Phụ thuộc:** bước 2. **Đầu ra:** lọc native trên Recent, tách biệt filter Session type hiện có.

| File/component | Sửa cụ thể |
| --- | --- |
| `src/extension/artifact-kind-filter-command.ts` **(mới)** | Quick Pick một lựa chọn: **All Types**, từng fixed kind theo label, **Other**. Preselect giá trị hiện tại; cancel không đổi filter. Other là synthetic filter, không ghi kind `other` vào artifact. |
| `src/extension/work-session-sidebar.ts` | Recent giữ kind filter trong bộ nhớ cửa sổ; refresh không mất, reload về All Types. Filter full discovery trước sort/cap20; Other = kind không thuộc fixed set. Không đổi Session type filter hoặc ghi recency. |
| `src/extension/extension.ts`, `package.json` | Đăng ký command dự kiến `agentPlus.filterRecentArtifacts`, icon filter và `view/title` đúng Recent. Dùng `createTreeView` cho Recent để có indicator `Type: <Label>` như Sessions; dispose handle/subscription đúng một lần. |
| `src/extension/artifact-search.ts`, `src/extension/artifact-search-command.ts` | View all từ Recent truyền kind filter đang dùng để search cùng tập; filter kind trước title match/cap1000. Command Search Artifact gọi trực tiếp không có filter vẫn tìm toàn collection như hiện tại. Không biến query title thành parser cú pháp filter. |
| `src/webview/ReviewApp.tsx`, `src/webview/SessionApp.tsx`, sidebar/search labels | Dùng formatter chung cho artifact kind thay raw slug hoặc `.toUpperCase()`. Session type label vẫn lấy registry. Không thêm card description/manager kind filters của Phase 5. |

**Khả năng phải đạt:** fixed kinds xuất hiện riêng kể cả không có artifact; Other gom toàn bộ kind mở; View all count/results phản ánh đúng filter. UI có trạng thái không có kết quả phù hợp. Filter không sửa manifests, không migrate hoặc gate Recent thành bắt buộc MCP 13.

**Kiểm chứng:** `test/work-session-sidebar.test.ts`, `test/artifact-search.test.ts`, `test/artifact-search-command.test.ts`, helper/picker tests và `test/release-contract.test.ts` cho command/menu. Dùng hơn 20 artifact với kind cần tìm nằm ngoài top20 để chứng minh thứ tự filter trước cap; test Other, cancel/refresh/reload và View all filter độc lập Command Palette search.

### 5.7. Bước 7 — Skill, installer, docs và nghiệm thu

**Phụ thuộc:** bước 1–6. **Đầu ra:** AI dùng đúng entry/decision và installed assets phản ánh contract mới.

| File/component | Sửa cụ thể |
| --- | --- |
| `skills/create-review-artifact/SKILL.md` | Thêm trigger Join Session theo yêu cầu rõ ràng và availability 6 tools; Join-only không đòi artifact hoặc tự tạo lifecycle. Giữ không auto-trigger vì document type. Bỏ ép implementation-plan; hướng dẫn fixed/open choice, plan vs approved và success-only active context. |
| `references/artifact-contract.md` | Tool thứ 6/input/output, nested inspection, `session` context, exact reference paths, instructions file exception, mapping decisions và recovery. Wait/advance vẫn đủ comments; snapshot cũ không tái thực thi. |
| Cùng skill/contract | AI được đọc tài liệu tham khảo qua catalog exact path và sửa đúng `instructions.md` theo yêu cầu. Cấm sửa managed artifact lifecycle/membership/layout/metadata trực tiếp; cho phép Instructions Markdown không bị quy tắc cấm toàn bộ registry phủ định. Không tự đọc toàn bộ catalog hoặc chat transcript. |
| `skills/create-review-artifact/agents/openai.yaml` | Đồng bộ display/short description/default prompt với Join entry, không mở auto-trigger ngoài yêu cầu user. |
| `src/extension/mcp-clients/skill-helper.ts` | Append description chính thức mới vào `OFFICIAL_SKILL_DESCRIPTIONS`, giữ các entry cũ và custom rules markers; không mất user-custom description khi reinstall. Không refactor client drivers ngoài assets contract cần thiết. |
| `src/shared/contracts.ts`, support/version tests | Hoàn tất MCP 13 / Skill 6 theo baseline đã nêu, `serverInfo`/tool instructions/receipts đồng bộ. Giữ package 1.1.4 nếu không có yêu cầu release khác. |
| Docs canonical | Cập nhật phần liên quan trong `README.md`, `docs/INSTRUCTION.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/COMPONENTS.md`, `CHANGELOG.md`, `docs/CHANGE_LOGS.md`. Sửa phát biểu cũ về 5 tools, ép implementation-plan, approve non-plan và inline instructions; không chép nguyên plan vào docs. |
| Plans | Ghi progress/checkpoint thực tế vào file này và `plan.md`; Phase 5 giữ nguyên chưa triển khai. Không đổi lịch sử kết quả của Phase 3 thành bằng chứng Phase 4. |

**Kiểm chứng:** `test/skill-contract.test.ts`, `test/workspace-integration.test.ts`, `test/mcp-client-drivers.test.ts`, `test/integration-verification.test.ts`, `test/global-integration-status.test.ts`, `test/release-contract.test.ts`. Cập nhật exact description/tool count/version assertions theo contract mới, giữ tests customization-preserving installer. Chỉ sửa test bị ảnh hưởng, không xoá assertion bảo vệ lifecycle để làm pass.

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

**Đạt Phase 4 khi:** ba entry cho context nhất quán; join+artifact dùng chung inspect và một call; Instructions dùng một nguồn Markdown; fixed/open kind/Proceed đúng; Connect/filter/skill/install đồng bộ; toàn App UI/Tree Views đã được rà soát English wording, New/Join đúng nghĩa; check/test/build pass và giới hạn manual được báo rõ. Không đưa tính năng Phase 5 vào tiêu chí hoàn thành.

## 7. Rủi ro triển khai và giới hạn chấp nhận

- **Tách inspect mất side effects hoặc thứ tự:** core phải giữ routing/v1 preflight trước takeover và rollback connection/membership. Tập trung regression vào đường đang có, không thêm hệ thống ownership khác.
- **Nhầm context với review authorization:** catalog/read/join-only không phải token hoặc approval; snapshot submission cũ không được phát lại execution directive. Đây là ranh giới bắt buộc của join+inspect.
- **Storage đổi nhưng consumer/skill còn JSON:** rà cả create/migrate/type writes/read models/watcher/fixtures và prose cấm sửa file để không dual-write hoặc hướng dẫn AI sửa sai file. Không có production fallback cho v2-inline chưa publish.
- **Lọc sau cap hoặc nhóm Other sai:** fixed set là nguồn chung; Other dựa trên set membership, không dựa vào nhóm Proceed. Hai kind plan có cùng action nhưng vẫn là hai filter.
- **Giới hạn đã chấp nhận:** file cài mới không chứng minh process đang chạy đã restart; own/external Instructions edits dùng last-write-wins, không có dirty recovery; ownership cùng artifact vẫn theo cơ chế hiện tại. Không biến các giới hạn này thành chặng hardening.
- **Độ khó dự kiến:** trung bình–khá; chặng MCP khó nhất vì giữ lifecycle/recovery khi tách core. Phase 1–3 đã có registry, active Session, migration, scoped refresh, pickers và UI nên không phải xây lại manager/navigation.

## 8. Checklist tiến độ

- [ ] Chặng 1: storage Instructions + shared context/description/kind helpers và focused tests.
- [ ] Chặng 2: inspect core + join tool/context entry + Proceed mapping và lifecycle regression.
- [ ] Chặng 3: Instructions/Open/Connect + New/Join wording và English UI/Tree Views + Recent filter/labels + skill/versions/docs.
- [ ] Check/test/build và diff checks; ghi bằng chứng manual hoặc phần chưa xác minh.
- [ ] Chú review kết quả từng chặng; chỉ đánh dấu hoàn thành theo công việc thực tế, không theo việc đã viết plan.
