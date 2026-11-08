# Phase 3 — Session Manager: hướng dẫn triển khai

Trạng thái: **Đã hoàn thành toàn bộ Phase 3 bao gồm cả Bước 7 mở rộng (Active Session contract)**: 40 test files, 587 tests passed, typecheck và build pass. Phase 1+2 đã hoàn thành theo [plan tổng thể](plan.md) và [hướng dẫn Phase 1+2](plan-phase-1-2.md).

Mục tiêu ban đầu: manager editing, filter/search Sessions và English Quick Input. Phạm vi hiện tại gồm **7 bước trong 3 chặng**: giữ kết quả bước 1–6, bổ sung quy tắc active Session cho chat AI ở bước 7 sau khi Chặng 3 gốc hoàn thành.

## 1. Phạm vi đã chốt

| Component | Kết quả Phase 3 |
| --- | --- |
| Tab Session | Giữ cùng URI, Session ID và provider `agentPlus.workSession`; sửa tên, Hướng dẫn và loại Session. Không tạo một manager/tab thứ hai. |
| Bố cục | Working ở giữa; panel bên phải theo thứ tự **Type → Hướng dẫn → References → Archived**. Đóng panel thì Working mở rộng. |
| Hướng dẫn | Một chuỗi Markdown; textarea số dòng/chiều cao cố định, cuộn bên trong, có **Save**. User kiểm soát nội dung; AI có thể hỗ trợ sửa trường `instructions` trong `conversation.json` bằng công cụ ghi file của AI. Giữ ô nhập khi dữ liệu không liên quan đổi, nhận giá trị mới khi chính instructions trên đĩa đổi. |
| Type trong manager | Nút ✎ mở Quick Pick để tìm/chọn hoặc tạo nhanh rồi gán type. Quản lý global vẫn ở ⚙ của sidebar. |
| Artifact | Menu chuyển Working/References/Archived, lên/xuống trong vùng, gỡ khỏi Session. Dùng API registry đã có. |
| Panel preference | Nhớ riêng từng Session bằng extension `globalState`; mặc định mở. Không ghi vào metadata/layout. |
| Filter Sessions | Nút phễu trên header Sessions → Quick Pick một type hoặc **All Types** → áp dụng vào danh sách sidebar. Hiện bộ lọc đang dùng. |
| Search Sessions | Command **AI Artifacts: Search Sessions** và nút kính lúp trên header Sessions → Quick Pick tìm theo title, chọn để mở đúng Session. |
| Quick Input | Labels, titles, placeholders, tooltips, xác nhận và thông báo thuộc các luồng Session Quick Input dùng tiếng Anh; giữ nguyên tên/type label do user nhập. |
| Active Session của chat AI — bổ sung | Mỗi chat giữ tối đa một Session mặc định; create/inspect reuse ID đó, New/Join thành công thay ID đang giữ theo mục 5.7. |

**Ngoài phạm vi:** Pin/Archive/Delete Session; Connect từ manager và catalog/agent context đầy đủ (Phase 4); description artifact và masonry (các phase sau); thêm artifact ngoài Session; attach/import file/folder hoặc chip cho Hướng dẫn; rich editor/preview mới; dirty dialog, native save/backup/hot exit; hardening nhiều manager cùng sửa metadata. `Archived` trong manager là **vùng artifact**, không phải archive Session.

**Cách dùng đã chốt:** giữ Quick Pick chọn/tạo type, Input Box đổi title, textarea + Save cho instructions và menu Move to / Move Up / Move Down. Không triển khai drag/drop sắp xếp artifact hoặc thêm dependency dnd-kit ở bất kỳ phase nào trong roadmap này. Không lấy việc thay các controls hiện tại làm yêu cầu nâng cấp của phase sau.

## 2. Hiện trạng code và phần cần tận dụng

Các điểm dưới đây đã đối chiếu source lúc lập hướng dẫn; chúng là nền hiện có, không phải việc cần xây lại.

| File/component | Hiện trạng và hướng sửa |
| --- | --- |
| `src/shared/conversation-artifact-registry.ts` | Có `readSession`, `listSessions`, `updateSessionDetails`, `setSessionType`, `moveArtifactInSession`, `removeArtifactFromSession`. Nối UI vào API này; không đổi storage/migration. `setSessionType` mới kiểm tra format ID: đường gán từ manager phải kiểm tra type còn tồn tại. |
| `src/shared/session-type-registry.ts` | Có list/create/rename/delete và `isValidSessionTypeId`; default `conversation`, ID ổn định, label đổi được. Dùng chung registry, không thêm store khác. |
| `src/extension/conversation-artifact-service.ts` | Đã resolve DTO Session/card. `onDidChange` chưa có payload; watcher bỏ URI, debounce rồi báo thay đổi chung. Sửa trước để giữ loại thay đổi và ID qua đường refresh. |
| `src/extension/extension.ts` | Đã có hai Tree Views, Session editor/opener, watcher registry/manifest/types; một số callback refresh tất cả. Nối event có phạm vi; dùng `createTreeView` riêng Sessions để đặt description filter. |
| `src/extension/work-session-provider.ts` | `CustomReadonlyEditorProvider`, gửi toàn bộ `workSessionState` khi service đổi; chỉ nhận ready/openArtifact/openExternal. Giữ provider, thêm actions và thông báo theo phần; Save qua host/registry. |
| `src/webview/SessionApp.tsx` | Một state toàn trang, Hướng dẫn trong `pre`, ba vùng artifact; lỗi chuyển cả trang sang error. Thêm controls, tách state ô nhập và lỗi thao tác. |
| `src/extension/work-session-sidebar.ts` | V2 list, gate MCP, dòng migration, label type/count đã có; chưa filter/search Session. Giữ native Tree Views và migration notice. |
| `src/extension/session-type-command.ts` | Quick Pick quản lý types đã có; handler rename/delete đang nhận diện bằng tooltip tiếng Việt. Đổi wording phải đổi sang button/action identity ổn định. |
| `artifact-search-command.ts`, `artifact-search.ts` trong `src/extension/` | Có lifecycle Quick Pick và `normalizeArtifactTitleSearch`. Tận dụng cho Session search, không refactor toàn bộ artifact search. |

## 3. Invariant dữ liệu và refresh

### 3.1. Đường ghi

- `conversation.json` schema v2 giữ `sessionId`, `title`, `instructions`, `typeId`, `createdAt`. Sửa một trường qua API đọc bản mới nhất rồi patch; không gửi lại toàn bộ snapshot cũ từ webview.
- `registered-artifacts/<artifactId>.json` là nguồn membership duy nhất. MCP create/inspect cập nhật membership; khi reuse không sửa title/instructions/typeId hoặc layout.
- Quy tắc MCP reuse trên không cấm AI sửa Hướng dẫn: đó là thao tác riêng bằng công cụ file của AI trên `conversation.json`, theo yêu cầu user; không phải side effect của create/inspect.
- `layout.json` giữ ba mảng ID có thứ tự. Move/reorder chỉ ghi layout; remove xoá membership và lọc layout, không xoá artifact hoặc ảnh hưởng Session khác. Session v2 rỗng vẫn tồn tại.
- Session `updatedAt` tính từ `max(createdAt, ...registeredAt)`. **Inspect làm mới `registeredAt` là hành vi hợp lệ đã chốt**. Sửa nội dung artifact thông thường không tự register lại; metadata/layout edits không đẩy Session lên đầu.
- Giữ atomic write, chấp nhận bản lưu sau cùng thắng. Không thêm lock, CAS, revision check, merge hoặc chống nhiều manager ghi đồng thời.
- Gate theo numeric MCP đã cài trên đĩa **12**; không kiểm tra process đang chạy, không cần bump MCP/package/schema cho phạm vi này.

### 3.2. Refresh đúng phần

Có thể giữ số lượng watcher hiện tại; yêu cầu là **phân loại đường dẫn và chuyển thông tin tới consumer**, không phải tạo watcher cho từng artifact.

| Thay đổi | Phần cần cập nhật | Ô Hướng dẫn đang nhập |
| --- | --- | --- |
| Manifest artifact A | Recent Artifacts; card A trong manager đang chứa A. `artifact.updatedAt` của card có thể đổi. | Không gán lại, không remount textarea. |
| Membership Session S | Sidebar S/count/recency; danh sách manager S; đích Sessions của Review App liên quan. | Không lấy `instructions` từ snapshot này để set input. |
| Layout Session S | Vùng và thứ tự artifact của manager S. | Giữ nguyên. |
| Metadata Session S, instructions không đổi | Tên/type và dữ liệu persisted của S; sidebar nếu cần. | Giữ nguyên; ghi lại metadata không đồng nghĩa instructions đã đổi. |
| Chính instructions của S đổi trên đĩa | Gửi giá trị instructions mới tới manager S, kể cả AI sửa file trực tiếp; own-save vẫn có acknowledgement. | Nhận giá trị mới, kể cả đang gõ. Chấp nhận thay thế phần chưa Save, không thêm conflict handling. |
| Global types | Type label/options, filter label và list liên quan. | Giữ nguyên. |
| MCP đã cài | Các gate Session và actions mới. | Không reload webview/reset form. |

Textarea khởi tạo khi mở Session, thay đổi do user nhập, own-save hoặc khi chính giá trị instructions trên đĩa đổi. Khi đọc metadata, so instructions với **giá trị persisted đã đọc lần trước**, không so với nội dung user đang nhập: chỉ đổi title/type hoặc watcher báo lặp thì không gửi instructions patch. Đây là so sánh trường dữ liệu để refresh đúng phần, **không phải `isDirty` hay phát hiện conflict**. Không lưu draft vào `localStorage`/`globalState` hoặc thiết kế recovery; đóng/reload trước Save chưa được bảo vệ.

### 3.3. AI hỗ trợ sửa Hướng dẫn

- File đích là `~/.ai-artifacts/conversation-registry/<sessionId>/conversation.json` của đúng Session v2 đang làm việc. Không tạo thêm file instructions riêng trong đợt này.
- AI dùng công cụ đọc/ghi file sẵn có: đọc JSON hiện tại, sửa đúng chuỗi `instructions`, giữ các trường khác và ghi JSON hợp lệ. Không cần tool MCP chuyên sửa Hướng dẫn; không đụng membership/layout hoặc artifact lifecycle.
- AI sửa file và user Save cùng dùng quy tắc bản ghi thành công sau cùng thắng. Không thêm lock, merge, dirty guard/dialog hoặc tests hardening conflict AI–user.
- **Phase 3:** hỗ trợ watcher/UI nhận instructions sửa trực tiếp từ bên ngoài. Đây là bổ sung cho bước 3/Chặng 2, gồm cả contracts/provider cần nối thêm sau Chặng 1.
- **Phase 4:** khi hoàn thiện agent context/Connect/skill contract, cung cấp exact Session ID và đường dẫn metadata để AI biết nơi đọc/sửa Hướng dẫn, cùng quy tắc chỉ sửa trường được yêu cầu. Chưa tuyên bố MCP/skill hiện tại đã trả đường dẫn hoặc có hướng dẫn này.

## 4. Thứ tự triển khai và checkpoint

| Chặng | Bước | Đầu ra để review | Trạng thái |
| --- | --- | --- | --- |
| 1 — Refresh và host actions | 1. Event có phạm vi | Watcher tới đúng consumer; giữ behavior Phase 1+2. | ✅ Đã hoàn thành |
| 1 — Refresh và host actions | 2. Contracts/actions | Manager ghi đúng file qua API hiện có; lỗi không xoá state. | ✅ Đã hoàn thành |
| 2 — Session Manager | 3. UI manager | Sửa tên/Hướng dẫn/type, panel preference, menu artifact. | ✅ Đã hoàn thành |
| 3 — Sidebar và nghiệm thu | 4. Filter/search | Lọc sidebar theo type; tìm toàn bộ v2 và mở đúng Session. | ✅ Đã hoàn thành |
| 3 — Sidebar và nghiệm thu | 5. English Quick Input | Wording nhất quán, CRUD types vẫn đúng. | ✅ Đã hoàn thành |
| 3 — Sidebar và nghiệm thu | 6. Validation/bàn giao | Tests/check/build và bằng chứng Extension Host tách riêng. | ✅ Đã hoàn thành |
| 3 — Mở rộng sau nghiệm thu ban đầu | 7. Active Session contract | Chuẩn hoá default/New/Join cho chat AI; skill/prompt/tests/version đồng bộ. | ✅ Đã hoàn thành |

Mỗi chặng kết thúc ở phần diff review được và cập nhật tiến độ bằng kết quả thực tế. Không đánh dấu runtime hoàn thành chỉ từ build/render markup pass.

## 5. Hướng dẫn từng bước

### 5.1. Bước 1 — Event có phạm vi và refresh theo component

**Phụ thuộc:** Phase 1+2. **Đầu ra:** giữ Session ID/artifact ID và loại dữ liệu tới consumer.

| File/component | Sửa cụ thể |
| --- | --- |
| `conversation-artifact-service.ts` | Mở rộng `onDidChange`/`scheduleChangeNotification`/`notifyChanged` bằng batch event có loại/ID. Tận dụng debounce, gom/dedupe và giữ mọi ID thay vì chỉ event cuối. Phân loại URI watcher, bỏ qua tmp/backup. |
| `src/shared/contracts.ts`, `src/webview/SessionApp.tsx` | Thêm typed outgoing patches summary/artifact sections và xử lý merge đúng phần ngay trong bước này; giữ initial `workSessionState`. App chỉ đọc hiện tại vẫn phải nhận được các thay đổi sau khi đổi pipeline. Bước 2 bổ sung action/result, bước 3 mới thêm form editing. |
| `extension.ts` | Manifest watcher gửi artifact ID; types watcher gửi types event; registry phân biệt metadata/membership/layout. Callback type CRUD/migration/gate gửi đúng phạm vi, thay đường `notifyChanged()` chung. |
| `work-session-sidebar.ts` | Sessions refresh theo metadata/membership/types/support; layout không đổi count/recency. Recent refresh theo artifact event. Giữ sort/cap/gate. |
| `work-session-provider.ts` | Target khác thì bỏ qua; membership/layout đúng Session gửi danh sách; artifact đang là member gửi card; types/metadata gửi summary phù hợp. Có thể resolve DTO hiện có rồi chọn phần gửi, không cần cache/index framework mới. |
| `artifact-review-provider.ts` | Đổi interface/subscription service: membership chứa artifact đang mở hoặc metadata/type của đích liên quan mới refresh Session targets. Layout không chạy lại review hoặc reload Review App. Giữ watcher/lifecycle review hiện tại. |
| Tests service/sidebar/provider | Đổi mocks theo signature mới; kiểm tra đúng target, khác target và batch nhiều ID. Không chỉ kiểm tra số lần callback chung. |

**Event đề xuất** (extension-only, không phải schema lưu trên đĩa):

```ts
type WorkSessionDataChange =
  | { kind: "metadata"; sessionId: string }
  | { kind: "membership"; sessionId: string; artifactId: string }
  | { kind: "layout"; sessionId: string }
  | { kind: "artifact"; artifactId: string }
  | { kind: "types" }
  | { kind: "support" };
// onDidChange(listener: (changes: readonly WorkSessionDataChange[]) => ...)
```

Membership giữ artifact ID để Review App phát hiện cả quan hệ mới, chưa có trong targets cũ. Migration dùng ID Session/members vừa chuyển; xoá thư mục làm consumer đọc lại target bị ảnh hưởng. Nguồn event là URI/operation thật, không suy từ title/newest Session.

**Khả năng phải đạt:** thêm/inspect member cập nhật đúng Session; manifest chỉ cập nhật card/Recent; layout không tác động form; màn khác target không refresh vô cớ. Không dựng lại HTML hoặc remount `SessionApp` sau mỗi event.

**Kiểm chứng:** `conversation-artifact-service.test.ts`, `work-session-sidebar.test.ts`, `work-session-provider.test.ts`, subscription trong `artifact-review-provider.test.ts`; kiểm tra payload/target và dispose watcher/listener.

### 5.2. Bước 2 — Typed actions, persistence và kết quả thao tác

**Phụ thuộc:** bước 1. **Đầu ra:** host xử lý đủ thao tác manager; webview không ghi filesystem trực tiếp.

| File/component | Sửa cụ thể |
| --- | --- |
| `src/shared/contracts.ts` | Mở rộng `sessionWebviewToExtensionMessageSchema` bằng actions dưới đây; tái dùng summary/artifact patches bước 1, thêm preference và kết quả action. Giữ typed union/validation; không đổi schema metadata/membership/layout. |
| `conversation-artifact-service.ts` | Wrapper manager dùng `updateSessionDetails`, `setSessionType`, `moveArtifactInSession`, `removeArtifactFromSession`, truyền root options hiện có và phát scoped event sau thành công. Trước gán type kiểm tra ID tồn tại qua registry types. |
| `work-session-provider.ts` | Bind action vào `document.sessionId`; kiểm tra Session v2/gate, membership khi thao tác artifact. Nối input box đổi tên, picker type, preference `globalState`; lỗi action không thay màn manager. |
| `session-type-command.ts` hoặc helper nhỏ dùng chung | Hoàn thiện picker chọn/tìm/tạo type cho handler trong bước này; tái dùng CRUD registry, type hiện có và action `Create type "…"`, tạo rồi gán. Bước 3 chỉ nối nút ✎ vào action đã có. |
| Registry hiện có | Tận dụng validation title/path/atomic write. Không sửa lifecycle/manifest; không import registry types ngược vào conversation registry tạo vòng phụ thuộc. |
| `vscode-api.ts`, test provider/contracts | Cập nhật type union cần thiết; giữ một VS Code API instance. Kiểm tra action parse và ghi đúng phạm vi bằng fixture. |

**Actions mới đề xuất** (tên theo convention hiện có, khả năng/payload như bảng):

| Action từ webview | Xử lý host |
| --- | --- |
| `renameSession` | Native Input Box với title hiện tại; accept hợp lệ gọi `updateSessionDetails({ title })`; cancel không ghi. |
| `saveSessionInstructions { instructions }` | `updateSessionDetails({ instructions })`; giữ nguyên Markdown, cho phép rỗng. Không gửi title/typeId từ form snapshot cũ. |
| `selectSessionType` | Quick Pick chọn/tạo rồi gọi wrapper gán type đã kiểm tra tồn tại. Cancel không đổi assignment. |
| `moveArtifact { artifactId, zone }` | Đọc membership/layout hiện tại, move tới Working/References/Archived; append cuối vùng đích. |
| `reorderArtifact { artifactId, direction }` | Đọc thứ tự hiện tại; lên/xuống một bước trong vùng qua `moveArtifactInSession`. |
| `removeArtifact { artifactId }` | `removeArtifactFromSession`; chỉ gỡ quan hệ với Session đang mở. |
| `setSessionPanelExpanded { expanded }` | Lưu preference theo ID document; không ghi registry. |

Không nhận Session ID/path tuỳ ý trong action payload. `openArtifact` vẫn dùng coordinator và kiểm tra membership. Save trả giá trị đã lưu cho đúng control; move/remove chỉ cập nhật artifact sections. Own-write có thể được watcher báo lại: patch lặp không được reset input.

**Đầu ra tới webview:** initial data; summary gồm title/type/timestamps; artifact sections gồm ba vùng/card; preference panel; own-save acknowledgement; error có action/message để hiện đúng vị trí. Đây là giao thức nhỏ cho manager, không xây RPC framework/version/merge.

**Khả năng phải đạt:** title/instructions/type chỉ sửa metadata; move/reorder chỉ sửa layout; remove chỉ xoá membership/dọn layout. Pending/error không làm mất dữ liệu hiển thị; gate MCP cũ chặn actions Session.

**Kiểm chứng:** provider action qua fixture so file trước/sau; Save instructions không đổi title/type/layout/membership/recency; type không tồn tại bị từ chối; move/reorder/remove giữ artifact và membership Session khác. Tái dùng registry tests đã phủ invariant, không sao chép toàn bộ ở tầng UI.

### 5.3. Bước 3 — Manager editing, panel và menu artifact

**Phụ thuộc:** bước 2. **Đầu ra:** quản lý Session trên tab hiện có.

| File/component | Sửa cụ thể |
| --- | --- |
| `src/webview/SessionApp.tsx` | Header title + ✎ đổi tên, toggle panel. Working ở chính; panel Type → Hướng dẫn → References → Archived. Tách state ô nhập khỏi summary/artifacts, lỗi action khỏi lỗi load ban đầu. |
| `src/shared/contracts.ts`, `work-session-provider.ts` | Bổ sung instructions patch cho metadata thay đổi bên ngoài. Provider so với instructions persisted đã đọc trước đó; chỉ gửi khi trường thực sự đổi, không gửi lại vì title/type đổi. App nhận patch này để cập nhật ô nhập, không kiểm tra dirty hoặc nguồn AI/user. |
| `src/webview/styles.css` | CSS theo namespace Session; fixed rows/height textarea, cuộn bên trong; Working mở rộng khi panel đóng. Dùng theme variables, không redesign Review App/thêm UI library. |
| `work-session-provider.ts`, extension context | `globalState` key theo Session ID, đề xuất `workSessions.panelExpanded.<sessionId>`; mặc định `true`, gửi khi ready. Nhớ cùng Session qua workspace; không dùng webview localStorage. |
| Type control | Nút ✎ gọi picker chọn/tìm/tạo từ bước 2; hiển thị assignment/type label sau host xác nhận. ⚙ sidebar tiếp tục quản lý global. |
| Tests UI/provider | Input sau patch, Save result/error, panel state và menu payload. SSR snapshot không chứng minh giữ focus. |

**Hướng dẫn:**

1. Luôn hiện textarea, kể cả instructions rỗng. Khởi tạo từ initial load; giữ state ở cấp không bị unmount khi toggle panel hoặc thay danh sách artifact.
2. Có **Save**, trạng thái đang lưu và lỗi tại khu vực này. Trong lúc lưu, chặn gửi lặp và sửa cùng ô để acknowledgement không thay lượt gõ mới. Thành công giữ nội dung đã lưu; thất bại giữ nội dung vừa nhập để thử lại.
3. Không có effect “mỗi DTO mới thì set instructions”. Artifact/membership/layout/type patch và title rename không cập nhật textarea. Riêng instructions patch do giá trị trên đĩa thực sự đổi thì cập nhật ô nhập; không dùng dirty guard để chặn. Đây là xử lý nguồn refresh, không cần conflict subsystem.
4. Không thêm rich text, file chip, description/catalog hoặc preview editor. Đóng tab/reload trước Save có thể mất phần nhập theo phạm vi đã chốt.

**Menu artifact:**

- Move to Working / References / Archived; vùng hiện tại không phải thao tác chuyển. Cross-zone append cuối; không đổi membership/registeredAt.
- Move Up / Move Down theo index trong vùng, disable ở đầu/cuối; sau host xác nhận hiển thị thứ tự registry trả về.
- Remove from Session: chỉ gỡ membership và dọn layout. Gỡ artifact cuối vẫn giữ manager rỗng; không xoá artifact hoặc archive/delete Session.
- Menu là control riêng, không làm nổi bọt click thành mở artifact. Card vẫn mở qua routing hiện có; artifact unavailable vẫn tổ chức/gỡ được nhưng không mở review.

**Khả năng phải đạt:** đổi tên qua Input Box; Markdown + Save; chọn/tạo type; panel nhớ riêng từng Session sau reopen/reload; chuyển/sắp xếp/gỡ artifact đúng file. Background updates không liên quan giữ value/focus; AI sửa chính instructions trên đĩa thì manager nhận nội dung mới.

**Kiểm chứng:** interaction test message/state nếu hạ tầng hiện có hỗ trợ, cộng Extension Host: đang gõ thì đổi manifest, create/inspect thêm member, đổi title/type hoặc layout; input/focus giữ nguyên, phần liên quan cập nhật. Sửa riêng instructions trong fixture `conversation.json` thì manager hiện nội dung mới. Thử Save thành công/lỗi; toggle panel giữ phần chưa Save trong tab đang mở. Không thêm matrix nhiều manager/AI–user sửa cùng trường.

### 5.4. Bước 4 — Sidebar filter và Search Sessions

**Phụ thuộc:** bước 1–2; dùng manager bước 3 để smoke test. **Đầu ra:** native Quick Pick filter áp dụng lên sidebar; search mở đúng Session.

| File/component | Sửa cụ thể |
| --- | --- |
| `work-session-sidebar.ts` | Selected type ID trong memory từng window. Lọc item Session theo ID, giữ sort `updatedAt`; migration notice độc lập. Empty state phân biệt chưa có Session với không khớp filter. |
| `extension.ts` | `createTreeView("agentPlus.sessions", { treeDataProvider })`, giữ handle đặt description/dispose; bỏ đăng ký `registerTreeDataProvider` trùng view. Đăng ký filter/search, cùng gate installed MCP. |
| `package.json` | Command đề xuất `agentPlus.filterSessions` / `agentPlus.searchSessions`, title **Filter Sessions** / **Search Sessions**, category **AI Artifacts**. Header Sessions thêm `filter`, `search` qua `view/title`, giữ ⚙. Không thêm shortcut mặc định/+ Session. |
| Helper mới nếu cần: `src/extension/session-filter-command.ts`, `session-search-command.ts` | Quick Pick theo pattern dependency-injected của artifact search. Tách chọn filter khỏi persistence; search chỉ đọc và gọi opener. Không xây sidebar webview. |
| Tests sidebar/commands, `test/release-contract.test.ts` | Filter thực, search nguồn đầy đủ/open exact ID; cập nhật expected menu assertions, giữ các menu review hiện có. |

**Filter:**

1. Phễu mở Quick Pick gồm **All Types** và registry types, preselect type đang dùng. Accept thì apply; Esc giữ filter cũ. Một type tại một thời điểm, không multi-select/tags.
2. State trong memory từng window: giữ qua refresh, Reload Window về All Types. Không ghi vào Session metadata/layout hoặc global preferences.
3. Active filter hiển thị qua `TreeView.description`, ví dụ `Type: Feature`; All Types xoá description filter. Rename đổi label; xoá selected type reset All Types. Match theo ID ổn định.
4. Không khớp hiện `No sessions match this filter`; N conversation có thể migration vẫn hiện nếu có. Gán type trong manager làm Session vào/ra kết quả, không đổi filter.

**Search:**

1. Command Palette **AI Artifacts: Search Sessions** và kính lúp cùng handler. Nguồn là **toàn bộ Session v2**, độc lập filter sidebar; không đưa v1 vào hoặc tự migration.
2. Tìm title không phân biệt hoa/thường/dấu theo normalization hiện có. Label title, description type label, detail timestamp/ID để phân biệt title trùng; thứ tự ban đầu theo recency.
3. Accept gọi `agentPlus.openWorkSession` với exact Session ID; opener kiểm tra lại target/gate. Cancel không mở/ghi; chọn Session không đổi filter hoặc recency.
4. Tận dụng loading/filter/hide/dispose của mẫu artifact Quick Pick; empty/no-result rõ ràng. Không thêm search engine/index hoặc full-text instructions search.

**Khả năng phải đạt:** filter áp dụng tree thật, indicator đúng; search tìm được Session bị filter ẩn và mở cùng tab theo URI. Giữ Activity Bar AI Artifacts, icon `library`, view IDs và Recent Artifacts hiện tại.

**Kiểm chứng:** filter All/type/cancel; rename/delete type đang lọc; migration notice không bị lọc; search ngoài filter và title trùng mở đúng ID. Contributions chỉ gắn actions vào view Sessions, không chỉ kiểm tra label trong source.

### 5.5. Bước 5 — Wording tiếng Anh cho Session Quick Input

**Phụ thuộc:** bước 3–4. **Đầu ra:** native picker/input flows nhất quán, không thay user content.

| File/component | Sửa cụ thể |
| --- | --- |
| `session-type-command.ts` | Đổi title/placeholder, Add/Rename/Delete, default notice, delete confirmation, validation/kết quả sang tiếng Anh. Tách button identity khỏi tooltip được dịch. |
| `extension.ts`, `artifact-review-provider.ts`, `session-migration-command.ts` | Rà native Session flows: mở Session, chọn membership, migration single/bulk và notifications đi kèm. Đổi wording đúng phạm vi này, không dịch toàn bộ Review App. |
| Helpers manager/filter/search mới | English titles/placeholders/actions ngay từ đầu; title/instructions/type label user giữ nguyên. |
| Tests Quick Input | Cập nhật expectations và kiểm tra create/rename/delete/cancel/assign/open; handler không phụ thuộc tooltip text. |

| Ngữ cảnh | Wording thống nhất |
| --- | --- |
| Quản lý types | `Manage Session Types` · `Session types are shared across all sessions` |
| Chọn type | `Select Session Type` · `Search or create a type` · `Create type "…"` |
| Đổi tên Session | `Rename Session` · `Enter a session name` |
| Lọc | `Filter Sessions` · `All Types` · `Select a session type` |
| Tìm | `Search Sessions` · `Search sessions by name` |
| Xoá type đang dùng | Nêu số Session sẽ về default; actions `Delete Type` / `Cancel`. Default type không có delete action. |

**Khả năng phải đạt:** dịch không làm rename/delete mất tác dụng; default rule, xác nhận chuyển về default và cancel vẫn đúng contract; không tự dịch tên user tạo.

### 5.6. Bước 6 — Validation, docs và bàn giao

**Phụ thuộc:** bước 1–5. **Đầu ra:** báo đúng khả năng đã kiểm chứng và phần chưa xác minh.

| Phần | Công việc |
| --- | --- |
| Focused tests | Chạy theo component từng bước. Behavior tests cho scoped events, actions, search/filter, bảo toàn input; không nhân đôi implementation. Root tạm, không mutation home/registry thật. |
| Cuối đợt | `npm.cmd run check`, `npm.cmd test`, `npm.cmd run build`, `git diff --check`. Chạy lại khi có code mới/lỗi mới; báo tests skipped. Không cố định số test theo Phase 1+2. |
| Extension Host | Scenarios mục 6, ghi đã chạy/chưa chạy. Automated/build không thay bằng chứng focus, native picker, Activity Bar hoặc tab reuse. |
| Docs khi triển khai | Theo quy định repo, hỏi Chú có muốn đồng bộ docs hành vi trước khi sửa canonical docs. Chuẩn bị phần manager editing/refresh, panel preference, filter/search commands và giới hạn Save trong README/docs liên quan. Plan này không cấp phép sửa toàn bộ docs hoặc code. |
| Bàn giao | Component đã đổi, kết quả và cách thử; không tự bump version, publish, cài integration global hoặc migrate dữ liệu thật. |

### 5.7. Bước 7 — Mở rộng Chặng 3: contract active Session của chat AI

**Phụ thuộc:** bước 1–6 đã hoàn thành. **Trạng thái:** ✅ Đã hoàn thành toàn bộ (mở rộng Chặng 3).

**Quan hệ:** một Session có thể được nhiều conversation chat AI cùng sử dụng. Mỗi chat giữ **0 hoặc 1 `activeSessionId`** tại một thời điểm; chat có thể chuyển Session theo yêu cầu user. Đây là ngữ cảnh của chat do AI giữ, không thêm bảng/list chat vào registry. Tham số MCP hiện tại `artifactConversationId` mang Session ID, không phải ID của conversation chat hoặc `reviewSessionId`.

| Intent | ID gửi vào create/inspect | Ngữ cảnh sau thành công |
| --- | --- | --- |
| Chưa có active Session | Omit `artifactConversationId` | Giữ ID Session được tool trả về. |
| Thao tác mặc định, đang giữ S | Gửi S | Tiếp tục dùng S cho các lượt sau. |
| Create artifact và user yêu cầu New Session | Omit ID cũ dù chat đang giữ S | Thay S bằng ID mới trả về. Chỉ đổi `conversationName` mà vẫn gửi S không phải New Session. |
| Inspect exact artifact và user yêu cầu New Session | Omit ID cũ dù chat đang giữ S | Thay S bằng ID mới trả về; giữ exact artifact handle. |
| User chỉ định Join Session T | Gửi exact ID T | Thay active ID bằng T sau thành công. |

- New/Join là quyền đổi mặc định của chat. Chỉ commit active ID mới sau thành công; lỗi không tự retry vào Session cũ. Window-selection retry giữ nguyên intent/Session đích của request, không tự đưa ID cũ trở lại request New.
- Không đồng thời giữ hai ID làm mặc định. Thay active ID không xoá Session cũ, chuyển membership cũ, clone artifact hoặc làm mất mapping handle/round đang giữ cho từng artifact. Một artifact vẫn có thể thuộc nhiều Session.
- Không suy ra active Session từ membership của artifact, title, newest Session, PID hoặc AI client. Wait/advance trả lại thông tin của request/round không tự trở thành hành động chuyển Session của chat.

| File/component | Sửa cụ thể khi triển khai bước 7 |
| --- | --- |
| `skills/create-review-artifact/SKILL.md` | Chuẩn hoá một active ID theo chat; quy tắc default/New/Join và explicit create-new phải thắng reuse mặc định. Dùng từ Session thay mô tả drawer cũ ở phần identity; giữ exact handles, lifecycle và recovery v1 đã có. |
| `skills/create-review-artifact/references/artifact-contract.md` | Ghi rõ quan hệ chat–Session và bảng intent, phân biệt active context với membership/review ownership. Đồng bộ mô tả registry v2 đang thay cho đoạn v1/drawer cũ; không đổi signature MCP hoặc thêm tool. |
| `src/shared/artifact-connect-prompt.ts` | Rà mode new/join đã có: New omit ID cũ, thành công replace active ID; Join dùng exact T và chỉ đổi active sau thành công. Giữ legacy prompt và installed-MCP gate hiện có; không thêm popup/control manager mới. |
| `test/skill-contract.test.ts`, `test/artifact-connect-prompt.test.ts` | Kiểm chứng chỉ dẫn và prompt cho default, explicit create-new, inspect-new, join, success-only replacement và legacy. Tận dụng data/MCP fixtures đang có cho omit/reuse; không coi text assertions là bằng chứng AI client runtime. |
| `src/shared/contracts.ts`, version expectations và docs liên quan | Khi thay skill thực sự, tăng numeric `SKILL_VERSION` một đơn vị từ source hiện tại; giữ `MCP_VERSION` nếu MCP không đổi. Đồng bộ receipt/version tests và mô tả version trong README/docs theo source (README và release-contract hiện còn ghi skill 3 trong khi source là 4). Không bump package hoặc cài integration global trong lượt ghi plan. |

**Khả năng phải đạt:** chat đang giữ S vẫn tạo/inspect được vào Session mới theo yêu cầu rồi dùng ID mới cho request mặc định tiếp theo; nhiều chat có thể dùng cùng S. Các thao tác manager, membership và review lifecycle giữ contract đã có.

**Kiểm chứng:** focused suites của skill/prompt; check/test/build sau thay đổi thực đã pass 100%. Manual runtime với AI client (default S → create-new N → create/inspect mặc định dùng N; inspect-new → mặc định dùng ID mới; Join T → mặc định dùng T) ghi nhận riêng.

## 6. Nghiệm thu Phase 3

Mục 1–7 dưới đây là nghiệm thu phạm vi ban đầu đã ghi nhận. Bước 7 mở rộng có tiêu chí riêng ở mục 5.7 và chỉ được đánh dấu hoàn thành sau khi triển khai/kiểm chứng phần bổ sung.

Manual trong Extension Development Host với fixture Session v2/installed MCP đủ version:

1. Mở cùng Session từ sidebar/search/Review App: cùng tab. Đổi tên, instructions rỗng/Markdown, Save/reopen: đúng dữ liệu; metadata edit không tăng recency.
2. Đang gõ instructions: đổi manifest, create/inspect thêm membership, move/reorder artifact. Card/danh sách/thời gian tương ứng cập nhật; input/focus không bị background refresh thay thế. Inspect tăng recency, chỉ đổi manifest không tăng `registeredAt`.
3. Save lỗi giữ nội dung nhập/manager; thử lại được. Gán/tạo type, cancel picker, rename/delete type global: assignment/labels đúng, instructions không reset. Sửa chính instructions trong file metadata bằng công cụ ngoài thì ô nhập nhận giá trị mới; chỉ sửa title/type không reset ô nhập.
4. Toggle panel ở hai Session; reopen/reload nhớ preference riêng. Toggle trong tab đang mở giữ phần chưa Save; Working mở rộng khi panel đóng.
5. Move ba vùng, lên/xuống, remove: đúng sau reopen; không xoá artifact/ảnh hưởng Session khác. Gỡ member cuối vẫn giữ Session rỗng.
6. Filter type rồi refresh, rename/delete type: indicator/list đúng, migration notice còn. Search từ icon/Command Palette tìm toàn bộ v2 kể cả Session bị ẩn, chọn exact ID; cancel không ghi.
7. Installed MCP cũ: gate chặn cả actions mới; Recent/review/Connect legacy vẫn dùng được. Filter/search không tự migration hoặc tạo Session.

**Đạt Phase 3 khi:** manager editing/artifact actions hoạt động trên model hiện có; dữ liệu không liên quan không đè input, instructions trên đĩa thực sự đổi thì manager nhận giá trị mới; panel preference riêng từng Session; sidebar filter/search và English Quick Input hoạt động; check/test/build pass, manual evidence hoặc phần chưa xác minh báo rõ. Không gộp các mục hoãn thành tiêu chí bắt buộc.

## 7. Rủi ro triển khai và giới hạn chấp nhận

- **Còn đường refresh chung:** sửa watcher nhưng bỏ callback type CRUD/migration hoặc subscription sẽ còn gửi full state. Bước 1 đi hết producer → service → provider → UI; input cũng tách riêng khỏi snapshot refresh.
- **Action ghi sai phạm vi:** Save cả DTO cũ có thể đè trường khác, remove có thể nhầm xoá artifact. Bước 2 giới hạn payload, bind Session từ document và tái dùng registry API.
- **Giới hạn đã chấp nhận:** đóng/reload trước Save có thể mất phần nhập; nhiều manager hoặc AI–user sửa cùng trường dùng bản lưu sau cùng thắng. Nếu instructions trên đĩa đổi, manager nhận bản mới kể cả đang có phần nhập chưa Save. Không thêm dirty dialog/lock/conflict handling.
- **Độ khó dự kiến:** trung bình; refresh và bảo toàn input khó nhất. Persistence/types/navigation đã có từ Phase 1+2, phần còn lại chủ yếu nối controls/native pickers và kiểm chứng. Không còn quyết định sản phẩm bắt buộc phải chốt trước khi bắt đầu theo phạm vi này.
