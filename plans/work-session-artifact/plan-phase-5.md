# Phase 5 — Hướng dẫn triển khai UI và quản lý danh sách

Trạng thái: **Chưa triển khai — 8 bước / 3 chặng.** Lập ngày **2026-11-07**, sau khi đối chiếu code hiện tại và các quyết định của Chú. Viết xong hướng dẫn không đồng nghĩa đã hoàn thành tính năng hoặc đã kiểm chứng Extension Host.

Bổ sung ngày **2026-11-08**: Review App sửa title/type của artifact, Quick Pick chọn/tạo kind mở và MCP đọc kind hiện tại khi trả decision. Phần này nằm trong **Bước 6 / Chặng 3**, làm UI + host + MCP cùng đợt; không thêm phase/chặng mới.

Nguồn phạm vi: [plan tổng](plan.md), [Phase 4](plan-phase-4.md), [Phase 4.5](plan-phase-4.5.md), [note](note.md) và các quyết định tiếp nối. **Grid thay masonry** trong phạm vi Phase 5; các đề xuất masonry trước đó không còn là yêu cầu. Triển khai sau 4.5, dùng output standalone/Inspect trực tiếp/Start/hai skills của phase đó; không dựng lại popup New/Join hoặc auto-create cũ. Các source snapshot bên dưới được đọc trước 4.5 và phải refresh khi implementation bắt đầu; không đổi tiến độ lịch sử Phase 4.

## 1. Phạm vi theo component

| Component | Kết quả cần đạt |
| --- | --- |
| Session Manager | Card grid theo thứ tự array; kind/description; search/filter artifact trong phiên; helper text cho các vùng/Instructions; padding side panel giảm nhẹ, đồng đều. |
| Review App và artifact metadata | Header `ROUND n · Type` với nút sửa type/title; native Input Box/Quick Pick, tạo kind mở; cập nhật `artifact.json.title`/`kind` mà không đổi recency hoặc review round. |
| MCP decision result | Đọc lại manifest của đúng artifact/round khi xử lý submission, dùng cùng kind mới cho field `kind` và `nextAction` trong hai wait flows; giữ policy Proceed đã có. |
| Sidebar | Menu chuột phải Recent Artifacts/Sessions, Pin/Unpin, Archive/Delete, tooltip đầy đủ title và kind/type. Giữ Activity Bar riêng và các controls Phase 4. |
| UI state | File riêng cho artifact và Session; không đưa Pin/Archive vào metadata của MCP hoặc layout. |
| Search và editors | Search tìm cả Archived; mở vẫn giữ Archive. Header Archived chỉ có nút **Restore** primary cùng tên/nhãn Archived. |
| Delete và cleanup | Tận dụng phần xoá artifact của retention và `cleanupStaleConversations`; xoá Session độc lập artifact; Session Archive đủ 30 ngày được cleanup khi activation. |
| Export | Manager **More → Export / Archive / Delete**. ZIP tài liệu cho người đọc, gồm Instructions và Markdown cả ba vùng. |
| Session types | Thêm `{ id: "module", label: "Module" }` vào seed khi chưa có file types. Không backfill file đã có. Type mặc định khi tạo Session vẫn là Conversation. |

**Ngoài phạm vi:** drag-and-drop/masonry, sửa MCP review lifecycle/ownership hoặc policy Proceed (ngoại lệ duy nhất là đọc kind mới khi trả decision theo mục 3.6), tool MCP mới, readonly inspect, chuyển Instructions về JSON, thiết kế lại các native Quick Input đã được chấp nhận, attach/import file/folder, ZIP import, thêm cleanup Session chưa Archive, lock/CAS/merge/conflict hoặc dirty dialog/recovery. Không thêm migration types hoặc Pin/Archive, không thêm registry/quản lý taxonomy artifact types độc lập. MCP Resources/Composer Mentions để bàn sau, không nằm trong bổ sung này.

## 2. Hiện trạng code đã kiểm tra

Đây là snapshot để tìm đúng điểm sửa, không phải kết luận Phase 4 đã hoàn thành. Có source/test Join đang thay đổi trong worktree; đọc lại diff trước khi bắt đầu implementation.

| File/component hiện có | Tận dụng và phần cần bổ sung |
| --- | --- |
| `src/shared/contracts.ts` | Có `ReviewState`, `WorkSessionArtifactRow`, `WorkSessionViewData`, typed webview actions/patches và `WorkSessionDataChange`. Chưa có contract Pin/Archive, description trong manager row, UI-state patches hoặc Deleted state. |
| `src/shared/artifact-files.ts` | Có canonical roots, constants và Instructions/layout paths. Thêm hai UI-state filenames/path helpers; không rename file cũ. |
| `src/shared/session-type-registry.ts` | `DEFAULT_SESSION_TYPES` hiện là Conversation, Project, Feature, Fix; `ensureSessionTypesDocument` chỉ seed khi file không tồn tại. Đã có lookup `seedIfMissing: false` phục vụ context. |
| `src/extension/work-session-sidebar.ts` | Recent sort recency, cap 20 + View all; Sessions có type filter. Chưa có UI state/item context cho các menu mới. Khi triển khai phải giữ kind filter/indicator của Phase 4 đã được nối vào. |
| `src/extension/artifact-search.ts`, `artifact-search-command.ts`, `session-search-command.ts` | Có validated discovery, tìm title không phân biệt dấu/hoa thường và native Quick Pick. Cần enrich trạng thái Archived cho kết quả; không biến Search thành thao tác Restore. |
| `src/extension/conversation-artifact-service.ts` | Resolve manager rows từ manifest; artifact lỗi/mất hiện `unavailable`, không tự xoá membership khi mở. Có scoped events/watchers; thêm enrichment description/UI state và event chính xác, không generic-refresh Instructions vì Pin/Archive. |
| `src/extension/work-session-provider.ts`, `artifact-review-provider.ts` | Có binding editor tới exact ID và typed host actions. Thêm state/actions Archive/Restore/Delete/Export qua host, dùng lại Connect/Instructions/rename/type của Phase 4. Review watcher hiện chưa theo dõi `artifact-ui-state.json`. |
| `src/webview/SessionApp.tsx`, `ReviewApp.tsx`, `styles.css` | Manager có chip Type, fixed-height textarea + Save, panel preference, menu move/up/down/remove; list hiện một cột. Giữ markup/spacing đã được Chú chấp nhận làm baseline, chỉ bổ sung phạm vi Phase 5. |
| `src/extension/artifact-retention.ts` | `executeArtifactRetentionCleanup` chọn artifact hết hạn, xác thực, claim/staging rename rồi xoá; cuối lượt gọi cleanup registry. Chưa có API Delete một artifact bất kể tuổi. |
| `src/shared/conversation-artifact-registry.ts` | `cleanupStaleConversations` xoá membership stale, lọc ba mảng layout, giữ Session v2 rỗng; xoá conversation v1 rỗng theo logic cũ. `readSession` chỉ reconcile layout với membership, không kiểm tra/xoá artifact đã mất. Chưa có Delete Session v2 hoặc cleanup Archive 30 ngày. |
| `src/extension/extension.ts`, `package.json` | Là điểm đăng ký commands/menus/watchers và activation cleanup. `view/item/context` cho hai tree chưa có; tránh đăng ký lại provider hoặc commands đã có ở Phase 4. |
| `package-lock.json`, `node_modules/yazl/README.md` | Repo hiện có `yazl` 2.5.1 gián tiếp qua tooling, chưa là dependency trực tiếp. API local có `ZipFile`, `addBuffer`, `addEmptyDirectory`, `outputStream`, `end`; không dùng transitive dependency ngầm cho tính năng export. |

**Snapshot bổ sung cho edit artifact — 2026-11-08:** `artifactManifestSchema` đã có `title` (1–200 ký tự) và `kind` mở theo `artifactKindSchema` (`^[a-z][a-z0-9-]{0,63}$`), nên không cần field/schema mới. `artifact-kinds.ts` có danh sách 10 kinds cố định, `formatArtifactKindLabel` và `isPlanProceedKind`. `ArtifactStore` chưa có API patch title/kind; provider đang full-refresh cho mọi thay đổi `artifact.json`, chưa có typed metadata-only patch. Service đã có event `{ kind: "artifact", artifactId }` và manager/sidebar đọc title/kind từ manifest. `ReviewApp.tsx` hiện render type trước ROUND và chưa có nút edit hai trường này. `readValidatedSubmissionOnce` đang dùng `context.manifest.kind` từ lúc bắt đầu chờ cho cả response và `reviewDecisionAction`; watcher chờ submission không nạp lại manifest. Đó là điểm MCP phải sửa cùng UI. Đây là source review để lập hướng dẫn, không phải kết quả implementation hoặc runtime test.

**Các test nền cần giữ:** `work-session-sidebar.test.ts`, `artifact-search*.test.ts`, `session-search-command.test.ts`, `work-session-provider.test.ts`, `session-app.test.tsx`, `conversation-artifact-service.test.ts`, `conversation-artifact-registry.test.ts`, `artifact-retention.test.ts`, `session-type-registry.test.ts`, `release-contract.test.ts` và regression review hiện có. Lượt lập plan này chỉ đọc source; không chạy lại suite và không tái sử dụng số pass cũ làm bằng chứng Phase 5.

## 3. Contract đã chốt

### 3.1. Trạng thái UI và recency

| Đối tượng | File |
| --- | --- |
| Artifact | `<artifactDirectory>/artifact-ui-state.json` |
| Session | `<sessionDirectory>/session-ui-state.json` |

```json
{
  "schemaVersion": 1,
  "pinned": true,
  "archivedAt": "2026-11-07T10:00:00.000Z"
}
```

- `pinned?: boolean` mặc định false; thiếu `archivedAt` là chưa Archive. Không có file thì dùng default trong bộ nhớ, không tạo file trong read/list. Không thêm `isArchived` hoặc `updatedAt` vào UI state.
- Extension quản lý hai file; giữ artifact schema 6, Session schema 2 và strict metadata. Riêng Phase 5 không tăng numeric MCP/Skill version hoặc ép reinstall. Không mở lại việc chọn MCP version: Work Session vẫn dùng mốc 12 đã chốt.
- Pin chỉ thay `pinned`; Archive đặt `archivedAt`; Restore bỏ `archivedAt`, giữ Pin. Đọc bản hiện tại rồi patch đúng field, ghi atomic theo quy ước repo, không thêm lock.
- Không ghi artifact manifest, connection, comments/submission, Instructions, membership hoặc layout chỉ vì Pin/Archive. `Session.updatedAt = max(createdAt, ...registeredAt)` vẫn giữ; create/inspect làm mới `registeredAt` như hiện tại.
- Global Archive artifact độc lập vùng `archived` trong Session. Archive từ Recent không chuyển hoặc bỏ card trong bất kỳ Session nào. Archive Session không Archive artifacts bên trong. MCP làm việc tiếp không tự Restore hoặc reset `archivedAt`.
- Nếu UI-state JSON có lỗi, không tự sửa/overwrite bằng default khi thao tác hoặc cleanup. Báo lỗi cục bộ/diagnostic phù hợp và bỏ qua cleanup mục đó; lỗi một mục không được làm toàn bộ danh sách thành “No sessions yet”.

### 3.2. Danh sách, Search và header Archived

- Danh sách mặc định ẩn mục globally Archived, kể cả Pin. Áp type/kind filter → sort Pin trước, recency sau, ID làm tie-break → cap Recent 20. Sessions không có cap 20. Dòng migration không phải Session item và không được Pin/Archive.
- Command Palette Search Artifact/Search Sessions tìm toàn bộ mục còn tồn tại, gồm Archived, độc lập active filter sidebar. View all giữ tham số kind filter đã có từ Phase 4; Search vẫn bao gồm Archived trong phạm vi đó. Không truyền trạng thái Archive của sidebar thành điều kiện ẩn trong Search.
- Search tiếp tục match title, gắn nhãn `Archived` trong description; chọn chỉ Open. Không Restore trong Quick Pick/menu sidebar, không tự gia hạn retention hoặc mốc Archive.
- Khi mở artifact/Session globally Archived: giữ tên, metadata/nhãn **Archived**; ẩn các action buttons khác trên header và chỉ render **Restore** primary (`--vscode-button-*`). Session header không hiện Rename/Connect/More/panel toggle lúc này; Review header không hiện các action bình thường.
- Restore thành công gửi patch rồi hiện lại header bình thường; lỗi giữ Archived/Restore, hiện lỗi tại thao tác. Không chuyển trạng thái MCP approval/save hoặc thêm chính sách read-only toàn bộ nội dung chỉ vì Archive. Không thay các controls ngoài header vượt phạm vi này.
- Tooltip Recent đầy đủ title + kind label; Sessions đầy đủ title + Session type label. Không cắt tooltip bằng `…`. Type Session không phải kind artifact.

### 3.3. Grid và thứ tự layout

Nguồn thứ tự duy nhất vẫn là ba mảng `layout.json` sau reconciliation. Render theo array, từ trái sang phải rồi xuống hàng; Move Up/Down thay index array. Không dùng CSS `order`, column layout, dense packing hoặc lưu toạ độ card.

| Chiều rộng content container toàn manager | Panel đóng | Panel mở |
| --- | --- | --- |
| Small: dưới 800px | 1 cột Working | 1 cột Working |
| Medium: 800–1099px | 2 cột Working | 1 cột Working |
| Large: từ 1100px | 3 cột Working | 2 cột Working |

- Hai ngưỡng 800/1100 là lựa chọn triển khai ban đầu, kiểm tra thực tế trong Extension Host; số cột và quy tắc giảm một cột, tối thiểu một, là yêu cầu đã chốt.
- Dùng container của **toàn manager**, không dùng window viewport hoặc đo riêng Working rồi trừ cột thêm lần nữa. CSS container query + class/data attribute panel mở là đủ; tránh thêm JS resize state khi không cần.
- References và Archived trong side panel luôn 2 cột. Giữ panel khoảng 360px như baseline, giới hạn không vượt container; card có `min-width: 0`, title wrap/clamp, menu không bị cắt. Ở Small, xếp panel xuống dưới Working để không ép Working thành cột quá hẹp; panel preference vẫn giữ theo Session.
- Side blocks Type/Instructions/References/Archived cùng padding **12px 14px** thay baseline 14px 16px: giảm nhẹ, đồng đều. Giữ chip Type, chiều cao header Working/Type 28px và textarea có rows/overflow, không thiết kế lại editing controls.
- Search/filter chỉ tạo derived visible arrays; không sort lại persisted layout. Khi đang lọc, Move Up/Down vẫn dùng index/thứ tự gốc của zone, không ghi array đã lọc thành layout.

### 3.4. Delete, retention và cleanup Session

| Thao tác | Phạm vi |
| --- | --- |
| Remove artifact khỏi một Session | Hành vi cũ: xoá membership/layout ở Session đó; artifact và các Session khác được giữ. |
| Delete artifact | Xoá artifact toàn cục, sau đó cleanup membership/layout stale ở các Session. Không xoá Session v2 rỗng. |
| Delete Session | Xoá đúng thư mục Session v2 gồm metadata, Instructions, layout, memberships, UI state; không xoá artifact hoặc Session khác. |
| Cleanup Session Archive | Khi activation, xoá Session đã Archive đủ 30 ngày, cùng primitive Delete Session. Không dựa vào Session.updatedAt, Pin không miễn cleanup. |

- Không gọi nguyên retention sweep để Delete một artifact: sweep chọn theo tuổi và có thể xoá các mục khác. Tách phần xác thực/staging/xoá một target để dùng chung, giữ nguyên selection theo tuổi ở retention wrapper.
- Sau Delete artifact gọi lại `cleanupStaleConversations`; hàm này đã prune membership và ba mảng layout. Cleanup registry là best-effort như hiện tại; lỗi không làm artifact đã xoá xuất hiện lại. Trả/báo đúng “đã xoá artifact, cleanup tham chiếu chưa hoàn tất”, không khẳng định đã hoàn tất toàn bộ.
- Đây là luồng Delete của extension. Không thêm watcher tự xoá tham chiếu mỗi khi user xoá file ngoài extension; có thể còn card `unavailable` đến lượt cleanup. Đọc/mở Session không tự prune.
- Retention artifact tiếp tục theo `artifact.json.updatedAt` và setting hiện có, không phụ thuộc Pin/Archive. Session chưa Archive không tự xoá vì rỗng hoặc lâu không dùng. Session Restore bỏ điều kiện cleanup Archive; Archive lại bắt đầu mốc mới.
- Xác nhận destructive action nêu đúng phạm vi: Delete artifact ảnh hưởng mọi Session; Delete Session giữ artifacts. Huỷ không ghi/xoá gì. Cleanup tự động không cần dialog.

### 3.5. Seed Module và Export tài liệu

- Seed mới theo thứ tự **Conversation, Project, Module, Feature, Fix**; `{ id: "module", label: "Module" }`. Không đụng file types đã tồn tại, không backfill/merge, không migration hoặc version bump. User test seed bằng fixture/profile sạch, không tự xoá file global của user.
- Module là lựa chọn trong type picker/filter như các type khác, không phải artifact kind. Conversation vẫn là type được gán khi Add Session/create dùng default; chỉ Conversation giữ quy tắc không được xoá như hiện tại.

```text
Tên Session/
  Instructions.md
  Working/
    01 - Tên artifact.md
    02 - Tên artifact.md
  References/
    01 - Tên tài liệu.md
  Archived/
    01 - Tên tài liệu.md
```

ZIP lấy dữ liệu persisted, đủ cả ba vùng theo thứ tự layout, không dùng search/filter visible arrays hoặc Instructions đang gõ chưa Save. Nội dung Markdown giữ nguyên; không metadata JSON, ID filename, comments/submission/review state. Không tự thu thập file/folder/assets từ link Markdown, không thiết kế import. Tên được chuẩn hoá thành filename hợp lệ; số thứ tự phân biệt title trùng. Chi tiết lỗi/save ở Bước 7.

### 3.6. Artifact title/type do user chỉnh và kind dùng cho Proceed

```text
ROUND 2 · Implementation plan [edit type]
Work Session Artifact — Phân tích và đề xuất phạm vi [edit title]
```

- UI gọi **Type**, persisted field vẫn là `artifact.json.kind`; tách biệt với `Session.typeId`. Giữ bộ kinds cố định và cho phép kinds mở như hiện tại. Label dùng `formatArtifactKindLabel`: `meeting-note` → `Meeting note`.
- Sửa title bằng native Input Box, prefill title hiện tại; trim, không rỗng, tối đa 200 ký tự theo manifest schema. Chỉ sửa metadata title; không sửa heading hoặc bất kỳ nội dung nào trong `artifact.md`.
- Sửa type bằng native Quick Pick: bộ cố định theo thứ tự `FIXED_ARTIFACT_KINDS`, tiếp theo các kinds mở đang được artifacts hợp lệ trong collection sử dụng, rồi **Create new type…**. Dedupe bằng slug, giữ kind hiện tại kể cả không có trong kết quả discovery; đánh dấu lựa chọn hiện tại. Không ghi từng artifact thành một dòng type trùng nhau.
- Create new type mở Input Box nhập slug `lowercase-with-hyphens`; validate bằng `artifactKindSchema` hiện có, không thêm restriction khác hoặc tự đổi một chuỗi sai thành kind ngoài ý user. Slug đã có thì chọn lại kind đó. Tạo ở đây là gán kind mới cho artifact, không tạo Session type hoặc ghi registry mới. Kind mở không còn artifact nào sử dụng sẽ không có trong các lượt gợi ý sau; không có thao tác rename/delete kind toàn cục trong phase này.
- Extension host được phép patch **chỉ `title` hoặc `kind`** trong manifest của artifact đã bind. Đọc manifest mới nhất rồi patch đúng trường, ghi atomic bằng primitive an toàn hiện có. Chấp nhận bản ghi sau cùng thắng giữa AI/user; không locks/CAS/conflict detection/merge/retry-on-conflict hoặc ownership handoff cho metadata editing.
- Rename/change type không sửa `updatedAt`, `createdAt`, ID, reviewSessionId, reviewRound, Markdown/SHA, comments, submission, connection, membership/registeredAt, layout hoặc UI state. Không tự làm mới artifact retention, đẩy recency hoặc gia hạn Session. Chỉ thay thứ tự hiển thị nếu kết quả filter theo title/kind thực sự thay đổi.
- Khi MCP xử lý submission, đọc lại manifest hiện tại của đúng artifact/round rồi dùng **cùng bản manifest đó** cho response `kind`, link title nếu có và `nextAction`: `plan`/`implementation-plan` → `execute-approved-plan`, mọi kind khác → `approved`; `revise` và `save` giữ semantics đã có. Không thêm kind vào submission schema, không restart waiter hoặc tăng round để đổi type.
- Việc đọc lại đặt trong hàm xử lý submission chung để cả `wait_for_artifact_review` và nhánh wait của `advance_and_wait_for_artifact` đều nhận kind mới. Giữ các binding/checks hiện có cho artifactId/reviewSessionId/reviewRound/SHA/comments/submission. Không dùng title để tìm lại artifact hoặc đọc manifest mới rồi âm thầm nhận một round khác.
- Edit metadata không phát lại decision, không tạo grant mới hoặc biến Proceed đã lưu thành yêu cầu execution mới. Các nhánh inspect snapshot cũ tiếp tục là lịch sử theo contract 4.5; không mở rộng việc sửa này thành thay đổi token/ownership/approval protocol.
- Theo quy tắc header Archived ở mục 3.2, ẩn cả hai nút edit khi artifact globally Archived; Restore đưa lại header thường. Giữ các điều kiện read-only/deleted hiện có; lỗi native picker/write chỉ báo tại thao tác, không làm mất nội dung review.

## 4. Chia chặng và đầu ra review

| Chặng | Bước | Đầu ra review được |
| --- | --- | --- |
| **1 — Nền persistence và deletion** | **1–2** | UI-state schemas/read-write + seed Module; primitive Delete artifact/Session, dùng lại retention/prune, focused tests. Chưa có menu mới để user bấm. |
| **2 — Quản lý danh sách và Archived** | **3–5** | Sidebar menus/tooltip/Pin/Archive/Delete, Search Archived, header Restore/More và cleanup Session Archive 30 ngày chạy xuyên host/editor. |
| **3 — Trình bày, edit artifact và export** | **6–8** | Grid/cards/filter/helper text; header edit title/type + kind mở + Proceed dùng kind mới trong cùng Bước 6; ZIP tài liệu, docs, check/test/build và manual verification được ghi rõ. |

Hoàn thành từng chặng theo implementation và bằng chứng thực tế. Không đánh dấu xong chỉ vì docs hoặc một test snapshot pass. Ưu tiên rebase/tận dụng output Phase 4 đã xong trước khi bắt đầu UI; không triển khai lại Add/Connect/Instructions/kind filter ở Phase 5.

## 5. Hướng dẫn triển khai từng bước

### Bước 1 — UI state, typed contracts và seed Module

**Files:** `src/shared/contracts.ts`, `artifact-files.ts`, `session-type-registry.ts`; tạo `src/extension/artifact-ui-state.ts` cho persistence host-only (tên mới đề xuất); tests tương ứng.

1. Thêm shared strict schema UI state v1 dùng chung hai loại; schema/tên DTO mới không được thêm field vào artifact/session metadata schemas. Thêm constants/path helpers riêng.
2. Module host đọc/patch UI state qua exact artifactId/sessionId. Resolve canonical parent đã kiểm tra như code hiện có; chỉ đọc/ghi file thường, không theo symlink/junction hoặc nhận arbitrary path từ webview. Missing file dùng default; không tạo lại entity đã bị Delete khi ghi UI state.
3. Atomic write theo pattern repo, patch từ file mới nhất; Pin/Unpin/Archive/Restore giữ các field còn lại. Không thêm lock hay cross-window merge. Pin nhiều cửa sổ vẫn theo last-write-wins đã chốt.
4. Thêm UI-state field cho read DTO `ReviewState`/`WorkSessionViewData`, hoặc envelope tương đương, nhất quán producer/consumer. Không persist DTO trở lại manifest/metadata. Thêm typed patches `artifactUiStatePatch`/`sessionUiStatePatch` để thay trạng thái header mà không reload review comments hoặc textarea.
5. Mở rộng `WorkSessionDataChange` với `{ kind: "artifactUiState", artifactId }` và `{ kind: "sessionUiState", sessionId }`; cập nhật `changeKey`, classifiers/listeners cùng lượt. Phần Instructions tiếp tục dùng scope Phase 4.
6. Thêm Module vào `DEFAULT_SESSION_TYPES` tại vị trí giữa Project và Feature. Giữ `ensureSessionTypesDocument` chỉ seed khi thiếu file; giữ lookup context không ghi file. Không thêm backfill.

**Đạt được:** thao tác trạng thái không đụng lifecycle/recency; fixture không file đọc default không ghi; Pin→Archive→Restore giữ Pin; types file mới có Module, file đã có giữ nguyên byte/content. Test logic persistence/contract có ý nghĩa, không viết test chỉ đếm dòng/hằng số.

### Bước 2 — Dùng chung deletion và cleanup đang có

**Files:** `src/extension/artifact-retention.ts`; tạo `src/extension/artifact-deletion.ts` cho core một artifact; `src/shared/conversation-artifact-registry.ts`; tests retention/registry và deletion mới.

1. Tách phần xác thực target/staging rename/xoá đang ở retention thành primitive một artifact. Đầu vào ID đã validate và root options, không nhận đường dẫn bất kỳ từ UI. Recheck directory là canonical child thật, manifest/schema/ID đúng và managed files hợp lệ trước khi rename/xoá.
2. Giữ lựa chọn hết hạn, recheck updatedAt trước commit và các counts của retention ở wrapper. Explicit Delete dùng chính target bất kể tuổi, không thay timestamp/retentionDays để ép sweep. Giữ claim/staging handling hiện có khi tách; không phát sinh cơ chế lock mới.
3. Commit của Delete artifact là target rời collection qua staging rename. Lỗi trước đó trả chưa xoá; nếu xoá staging chưa xong thì giữ quy tắc staging drain ở lần activation sau. Không báo chưa xoá để UI retry một target đã được stage thành công.
4. Coordinator sau Delete artifact gọi `cleanupStaleConversations` đúng một lượt, tận dụng hoàn toàn validation/unlink membership/filter layout hiện có. Giữ v1 cleanup và giữ v2 rỗng. Nếu cần notify chính xác, bổ sung danh sách Session IDs bị thay đổi vào result bên cạnh counts cũ; không viết lại một scanner cạnh tranh.
5. Thêm primitive `deleteSession` trong registry (tên đề xuất): validate exact Session v2/canonical directory, xoá đúng thư mục đó. Không lặp qua artifact để Delete chúng; không dùng cleanup v1 rỗng để thay cho Delete v2.
6. Result tách được artifact deletion thành công và cleanup tham chiếu có lỗi/skip; host chỉ báo kết quả đã biết. Không rollback artifact đã xoá, không tạo lại memberships hoặc lifecycle.

**Đạt được:** Delete artifact còn mới A nằm trong hai Sessions S1/S2 chỉ xoá A và hai tham chiếu, giữ artifact B và S1/S2 kể cả rỗng. Delete S1 giữ A/B và S2. Retention vẫn không xoá artifact chưa hết hạn; target không hợp lệ/outside root/link bị từ chối. Kiểm thử bằng temp roots, không chạy destructive fixture trên dữ liệu global.

### Bước 3 — Sidebar menus, Pin/Archive, Search và tooltip

**Files:** `work-session-sidebar.ts`, `artifact-search.ts`, `artifact-search-command.ts`, `session-search-command.ts`, `extension.ts`, `package.json`; thêm `src/extension/work-session-management-command.ts` nếu cần coordinator dùng chung giữa tree/editor.

| Recent Artifacts | Sessions |
| --- | --- |
| Open | Open |
| Copy Connect Prompt | Rename |
| Pin / Unpin | Change Type |
| Archive | Copy Connect Prompt |
| Delete | Open Instructions File |
| — | Copy Instructions File Path |
| — | Pin / Unpin |
| — | Archive |
| — | Delete |

1. Khai báo commands cần thiết và `menus["view/item/context"]` với `view == agentPlus.recentArtifacts`/`agentPlus.sessions`, `viewItem` context phân biệt artifact/Session/pinned. Chỉ item thật có menu; không menu destructive cho View all, empty, migration hoặc unsupported.
2. Handler lấy ID từ item vừa click, không lấy selection/tab đang active. Dùng lại Open/Connect/Rename/Change Type/Open Instructions của Phase 4; nếu logic còn gắn vào một editor, tách callback tối thiểu để tree/editor cùng gọi, không rewrite command subsystem.
3. Read UI state để enrich danh sách ở extension boundary. Không lọc Archived trong `listSessions`/catalog hoặc canonical artifact discovery dùng chung cho MCP/manager; default sidebar mới áp ẩn. Raw discovery tiếp tục trả các entity hợp lệ còn tồn tại.
4. Sort Pin/recency, filter và cap theo mục 3.2. Khi chỉ còn Archived, empty message phản ánh không có mục đang hiển thị; Search vẫn mở được. Giữ active filter khi Pin/Archive refresh.
5. Search rows thêm nhãn Archived nhưng giữ match title, giới hạn Quick Pick hiện có và loại bỏ mục đã Delete. Command Palette không kế thừa active filter; View all giữ kind argument của Phase 4. Không thêm nút Restore vào picker/context menu.
6. Tooltip dùng title và `formatArtifactKindLabel(kind)` hoặc Session type label đầy đủ; dates/ID có thể giữ phụ trợ. Pin có icon/description indicator nhưng không prepend vào dữ liệu title thật.
7. Pin/Archive ghi state rồi notify đúng ID; Delete dùng coordinator Bước 2 sau confirm native. Confirm artifact: `Delete this artifact permanently from all sessions?`; Session: `Delete this session permanently? Its artifacts will be kept.` Hủy không gọi primitive.
8. Copy Instructions File Path lấy canonical `instructions.md` từ exact Session ID, clipboard nhận absolute filesystem path. Không lấy URI webview hoặc JSON metadata path. Copy Connect tiếp tục chỉ copy prompt, không gọi MCP/takeover/register.

**Đạt được:** nhấn chuột phải item A trong khi editor B active vẫn thao tác A; >20 artifacts có Pin/Archive/filter áp trước cap; type/kind filter và Search title giữ đúng; Search Archived→Open không Restore. Các thao tác trên tree không bump registeredAt/updatedAt.

### Bước 4 — Header More, Archived/Restore và scoped updates

**Files:** `work-session-provider.ts`, `artifact-review-provider.ts`, `conversation-artifact-service.ts`, `contracts.ts`, `SessionApp.tsx`, `ReviewApp.tsx`, `styles.css`.

1. Nạp initial UI state cho đúng document. Thêm typed actions Restore artifact, Restore Session, mở manager More menu hoặc các actions Export/Archive/Delete; tên concrete nhất quán schema/provider/webview. Archive/Delete/Export manager luôn lấy Session ID từ document đã bind, không từ payload path.
2. Manager active có More với **Export**, **Archive**, **Delete**. Archive/Delete gọi chung coordinator tree; Export Bước 7. Nếu checkpoint trước Bước 7, chưa render item Export chạy giả hoặc placeholder success; chỉ hoàn tất menu khi handler thật đã có.
3. Render header Archived theo mục 3.2. Restore action primary có pending/disabled trong lúc ghi, lỗi không làm toàn app thành error. Restore không submit `approve`/`save` và không mở Connect tự động.
4. Review provider theo dõi `artifact-ui-state.json` bằng watcher/event scoped riêng, gửi UI-state patch; không gọi `store.load` rồi thay toàn bộ review state chỉ vì Pin/Archive. Manager nhận session UI-state patch, không reset Instructions draft/panel/filter.
5. Classify create/change/delete UI-state files và dedupe event theo ID; khi file bị xoá, reload default để bỏ Archived/Pin trong editor. Bổ sung listener Recent và Sessions cho loại event mới. Nếu cần watcher global artifacts, chỉ watch đúng UI-state filename, không tạo một full snapshot loop.
6. Mixed event batches xử lý từng phần liên quan như Phase 4; artifact UI state không phải Instructions change, session UI state không phải metadata/layout. Artifact Archive trong Recent không làm card biến mất khỏi Session.
7. Khi Delete thật xảy ra, gửi terminal deleted/unavailable state tới editor đang mở và refresh danh sách/Session bị prune; không để các nút vẫn ghi vào thư mục đã xoá. Session provider hiện có nhánh `getWorkSession` mất thì return: bổ sung xử lý xoá cho chính document thay vì im lặng giữ UI cũ. Không thêm dirty dialog hoặc tự phục hồi dữ liệu.

**Đạt được:** Archive tree→editor header đổi ngay; Archived chỉ có Restore action trên header; Restore hiện lại controls cũ và sidebar nếu hợp filter. Lỗi action giữ nội dung đang xem; event Pin/Archive của A không refresh Instructions/controls của Session B không liên quan. Existing lifecycle readOnly/decision handling vẫn giữ.

### Bước 5 — Cleanup Session đã Archive đủ 30 ngày

**Files:** tạo `src/extension/work-session-retention.ts`; `extension.ts`, registry/UI-state helpers đã có; tests cleanup mới.

1. Hàm cleanup nhận `now`, root options và diagnostic để test độc lập. List Session v2 hợp lệ, đọc UI state; chỉ eligible khi có `archivedAt` hợp lệ và `now >= Date.parse(archivedAt) + 30 ngày`.
2. Trước xoá đọc lại state của exact Session để không dùng một giá trị Archive cũ đã Restore; gọi primitive Delete Session Bước 2. Không dùng Pin, createdAt, Session.updatedAt hoặc membership count làm điều kiện thêm.
3. Chạy trong activation background cùng retention artifact hiện có, tuần tự trong cùng pipeline để tránh tự tạo hai lượt xoá/chỉnh registry chồng nhau. Không block activation và không chạy mỗi lần mở manager.
4. Giữ `cleanupStaleConversations` bảo toàn v2 rỗng; **chỉ hàm mới** áp điều kiện Archive 30 ngày. Mỗi lỗi item ghi diagnostic rồi tiếp tục; kết quả có counts/IDs cần cho refresh. Archive sai/thiếu thì không xoá.
5. Notify IDs đã xoá để tree/Search lần sau không còn mục và editor đang mở nhận Deleted. Không gọi MCP, không auto migration, không xoá artifact bên trong.

**Đạt được:** 29 ngày giữ, đúng 30 ngày xoá; archived+pinned vẫn xoá; chưa Archive/rỗng/lâu không dùng vẫn giữ; Restore trước cleanup thì giữ; artifacts của Session bị cleanup không bị xoá bởi primitive Session. Retention artifact độc lập vẫn theo setting cũ.

### Bước 6 — Grid, card metadata, manager filter/search, helper text và edit artifact

#### 6.1. Session Manager grid/cards/filter/helper text

**Files:** `contracts.ts` (row DTO), `conversation-artifact-service.ts`, `SessionApp.tsx`, `styles.css`; dùng lại `markdown-description.ts`, `artifact-kinds.ts`, `normalizeArtifactTitleSearch` hoặc helper thuần tương ứng.

1. Enrich manager row với description plain text từ Markdown bằng `extractMarkdownDescription` Phase 4, kind label dùng shared helper; không gọi AI hoặc lưu description mới vào manifest/membership. Đọc dưới cùng canonical validation như catalog, giữ `unavailable` khi artifact lỗi/mất. DTO row available vẫn bắt buộc kind; nhánh `unavailable: true` cho phép không có kind, renderer/filter phải kiểm tra nhánh này. Bỏ fallback kind `spec` đang có trong service cho artifact mất, không đổi kind thành giá trị đoán để lọc.
2. Card hiện title, kind label, description ngắn (clamp hai dòng là lựa chọn trình bày ban đầu) và thông tin updatedAt đã có. Description rỗng thì bỏ vùng text, không placeholder metadata. Render text bình thường, không HTML từ Markdown. Card/menu/keyboarding hiện có tiếp tục hoạt động.
3. Đổi list sang grid theo mục 3.3, có attribute/class cho panelExpanded. Dùng `repeat(n, minmax(0, 1fr))`, mặc định row flow; không dense hoặc sort lại array. Side panel References/Archived cố định hai cột kể cả khi Working đổi breakpoint.
4. Thêm một ô search title và kind selector cho artifacts **trong Session hiện tại**, áp lên cả ba vùng; không phải Search Sessions và không fetch collection toàn cục. Kind selector gồm All Types + các kind thực sự có trong Session, bao gồm kind mở; dùng label thống nhất, không bắt manager dùng fixed/Other của Recent. Nếu dùng lại title normalization, chuyển đúng hàm thuần sang shared helper và cập nhật import hiện có; không import nguyên module discovery Node/filesystem của extension vào webview.
5. Filter/query ở state của webview, refresh cards không reset; không persist vào metadata/layout/globalState. Empty filtered zone hiện `No matching artifacts`; count hiển thị visible/total khi có filter. Nếu kind đã chọn không còn tồn tại, trở về All Types. Unavailable không bị gán kind giả, vẫn có thể tìm theo title/ID fallback.
6. Move/Up/Down/Remove luôn làm trên canonical zone arrays/ID, không trên filtered array. Reorder vẫn đổi index gốc một bước, không diễn giải lại thành nhảy qua các card bị lọc. Khi đang lọc không đổi nguồn layout phục vụ Export.
7. Helper text cố định, không thêm metadata description cho zone: Working — `Artifacts you are actively working on.`; References — `Supporting material for this session.`; Archived — `Artifacts set aside within this session.`; Instructions — **`Rules, workflows, and other guidance for AI in this session.`** Wording vùng Archived phải phân biệt với global Archive.
8. Áp padding nhẹ, bằng nhau cho bốn blocks sidebar; giữ Type chip, native pickers, textarea Markdown rows/overflow + Save/Open, panel memory và các nút Add/Connect của Phase 4. Không thêm DnD hoặc rich editor.

**Đạt được:** các dải độ rộng và panel on/off đúng bảng; render trái→phải đúng array; Move Up/Down thay thứ tự và tồn tại sau mở lại. Filter không ghi layout/updatedAt và không làm mất Instructions đang gõ. References/Archived hai cột không tràn ngang, menu truy cập được trong panel.

#### 6.2. Review App sửa title/type và MCP trả kind mới

**Files:** `src/shared/contracts.ts`, `src/shared/artifact-kinds.ts` (dùng lại), `src/extension/artifact-store.ts`, `src/extension/artifact-review-provider.ts`; tạo `src/extension/artifact-metadata-command.ts` cho native input/picker controller (tên mới đề xuất); `artifact-search.ts`, `conversation-artifact-service.ts`, `work-session-provider.ts`, `work-session-sidebar.ts` chỉ chỉnh phần discovery/events cần thiết; `src/webview/ReviewApp.tsx`, `styles.css`; `src/integration/artifact-review-mcp-v4.ts`.

**A. Contract và persistence — hoàn thành trước khi nối nút UI**

1. Thêm hai strict actions không nhận path/ID tuỳ ý từ webview: `{ type: "renameArtifact" }` và `{ type: "changeArtifactType" }`. Provider lấy target từ `ArtifactStore` đã bind; giá trị mới lấy từ native input. Không thêm tool MCP hay trường metadata persisted.
2. Thêm API hẹp cho store, ví dụ `updateMetadata(patch: { title?: string; kind?: string })`. Validate patch qua title/kind schema hiện có, resolve lại exact safe global handle/file và parse manifest mới nhất; chỉ spread trường được yêu cầu lên manifest đó. Kiểm tra writable/deleted như các thao tác host hiện có, không nhận nguyên manifest từ webview.
3. Ghi qua `writeNewManagedFile` → `replaceManagedFile` → dọn đúng temp của lần ghi, theo pattern `writeComments` hiện có (hoặc primitive tương đương repo); giữ Windows fallback/quy tắc managed files. Không dùng comments writer để ghi manifest. Không tự thêm lock hoặc đổi transaction protocol của MCP.
4. Ghi thành công trả title/kind đã persisted cho provider. Huỷ picker, nhập không hợp lệ hoặc giá trị không đổi thì không ghi file. Lỗi đọc/ghi không coi là đã lưu; không tự tạo lại artifact bị xoá. Không gọi load có side effect tạo comments chỉ để đổi metadata nếu đã có helper đọc manifest an toàn.

**B. Native input và danh sách type — không thêm registry**

5. Rename dùng Input Box: title **Rename artifact**, prompt **Enter a title for this artifact**, placeholder **Artifact title**. Prefill title hiện tại; trim/validate 1–200 ký tự. Cancel không làm gì.
6. Type picker có title **Change artifact type**, placeholder **Select a type or create a new one**. Dùng `discoverSearchableArtifacts` để lấy kinds mở từ collection hợp lệ, dedupe và sort nhóm mở theo label/slug; nhóm fixed giữ thứ tự shared constant. Hiện label đã format và raw slug ở description để search/nhận diện, đánh dấu **Current**. Không thay behavior fixed/Other của filter Recent.
7. Dòng **Create new type…** mở Input Box title **Create artifact type**, prompt **Enter a type in lowercase, using hyphens between words**, placeholder **meeting-note**. Trim và validate bằng `artifactKindSchema`. Ví dụ `meeting-note` hợp lệ, `Meeting Note` chưa hợp lệ và phải được sửa trước khi lưu; không tự slugify mất dấu/nghĩa. Slug trùng chỉ là chọn type đã có, không tạo bản ghi phụ. Sau confirm gọi cùng store patch `kind`.
8. Controller dùng dependencies của native UI/discovery/store để test bằng fixture; không đọc/ghi collection home thật trong tests. Discovery lỗi được báo đúng; không tự seed một registry mới để bù lỗi.

**C. Header và đồng bộ metadata scoped**

9. Đổi eyebrow thành `ROUND {reviewRound} · {formatArtifactKindLabel(kind)}`; đặt nút pencil bên type với tooltip/aria-label **Change artifact type**. Đặt pencil bên title với tooltip/aria-label **Rename artifact**. Dùng icon/style button đã có, layout wrap được khi title dài; giữ utility controls/Markdown/Comments bên dưới.
10. Thêm typed patch như `{ type: "artifactMetadataPatch", artifactId, title, kind }`. Webview nhận patch đúng artifactId, chỉ cập nhật hai fields trong `state.artifact`; giữ Markdown renderer, comments, selection/popover đang nhập, send status và round. Không remount app, không giả round change hoặc reset feedback khi rename.
11. Tách nhánh watcher manifest: nếu validated manifest chỉ đổi title/kind trên cùng identity/round và các fields khác giữ nguyên, gửi metadata patch; nếu có round/content/lifecycle change thì giữ full-refresh hiện có. Đọc/validate đúng file vẫn cần thiết; không bỏ watcher cho thay đổi bên ngoài. Dùng pending/error tại thao tác; nút edit không gửi trùng khi native flow đang mở hoặc quyết định đang submit.
12. Reuse `{ kind: "artifact", artifactId }` hiện có và watcher/debounce để Recent title/tooltip/kind-filter, search lần sau, manager rows/filter và catalog đọc đúng metadata mới. Không tạo loại event generic cho toàn bộ Session; không refresh/replace Instructions draft vì artifact đổi nhãn. Không gọi register để cập nhật cache, không sửa memberships/layout/registeredAt. Catalog đọc manifest hiện tại qua resolver có sẵn, không thêm dữ liệu snapshot ngang hàng.
13. Giữ Archived header chỉ Restore: hide edit buttons theo cùng nhánh header. Restore cho phép sửa lại title/type. Lỗi rename/type giữ nội dung đang xem và các comments chưa submit; không chuyển toàn app sang terminal error.

**D. MCP đọc kind mới — cùng checkpoint với UI edit type**

14. Trong `readValidatedSubmissionOnce`, khi đã có submission cần xử lý, đọc/parse manifest hiện tại qua cùng managed-file/validation helpers; đối chiếu artifactId/reviewSessionId/reviewRound với context của waiter. Giữ bounded retry JSON và đường lỗi binding hiện có. Không reload/reset waiter, không lấy nhầm context của round mới.
15. Tạo context/metadata kết quả từ bản manifest vừa đọc; dùng kind đó cho `reviewDecisionAction` và response `kind`, đồng thời title mới cho artifact link khi response có link. Không tính nextAction từ kind mới nhưng trả field kind/link từ context cũ. `attachRoundGrant` hiện tạo artifactLink bằng context của caller: đồng bộ việc lấy title mới ở đường này khi cần, không thay binding/token.
16. Đặt logic ở shared result path; cả wait ban đầu lẫn wait sau advance dùng chung. Không chỉ sửa handler `submitReview` ở extension vì MCP waiter có context riêng. Không thêm `kind` vào `review-submission.json`, không phát lại Proceed đã nhận hoặc dùng metadata edit để re-grant execution. Giữ distinction fresh decision/historical snapshot của skill.

**Kiểm chứng đúng phạm vi:**

- `test/artifact-store.test.ts`: đổi title/kind hợp lệ chỉ thay trường yêu cầu; `updatedAt`, identity/round và các file Markdown/comments/submission/connection/membership giữ nguyên. Huỷ/no-op không ghi qua controller; validation dùng schema thật.
- `test/artifact-review-provider.test.ts` và test controller native mới khi cần: đúng bound artifact, picker fixed + distinct open + Current + Create, nhập custom slug, cancel/invalid/no-op; success patch và lỗi không xoá nội dung.
- `test/review-app.test.tsx`: ROUND đứng trước type, hai edit actions đúng, metadata patch giữ round/feedback draft, archived hide/Restore hiện lại buttons. Tận dụng test provider/app sẵn, không test chỉ số lượng DOM hoặc mirror toàn implementation.
- `test/review-wait-mcp.test.ts`: waiter đã bắt đầu với `implementation-plan` → sửa manifest thành `note` → Proceed trả `kind: note`, `nextAction.type: approved`; chiều `note` → `plan` trả `execute-approved-plan`. Có case từ wait sau advance và giữ tests revise/save/old snapshots hiện có. Chờ waiter thực sự bắt đầu trước khi patch manifest để test bắt được stale context, không chỉ load kind mới ngay từ đầu.
- Service/sidebar/manager tests đã có: rename/kind xuất hiện đúng trong metadata hiển thị và các filter liên quan, recency không đổi; Instructions draft không reset. Không thêm cross-agent conflict matrix hoặc coordination test ngoài quyết định last-write-wins.

**Đạt được cùng đợt:** user sửa title/type, tạo kind mở và xem metadata mới ở các nơi liên quan; round/retention/feedback giữ nguyên; Proceed trả kind và action thống nhất theo manifest mới. Chưa xong phần D thì chưa coi edit type sẵn sàng chỉ vì picker/header chạy được. Không cần tăng artifact schema hoặc thêm registry; runtime thay đổi được build/cài lại/restart để test theo quy ước MCP 12 của feature chưa release, không tự bump version theo bước.

### Bước 7 — Export ZIP tài liệu cho người đọc

**Files:** tạo `src/extension/work-session-export.ts`; nối `work-session-provider.ts`/management coordinator; `package.json`, `package-lock.json`; test export mới.

1. Dùng ZIP writer có sẵn trong hệ sinh thái repo: đưa `yazl` thành dependency build trực tiếp (và typings phù hợp), dựa API local đã kiểm tra. Không import dựa vào transitive `@vscode/vsce`, không tự viết ZIP format hoặc gọi PowerShell/shell zip. Bundle phía extension Node, không đưa thư viện vào webview/MCP.
2. Host nhận Export từ bound Session, đọc Session/layout/Instructions persisted và validate từng member artifact. Không gọi inspect/register hoặc đọc từ filtered UI rows. Global Archive artifact không làm thiếu tài liệu nếu artifact vẫn còn trong một zone của Session.
3. Tạo ZIP entry theo cấu trúc mục 3.5. Có root và ba zone folders cả khi rỗng; `Instructions.md` vẫn có nếu nội dung rỗng. Prefix `01`, `02`, … theo thứ tự trong từng zone; không dùng ID làm filename. Chuẩn hoá separators, ký tự filename không hợp lệ, dấu chấm/khoảng trắng cuối và tên rỗng; fallback tên đọc được như `Session`/`Artifact`.
4. Dùng nội dung file nguyên bản để đóng gói Markdown, không render hoặc đổi formatting/links. ZIP entry paths tương đối dưới root, không absolute, không `..`; không thu gom file ngoài danh sách approved.
5. Nếu artifact member không đọc được/unavailable, dừng và báo rõ artifact bị thiếu; không báo export toàn bộ thành công nhưng lặng lẽ bỏ tài liệu. Không thêm cơ chế repair/restore artifact hoặc tự prune chỉ để export.
6. Mở native Save dialog, default tên Session `.zip`; Cancel không ghi. Chỉ báo thành công khi stream/output hoàn tất. Tạo file tạm sibling rồi finalize theo cơ chế thay file phù hợp Windows của repo; lỗi không ghi đè ZIP đích đang tốt bằng file dở. Dọn đúng temp do lần export tạo.
7. Export đang chạy có pending để không gửi trùng; lỗi inline/action message và có thể thử lại. Export lấy bản đã Save: không tự Save textarea hoặc thêm dirty dialog. Không thay đổi bất cứ nguồn dữ liệu nào sau export.

**Đạt được:** giải nén fixture có đúng cây thư mục, thứ tự, Unicode/duplicate titles và Markdown/Instructions đúng nội dung. Không có JSON/IDs/review state ngoài yêu cầu. Cancel/lỗi không để ZIP đích hỏng hoặc thay state nguồn. Test mở ZIP bằng reader độc lập, không chỉ mock hàm writer rồi coi là export hợp lệ.

### Bước 8 — Validation, docs và bàn giao

**Files docs:** cập nhật `README.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/INSTRUCTION.md`, `docs/CHANGE_LOGS.md` theo hành vi thật; plan tổng/note/checkpoints. Chỉ sửa skill nếu wording cũ về artifact lifetime/cleanup/metadata ownership thực sự cần đồng bộ; không tự sửa wording skills đóng băng của 4.5, không thêm tool hoặc thay contract Proceed chỉ vì UI feature.

- Ghi rõ Archive toàn cục vs zone Archived, Search/Restore, Delete Session giữ artifacts, Delete artifact toàn cục, Session Archive cleanup activation sau 30 ngày, Pin không miễn artifact retention.
- Bổ sung docs quyền extension sửa `artifact.json.title`/`kind`, label Type khác Session Type, tạo kind mở không registry, last-write-wins, giữ updatedAt/round/Markdown và đọc kind hiện tại khi trả Proceed. Canonical ownership docs phải ghi ngoại lệ metadata hẹp này, không diễn giải thành quyền extension/skill ghi các lifecycle fields khác.
- API/DTO tests đi cùng bước thay đổi; mở rộng regression hiện có thay vì duplicate một suite chỉ kiểm tra implementation. Không yêu cầu exhaustive cross-window/ownership matrix ngoài phạm vi.
- Chạy `npm.cmd run check`, `npm.cmd test`, `npm.cmd run build` sau khi các chặng hoàn tất; chạy focused suites trong từng chặng. Kiểm tra `git diff --check`. Ghi đúng pass/skipped và các giới hạn; không đổi version để chữa test.
- Manual Extension Host: menu đúng item khi tab khác active; >20 Recent có Pin/Archive/filter; Search Archived→Open→Restore; Archive header chỉ Restore; Delete artifact trong hai Sessions; Delete Session giữ artifact; panel on/off và grid qua ba dải; filter+Move không mất order; UI-state update không thay Instructions draft; header ROUND trước type, rename/select/create kind rồi metadata/filters cập nhật mà feedback draft còn nguyên; ZIP mở/giải nén đúng. Manual agent: đang wait → đổi plan/non-plan → Proceed nhận đúng kind/action, không yêu cầu user restart waiter chỉ để nhận loại mới.
- Cleanup 30 ngày và seeded types dùng temp root hoặc profile test, không chỉnh dữ liệu global thật chỉ để test. Không đổi/đăng ký lại Activity Bar/icon đang được Chú chấp nhận.

## 6. Tiêu chí hoàn thành và tiến độ

- [ ] **Chặng 1:** UI state/schema/default-read/atomic-patch và Module seed-only; deletion dùng chung retention/prune, tests isolated pass.
- [ ] **Chặng 2:** hai context menus, Pin/Archive sort/filter, Search Archived, tooltip, Restore-only header/More, Delete scopes và cleanup Archive 30 ngày; scoped events cập nhật đúng editor.
- [ ] **Chặng 3:** grid thay masonry với hai bộ cột, side panel hai cột/padding, card descriptions/filter/helper text, edit title/type theo Bước 6.2, Export ZIP đủ tài liệu, docs và validation.
- [ ] **Edit artifact:** ROUND trước type, hai native edit flows và Create new type; manifest chỉ đổi title/kind, updatedAt/round/Markdown/comments giữ nguyên; scoped metadata refresh và last-write-wins, không registry/conflict hardening.
- [ ] **Proceed với kind mới:** cả hai wait flows đọc cùng manifest hiện tại cho response kind/nextAction; plan ↔ non-plan sau khi waiter bắt đầu trả action đúng; không restart waiter hoặc reexecute saved decision.
- [ ] Regression giữ nguyên review lifecycle/schema/active Session/registeredAt/Instructions contract của Phase 4.5, ngoài phần đọc metadata mới khi trả decision được chốt ở mục 3.6.
- [ ] Check/test/build/diff checks được ghi kết quả thật; manual UI/ZIP/cleanup evidence hoặc phần chưa xác minh được nêu rõ.
- [ ] Chú review output trước khi đánh dấu Phase 5 hoàn thành. Không tự kết luận release-ready chỉ từ automated checks.

## 7. Rủi ro và giới hạn chấp nhận

| Điểm cần chú ý | Cách triển khai trong phạm vi |
| --- | --- |
| Delete artifact ảnh hưởng nhiều Sessions | Dùng primitive một target và scanner prune đã có; confirmation nói rõ, kết quả phân biệt deletion commit và cleanup best-effort. Không tự xoá Session v2 rỗng. |
| Archive toàn cục dễ nhầm với zone Archived | UI-state riêng, helper text rõ; catalog/layout/membership không bị sửa chỉ vì Archive. |
| Grid/filter có thể làm lệch thứ tự lưu | Array là nguồn duy nhất, grid row flow, derived filter không persist; Move/Up/Down dùng index gốc. |
| UI-state watcher có thể kéo refresh rộng | Typed ID events/patches, không reload Instructions/review content khi chỉ Pin/Archive; giữ reducer và scoped refresh Phase 4. |
| Export có tài liệu mất hoặc lỗi ghi | Báo lỗi rõ, không xuất thiếu trong im lặng; temp output trước finalize, không có chức năng repair/import. |
| Edit type nhưng waiter còn kind cũ | Nạp lại manifest trong shared submission result, kind/nextAction/link cùng bản mới, đối chiếu đúng identity/round; test đổi loại sau khi waiter đã bắt đầu ở cả hai wait flows. |
| Rename/type refresh làm mất feedback hoặc nhầm Session type | Typed metadata patch chỉ title/kind; giữ drafts/round và dùng event artifact đã có. Kind mở chỉ là slug trên artifact, không chạm Session type registry. |

**Độ khó dự kiến:** trung bình; deletion/cleanup và scoped event wiring cần rà kỹ hơn CSS/menu. Phase 4 đã cung cấp context/snippet/kind/Connect/Instructions và Add nên Phase 5 dùng lại, không xây lại luồng agent. Optional hardening về cross-window conflict, active waiter coordination, cache dài hạn, ZIP import và cleanup Session khác vẫn ngoài phạm vi.

**Kiểm tra lượt bổ sung plan 2026-11-08:** chỉ đọc source và cập nhật hướng dẫn/checkpoints; không triển khai edit metadata, đổi MCP/skill/version, chạy feature tests/check/build hoặc ghi dữ liệu global. Khi implementation bắt đầu, đối chiếu lại source Phase 4.5 và snapshot ở mục 2; không dùng ghi chú này làm bằng chứng tính năng đã hoạt động.
