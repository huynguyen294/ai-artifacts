# Phase 1 + 2 — Session model, sidebar và điều hướng

Trạng thái: **ĐỢT PHASE 1+2 ĐÃ HOÀN THÀNH 100% (Cả 3 Chặng: Chặng 1, 2, 3). Sẵn sàng bàn giao và review.**

> [!NOTE]
> - **Tiến độ tổng thể:**
>   - ✅ **Chặng 1 (Headless Data Layer & MCP Contract — Bước 1, 2, 3):** ĐÃ HOÀN THÀNH.
>   - ✅ **Chặng 2 (Sidebar TreeView & Session Tab Webview — Bước 4, 5):** ĐÃ HOÀN THÀNH.
>   - ✅ **Chặng 3 (ReviewApp Navigation, Connect Dialog & Bulk Migration — Bước 6, 7):** ĐÃ HOÀN THÀNH.

Bản này là hướng dẫn triển khai Phase 1+2, đã đối chiếu source hiện tại ngày 2026-11-06. Mục 1–12 giữ contract/phạm vi; mục 13 mô tả từng bước theo file/hàm, luồng xử lý, khả năng phải đạt và kiểm chứng. Mọi tên file/API/command được đánh dấu **mới/đề xuất** chưa tồn tại trong source; không đọc chúng như API đã triển khai. Nhãn nút Review App đã chốt là **Sessions**.

Ngoại lệ chuẩn bị đã làm theo yêu cầu Chú: numeric MCP_VERSION được tăng **11 → 12** để phân biệt bản MCP đã cài khi test; package vẫn 1.1.4, skill vẫn 3. Version bump chưa triển khai Session v2, UI gate hoặc migration mô tả bên dưới.

Chú yêu cầu triển khai Phase 1 và Phase 2 trong một đợt; giữ tên file này để review chung. Phần 1–9 là Phase 1, phần 10–15 là Phase 2 và nghiệm thu kết hợp. Session types được bổ sung theo quyết định tiếp nối: một type/session, danh sách dùng chung toàn user; popup quản lý mở bằng ⚙ ở header **Sessions** trong sidebar trái, không có nút **+ session**.

Quyết định tiếp nối: bỏ drawer conversation cũ; mở tính năng Session theo MCP đã cài trên đĩa. Migration chỉ chạy khi user yêu cầu: từng conversation tại Review App hoặc bulk từ thông báo phát hiện conversation v1 trong Sessions. Không tự migration khi activation, đọc/list, mở artifact hoặc cleanup; chưa kiểm tra process MCP đang chạy.

Đã chốt thêm: **MCP cũ giữ Connect như hiện tại, copy prompt exact artifact handle trực tiếp; chỉ MCP mới đủ mốc Session mới mở popup New/Join.** Recent Artifacts giới hạn **20 mục + Xem tất cả**; popup quản lý types dùng **Quick Pick native** ở vị trí Quick Input chuẩn của VS Code.

Quyết định mới nhất thay nhánh inspect bỏ qua v1: **create và inspect cùng trả lỗi khi caller truyền ID conversation v1**, trước mọi mutation/takeover/cấp token. Skill chỉ hướng dẫn user chọn migration conversation đó hoặc chủ động tạo Session mới và ngừng dùng ID cũ. Không giữ nhánh inspect thành công kèm cảnh báo v1.

Đã chốt lại thiết kế lưu trữ để tách đường ghi giữa MCP và Session Manager: **giữ nguyên `registered-artifacts/` làm nguồn membership duy nhất**, tách bố cục ba mảng (`working`, `references`, `archived`) sang file riêng **`layout.json`**, **bỏ lock layout/session** (dùng atomic write, chấp nhận bản lưu sau cùng thắng), và **`Session.updatedAt` hiển thị được tính từ thời điểm lớn nhất giữa `createdAt` và các `registeredAt`** (giữ hành vi MCP register/inspect cập nhật `registeredAt` để tự đẩy Session lên đầu; kéo thả hoặc sửa metadata không cập nhật `updatedAt`). Trình tự đợt này vẫn gồm **7 bước nhỏ** ở mục 13; không đổi phạm vi Phase 3–5 ngoài hướng dẫn xử lý lỗi v1 tối thiểu được làm ngay trong đợt này.

## Phase 1 — Model và API dữ liệu

## 1. Kết quả cần đạt

Chuyển nền conversation grouping thành một đối tượng Session tách biệt rõ trách nhiệm giữa metadata (`conversation.json`), membership (`registered-artifacts/`) và bố cục hiển thị (`layout.json`). Kết thúc phase, shared API lưu/đọc được session độc lập; create/inspect hiện tại dùng cùng model; các consumer hiện có vẫn hoạt động. Chưa xây sidebar hoặc Session Manager.

Quyết định đã thống nhất:

- Metadata Session lưu `title`, `instructions`, `typeId`, `createdAt`; membership giữ nguyên trong `registered-artifacts/<artifactId>.json`; bố cục ba mảng ID có thứ tự (`working`, `references`, `archived`) lưu riêng trong `layout.json`.
- Session type mặc định `conversation`; danh sách type global lưu riêng, hỗ trợ thêm/đổi tên/xoá. Session type độc lập với artifact kind/type và không điều khiển lifecycle.
- `instructions` là **một chuỗi Markdown**, nhãn UI dự kiến “Hướng dẫn”; thay tên Rules trong phân tích cũ.
- Tạo artifact chưa có session thì tự tạo session; có session thì reuse.
- Một artifact có thể thuộc nhiều session. New-session từ artifact vẫn dùng cùng artifact ID.
- Không thêm `order`, `zone`, `pinned` vào từng file `registered-artifacts/*.json`; ba mảng trong `layout.json` biểu diễn vùng và thứ tự.
- `Session.updatedAt` hiển thị được tính khi đọc từ thời điểm lớn nhất giữa `createdAt` và các `registeredAt` hiện có. MCP tạo/inspect artifact cập nhật `registeredAt` như hiện tại nên tự đẩy Session lên đầu; kéo thả (`layout.json`) hoặc sửa metadata (`title`, `instructions`, `typeId`) không làm thay đổi `updatedAt`.
- Bỏ lock cho layout/session; giữ atomic write cho từng file và chấp nhận quy tắc “bản lưu sau cùng thắng” khi nhiều cửa sổ cùng sửa bố cục/metadata.
- Giữ artifact schema v6, exact handles và cơ chế review/takeover hiện tại.

Luồng migration theo thao tác user ở mục 5 và thiết kế tách `registered-artifacts/` + `layout.json` đã được thống nhất trong chat; tài liệu này là **plan triển khai**, chưa phải thay đổi đã chạy.

## 2. Hiện trạng đã đối chiếu source

| Component | Hiện tại | Thay đổi cần thiết |
| --- | --- | --- |
| `src/shared/contracts.ts` | Conversation metadata schema v1 có ID, name, createdAt; membership riêng có registeredAt | Thêm Session metadata schema v2, schema `layout.json` (ba mảng) và DTO Session tổng hợp |
| `src/shared/conversation-artifact-registry.ts` | Create/register/list/remove; metadata và từng file membership; có helper ghi file atomic | Giữ nguyên logic `registered-artifacts/`; thêm đọc/ghi metadata v2, `layout.json`, tính `updatedAt`, migration theo yêu cầu và giữ Session rỗng |
| `src/integration/artifact-review-mcp-v4.ts` | Create/inspect tạo hoặc reuse conversation; inspect/rollback khôi phục membership file | Preflight chặn ID v1; create/inspect với v2 chỉ ghi `registered-artifacts/` và giữ nguyên cơ chế rollback membership hiện tại |
| `src/extension/conversation-artifact-service.ts` | Dựng drawer từ registry và manifest, theo dõi registry | Phục vụ Session v2 (gộp metadata + membership + layout) và phát hiện conversation v1 để migration; bỏ consumer drawer cũ |
| `src/extension/artifact-retention.ts` | Prune membership và xoá conversation rỗng | Prune `registered-artifacts/` (và dọn ID tương ứng khỏi `layout.json`), giữ Session v2 rỗng |
| `src/extension/workspace-integration.ts` | `readInstalledIntegrationVersion`, `getBaseIntegrationPaths`, `baseScriptIsCurrent`; kiểm tra tổng hợp còn xét cả skill/clients | Reuse phần MCP để có trạng thái dùng chung cho sidebar/provider; không dùng trạng thái tổng của client để chặn Sessions |
| `src/extension/artifact-review-provider.ts` | `ready` tự gọi `refreshConversations`; Connect chỉ copy prompt; HTML tải `review.js` | Thay drawer controller bằng Session service/actions, truyền gate và xử lý popup/migration |
| `src/webview/ReviewApp.tsx`, `vscode-api.ts`, `main.tsx` | State/DTO drawer cũ; một VS Code API instance chỉ typed theo review; entry chỉ render ReviewApp | Bỏ drawer cũ, thêm Sessions/Connect dialog; union message có kiểm tra riêng và discriminator để render SessionApp |
| `src/shared/artifact-connect-prompt.ts` | `buildArtifactConnectPrompt(directory)` chỉ xuất exact handle | Thêm mode New/Join tường minh; New yêu cầu skill bỏ ID đang giữ, Join chỉ định ID v2 |
| `package.json`, `test/release-contract.test.ts` | Chưa có Activity Bar/tree views; test so sánh toàn bộ `contributes.menus` bằng `toEqual` | Thêm contributions/commands cần thiết và cập nhật đúng assertions menu bị ảnh hưởng |

Đây không chỉ là thêm thuộc tính: cần nâng metadata lên v2, thêm `layout.json` cho bố cục ba vùng và sửa nhánh cleanup đang xoá group rỗng. Nhờ giữ nguyên `registered-artifacts/`, không cần xây lại cơ chế đăng ký/rollback membership của MCP hay artifact lifecycle.

Các điểm source cần lưu ý khi thực thi: `ensureSafeConversationDirectory()` tiếp tục kiểm tra thư mục con `registered-artifacts/` như hiện tại; `layout.json` là file tuỳ chọn cùng cấp với `conversation.json`. `discoverSearchableArtifacts()` trả toàn bộ artifact đã sort theo title, nên Recent phải sort lại theo updatedAt trước khi lấy giới hạn. Lấy implementation/tests làm căn cứ cho các chi tiết này, không sao chép mô tả cũ trong docs.

## 3. Contract dữ liệu đề xuất

```ts
// File: conversation.json (schema v2)
type WorkSessionMetadata = {
  schemaVersion: 2;
  sessionId: string;       // UUID, độc lập với artifact reviewSessionId
  title: string;
  typeId: string;          // tham chiếu session-types.json; mặc định "conversation"
  instructions: string;    // Markdown; mặc định ""
  createdAt: string;       // ISO datetime
};

// File: layout.json
type WorkSessionLayout = {
  schemaVersion: 1;
  working: string[];       // artifact IDs
  references: string[];
  archived: string[];
};

// Đối tượng tổng hợp trả về khi đọc Session (metadata + registered-artifacts + layout)
type WorkSession = WorkSessionMetadata & {
  working: string[];
  references: string[];
  archived: string[];
  updatedAt: string;       // ISO datetime = max(createdAt, ...registeredAt)
};
```

- `sessionId` giữ UUID conversation khi chuyển dữ liệu cũ. Không sửa `reviewSessionId` trong artifact.
- Dùng validation ID/title đang có; title không rỗng. Khi auto-create, fallback title artifact như behavior hiện tại; API tạo session rỗng nhận title rõ ràng.
- Khi tạo mới: `instructions = ""`, `typeId = "conversation"`, tạo thư mục `registered-artifacts/` rỗng; `layout.json` có thể chưa cần tạo hoặc khởi tạo ba mảng rỗng. API tạo rỗng phục vụ model; không có command/nút tạo session thủ công ở sidebar.
- **Quy tắc kết hợp `registered-artifacts/` và `layout.json`:**
  - `registered-artifacts/<artifactId>.json` là nguồn duy nhất quyết định artifact nào thuộc Session.
  - Khi đọc Session, các ID có trong `layout.json` nhưng không tồn tại trong `registered-artifacts/` sẽ bị loại bỏ khỏi kết quả.
  - Các artifact có trong `registered-artifacts/` nhưng chưa xuất hiện trong `layout.json` (ví dụ vừa được MCP thêm mới hoặc chưa có `layout.json`) mặc định được append vào cuối `working` theo thứ tự `registeredAt` tăng dần (tie-break bằng `artifactId`).
  - Một ID chỉ xuất hiện tối đa một lần trong tổng ba mảng của cùng Session. Session khác có thể chứa cùng ID.
- **Quy tắc ghi của MCP và Manager:**
  - MCP khi create/inspect chỉ tạo/cập nhật `registered-artifacts/<artifactId>.json` (giữ hành vi cập nhật `registeredAt` mới cả khi đăng ký lại/inspect lại). MCP không sửa `conversation.json` khi reuse và không đụng tới `layout.json`; do đó artifact đã được user xếp vào `references` hoặc `archived` trong `layout.json` vẫn giữ nguyên vùng và vị trí khi inspect lại.
  - Manager chỉ sửa `conversation.json` khi đổi `title`/`instructions`/`typeId`, sửa `layout.json` khi đổi vùng/thứ tự (chỉ ghi một lần sau khi thả thành công), và xoá file trong `registered-artifacts/` (kèm dọn `layout.json`) khi gỡ artifact.
- **Quy tắc `Session.updatedAt`:**
  - Tính động khi đọc: `updatedAt = max(createdAt, ...registeredAt của các membership hiện có)`.
  - Chỉ tăng khi tạo Session hoặc khi MCP thêm/inspect artifact (cập nhật `registeredAt`).
  - Kéo thả (`layout.json`), sửa `title`/`instructions`/`typeId`, đổi label type global hoặc gỡ artifact không ghi timestamp `updatedAt` riêng và không tự đẩy Session lên đầu.
  - Recent artifact vẫn dùng `artifact.updatedAt` riêng.
- Không sao chép title/type/description/directory của artifact vào ba mảng. Catalog dành cho Phase 4.
- Chưa thêm `isPinned`, trạng thái archive session, panel preference hoặc metadata cho tính năng hoãn.

### Storage: giữ `registered-artifacts/`, thêm `layout.json`, bỏ lock

Giữ đường dẫn vật lý hiện có trong Phase 1:

```text
~/.ai-artifacts/conversation-registry/<sessionId>/
  conversation.json              # WorkSessionMetadata schema v2
  registered-artifacts/          # nguồn membership (giữ nguyên schema v1 từng file)
    <artifactId>.json
  layout.json                    # bố cục ba mảng working / references / archived
```

Tên đường dẫn lịch sử được đóng gói trong shared path helpers; model/API mới dùng Session.
- **Tách biệt điểm ghi:** MCP chỉ ghi file con trong `registered-artifacts/`; Manager ghi `layout.json` khi sắp xếp và `conversation.json` khi sửa thông tin chung. Không còn xung đột giữa MCP thêm artifact và user kéo thả trên cùng một file.
- **Không dùng file lock cho layout và session:** dùng atomic write cho từng file và chấp nhận quy tắc “bản lưu sau cùng thắng” (last write wins), kết hợp watcher refresh các cửa sổ đang mở. Nếu `layout.json` thiếu hoặc chưa kịp lưu, membership trong `registered-artifacts/` vẫn bảo toàn đầy đủ danh sách artifact.

### Danh sách session types dùng chung

Lưu tại `~/.ai-artifacts/session-types.json`, tách khỏi registry session và artifact lifecycle:

```json
{
  "schemaVersion": 1,
  "types": [
    { "id": "conversation", "label": "Conversation" },
    { "id": "project", "label": "Project" },
    { "id": "feature", "label": "Feature" },
    { "id": "fix", "label": "Fix" }
  ]
}
```

- Khởi tạo bốn type trên khi file chưa tồn tại; không seed lại type user đã xoá mỗi lần mở. Type tồn tại độc lập dù chưa được session nào sử dụng.
- Custom type có ID ổn định do hệ thống sinh (đề xuất UUID); label do user nhập. Trim và kiểm tra tên không rỗng, không trùng sau khi trim/đối chiếu không phân biệt hoa thường. Đổi label không đổi ID.
- `conversation` là ID mặc định cố định, cho sửa label nhưng không xoá. Các type khác có thể xoá.
- Gán type chỉ chấp nhận ID hiện có. Reuse/inspect không reset type user đã chọn. Migration conversation v1 gán `conversation`.
- Xoá type chưa dùng: xoá entry. Xoá type đang dùng: UI hiển thị số session bị ảnh hưởng và xác nhận chuyển về type mặc định rồi xoá. Nếu label mặc định đã đổi, UI dùng label mới kèm ý nghĩa “mặc định”.
- API chuyển các session liên quan về `conversation` trước, chỉ xoá entry type sau khi chuyển thành công. Nếu một lần ghi thất bại, giữ entry type, báo kết quả chưa hoàn tất và cho thử lại; không tuyên bố giao dịch nhiều file là atomic. Các session đã chuyển vẫn hợp lệ.
- Giữ atomic-write cho từng file; không xây transaction framework hay hệ thống file lock phức tạp.
- Đây là user data; không đặt dưới `managed/`, không dọn theo artifact retention. File hỏng phải báo lỗi, không ghi đè bằng defaults.

## 4. Shared API và behavior

Tên API dưới đây là đề xuất mới, không mô tả hàm đã tồn tại:

| API | Trách nhiệm |
| --- | --- |
| `createSession` | Tạo session độc lập (`conversation.json` v2 + thư mục `registered-artifacts/`), có thể chưa chứa artifact |
| `readSession`, `listSessions` | Đọc một hoặc nhiều session (hợp nhất `conversation.json`, `registered-artifacts/` và `layout.json`), gồm cả session rỗng |
| `updateSessionDetails` | Sửa `title`/`instructions` trong `conversation.json`, không đụng membership/layout |
| `setSessionType` | Validate `typeId` trong danh sách global rồi cập nhật `conversation.json` |
| `listSessionTypes`, `createSessionType`, `renameSessionType` | Đọc/khởi tạo defaults; tạo type mới; đổi label giữ ID |
| `countSessionsByType`, `deleteSessionType` | Đếm ảnh hưởng để xác nhận; xoá theo quy tắc chuyển về mặc định ở trên |
| `registerArtifactInSession` | Ghi/cập nhật `registered-artifacts/<artifactId>.json` (cập nhật `registeredAt`); không sửa `conversation.json` hay `layout.json` |
| `moveArtifactInSession` | Đọc membership hiện có + `layout.json`, di chuyển ID đã thuộc session vào vùng/vị trí đích và lưu `layout.json` |
| `removeArtifactFromSession` | Xoá `registered-artifacts/<artifactId>.json` và bỏ ID khỏi `layout.json` nếu có; không xoá file artifact hoặc session rỗng |
| `listSessionsForArtifact` | Tìm các session v2 chứa `registered-artifacts/<artifactId>.json` |
| `listMigrationCandidates` | Phát hiện conversation v1 có thể chuyển, phục vụ đếm/sidebar và chọn từ artifact; không ghi dữ liệu |
| `migrateConversationToSession` | Chuyển một conversation v1 theo ID sang metadata v2; dùng chung cho Review App và bulk; đã v2 thì bỏ qua |

- Tái sử dụng validation đường dẫn và helper ghi file atomic hiện có; bỏ cơ chế file lock theo session/layout, chấp nhận quy tắc bản lưu sau cùng thắng.
- Read/list hợp nhất `registered-artifacts/` với `layout.json`: giữ nguyên thứ tự các ID hợp lệ trong `layout.json` và nối các membership mới vào cuối `working`. Các lỗi dữ liệu ở `conversation.json` hoặc `registered-artifacts/` tiếp tục được báo hoặc cô lập theo contract hiện tại; không tự biến dữ liệu hỏng thành session rỗng.
- API đọc/list Session chỉ trả v2; v1 được nhận diện riêng để migration, không coi v1 hợp lệ là dữ liệu hỏng và không tự chuyển khi đọc. Không duy trì UI/DTO drawer v1.
- Move là API dữ liệu ghi `layout.json` để Phase 3 dùng menu và Phase 5 dùng drag/drop (chỉ lưu một lần sau khi thả chuột thành công). Không làm drag/drop trong Phase 1.
- Không thêm public delete/archive/pin session trong phase này. Giữ helper rollback nội bộ cho session/membership vừa tạo thất bại.

### Tích hợp create/inspect và rollback

- Không có ID: tạo session v2 với title mặc định rồi đăng ký artifact vào `registered-artifacts/`; trả ID cho caller reuse.
- Có ID Session v2 hợp lệ: ghi/cập nhật `registered-artifacts/<artifactId>.json`, không đổi `title`/`instructions`/`typeId` trong `conversation.json`, không sửa `layout.json` và không tạo thêm session.
- **Có ID conversation v1 — create và inspect cùng một luồng lỗi:** nhận diện version tại metadata path đã validate, trả error result với code dự kiến `CONVERSATION_MIGRATION_REQUIRED`, kèm ID cũ và hướng dẫn hai lựa chọn dưới đây. Đây là contract sẽ triển khai, chưa có trong runtime hiện tại. Error code là trường riêng, không dùng làm giá trị ID.
- Lỗi v1 phải trả trước khi create tạo artifact/session hoặc inspect takeover waiter, cấp round token, ghi connection/membership. Không trả inspect thành công kèm feedback/token và cảnh báo v1. Không tự migration/tạo Session thay thế.
- Điều kiện lỗi là **caller truyền ID v1**, không phải artifact mục tiêu từng thuộc conversation v1. ID truyền vào là nhóm chat muốn dùng để đăng ký artifact; artifact đang inspect có thể chưa thuộc nhóm đó. Không truyền ID thì create/inspect vẫn tạo Session v2 mới theo contract hiện tại, không quét grouping v1 để tìm conversation cũ.
- Với ID v2 hoặc không có ID, inspect/takeover/reconnect và review/token tiếp tục theo contract artifact hiện tại. Wait/advance vẫn dùng exact artifact handle; không thêm bước migration vào các tool này.
- ID không tồn tại hoặc dữ liệu hỏng: trả lỗi; không âm thầm chọn phiên mới nhất.
- Inspect artifact vào session mới giữ membership cũ ở các session khác; inspect vào session đã có chỉ cập nhật `registeredAt` trong `registered-artifacts/<artifactId>.json` (để đẩy `Session.updatedAt` lên đầu) mà không sửa `layout.json`, nên không đưa artifact từ References/Archived về Working.
- Chỉ takeover artifact mục tiêu theo behavior hiện tại; không takeover cả session.
- **Giữ nguyên logic rollback membership hiện tại:** vì `registered-artifacts/<artifactId>.json` được giữ nguyên, khi inspect/create cần rollback thì nếu membership vừa tạo mới sẽ xoá file membership đó, còn nếu membership đã có trước thì khôi phục `previousMembershipRegisteredAt` như code hiện có. Request truyền ID v1 đã trả lỗi trước mutation nên không phát sinh ghi/rollback.
- Rollback create chỉ dọn session/artifact mới thuộc lần tạo thất bại theo cơ chế hiện tại; không xoá session reuse.

### Skill xử lý lỗi ID conversation v1

- Khi nhận `CONVERSATION_MIGRATION_REQUIRED` từ create hoặc inspect, AI dừng request lỗi và báo user đúng hai lựa chọn; không tự retry cùng ID, không tự bỏ ID hoặc chọn Session khác.
- **1. Giữ conversation cũ:** user mở một artifact đã thuộc conversation có ID đó trong Review App và dùng migration để chuyển conversation sang v2. Sau khi chuyển thành công, retry request với cùng ID. Không mặc định artifact đang inspect đã thuộc conversation cũ.
- **2. Dùng Session mới:** sau khi user chọn, bỏ ID v1 khỏi active context của chat và retry create/inspect không truyền ID để tạo Session v2. Giữ ID mới trả về cho các lần tiếp theo, mở Session mới qua UI điều hướng. Với inspect, giữ exact artifact handle, không clone artifact. Không tự nhập membership cũ hoặc xoá dữ liệu conversation v1; “bỏ conversation cũ” ở đây là ngừng dùng ID cũ trong chat.
- Hướng dẫn lỗi chung này nằm ngay trong patch MCP/skill Phase 1+2; đồng bộ SKILL.md, reference contract và test tương ứng, tăng numeric SKILL_VERSION khi triển khai thay đổi skill. Bước chuẩn bị hiện tại mới bump MCP lên 12, skill vẫn là 3.

**Ranh giới với Phase 4:** giữ tên tham số MCP `artifactConversationId`/`conversationName` như adapter tạm sang `sessionId`/`title`. Không duy trì hai model dữ liệu. Hướng dẫn lỗi v1 và popup inspect New/Join tối thiểu ở mục 12 làm cùng Phase 1+2 theo yêu cầu tiếp nối; Phase 4 mới đổi vocabulary rộng hơn và bổ sung instructions/catalog, trải nghiệm new/join đầy đủ. Đây là bước triển khai nội bộ, không tuyên bố đã hoàn thành breaking release.

Bỏ drawer Conversation Artifacts trong đợt này; nút được thay bằng Sessions hoặc hành động migration theo trạng thái ở mục 12. Bỏ các DTO cũ chỉ phục vụ drawer (`ConversationArtifactsViewState`, `ConversationArtifactGroup`, `ConversationArtifactItem`); giữ nguyên schema/helper `registered-artifacts/` vì đó vẫn là nguồn membership chính thức của Session v2.

## 5. Conversation cũ — migration theo yêu cầu và bulk

Chuyển **v1 → v2 tại chỗ** theo từng conversation. Migration là hành động user chủ động: nút tại Review App hoặc xác nhận bulk từ Sessions. Hàm chuyển một conversation độc lập với UI và được dùng chung ở cả hai luồng. Không có migration artifact lifecycle.

### Điều kiện MCP và phát hiện dữ liệu

- Dùng cơ chế kiểm tra MCP đã cài trên đĩa hiện có; không thêm handshake, heartbeat hoặc kiểm tra process MCP đang chạy. Chốt mốc numeric MCP_VERSION **12** cho logic Session mới; bản 11 trở xuống là nhánh chưa cập nhật. Source đã được bump lên 12 ở bước chuẩn bị, nhưng Session v2 và UI gate chỉ có sau khi triển khai plan; không nhầm version marker với feature đã chạy.
- MCP chưa đủ version, thiếu hoặc không xác minh được: chặn phần Sessions và migration; Sessions disabled với tooltip yêu cầu cập nhật. Recent Artifacts, Connect và review lifecycle vẫn hoạt động.
- MCP đã đủ version: enable phần Sessions, gồm quản lý types và phát hiện migration. Sidebar chỉ load Session v2; conversation v1 chỉ đóng góp vào thông báo migration, không hiện như Session đã dùng được.
- Phát hiện/đếm v1 là read-only. Activation, sidebar refresh, read/list, mở artifact và retention không tự chuyển dữ liệu. Dữ liệu hỏng được báo riêng, không cộng như candidate hợp lệ hoặc âm thầm chuyển thiếu membership.
- Cùng điều kiện MCP được kiểm tra tại handler migration/mở Session và quản lý types, không chỉ ở UI. Sau installer cập nhật file, kiểm tra lại và refresh hai nơi dùng trạng thái này.

### Chuyển một conversation

1. Nếu metadata đã là v2 hợp lệ: dùng trực tiếp, bỏ qua bước chuyển.
2. Nếu là v1: validate metadata và các file trong `registered-artifacts/` theo cơ chế hiện có; giữ nguyên `sessionId = artifactConversationId`, `title = conversationName`, `createdAt` và giữ nguyên toàn bộ thư mục `registered-artifacts/` làm nguồn membership cho v2.
3. Tạo metadata `conversation.json` schema v2 với `instructions: ""` và `typeId: "conversation"`. Khởi tạo `layout.json` với `working` chứa các artifact ID đã sắp xếp theo `registeredAt` tăng dần (tie-break bằng `artifactId`), `references: []`, `archived: []`. `Session.updatedAt` khi đọc sẽ tự động lấy thời điểm lớn nhất giữa `createdAt` và các `registeredAt` hiện có, không lấy thời điểm chạy migration làm mọi phiên thành Recent.
4. Lưu bản gốc metadata v1 (`conversation.v1.backup.json`) trước khi atomic replace `conversation.json` bằng v2.
5. Chỉ công nhận migration khi `conversation.json` v2 commit thành công. Đường ghi metadata migration dùng staging + rename, không dùng fallback copy đè lên nguồn v1 trong `writeAtomicJsonFile()` hiện tại. Nếu Windows chặn replace sau retry hữu hạn, trả lỗi và giữ v1/backup để thử lại; không đổi fallback của artifact lifecycle. Dữ liệu không hợp lệ được báo rõ; không chuyển conversation có membership hỏng.

### Bulk từ Sessions

- Khi MCP đã đủ version và có N candidate, phần Sessions hiện dòng hành động **“Có N conversation có thể chuyển sang Sessions”**. N = 0 thì không hiện dòng migration. Đếm conversation, không đếm artifact hoặc nhân đôi conversation có nhiều artifact.
- Click dòng này mở popup: **“Có N conversation có thể chuyển sang Sessions để sử dụng.”** với hành động **“Chuyển tất cả”** và **“Huỷ”**. Mở popup hoặc huỷ không ghi dữ liệu.
- Chỉ sau khi user chọn Chuyển tất cả mới chạy batch candidate đã xác nhận, tuần tự gọi hàm chuyển một conversation. Hiện tiến độ; kiểm tra lại schema trước khi chuyển, mục đã v2 thì bỏ qua.
- Một conversation lỗi: giữ nguồn của mục đó, ghi nhận lỗi và tiếp tục các mục còn lại. Các mục đã thành công được giữ; không xây transaction hoặc rollback cho toàn batch.
- Kết thúc báo số đã chuyển/bỏ qua/thất bại; refresh Sessions, số candidate còn lại và trạng thái Sessions ở các Review App đang mở. Có thể bấm lại để thử các mục còn v1; không tự retry hoặc chạy bulk nền.

Phương án này giữ grouping và artifact ID, nhưng **không hỗ trợ runtime cũ tiếp tục ghi registry sau nâng cấp**. Numeric MCP_VERSION đã tăng 11 → 12 theo yêu cầu để chuẩn bị test; dùng luồng reinstall/restart hiện có khi Chú thử runtime mới. Không tự nâng package SemVer, cài lại integration hoặc thêm cơ chế đồng bộ hai phiên bản runtime trong bước chuẩn bị này.

## 6. Cleanup và session rỗng

- Session v2 rỗng là hợp lệ, giữ `conversation.json` (`title`/`instructions`/`typeId`) khi gỡ artifact cuối hoặc artifact cuối hết retention.
- Cleanup bỏ các file membership stale trong `registered-artifacts/` theo validation hiện có và đồng bộ xoá các ID không còn membership khỏi `layout.json` (nếu có file `layout.json`). Không xoá `conversation.json` hay thư mục Session v2 chỉ vì không còn membership.
- Retention artifact vẫn theo `artifact.json.updatedAt`. References/Archived không cấp miễn retention.
- Cleanup nhận diện schema của `conversation.json` trước khi xử lý, không gọi migration. V1 giữ nguyên nhánh cleanup conversation hiện có (xoá cả conversation rỗng); v2 chỉ xoá membership stale và giữ session rỗng.
- Sidebar sau này xử lý độ dài danh sách bằng ghim/recent/archive; không dùng cleanup tự xoá session để giải quyết UI.

## 7. Các patch trong Phase 1

| Patch | Component / file dự kiến | Nội dung |
| --- | --- | --- |
| 1A | `src/shared/contracts.ts`, `src/shared/artifact-files.ts` | Schema Session metadata v2, schema `layout.json`, giữ membership schema; path helpers cho `layout.json` và backup v1; phân biệt `sessionId` và `reviewSessionId` |
| 1B | `src/shared/conversation-artifact-registry.ts` hoặc module Session thay thế; `test/conversation-artifact-registry.test.ts` | Giữ logic `registered-artifacts/`; thêm đọc/ghi metadata v2 + `layout.json`, tính `updatedAt` từ `createdAt`/`registeredAt`, phát hiện v1, hàm migration đơn lẻ dùng chung và giữ session v2 rỗng |
| 1C | `src/integration/artifact-review-mcp-v4.ts`, `skills/create-review-artifact/SKILL.md` và reference contract; tests MCP/skill, version counters liên quan | Nối create/inspect/rollback với Session v2 (ghi `registered-artifacts/` như cũ); adapter tên MCP cũ; cùng lỗi ID v1 trước mutation và skill hướng dẫn hai lựa chọn; tăng skill version khi triển khai |
| 1D | `src/extension/conversation-artifact-service.ts`, `src/extension/artifact-retention.ts`; provider và shared DTO liên quan | Đọc Session v2, phát hiện membership v1 cho migration; cleanup theo schema, không auto-migrate; bỏ DTO drawer cũ |
| 1E | **Mới dự kiến:** `src/shared/session-type-registry.ts`, test tương ứng; contracts/path helpers ở 1A | Defaults, list/create/rename/delete types, gán type cho session, lưu và cập nhật tham chiếu |

Các patch là các bước review của cùng Phase 1; không phát hành trạng thái producer/consumer dùng schema lệch nhau. Thay đổi canonical docs/skill contract được xác định theo diff thực tế và xin Chú cập nhật theo quy định repo; yêu cầu lập plan này chỉ ghi tài liệu trong thư mục plans.

## 8. Kiểm chứng và nghiệm thu

Test trọng tâm:

- Create session rỗng; lưu/đọc title/instructions và tính `updatedAt` đúng từ `createdAt` và `registeredAt`.
- Type mặc định khi auto-create/migrate; reuse giữ type; custom type dùng chung giữa các session và còn sau reload. Rename giữ ID, tên trùng/rỗng bị từ chối.
- Không xoá được type mặc định; xoá type khác chuyển session về mặc định sau xác nhận. Lỗi ghi không xoá entry type khi còn việc chuyển dở.
- Auto-create/reuse qua MCP ghi `registered-artifacts/`; register/inspect lại cập nhật `registeredAt` (đẩy `Session.updatedAt` lên đầu) nhưng không nhân đôi và không đổi vùng hay thứ tự đã lưu trong `layout.json`.
- Move/reorder giữa ba mảng lưu vào `layout.json`, kể cả vùng rỗng; artifact mới chưa có trong `layout.json` tự nằm cuối `working`; remove xoá membership và dọn `layout.json`, artifact ở session khác giữ nguyên; kéo thả hoặc sửa metadata không đổi `Session.updatedAt`.
- Inspect new/reuse và rollback: giữ nguyên khôi phục `registeredAt` của membership có trước hoặc xoá membership mới tạo khi lỗi, không clone artifact hoặc đổi lifecycle ngoài hành vi review hiện tại.
- Migration v1 giữ ID/title/membership/thứ tự và `updatedAt` tính từ `createdAt`/`registeredAt`; chạy lại không ghi đè v2 đã sửa; Windows chặn replace thì giữ nguồn v1/backup, không fallback copy đè metadata.
- Cleanup ID stale trong `registered-artifacts/` và `layout.json`; gỡ artifact cuối vẫn giữ session v2/instructions.
- List/đếm/cleanup không tự migration; v1 hợp lệ không bị báo như registry hỏng. Create và inspect có ID v1 cùng trả mã lỗi đã nêu trước artifact/session creation, takeover, cấp token hoặc ghi connection/membership. ID v2/không có ID vẫn theo contract Session mới; wait/advance không bị thêm điều kiện migration.
- Skill nhận lỗi v1 chỉ đưa hai lựa chọn; migration xong retry cùng ID hoặc user chọn Session mới thì retry không có ID và giữ ID mới. Không tự retry, tự chuyển nhóm, clone artifact hoặc xoá conversation cũ.
- Service trả Session v2 và candidate v1 đúng chức năng; watcher nhận thay đổi metadata/membership/layout.

Dùng test registry/service/retention/MCP hiện có và bổ sung case trực tiếp cho contract mới. Chạy focused tests khi sửa, sau đó các lệnh repo:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Kiểm tra Extension Host với runtime được build cùng phiên bản: tạo hai artifact reuse một session; mở Sessions; inspect cùng artifact vào session mới; reload đọc lại membership. Migration đơn lẻ/bulk thử trên fixture/userHome tạm, không thử phá dữ liệu thật. Báo riêng phần automated và phần runtime chưa kiểm chứng.

**Hoàn thành khi:** dữ liệu Session lưu/đọc độc lập; create/reuse và consumer hiện tại chạy trên cùng model; migration theo phương án được duyệt; session rỗng được giữ; các kiểm chứng liên quan có kết quả rõ ràng. Không yêu cầu hoàn thiện UI hoặc catalog để nghiệm thu Phase 1.

## 9. Ngoài phạm vi

Riêng Phase 1 chưa có sidebar/manager UI (sidebar được triển khai tiếp ở Phase 2 trong cùng file). Pin/archive/delete **session**; style, shadcn, icons; cài dnd-kit; agent catalog/description/artifact type; đổi toàn bộ MCP vocabulary; workflow/next-action; ownership hardening; sửa retention policy; release/publish vẫn ngoài phạm vi đợt này. CRUD **session types** thuộc phạm vi, không nhầm với CRUD/xoá session.

## Phase 2 — Sidebar, quản lý session types và điều hướng

## 10. Kết quả và layout

Activity Bar có mục AI Artifacts, mở sidebar gồm hai section:

**Icon và label mới nhất đã chốt:** dùng Codicon `library` có sẵn qua `icon: "$(library)"`, thay icon `layers` đã làm trong Chặng 3. Label/tiêu đề container là **AI Artifacts**, không thêm Manager/Management. Hai section giữ tên **Recent Artifacts** và **Sessions**. Không cần SVG riêng hoặc thư viện icon runtime cho lựa chọn này.

```text
AI ARTIFACTS

RECENT ARTIFACTS
  Artifact A
  Artifact B

SESSIONS                            ⚙
  Có N conversation có thể chuyển sang Sessions
  Session A              Conversation
  Session B              Feature
```

- **Không có + session**, command tạo session thủ công hoặc empty-state kêu user tạo session. Session được tạo qua luồng artifact/new-session; mở sidebar/item không tạo dữ liệu session.
- ⚙ nằm ở góc phải header **Sessions**; tooltip “Quản lý loại phiên”. Không đặt ở header Recent Artifacts, header chung hoặc cạnh edit Type trong manager.
- Recent Artifacts hiển thị title, kind và thời điểm cập nhật trong description/tooltip; sắp xếp artifact.updatedAt giảm dần. Sessions hiển thị title, type label, số artifact và updatedAt trong description/tooltip, sắp xếp session.updatedAt giảm dần. Dùng ID làm tie-break ổn định.
- Hai danh sách lấy dữ liệu global như storage hiện tại, không lọc theo workspace. Session rỗng vẫn hiện.
- Sessions chỉ hiển thị dữ liệu v2 và chỉ enable khi MCP đã cài đủ version. Khi chưa đủ, hiện hướng dẫn cập nhật; Recent Artifacts vẫn dùng được. Khi có candidate v1 và đủ MCP, hiện dòng phát hiện migration; click mở popup bulk theo mục 5. Không hiển thị từng conversation v1 như item Session.
- **Đã chốt:** Recent Artifacts giới hạn 20 mục và có dòng “Xem tất cả…” gọi search artifact hiện tại. Sessions hiển thị toàn bộ bản đầu; chưa thêm phân trang hoặc setting giới hạn.
- Loading/empty/error có nội dung riêng. Không hiển thị lỗi đọc registry thành “chưa có session”.
- **Bổ sung trong Chặng 3:** Recent Artifacts và Sessions mặc định bung lần đầu trong workspace (`visibility: "visible"`); sau đó VS Code giữ trạng thái người dùng đã chọn. Không tự mở sidebar AI Artifacts khi extension khởi động.
- Pin/group ghim, Archive session và filter/search session nâng cao chưa được chốt cho đợt này. Không tự đưa vào tiêu chí nghiệm thu.

### Lựa chọn kỹ thuật đề xuất

Dùng **hai Tree View native** trong một Activity Bar view container; action ⚙ qua menu `view/title` chỉ hiện trên view Sessions. TreeDataProvider phù hợp danh sách sidebar, không cần thêm React webview cho sidebar hoặc UI library.

**Đã chốt:** popup quản lý types dùng **Quick Pick native** (`createQuickPick`), InputBox cho tên và xác nhận khi xoá type đang dùng. Popup mở ở vị trí Quick Input chuẩn của VS Code, không phải popover neo cạnh nút ⚙. Style chi tiết vẫn để sau.

Nguồn API: [Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view), [Quick Picks](https://code.visualstudio.com/api/ux-guidelines/quick-picks). Repo đã có `artifact-search-command.ts` làm pattern Quick Pick; typings VS Code có item buttons và các sự kiện xử lý chúng.

## 11. Popup quản lý session types

- Title “Quản lý loại phiên”; phần mô tả ghi rõ **“Áp dụng cho tất cả phiên làm việc”**.
- List các type từ file global, có ô tìm tên. Mỗi dòng có label, số session đang dùng và nút sửa/xoá; type mặc định có nhãn “Mặc định”, không có nút xoá.
- Nút thêm trong popup là **thêm type**, không phải tạo session. Nhập tên → gọi API Phase 1 → cập nhật danh sách. Tạo type trong popup không tự đổi type của session nào.
- Sửa label bằng InputBox, giữ ID; user huỷ thì không ghi. Sau lưu, sidebar và tab session đang mở cùng nhận label mới.
- Xoá type chưa dùng thực hiện trực tiếp; type đang dùng hiện số session và hành động “Chuyển về [type mặc định] và xoá”. Huỷ không thay đổi dữ liệu; lỗi ghi hiện rõ và refresh theo trạng thái thực.
- Nếu count đã thay đổi lúc xác nhận, service đọc lại trạng thái trước khi mutation; không dùng dữ liệu count cũ làm danh sách session cần sửa.
- Sau thao tác quay về/refresh popup; Esc đóng, giải phóng listeners. Không cần trang Settings riêng.

**Phase 3 giữ phần chọn type trong manager:** Type nằm trên Hướng dẫn; nút ✎ mở select/search “Tìm hoặc tạo loại…”. Enter hành động “Tạo loại ‘…’” tạo type rồi gán cho session hiện tại. Không có nút ⚙ thứ hai ở manager. UI này chưa làm trong Phase 2; service types dùng chung đã sẵn.

## 12. Mở artifact và session

### Recent Artifacts

- Tái sử dụng `discoverSearchableArtifacts` trong `src/extension/artifact-search.ts`; dữ liệu đã có artifactId/title/kind/updatedAt. Không tạo một registry recents mới, không thêm lastOpenedAt.
- Click item dùng opener/validation đang có (`artifact-review-open.ts`), mở đúng artifact trong window hiện tại; không inspect/takeover, không sửa connection hoặc artifact.updatedAt.
- Artifact đã bị xoá: báo không còn tồn tại và refresh list, không tạo lại hoặc chọn item khác.

### Sessions và nút Sessions trên artifact

- Click session truyền sessionId đã chọn vào một command mở session. Validate lại registry trước khi mở; không suy ra từ newest hoặc title.
- Bỏ hẳn drawer Conversation Artifacts. Trong Review App, MCP đã cài chưa đủ version thì nút Sessions disabled; tooltip **“Sessions yêu cầu MCP server phiên bản 12 trở lên. Vui lòng cập nhật integration.”** Mốc 12 được chốt ở mục 5.
- MCP đã đủ version: membership v2 mở bằng **Sessions**; membership v1 có hành động **“Migrate to Session”**, cho phép user chuyển conversation đó rồi mở tab Session. Không chỉ disable nút khi còn v1 và không tự migration lúc mở Review App.
- Chỉ một conversation/session liên quan thì xử lý trực tiếp theo schema; nhiều thì Quick Pick chọn đúng ID và thể hiện mục nào mở Session v2, mục nào chuyển v1. Mỗi hành động migration tại Review App chỉ chuyển một conversation; nếu không có membership thì báo chưa thuộc session, không tự tạo.
- Sau migration thành công refresh sidebar và trạng thái nút, mở tab Session cùng ID. Nếu thất bại báo lỗi, không mở như thể đã chuyển thành công. Các thao tác mở Session v2 không làm thay đổi lifecycle artifact.
- Connect dùng giao diện mới bình thường, không bị chặn theo điều kiện Sessions; Review/Proceed/Just save vẫn hoạt động với artifact schema v6.
- Bổ sung popup inspect New/Join tối thiểu dưới đây trong đợt Phase 1+2; chỉ cập nhật Connect/prompt để biểu diễn lựa chọn ID, chưa thêm agent catalog/instructions hoặc đổi vocabulary MCP rộng hơn. Nhãn nút điều hướng đã chốt là **Sessions**; tên model/module WorkSession không đổi theo nhãn UI.

### Popup inspect: New Session / Join Session

- Popup cho user chọn inspect vào Session mới hoặc join Session liên quan. Đây là phần UI được lấy sớm vào đợt này theo yêu cầu Chú; extension chuẩn bị/copy prompt cho AI, không trực tiếp gọi MCP inspect hoặc ghi membership.
- Phát hiện conversation đích là v1: **disable Join**, tooltip giải thích phải migration conversation sang Session trước khi join; chỉ cho chọn inspect vào Session mới. Không âm thầm migration hoặc đưa ID v1 vào prompt Join.
- Nếu có nhiều membership, chỉ các lựa chọn join v1 bị disable; Session v2 hợp lệ vẫn có thể join. Không coi artifact có một membership v1 là lý do chặn join các Session v2 khác.
- Chọn New Session: prompt yêu cầu inspect exact artifact handle, không truyền ID conversation/session cũ. Chọn Join Session v2: prompt chỉ định exact ID v2 đã chọn; không lấy newest hoặc đoán theo title.
- **MCP cũ giữ nguyên luồng Connect:** click copy prompt exact artifact handle trực tiếp, không mở popup New/Join và không đưa yêu cầu New Session/Join Session vào prompt legacy. Chỉ khi MCP đã cài đủ mốc Session mới dùng popup và luồng New/Join nói trên; runtime cũ không được coi là đã có Session v2.
- Sau migration thành công, refresh popup/trạng thái lựa chọn; user có thể Join bằng cùng ID nay đã là v2. Nhánh lỗi MCP cho caller truyền ID v1 vẫn giữ để xử lý các lời gọi trực tiếp ngoài popup.

### Tab session tối thiểu — phụ thuộc lấy sớm từ Phase 3

Để Phase 1+2 chạy độc lập, cần điểm đến thật khi click session. Tạo **custom editor Session dạng chỉ đọc ở đợt này**, dùng cùng sessionId/URI/provider để Phase 3 mở rộng tiếp:

- Hiện title, type label, instructions và danh sách liên kết artifact chia Working/References/Archived theo thứ tự mảng. Có empty/error state; mở lại cùng session thì dùng lại tab.
- Artifact title/kind lấy từ manifest qua service hiện có; chưa dựng agent catalog hoặc description preview.
- Chưa có edit title/instructions/type, panel toggle, header Pin/Connect/More, cards hay kéo thả. Phase 3 bổ sung những phần này trên cùng editor, không tạo tab quản lý thứ hai.
- Mở bằng command `vscode.openWith` và viewType riêng (tên đề xuất `agentPlus.workSession`), URI metadata canonical của session. Không đăng ký chiếm mọi file `*.json`; provider kiểm tra đúng registry path/schema/ID.
- Provider kiểm soát đọc dữ liệu; webview chỉ nhận DTO và gửi yêu cầu mở artifact. Kiểm tra artifact thuộc session đang mở trước khi xử lý message; không nhận tuỳ ý đường dẫn từ webview.
- Theo dõi session/types/artifact thay đổi và refresh nội dung tab. Không cung cấp chỉnh raw JSON để thay manager.

Đề xuất dùng custom readonly editor để đọc filesystem qua service, không tạo document JSON có unsaved buffer cạnh tranh với registry writer. Phase 3 vẫn ghi qua registry API và nhận snapshot mới. Đây là lựa chọn kỹ thuật mới, không phải mô tả provider đã có.

## 13. Component và thứ tự thực hiện Phase 2

Tên file/command mới dưới đây là đề xuất, cần điều chỉnh theo convention khi triển khai; không phải API có sẵn.

| Patch | File/component | Công việc |
| --- | --- | --- |
| 2A — contributions | `package.json`, `src/extension/extension.ts`, icon Activity Bar dưới `media/` | View container + hai view; register provider/commands; menu ⚙ chỉ trên Sessions; không contribute + session |
| 2B — data và tree | **Mới:** `src/extension/work-session-sidebar.ts`; reuse search/service/registry và kiểm tra MCP đã cài | Hai TreeDataProvider, Session chỉ v2, gate theo MCP, dòng candidate N và popup bulk; gọi migration đơn lẻ tuần tự, tiến độ/kết quả/refresh; Recent cap + Xem tất cả |
| 2C — type manager | **Mới:** `src/extension/session-type-command.ts`; type registry Phase 1 | Quick Pick/InputBox, thêm/đổi tên/xoá, xác nhận và kết quả lỗi |
| 2D — session tab | **Mới:** `src/extension/work-session-provider.ts`, `src/webview/SessionApp.tsx`; `src/shared/contracts.ts`, `src/webview/main.tsx` | Provider chỉ đọc, DTO/messages riêng, render session + artifact links |
| 2E — artifact navigation | `src/webview/ReviewApp.tsx`, `src/extension/artifact-review-provider.ts`, `src/shared/artifact-connect-prompt.ts`, shared message schema | Bỏ drawer cũ; Sessions gated theo MCP, migration v1 đơn lẻ, chọn ID khi nhiều membership và mở tab; popup inspect New/Join tối thiểu, disable Join v1 |
| 2F — tests | Test mới cho sidebar/type command/session provider; test search/service/provider bị ảnh hưởng | Các luồng dữ liệu, routing và regression bên dưới |

**Webview build:** `main.tsx` hiện render ReviewApp và Vite chỉ có một entry `review.js`. Đề xuất thêm discriminator do provider gắn vào root để render ReviewApp hoặc SessionApp; reuse bundle/style/CSP hiện có, không cần đổi pipeline sang multi-entry chỉ để làm tab tối thiểu. Tách DTO session khỏi review state; tab session không khởi tạo review/comment handlers.

**Refresh:** reuse registry watcher/service hiện có; bổ sung watch `session-types.json` và manifest create/update/delete cho Recent. Debounce theo pattern hiện tại; refresh lần đầu và khi view hiện lại. Sau installer kiểm tra lại MCP đã cài; sau migration refresh Session list/candidate count/Review App. Phát hiện v1 không đồng nghĩa chạy migration. Dispose subscriptions cùng extension/provider. Không polling hay thêm daemon.

### 7 bước nhỏ trong đợt Phase 1+2 (Tổ chức theo 3 Chặng triển khai)

Thực hiện theo thỏa thuận gộp bước:
- **Chặng 1 (ĐÃ HOÀN THÀNH):** Bước 1 + 2 + 3 (Nền dữ liệu Session v2, Session types global, Migration v1→v2 và Cleanup retention, Tích hợp MCP & Skill contract).
- **Chặng 2 (ĐÃ HOÀN THÀNH):** Bước 4 + 5 (Sidebar Activity Bar, Quick Pick quản lý types, Custom readonly Editor cho Session tab).
- **Chặng 3 (ĐÃ HOÀN THÀNH):** Bước 6 + 7 (Thay drawer bằng nút Sessions, Connect dialog New/Join, Bulk migration UI, Kiểm chứng kết hợp và nghiệm thu).

| Bước / Chặng | Trạng thái | Công việc và kết quả |
| --- | --- | --- |
| **Chặng 1: Bước 1** (Model/persistence Session & types) | ✅ **Đã hoàn thành** | Metadata Session v2; giữ `registered-artifacts/` làm nguồn membership; `layout.json` chứa ba mảng; tính dynamic `updatedAt`; registry session-types global. |
| **Chặng 1: Bước 2** (Migration v1→v2 & Cleanup) | ✅ **Đã hoàn thành** | `listMigrationCandidates` và `migrateConversationToSession` có backup `conversation.v1.backup.json`; retention cleanup giữ Session v2 rỗng. |
| **Chặng 1: Bước 3** (Tích hợp MCP & Skill) | ✅ **Đã hoàn thành** | MCP tạo/reuse Session v2; preflight fail-closed chặn conversation v1 với mã lỗi `CONVERSATION_MIGRATION_REQUIRED`; skill v4 hỗ trợ 2 hướng recovery. |
| **Chặng 2: Bước 4** (Sidebar & popup types) | ✅ **Đã hoàn thành** | Activity Bar, Recent Artifacts (cap 20 + Xem tất cả), Sessions chỉ v2; gate MCP 12; Quick Pick ⚙ quản lý types. |
| **Chặng 2: Bước 5** (Tab Session chỉ đọc) | ✅ **Đã hoàn thành** | Provider/webview mở đúng Session ID qua `agentPlus.workSession`, hiện title/type/instructions và 3 vùng; mở artifact; refresh. |
| **Chặng 3: Bước 6** (Review App & Migration UI) | ✅ **Đã hoàn thành** | Bỏ drawer cũ; nút Sessions trên Review App; popup inspect New/Join (disable Join v1); popup bulk migration từ sidebar. |
| **Chặng 3: Bước 7** (Kiểm chứng & Nghiệm thu) | ✅ **Đã hoàn thành** | Hoàn tất regression tests; chạy check/test/build; kiểm tra Extension Host; báo cáo nghiệm thu. |

---

### Chặng 1: Bước 1 + 2 + 3 — Headless Data Layer, Migration & MCP Contract (ĐÃ HOÀN THÀNH)

> [!NOTE]
> - **Trạng thái:** ✅ **Đã hoàn thành** (Review Checkpoint 1 sẵn sàng)
> - **Các file đã can thiệp & tạo mới:**
>   - [`src/shared/contracts.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts): Định nghĩa `WORK_SESSION_SCHEMA_VERSION = 2`, `WORK_SESSION_LAYOUT_SCHEMA_VERSION = 1`, `SESSION_TYPES_SCHEMA_VERSION = 1`, `DEFAULT_SESSION_TYPE_ID = "conversation"`, tăng `SKILL_VERSION = 4`. Thêm Zod schemas: `workSessionMetadataSchema`, `workSessionLayoutSchema`, `workSessionSchema`, `sessionTypeSchema`, `sessionTypesDocumentSchema`, error class `ConversationMigrationRequiredError`.
>   - [`src/shared/artifact-files.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/artifact-files.ts): Constants `WORK_SESSION_LAYOUT_FILE`, `CONVERSATION_V1_BACKUP_FILE`, `SESSION_TYPES_FILE`. Bổ sung path helpers: `workSessionLayoutPath`, `conversationV1BackupPath`, `sessionTypesFilePath`.
>   - [`src/shared/session-type-registry.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/session-type-registry.ts) *(mới)*: Seed defaults 4 types (`conversation`, `project`, `feature`, `fix`), CRUD types global với case-insensitive uniqueness, cấm xoá type default, tự động chuyển session về `DEFAULT_SESSION_TYPE_ID` khi xoá custom type.
>   - [`src/shared/conversation-artifact-registry.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/conversation-artifact-registry.ts): Parser metadata v2/layout; hàm `reconcileSessionLayout` (kết hợp `registered-artifacts/` với `layout.json`, unplaced append cuối `working`, tính `updatedAt = max(createdAt, ...registeredAt)`); CRUD Session v2; `migrateConversationToSession` sinh backup `conversation.v1.backup.json` và chuyển đổi an toàn; retention cleanup theo schema (v2 giữ thư mục/metadata dù rỗng).
>   - [`src/integration/artifact-review-mcp-v4.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts): Hàm `preflightConversationVersion` fail-closed chặn caller truyền ID conversation v1 với lỗi `CONVERSATION_MIGRATION_REQUIRED`; `createArtifact`/`persistArtifact`/`handleInspectTool` chuyển sang `createSession` và `registerArtifactInSession`; rollback khôi phục membership chính xác; `artifactHandle` map `sessionId`/`title` thành `artifactConversationId`/`conversationName`.
>   - [`skills/create-review-artifact/SKILL.md`](file:///d:/workspace/my-projects/ai-artifacts/skills/create-review-artifact/SKILL.md) & [`artifact-contract.md`](file:///d:/workspace/my-projects/ai-artifacts/skills/create-review-artifact/references/artifact-contract.md): Bổ sung hướng dẫn phục hồi 2 lựa chọn khi gặp `CONVERSATION_MIGRATION_REQUIRED` (Option 1: migrate từ Review App rồi retry; Option 2: drop ID cũ và tạo session mới).
>   - Tests: [`test/artifact-contracts.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/artifact-contracts.test.ts), [`test/skill-contract.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/skill-contract.test.ts), [`test/session-type-registry.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/session-type-registry.test.ts) *(mới)*, [`test/conversation-artifact-registry.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/conversation-artifact-registry.test.ts), [`test/review-wait-mcp.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/review-wait-mcp.test.ts).
> - **Kết quả đạt được (Phase Achievements):**
>   - Toàn bộ tầng Headless Session v2, Layout ba mảng và Session Types global đã hoạt động bền vững, không dùng file lock, sử dụng atomic writes hoàn toàn.
>   - MCP server và Skill contract v4 bảo đảm fail-closed tuyệt đối với conversation v1, ngăn chặn phân mảnh dữ liệu.
>   - `npm run check` (tsc --noEmit) pass sạch 100%.
>   - `npm test` pass toàn bộ **33 test files (540 tests passed, 0 failed)**.
>   - `npm run build` build thành công cả 5 targets (extension, uninstall, webview, enhancements, integration MCP).

---

### Chặng 2: Bước 4 + 5 — Sidebar, Session Types Popup & Tab Session (ĐÃ HOÀN THÀNH)

> [!NOTE]
> - **Trạng thái:** ✅ **Đã hoàn thành** (Review Checkpoint 2 sẵn sàng)
> - **Các file đã can thiệp & tạo mới:**
>   - [`package.json`](file:///d:/workspace/my-projects/ai-artifacts/package.json): Khai báo views container `agentPlus-artifacts` (Activity Bar icon), views `agentPlus.recentArtifacts` và `agentPlus.sessions`, `view/title` menu cho icon ⚙ (`agentPlus.manageSessionTypes`), custom editor `agentPlus.workSession` (selector `**/.ai-artifacts/conversation-registry/*/conversation.json`), commands (`agentPlus.openWorkSession`, `agentPlus.manageSessionTypes`, `agentPlus.openArtifact`, `agentPlus.reinstallIntegration`, `agentPlus.migrateConversations`).
>   - [`src/shared/contracts.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts): Bổ sung `workSessionArtifactRowSchema`, `workSessionViewDataSchema`, `sessionWebviewToExtensionMessageSchema`, `SessionExtensionToWebviewMessage`.
>   - [`src/extension/work-session-support.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/work-session-support.ts) *(mới)*: Service kiểm tra hỗ trợ MCP numeric version >= 12 và đối chiếu runtime bundle script.
>   - [`src/extension/conversation-artifact-service.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/conversation-artifact-service.ts): Bổ sung các method `listWorkSessions`, `getWorkSession`, `listCandidates`, `countCandidates`, `resolveSessionViewData` (phân giải artifact manifests qua 3 vùng Working/References/Archived).
>   - [`src/extension/session-type-command.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/session-type-command.ts) *(mới)*: Command quản lý types dùng QuickPick native chuẩn VS Code (thêm, đổi tên, xoá có xác nhận và tự động reassign về type `conversation`, cấm xoá type mặc định).
>   - [`src/extension/work-session-sidebar.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/work-session-sidebar.ts) *(mới)*: `RecentArtifactsTreeDataProvider` (sort updatedAt desc, giới hạn 20 + Xem tất cả...), `WorkSessionsTreeDataProvider` (MCP v12 gate, item đếm candidate migration v1, render Session items v2).
>   - [`src/extension/webview-html.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/webview-html.ts) *(mới)*: Tách shell HTML dùng chung với CSP, nonce, và discriminator `data-app="session" | "review"`.
>   - [`src/webview/SessionApp.tsx`](file:///d:/workspace/my-projects/ai-artifacts/src/webview/SessionApp.tsx) *(mới)*: Component webview Session tab chỉ đọc hiển thị header (title, type badge), instructions Markdown, và 3 vùng (Working / References / Archived) với clickable artifact cards.
>   - [`src/webview/main.tsx`](file:///d:/workspace/my-projects/ai-artifacts/src/webview/main.tsx): Gắn discriminator chọn `SessionApp` hay `ReviewApp` dựa trên `data-app` attribute của root container.
>   - [`src/webview/vscode-api.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/webview/vscode-api.ts): Mở rộng kiểu `postMessage` chấp nhận union của review messages và session messages.
>   - [`src/webview/styles.css`](file:///d:/workspace/my-projects/ai-artifacts/src/webview/styles.css): Bổ sung styles cho Session tab (`.session-app-container`, header, instructions, zones, artifact cards).
>   - [`src/extension/work-session-provider.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/work-session-provider.ts) *(mới)*: `WorkSessionProvider` triển khai `CustomReadonlyEditorProvider` cho `agentPlus.workSession`, validate document path, xử lý message `ready`, `openArtifact`, `openExternal`, auto-refresh khi service change.
>   - [`src/extension/artifact-review-provider.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/artifact-review-provider.ts): Gắn `data-app="review"` vào webview root HTML.
>   - [`src/extension/extension.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/extension.ts): Kết nối toàn bộ providers, views, commands, và wiring.
>   - Tests: [`test/session-type-command.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/session-type-command.test.ts) *(mới)*, [`test/work-session-sidebar.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/work-session-sidebar.test.ts) *(mới)*, [`test/work-session-provider.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/work-session-provider.test.ts) *(mới)*, [`test/artifact-review-open.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/artifact-review-open.test.ts), [`test/release-contract.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/release-contract.test.ts).
> - **Kết quả đạt được (Phase Achievements):**
>   - Đã đưa toàn bộ giao diện Sidebar (Recent Artifacts + Sessions v2) và tab Session chỉ đọc vào VS Code extension.
>   - Phân luồng webview sạch sẽ giữa ReviewApp và SessionApp qua thuộc tính `data-app` mà không cần thay đổi pipeline build đơn tệp của Vite (`dist/webview/review.js`).
>   - Toàn bộ 36 test files (550 tests passed, 0 failed, 3 skipped).
>   - `npm run check` (tsc --noEmit) pass sạch 100%.
>   - `npm run build` pass sạch cả 5 targets.

### 13.4. Bước 4 — Trạng thái hỗ trợ, service, sidebar và popup types

**Phụ thuộc:** bước 1–3. **Đầu ra:** hai Tree View có dữ liệu và trạng thái chặn đúng; đã có điểm phát hiện N conversation, chưa nối thao tác migration UI cho đến bước 6.

| File/component | Sửa cụ thể |
| --- | --- |
| **Mới:** `src/extension/work-session-support.ts` | Một service trạng thái hỗ trợ dùng chung. Reuse `readInstalledIntegrationVersion`, `getBaseIntegrationPaths`, `baseScriptIsCurrent` từ `workspace-integration.ts`; hỗ trợ khi receipt MCP hợp lệ đạt mốc 12 và file runtime khớp bundle đang triển khai. Không dùng tổng `assetsCurrent` vốn xét cả skill/clients; không kiểm tra process. |
| `src/extension/conversation-artifact-service.ts` | Thay controller drawer bằng service Session; giữ filename/watcher để tránh rename lan rộng. Các method mới/đề xuất: list v2 cho sidebar, load view một Session, lookup liên quan một artifact gồm v2 và candidate v1. Trả DTO theo mục đích, không dựng `registeredAt` hoặc catalog agent. Giữ opener/notify/debounce/dispose đã có. |
| **Mới:** `src/extension/work-session-sidebar.ts` | Hai TreeDataProvider riêng cho Recent/Sessions. Stable item ID; Recent dùng `discoverSearchableArtifacts`, sort updatedAt desc + artifactId rồi giới hạn 20 mục đã chốt; Xem tất cả gọi search hiện có. Sessions chỉ v2, title/type label/count/updatedAt; có trạng thái cần cập nhật và dòng N candidate riêng với item Session. |
| **Mới:** `src/extension/session-type-command.ts` | Quick Pick/InputBox theo pattern `artifact-search-command.ts`: list/count types, item edit/delete buttons, thêm type, xác nhận delete đang dùng, refresh và dispose. Không dùng Quick Pick này cho popup Connect cần disable từng lựa chọn. |
| `package.json` | Đề xuất container `agentPlus-artifacts`, hai view `agentPlus.recentArtifacts`/`agentPlus.sessions`; commands `agentPlus.openWorkSession`, `agentPlus.manageSessionTypes`, `agentPlus.migrateConversations`. Menu ⚙ chỉ `view == agentPlus.sessions`, không contribute + session. Session editor contribution hoàn tất ở bước 5; icon có sẵn `media/icon.png` được thay bằng SVG `layers` ở bổ sung Chặng 3, mục 13.6. |
| `src/extension/extension.ts` | Compose support/service/providers/commands một lần; inject cùng instance cho sidebar và review provider. Reuse artifact open coordinator. Sau installer hoàn tất, refresh trạng thái hỗ trợ và các view; view hiện lại cũng kiểm tra file đã cài. Các entry handler Session/types/migration phải kiểm tra lại hỗ trợ, không chỉ disable UI. |
| Tests mới cho support/sidebar/type command; tests service/release bị ảnh hưởng | Hỗ trợ MCP-only; hai danh sách/sort/count; type popup; registration/menu. `release-contract.test.ts` hiện so sánh toàn bộ menu: thêm expected view/menu mới và giữ assertions các safe-open menu cũ. |

**Luồng trạng thái:**

- Khi chưa kiểm tra xong, các action Session chưa enable. Thiếu/hỏng receipt hoặc runtime chưa khớp → hiện yêu cầu cập nhật với action installer hiện có; Recent/Connect legacy/review vẫn dùng được. Mốc 12 là numeric MCP version, không lấy từ package SemVer hoặc schema v2.
- Kiểm tra bytes file runtime giúp phân biệt bundle Session hoàn chỉnh với bản chuẩn bị version 12 chỉ mới bump marker. Đây vẫn là kiểm tra file đã cài như Chú chốt; không chứng minh process đã restart. Không thêm logic process ở đợt này.
- Khi ready, list v2 và đọc types; v1 chỉ dùng để đếm candidate/lookup mục migration. List/count/hiện popup không tạo Session hay migration. Metadata lỗi có chẩn đoán, không biến thành empty state hoặc candidate hợp lệ.
- Registry watcher hiện có được giữ; thêm watch file types và manifest create/update/delete cho Recent/tab. Sau mutation refresh snapshot đã commit, debounce events và dispose đúng vòng đời. Không polling/daemon hoặc ghi lastOpenedAt.

**Khả năng phải đạt:** mở Activity Bar thấy hai section; MCP cũ chặn đúng phần Session; MCP đã cài đúng thì enable; Session v2 rỗng vẫn hiện; types thêm/sửa/xoá dùng được và còn sau reload. Chọn/gán type cho từng Session qua UI vẫn để Phase 3.

**Kiểm chứng bước:** support mock receipt/file độc lập với skill/client status; sidebar sort trước cap, v1 không thành Session item; ⚙ đúng view; popup huỷ không ghi, lỗi chuyển type giữa chừng giữ entry. Chưa tuyên bố mở tab/migration UI hoàn chỉnh trước bước 5–6.

### 13.5. Bước 5 — Tab Session chỉ đọc và message boundary

**Phụ thuộc:** bước 4. **Đầu ra:** command mở Session có điểm đến thật, nội dung và artifact links refresh được.

| File/component | Sửa cụ thể |
| --- | --- |
| **Mới:** `src/extension/work-session-provider.ts` | `CustomReadonlyEditorProvider` với custom document giữ URI/sessionId và dispose; triển khai `openCustomDocument`/`resolveCustomEditor`. Validate metadata canonical v2 trước load; không dùng TextDocument/ArtifactStore hoặc tạo unsaved JSON buffer. |
| `package.json`, `src/extension/extension.ts` | Register viewType đề xuất `agentPlus.workSession`. Selector chỉ metadata dưới `**/.ai-artifacts/conversation-registry/*/conversation.json`, không `*.json` chung; priority `option`, mở chủ động bằng `vscode.openWith` sau validation. Command nhận đúng ID, derive URI và mở/reveal cùng tab. |
| `src/shared/contracts.ts` | DTO Session view gồm metadata/type label/instructions và artifact rows trong đúng ba vùng/thứ tự; missing/error là trạng thái riêng. Session-to-host messages chỉ ready/open artifact/openExternal cần thiết; không add/remove comments hoặc submitReview. Tách schema Session messages khỏi review messages. |
| **Mới:** `src/extension/webview-html.ts`; provider review hiện có | Tách shell HTML tối thiểu dùng chung từ `ArtifactReviewProvider.html`: bundle/style URIs, nonce/CSP/enhancement data giữ nguyên; thêm discriminator `data-app="review"` hoặc `"session"`. Không sửa các provider legacy khác. |
| **Mới:** `src/webview/SessionApp.tsx`; `src/webview/main.tsx`, `vscode-api.ts`, `styles.css` | Entry chọn app theo discriminator, mặc định review để giữ luồng cũ. VS Code API instance chỉ acquire một lần, typed union đủ hai app; mỗi host vẫn parse schema riêng. SessionApp render title/type, instructions Markdown, ba vùng và empty/error; CSS giới hạn trong SessionApp, không redesign Review App. |
| Tests mới cho Session provider/App; test provider review/build contract hiện có | Canonical target, v2-only, cùng tab/ID, open artifact thuộc đúng session, messages riêng, refresh/dispose và review HTML/bundle vẫn hoạt động. |

**Luồng render/mở:**

1. Service đọc Session v2 rồi resolve artifact rows bằng manifest/validation/opener đang có; giữ ID và thứ tự mảng. Không lấy toàn bộ Markdown artifact chỉ để dựng danh sách. Artifact thiếu/hỏng báo phù hợp và không tự mở item khác hoặc sửa membership từ thao tác read.
2. Instructions dùng `parseMarkdownBlocks`/`MarkdownRenderer` hiện có với comments rỗng và không có review handlers; provider chấp nhận `openExternal` theo whitelist http/https/mailto hiện tại. Không dựng renderer HTML mới hoặc bỏ URL policy.
3. Click artifact chỉ gửi artifactId; provider xác minh ID còn trong session đang mở, derive canonical path và gọi shared open coordinator. Không nhận arbitrary filesystem path từ webview, không MCP inspect/takeover/connection write.
4. Subscribe Session/types/artifact thay đổi; mất target thì render missing/error và không tạo lại Session. Chưa có sửa title/type/instructions, panel toggle hoặc drag/drop.

**Khả năng phải đạt:** sidebar mở đúng tab chỉ đọc, ba vùng đúng order và mở đúng artifact trong window hiện tại; reload và mutation bên ngoài được phản ánh. Session tab không khởi tạo review lifecycle hoặc giành việc của MCP.

**Kiểm chứng bước:** tests provider/message/renderer và manual mở/reveal cùng ID; kiểm tra bundle `review.js` render đúng hai app. Không đổi Vite sang multi-entry; `build:webview` hiện tại vẫn dùng được.

### Chặng 3: Bước 6 + 7 — ReviewApp Navigation, Connect Dialog & Bulk Migration (ĐÃ HOÀN THÀNH)

> [!NOTE]
> - **Trạng thái:** ✅ **Đã hoàn thành 100%** (Review Checkpoint 3 sẵn sàng)
> - **Các file đã can thiệp & tạo mới:**
>   - [`media/layers.svg`](file:///d:/workspace/my-projects/ai-artifacts/media/layers.svg) *(mới)*: Icon Codicons `layers` 24×24, nền trong suốt, một màu currentColor chuẩn Activity Bar.
>   - [`package.json`](file:///d:/workspace/my-projects/ai-artifacts/package.json): Cập nhật icon container Activity Bar `media/layers.svg`, title `AI Artifacts`, cả hai view `agentPlus.recentArtifacts` và `agentPlus.sessions` có `visibility: "visible"`.
>   - [`src/shared/contracts.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts): Bổ sung `artifactSessionTargetSchema` / `ArtifactSessionTarget`, cập nhật `webviewToExtensionMessageSchema` (thêm `openArtifactSessions`, `migrateSelectedConversation`, `copyArtifactConnectPrompt` với `mode` và `sessionId`), cập nhật `ExtensionToWebviewMessage` với `artifactSessionsState`.
>   - [`src/shared/artifact-connect-prompt.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/artifact-connect-prompt.ts): Hỗ trợ các mode `legacy`, `new` (yêu cầu agent bỏ ID cũ), và `join` (gắn kết đúng session ID).
>   - [`src/shared/conversation-artifact-registry.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/conversation-artifact-registry.ts): Export `listCandidatesForArtifact(currentArtifactId, options)`.
>   - [`src/extension/conversation-artifact-service.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/conversation-artifact-service.ts): Bổ sung `getArtifactSessions(artifactId)` kết hợp sessions v2 và candidates v1.
>   - [`src/extension/session-migration-command.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/session-migration-command.ts) *(mới)*: Coordinator dùng chung cho `runSingleMigration` và `runBulkMigration` (xác nhận dialog native, progress bar, đếm succeeded/skipped/failed).
>   - [`src/extension/artifact-review-provider.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/artifact-review-provider.ts): Thay thế drawer logic bằng `refreshSessions`, gửi `artifactSessionsState`, xử lý `openArtifactSessions` (0/1/n session với QuickPick), `migrateSelectedConversation`, và copy connect prompt theo mode.
>   - [`src/extension/extension.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/extension.ts): Nối command `agentPlus.migrateConversations` gọi `runBulkMigration` với đầy đủ notification progress và refresh providers.
>   - [`src/webview/ArtifactConnectDialog.tsx`](file:///d:/workspace/my-projects/ai-artifacts/src/webview/ArtifactConnectDialog.tsx) *(mới)*: Dialog React chọn New Session vs Join Session, disabled v1 kèm tooltip & badge "Cần chuyển đổi v2", focus trap, phím Esc.
>   - [`src/webview/ReviewApp.tsx`](file:///d:/workspace/my-projects/ai-artifacts/src/webview/ReviewApp.tsx): Gỡ bỏ hoàn toàn `ConversationArtifactsDrawer`; thêm nút **Sessions** (disabled khi MCP < 12); Connect button mở `ArtifactConnectDialog` khi MCP >= 12 hoặc copy trực tiếp khi MCP < 12.
>   - Xoá `src/webview/ConversationArtifactsDrawer.tsx` và `test/conversation-artifacts-drawer.test.tsx`.
>   - [`src/webview/styles.css`](file:///d:/workspace/my-projects/ai-artifacts/src/webview/styles.css): Dọn sạch 153 dòng CSS cũ của drawer, thêm styling cho `.sessions-toggle` và toàn bộ `.connect-dialog-*`.
>   - Tests: [`test/session-migration-command.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/session-migration-command.test.ts) *(mới)*, [`test/artifact-connect-dialog.test.tsx`](file:///d:/workspace/my-projects/ai-artifacts/test/artifact-connect-dialog.test.tsx) *(mới)*, [`test/artifact-connect-prompt.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/artifact-connect-prompt.test.ts), [`test/artifact-review-provider.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/artifact-review-provider.test.ts).
> - **Kết quả đạt được (Phase Achievements):**
>   - Đã gỡ bỏ sạch sẽ toàn bộ code drawer cũ khỏi Review App.
>   - Điều hướng Sessions và Connect Dialog New/Join hoạt động mượt mà, phân cấp rõ rệt v1/v2 theo đúng quy chuẩn bảo vệ dữ liệu.
>   - Bulk migration có dialog xác nhận và thanh progress notification chi tiết.
>   - Toàn bộ 37 test files (548 tests passed, 0 failed, 3 skipped).
>   - `npm run check` (tsc --noEmit) pass 100%.
>   - `npm run build` pass sạch cả 5 targets.

### 13.6. Bước 6 — Nút Sessions, Connect dialog và migration UI

**Phụ thuộc:** bước 1–5. **Đầu ra:** user thực hiện được toàn bộ điều hướng/migration đã chốt; không còn drawer conversation cũ.

| File/component | Sửa cụ thể |
| --- | --- |
| `src/webview/ReviewApp.tsx`, `styles.css` | Xoá import/render/state/refs/count/focus handling chỉ dành cho ConversationArtifactsDrawer. Thay nút bằng **Sessions**, state loading/update-required/ready/error riêng; không làm lỗi Session che phần review đang hoạt động. Giữ CommentsDrawer, feedback/submit và focus trap của comments. |
| `package.json` — bổ sung nhỏ cho sidebar Chặng 2 | Đặt icon container `agentPlus-artifacts` thành Codicon `library` có sẵn (`icon: "$(library)"`), thay SVG `layers` theo lựa chọn mới nhất; title **AI Artifacts**, không thêm Manager/Management. Giữ tên hai view Recent Artifacts và Sessions, đặt `visibility: "visible"` cho cả hai. Chỉ quy định trạng thái mặc định lần đầu trong workspace; giữ lựa chọn mở/thu gọn sau đó do VS Code quản lý. Không thêm lệnh tự mở sidebar khi extension khởi động. |
| Xoá `src/webview/ConversationArtifactsDrawer.tsx` và test drawer tương ứng | Chỉ xoá sau khi không còn import. Bỏ DTO `ConversationArtifactsViewState`/item/group và messages chỉ phục vụ drawer; giữ legacy metadata/membership schemas cần cho discovery/migration/cleanup. Không xoá `focus-trap.ts` hoặc tests dùng chung với comments. |
| **Mới:** `src/webview/ArtifactConnectDialog.tsx` | Dialog React nhỏ trong Review App, dùng CSS/focus patterns hiện có. New luôn là lựa chọn được phép khi Session support ready; Join chỉ enable đích v2. Đích v1 hiện disabled + giải thích cần migration, keyboard không chọn được; tooltip đặt trên wrapper có thể hover khi control disabled. Không thêm UI library. |
| `src/shared/contracts.ts`, `src/extension/artifact-review-provider.ts` | Thay `refreshConversations`/controller cũ bằng Session state/actions. Các message đề xuất: yêu cầu mở Sessions của artifact, migrate conversation đã chọn, copy Connect prompt với mode new/join và optional sessionId. Host lấy artifactId/directory từ store đang mở, kiểm tra gate và membership/schema lại trước action; không tin candidate snapshot từ webview. |
| `src/shared/artifact-connect-prompt.ts`, tests prompt/skill | Mở rộng `buildArtifactConnectPrompt` bằng mode rõ ràng. Legacy không mode giữ exact-handle prompt hiện tại. New nói rõ bỏ ID active cũ cho request, omit ID khi inspect và lưu ID mới trả về; Join dùng đúng ID v2 được chọn và chuyển active context sau thành công. Giữ JSON quoting cho path/ID, không tạo command shell từ prompt. |
| **Mới:** `src/extension/session-migration-command.ts`; sidebar/service/provider/entry | Coordinator UI dùng chung cho single/bulk, gọi hàm migration bước 2. Single validate quan hệ artifact–conversation, migrate rồi mở Session cùng ID. Bulk lấy danh sách candidate lúc user xác nhận, chạy tuần tự với progress và kết quả; refresh các view/Review App. Không đặt batch loop trong React hoặc nhân đôi thuật toán migration. |
| Tests provider/connect dialog/prompt/migration command và sidebar bị ảnh hưởng | Gate, disabled Join v1, multiple memberships, New/Join payload đúng, huỷ popup không ghi, single/bulk result và refresh; giữ tests comments/review/clipboard cũ còn đúng contract. |

**Điều hướng Sessions:**

- MCP chưa ready: nút Sessions disabled, tooltip yêu cầu MCP server 12 trở lên; Connect vẫn copy exact-handle prompt legacy, không cung cấp Join Session. Khi ready: 0 membership → thông báo chưa thuộc Session, không tạo; 1 → mở v2 hoặc cho migrate v1; nhiều → chọn đúng ID/title/type và hành động theo schema.
- Session v2 mở bằng command bước 5. Conversation v1 chọn Migrate thì gọi coordinator một ID; thành công mở tab cùng ID, lỗi giữ màn hiện tại và báo lỗi. Một artifact có membership v1 không chặn mở/join membership v2 khác.

**Connect dialog:**

1. Chỉ mở dialog khi MCP đã cài đủ mốc Session. MCP cũ click Connect thì copy prompt legacy trực tiếp, không mở dialog và không nhận mode new/join. Với MCP mới, mở dialog/huỷ chỉ đọc state; không gọi MCP, ghi registry hoặc làm migration. User chọn New/Join rồi Copy mới tạo clipboard prompt. Dialog đóng trả focus về Connect, Esc huỷ không đổi chat hay dữ liệu.
2. Join v1 disabled cả ở UI lẫn handler. Join v2 phải thuộc danh sách đích liên quan được service xác minh; membership không còn hợp lệ thì refresh và báo, không đổi sang newest hoặc âm thầm New.
3. New phải có chỉ thị **bỏ ID đang giữ** trong prompt và trong skill; chỉ omit ID trong một prompt exact-handle chung là chưa đủ, vì skill hiện tại chủ động truyền active artifactConversationId. User chọn New là quyền thay active group cho request, không phải bulk-copy conversation cũ.

**Bulk UI:**

1. Khi N > 0 và MCP ready, sidebar hiện dòng phát hiện; click mở popup native xác nhận “Có N conversation có thể chuyển sang Sessions để sử dụng.” / “Chuyển tất cả” / “Huỷ”. Không thêm selector từng mục hoặc job nền.
2. Xác nhận chạy cùng hàm single cho từng ID; mỗi lần đọc lại schema trước khi chuyển, mục đã v2 được bỏ qua. Một mục lỗi ghi nhận và tiếp tục; không rollback batch, không auto retry. Báo số đã chuyển/bỏ qua/thất bại và số còn có thể thử lại.
3. Sau mỗi commit/hoàn tất, refresh Session list, candidate count, dialog/button state liên quan qua service hiện có. N = 0 thì ẩn dòng migration. Bulk không tự mở hàng loạt tab Session.

**Khả năng phải đạt:** Sessions thay drawer hoàn toàn; Connect chuẩn bị đúng prompt theo lựa chọn user; single migration chuyển rồi mở; bulk chỉ chạy sau xác nhận, có kết quả đúng và không phá những mục đã chuyển. Review/Proceed/Just save/Copy Markdown/Comments tiếp tục hoạt động.

**Kiểm chứng bước:** tests DTO/handler và command có effects thực trên fixture; render/interaction logic của dialog xác nhận v1 bị disabled; manual Extension Host kiểm tra hover/focus/Esc, clipboard và New trong chat đã giữ ID khác. Không coi static markup tests là bằng chứng clipboard/AI runtime.

### 13.7. Bước 7 — Validation, docs cần đồng bộ và bàn giao

**Phụ thuộc:** bước 1–6. **Đầu ra:** kết quả kiểm chứng theo từng khả năng, phần chưa chạy được ghi rõ; không tự publish/reinstall dữ liệu thật.

| Phần | Công việc |
| --- | --- |
| Tests data/MCP | Chạy focused suites ở các bước trong lúc sửa; giữ fixture v1 để test manual migration và lỗi ID v1, v2 cho tính năng mới. Không dùng home thật; không biến một build pass thành bằng chứng migration/runtime. |
| Tests UI/extension | Mock đúng Tree View/CustomReadonlyEditorProvider/QuickPick APIs được sử dụng; cập nhật provider/message tests và release menu assertions theo contributions mới. Verify review regression sau khi bỏ drawer, không chỉ xoá tests cũ. |
| Kiểm chứng kết hợp | Cuối đợt chạy `npm.cmd run check`, `npm.cmd test`, `npm.cmd run build`, `git diff --check`. Chỉ chạy lại hoặc mở rộng khi có thay đổi/lỗi mới cần kiểm chứng. Manual matrix gọn ở mục 14 là phần Extension Host, báo kết quả riêng. |
| Canonical docs/skill khi triển khai | Theo quy định repo, hỏi Chú trước khi đồng bộ docs hành vi; chuẩn bị diff đúng phần cho README, INSTRUCTION, PHILOSOPHY, ARCHITECTURE, COMPONENTS và CHANGE_LOGS. Skill/reference contract và version tests thuộc bước 3 đã có trong scope. Source đã chứng minh vài mô tả v1 cũ lệch code: sửa các đoạn Session thay thế, không mang lại cơ chế drawer/lock giả định cũ. |
| Bàn giao | Liệt kê component đã đổi, khả năng chạy được, kết quả automated và manual chưa chạy; hướng dẫn Chú build/cài/restart để so MCP cũ/mới. Không tự cài global integration, bump package, tag, publish hoặc migrate dữ liệu thật. |

**Khả năng phải đạt cuối đợt:** model/types lưu bền; create/reuse v2 và lỗi ID v1 thống nhất với skill; sidebar/gate đúng file MCP đã cài; tab chỉ đọc và nút Sessions điều hướng được; popup New/Join và migration single/bulk hoạt động theo thao tác user. Manager editing/type selector/catalog/drag-drop vẫn để các phase sau.

## 14. Kiểm chứng Phase 2 và nghiệm thu kết hợp

Automated tests cần kiểm tra behavior thực:

- Recent sort theo updatedAt rồi cap đúng 20 mục, Xem tất cả gọi search; open không ghi timestamp/connection; Sessions gồm session rỗng, label type lookup đúng.
- MCP chưa đủ version chặn section Sessions/types/migration và nút Sessions; Connect copy prompt legacy trực tiếp, không mở popup New/Join, Recent/review vẫn hoạt động. MCP mới mới có popup/luồng New/Join; cập nhật file MCP thì refresh trạng thái. Không kiểm tra process đang chạy.
- Sidebar chỉ list v2, đếm đúng N conversation v1; mở popup/huỷ không mutation. Xác nhận bulk chạy cùng hàm migration từng mục, báo kết quả và refresh; một mục lỗi không ngăn các mục còn lại, chạy lại bỏ qua v2.
- Review App không còn drawer cũ; MCP đủ version + v1 cho migration đơn lẻ, v2 cho mở Session. Mở/list/cleanup không tự chuyển dữ liệu.
- Popup inspect disable Join v1, chỉ cho New khi không có đích v2; membership v2 khác vẫn join được. Prompt New giữ exact handle và không có ID cũ; prompt Join có đúng ID v2 đã chọn. MCP cũ vẫn dùng Connect exact-handle hiện tại, không Join Session.
- Command mở session đúng ID; artifact có 0/1/n session theo ba nhánh đã mô tả, huỷ picker không mở hoặc mutate.
- Popup add/rename/delete qua API; defaults chỉ seed khi file chưa tồn tại; loại đã xoá không xuất hiện lại khi reopen.
- Delete type đang dùng: huỷ giữ nguyên; xác nhận chuyển về mặc định; lỗi chuyển dở giữ type và báo lỗi. Rename refresh label mà không đổi ID/typeId.
- Session provider đọc đúng target; link mở đúng artifact, session view không chạy review/takeover. Watcher refresh sau thay đổi/missing data và dispose khi đóng.
- Smoke test đăng ký hai view và action ⚙ đúng view; không có command/menu tạo session thủ công.
- Kiểm tra contributions dùng Codicon `library` (`icon: "$(library)"`) và title **AI Artifacts** cho container; khai báo `visibility: "visible"` cho cả Recent Artifacts và Sessions.

Manual trong Extension Development Host:

1. Trong workspace chưa lưu trạng thái hai view, kiểm tra icon `library` và tên AI Artifacts trên Activity Bar/tiêu đề sidebar; bấm icon thấy Recent Artifacts/Sessions mặc định bung và ⚙ đúng header; không có + session. Thu gọn một section rồi reload, kiểm tra giữ lựa chọn đó. Khi sidebar khác đang được chọn, reload không tự chuyển sang sidebar AI Artifacts.
2. Tạo artifact qua runtime cùng build: lần đầu có session Conversation, lần sau reuse đúng ID; sidebar nhận cập nhật.
3. Click Recent mở artifact; click Sessions mở tab đọc đúng ba vùng; nút Sessions từ artifact tới cùng tab. Thử artifact thuộc hai session và huỷ lựa chọn.
4. ⚙ tạo custom type, đổi label, đóng/mở lại. Kiểm tra assignment bằng fixture/shared API Phase 1 vì selector UI thuộc Phase 3; xoá type đang dùng xác nhận chuyển các session về mặc định.
5. Reload window; kiểm tra dữ liệu/types và điều hướng còn đúng. Thử empty registry, missing artifact và lỗi đọc để xác nhận UI phân biệt các trạng thái.
6. Với fixture MCP cũ: section Sessions và nút Sessions bị chặn, có hướng dẫn cập nhật; Connect copy prompt hiện tại trực tiếp, không có popup New/Join; Recent/review vẫn dùng được. Cập nhật file MCP rồi refresh, phần Sessions enable và Connect dùng popup mới, chưa tự migration v1.
7. Với fixture v1 + v2: sidebar chỉ list v2 và hiện đúng số candidate. Trong Review App chuyển một v1 thành Session rồi mở; sidebar và số candidate cập nhật. Huỷ popup bulk giữ dữ liệu; xác nhận chuyển các v1 còn lại, kiểm tra tiến độ/kết quả, lỗi một mục và chạy lại không nhập lại v2.
8. Popup inspect với conversation v1: Join disabled và có tooltip, chỉ chọn New; kiểm tra prompt không mang ID v1. Với Session v2, Join dùng đúng ID; sau migration cùng ID cũ được enable để Join.

Cuối đợt chạy `npm.cmd run check`, `npm.cmd test`, `npm.cmd run build` một lần sau khi focused tests qua. Không coi build/typecheck là bằng chứng UI/Extension Host. Tài liệu này chỉ lập kế hoạch, chưa chạy các kiểm chứng triển khai.

**Nghiệm thu Phase 1+2:** có model Session/types lưu được; luồng artifact auto-create/reuse giữ đúng; gate theo MCP đã cài; sidebar chỉ list v2 và điều hướng được; migration đơn lẻ/bulk chỉ chạy sau thao tác user; popup quản lý type hoạt động; tab session đọc được và mở artifact; drawer cũ được bỏ. Session Manager có chỉnh sửa đầy đủ vẫn thuộc Phase 3, không đánh dấu cả feature hoàn tất.

## 15. Phạm vi còn lại sau đợt này

- **Phase 3:** manager editing, Type ✎ chọn/tạo, panel Type → Hướng dẫn → References → Archived, cache toggle, menu thao tác/gỡ artifact và session actions theo phạm vi được chốt.
- **Phase 4:** agent contract/catalog và trải nghiệm new/join đầy đủ; popup inspect chọn ID tối thiểu đã thuộc bước 6 đợt này. Không lẫn session type với artifact kind/Proceed behavior.
- **Phase 5:** masonry/filter artifact/search và dnd-kit.
- Pin/recent grouping nâng cao, session archive semantics và style/dependency vẫn được ghi là đề xuất khi chưa được duyệt; không tự thêm vào Phase 1+2.
