# Sessions — Implementation plan

Trạng thái: **Phase 1+2 và toàn bộ Phase 3 (gồm cả Bước 7 mở rộng) đã hoàn thành theo các plan chi tiết.**

> [!NOTE]
> - **Tiến độ triển khai:**
>   - ✅ **Chặng 1 (Bước 1 + 2 + 3):** Headless Session v2, Layout ba mảng, Session Types global, Migration v1→v2 kèm backup, Retention cleanup, Tích hợp MCP & Skill v4 fail-closed với lỗi `CONVERSATION_MIGRATION_REQUIRED`. Đã xong 100% tests (540/540 passed), tsc clean, build clean.
>   - ✅ **Chặng 2 (Bước 4 + 5):** Sidebar Activity Bar (Recent Artifacts cap 20 + Xem tất cả, Sessions v2), MCP v12 gate, Quick Pick native ⚙ quản lý types, Custom readonly Editor cho Session tab (`agentPlus.workSession`), webview `SessionApp.tsx` ba vùng (Working/References/Archived), click routing mở artifact review. Đã xong 100% tests (550/550 passed, 36/36 files), tsc clean, build clean cả 5 targets.
>   - ✅ **Chặng 3 (Bước 6 + 7):** ĐÃ HOÀN THÀNH: Gỡ bỏ hoàn toàn `ConversationArtifactsDrawer` cũ; thêm nút **Sessions** trên `ReviewApp.tsx` gated MCP v12; tạo dialog `ArtifactConnectDialog.tsx` (New vs Join, disabled v1 kèm tooltip & badge); mở rộng prompt connect với các mode; tạo coordinator migration `session-migration-command.ts` (single & bulk có progress/xác nhận); cập nhật icon container `layers.svg`, title `AI Artifacts`, views `visibility: "visible"`. Đã xong 100% tests (548/548 passed, 37/37 files), tsc clean, build clean cả 5 targets.

Ngoại lệ chuẩn bị: theo yêu cầu Chú, numeric MCP_VERSION đã tăng **11 → 12** để test phân biệt bản cũ/mới; `SKILL_VERSION` đã được nâng lên **4** để hỗ trợ hợp đồng phục hồi lỗi v1; package giữ 1.1.4.

Nguồn yêu cầu: [analyzed.md](analyzed.md) và các quyết định tiếp nối trong chat. Khi khác nhau, quyết định mới trong chat được ưu tiên: `rules` đổi thành `instructions` (một chuỗi Markdown); giữ native Quick Input, textarea + Save và menu sắp xếp. Bỏ drag/drop và lựa chọn dnd-kit khỏi mọi phase của roadmap này.

**Đợt triển khai đầu gộp Phase 1 + 2 trong [plan-phase-1-2.md](plan-phase-1-2.md).**

**[Hướng dẫn Phase 3](plan-phase-3.md) gồm 7 bước / 3 chặng:** Bước 1–6 đã hoàn thành; Bước 7 là phần mở rộng sau Chặng 3 gốc. Phạm vi mới nhất thay các đề xuất cũ về header/session actions.

**[Hướng dẫn Phase 4](plan-phase-4.md) gồm 7 bước / 3 chặng, Chặng 1 (Bước 1–2) đã hoàn thành theo checkpoint:** tiếp tục MCP Join/Proceed ở Chặng 2, UI Connect/Add Session/Add Artifact/filter, skill và nghiệm thu ở Chặng 3. Đính chính Chặng 1 giữ MCP **12** cho toàn bộ feature chưa release và nhận metadata có `instructions` optional; nội dung hiệu dụng chỉ từ Markdown. Skill hiện 5, mục tiêu 6. Không mở lại Chặng 1 cho phần UI Add bổ sung.

Validation đính chính Chặng 1: check/build pass, toàn bộ **43 test files / 611 tests pass, 3 skipped** (2026-11-07). Chưa kiểm chứng lại sidebar với dữ liệu global trong Extension Host; checkpoint này không đánh dấu hoàn thành Chặng 2–3.

## Các phase

| Phase | Kết quả | Trạng thái |
| --- | --- | --- |
| [1. Session model](plan-phase-1-2.md) | Metadata Session v2 (`title`, `instructions`, `typeId`, `createdAt`), giữ `registered-artifacts/` làm nguồn membership, tách `layout.json` ba mảng, tính `updatedAt` từ `createdAt`/`registeredAt`; auto-create/reuse; migration theo yêu cầu; registry session types và API quản lý | ✅ **Đã hoàn thành trong Chặng 1** |
| [2. Sidebar và điều hướng](plan-phase-1-2.md#phase-2--sidebar-quản-lý-session-types-và-điều-hướng) | Recent Artifacts/Sessions v2; gate theo MCP đã cài; phát hiện và popup bulk migration; ⚙ quản lý types; tab session chỉ đọc; Sessions/migration đơn lẻ thay drawer cũ | ✅ **Đã hoàn thành trong Chặng 2 & Chặng 3** |
| [3. Session Manager cơ bản](plan-phase-3.md) | Manager editing, scoped refresh, menu move/reorder/remove, panel preference, filter/search và English Quick Input; bổ sung contract một active Session cho mỗi chat AI | ✅ **Đã hoàn thành toàn bộ (Bước 1–7)** |
| [4. Agent và catalog](plan-phase-4.md) | Add Session rỗng / Add Artifact qua Quick Pick ở Bước 5; Shared Session context/catalog; `join_session` có optional artifact ID dùng chung inspect; Instructions Markdown + Open Markdown File; fixed/open kinds, Proceed theo kind; Connect manager/Review App; rà soát toàn App UI/Tree Views sang tiếng Anh và sửa nghĩa New/Join; Recent kind filter; skill và MCP contract đồng bộ | Đang triển khai — Đã hoàn thành Chặng 1 (Bước 1–2) |
| 5. Tổ chức trực quan và quản lý danh sách | Card masonry, metadata/description và filter/search artifact; helper text UI; menu chuột phải Recent Artifacts/Sessions; manager More → Export ZIP/Archive/Delete; Pin/Archive/Delete với file trạng thái UI riêng; cleanup Session sau 30 ngày Archive. Sắp xếp/chuyển vùng tiếp tục dùng menu hiện có, ghi `layout.json` độc lập membership của MCP | Chưa triển khai |

## Ranh giới chung

- Một artifact có thể nằm trong nhiều session; `registered-artifacts/<artifactId>.json` là nguồn membership duy nhất của mỗi session, còn `layout.json` lưu ba mảng `working`, `references`, `archived` và thứ tự hiển thị, cập nhật qua menu move/reorder. Artifact đã đăng ký nhưng chưa có trong `layout.json` mặc định nằm cuối `working`.
- Bỏ file lock riêng cho layout/session; dùng atomic write và chấp nhận quy tắc “bản lưu sau cùng thắng” khi nhiều cửa sổ cùng cập nhật bố cục/metadata.
- `Session.updatedAt` hiển thị được tính khi đọc từ thời điểm lớn nhất giữa `createdAt` và các `registeredAt` trong `registered-artifacts/`. MCP tạo hoặc inspect lại artifact cập nhật `registeredAt` như hiện tại nên tự đẩy Session lên đầu mà không cần sửa `conversation.json`; move/reorder (`layout.json`) hoặc sửa metadata không làm thay đổi `updatedAt`.
- Gỡ artifact khỏi session xoá file trong `registered-artifacts/` và bỏ ID khỏi `layout.json`. Không xoá artifact hoặc ảnh hưởng session khác; Session v2 rỗng vẫn được giữ, trừ khi user Delete hoặc Session đã Archive đủ hạn theo quy tắc Phase 5.
- `instructions` là nội dung Markdown chứa rules, workflows và các hướng dẫn khác cho AI trong Session. Phase 4 dùng `instructions.md` làm nguồn chính; textarea sửa Markdown thẳng + Save và Open Markdown File dùng cùng file. Schema metadata v2 strict chấp nhận `instructions` optional string cũ nhưng không dùng làm fallback; metadata writer mới omit field. Read/list không tự migrate hoặc rewrite. DTO vẫn có chuỗi instructions đọc từ file, thiếu file thì rỗng. Attach file/folder và rich editor để sau.
- Helper text cho các zone và Instructions là công việc UI của Phase 5, không phải trường metadata mới. Wording Instructions: “Rules, workflows, and other guidance for AI in this session.” Description ngắn của artifact trong catalog vẫn thuộc Phase 4; đây là hai loại description khác nhau.
- Giữ artifact schema v6 và cơ chế ownership/review hiện tại. Session ID không phải reviewSessionId.
- Phase 4 thêm `join_session(sessionId, artifactId?)`: join-only trả context và không takeover/register; có artifact thì dùng chung core inspect và trả inspection trong một call. Create/inspect trả thêm context; đọc tài liệu tham khảo theo catalog exact path không cần readonly inspect. `artifactConversationId` ở API cũ và `sessionId` mới cùng là Work Session ID, không rename toàn bộ API trong đợt này.
- Phase 4 rà soát toàn App UI/Tree Views/native UI để chuyển product-owned labels/messages còn tiếng Việt sang tiếng Anh, giữ nguyên dữ liệu user. Connect **New Session**: “Start a new work session from this artifact.” **Join Session**: “Inspect this artifact and join one of its existing sessions with its full session context.” Context gồm Instructions/catalog/metadata của Session đã chọn, không phải transcript chat khác hoặc chỉ liên kết artifact. Chi tiết wording và kiểm chứng ở mục 3.6/Bước 5 hướng dẫn Phase 4.
- Artifact kind theo bộ cố định `plan`, `implementation-plan`, `idea`, `analysis`, `design`, `spec`, `checklist`, `report`, `guide`, `note` và cho phép kind mở. Hai kind plan Proceed trả `execute-approved-plan`; mọi kind khác trả `approved`. Recent filter All Types/từng kind cố định/Other thuộc Phase 4; manager artifact filters thuộc Phase 5.
- Contract bổ sung ở Phase 3/Bước 7: một Session có thể được nhiều chat dùng, mỗi chat giữ 0 hoặc 1 active Session. Default create/inspect gửi ID đang giữ; explicit New omit ID cũ và thay bằng ID trả về sau thành công; Join gửi exact ID đích và đổi active sau thành công. Chuyển active không chuyển/xoá membership cũ hoặc tạo mapping chat trong registry.
- Các controls đã được chấp nhận là baseline cho các phase sau: Quick Pick chọn/tạo type, Input Box đổi title, textarea + Save cho instructions, menu Move to / Move Up / Move Down. Không có yêu cầu thay bằng inline editor, rich editor hoặc kéo thả.
- Phase 1 nối model mới vào luồng hiện tại; popup inspect chọn New/Join tối thiểu thuộc đợt Phase 1+2, Phase 4 mới hoàn thiện contract agent/catalog và trải nghiệm new/join đầy đủ.
- Header manager Phase 3 có title/đổi tên và toggle panel; Working ở giữa, panel phải Type → Hướng dẫn → References → Archived. Nhớ panel theo Session ID bằng extension `globalState`. Connect và nút ＋ Add Artifact của Working thuộc Phase 4/Bước 5. Menu More → Export ZIP/Archive/Delete cùng Pin/Archive/Delete artifact/Session thuộc Phase 5.
- Sidebar Sessions có ⚙ quản lý types, filter và Search Sessions. Quyết định bổ sung cho Phase 4/Bước 5: thêm **Add Session** trên header Tree View, nhập title rồi tạo phiên rỗng với type mặc định Conversation và mở manager. Quyết định này thay giới hạn cũ “không có + session”; điều hướng/filter/search vẫn không tự tạo Session. Add Artifact dùng Quick Pick chọn artifact có sẵn, loại member đã thuộc Session và đăng ký vào cuối Working; không inspect/takeover.
- Phase 3 refresh theo loại thay đổi và ID: card/membership/layout hoặc title/type đổi không set lại ô Hướng dẫn. Nếu chính instructions trên đĩa đổi, gửi patch và nhận giá trị mới kể cả đang gõ; so với giá trị persisted trước đó, không so với ô nhập để phát hiện dirty. Không thêm `isDirty`, draft recovery, dirty dialog hoặc conflict handling AI–user/nhiều manager; chấp nhận bản ghi sau cùng thắng.
- Session được mở theo kết quả kiểm tra MCP đã cài trên đĩa, giữ numeric MCP_VERSION và gate **12** cho toàn bộ feature chưa release; không nâng 13 theo chặng. Skill lên **6** ở bước skill. Không kiểm tra process đang chạy. MCP chưa đủ version chặn section Sessions và nút Sessions trên Review App, giữ Recent/review/Connect legacy; runtime cài trên đĩa vẫn phải khớp bundle hiện tại để hỗ trợ luồng mới.
- Sidebar chỉ list Session v2. Conversation v1 được phát hiện/đếm read-only; hiện dòng “Có N conversation có thể chuyển sang Sessions”, click mở popup xác nhận rồi mới chạy bulk tuần tự bằng cùng hàm migration đơn lẻ. Huỷ không ghi; kết thúc báo kết quả và refresh.
- Bỏ drawer conversation cũ. Review App có Sessions cho v2, hành động migration từng conversation cho v1 khi MCP đã đủ version. Không tự migration khi activation, đọc/list, mở artifact hoặc cleanup. Không rollback cả batch nếu một mục lỗi.
- Create và inspect **có truyền ID conversation v1** cùng trả lỗi trước mutation/takeover/cấp token, mã `CONVERSATION_MIGRATION_REQUIRED`; không giữ nhánh inspect thành công kèm cảnh báo. Artifact từng thuộc v1 không tự gây lỗi nếu caller không truyền ID v1; ID v2/không có ID vẫn dùng Session API mới và ghi `registered-artifacts/` như hiện tại.
- Skill hướng dẫn đúng hai lựa chọn: mở một artifact đã thuộc conversation cũ để migration rồi retry cùng ID, hoặc user chọn tạo/mở Session mới thì retry không truyền ID và giữ ID mới cho chat. Không tự đổi nhóm, nhập membership cũ, clone artifact hoặc xoá conversation cũ. Hướng dẫn lỗi tối thiểu này đã được triển khai trong Chặng 1 cùng với việc nâng `SKILL_VERSION` từ **3 → 4**.
- Popup inspect: conversation v1 thì Join disabled, chỉ cho inspect New Session; Session v2 có thể Join. New không truyền ID cũ và yêu cầu skill bỏ active ID cho request, Join chỉ định đúng ID v2. Có nhiều membership thì chỉ disable các đích v1. Extension copy prompt cho AI, không tự gọi MCP/mutate; chi tiết và nhánh MCP cũ ở mục 12 plan chung. Nhãn nút điều hướng đã chốt là **Sessions**.
- **Đã chốt:** MCP cũ giữ Connect như hiện tại, click copy prompt exact artifact handle trực tiếp; không mở popup New/Join hoặc yêu cầu tạo Session v2. Chỉ MCP mới đủ mốc Session mới dùng popup/luồng New/Join. Recent Artifacts dùng 20 mục + Xem tất cả; quản lý types dùng Quick Pick native.
- **Lựa chọn icon mới nhất:** Activity Bar dùng Codicon `library` có sẵn qua `icon: "$(library)"`, thay lựa chọn `layers` trước đó; label/tiêu đề container là **AI Artifacts**, không thêm Manager/Management. Giữ hai section **Recent Artifacts** và **Sessions**.
- Chưa thêm dependency UI/style trong giai đoạn lập plan.

## 7 bước nhỏ trong Phase 3 (Tổ chức theo 3 Chặng)

Chi tiết file, luồng xử lý, khả năng phải đạt và kiểm chứng ở [plan-phase-3.md](plan-phase-3.md).

| Chặng | Bước | Công việc |
| --- | --- | --- |
| 1 | 1 + 2 | Scoped events từ watcher tới consumer; typed manager actions qua host/registry, lỗi tại thao tác. |
| 2 | 3 | UI sửa tên/Hướng dẫn/type; bố cục Working + panel, preference riêng từng Session; menu move/reorder/remove artifact. |
| 3 | 4 + 5 + 6 + 7 | Filter/search, English Quick Input và nghiệm thu ban đầu đã xong; mở rộng thêm active Session contract trong skill/prompt và kiểm chứng tương ứng. |

Toàn bộ Bước 1–7 đã hoàn thành theo [plan Phase 3](plan-phase-3.md). Không có migration/schema mới, dirty dialog, conflict handling, Pin/Archive/Delete Session hoặc Connect manager trong đợt mở rộng.

## 7 bước nhỏ trong đợt Phase 1+2 (Tổ chức theo 3 Chặng)

Hướng dẫn từng file/hàm, luồng xử lý, khả năng phải đạt và kiểm chứng ở mục 13 của [plan chi tiết](plan-phase-1-2.md).

| Bước / Chặng | Trạng thái | Công việc |
| --- | --- | --- |
| **Chặng 1: Bước 1** | ✅ **Đã hoàn thành** | Model/persistence Session v2 và types global: giữ `registered-artifacts/` làm nguồn membership, tách `layout.json` ba mảng, tính dynamic `updatedAt`. |
| **Chặng 1: Bước 2** | ✅ **Đã hoàn thành** | Phát hiện v1, hàm migration từng conversation dùng chung có backup `conversation.v1.backup.json`; cleanup theo schema, giữ Session v2 rỗng. |
| **Chặng 1: Bước 3** | ✅ **Đã hoàn thành** | Nối MCP create/reuse/rollback và skill; create/inspect có ID v1 cùng trả lỗi `CONVERSATION_MIGRATION_REQUIRED`, skill v4 hướng dẫn migration hoặc chủ động tạo Session mới. |
| **Chặng 2: Bước 4** | ✅ **Đã hoàn thành** | Sidebar Recent/Sessions v2, gate MCP đã cài từ version 12, ⚙ quản lý types qua Quick Pick native, phát hiện/đếm số conversation có thể migration. |
| **Chặng 2: Bước 5** | ✅ **Đã hoàn thành** | Tab Session chỉ đọc qua `agentPlus.workSession`, hiện ba vùng và mở artifact qua coordinator; discriminator webview `SessionApp.tsx`; auto-refresh dữ liệu. |
| **Chặng 3: Bước 6** | ✅ **Đã hoàn thành** | Bỏ drawer cũ, Sessions và migration đơn lẻ tại Review App; popup inspect New/Join (disable Join v1), popup/bulk migration từ sidebar; nối điều hướng vào tab Session. Bổ sung cấu hình Recent Artifacts và Sessions mặc định bung lần đầu (`visibility: "visible"`), sau đó giữ lựa chọn người dùng; không tự mở sidebar khi khởi động. |
| **Chặng 3: Bước 7** | ✅ **Đã hoàn thành** | Kiểm chứng kết hợp bằng tests/check/build và Extension Host theo plan. |

---

## Hướng dẫn Review Checkpoint 1 (Dành cho Chú)

Checkpoint 1 nghiệm thu toàn bộ tầng **Headless Data Layer, Session Types, Single Migration & MCP Contract**:

### 1. Các file thay đổi cần kiểm tra code diff:
- **Contracts & Schemas**: [`src/shared/contracts.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts), [`src/shared/artifact-files.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/artifact-files.ts)
- **Session Types Global**: [`src/shared/session-type-registry.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/session-type-registry.ts) *(module mới)*
- **Session Registry & Reconciliation**: [`src/shared/conversation-artifact-registry.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/conversation-artifact-registry.ts)
- **MCP Server & Fail-Closed Preflight**: [`src/integration/artifact-review-mcp-v4.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts)
- **Skill Recovery Contract**: [`skills/create-review-artifact/SKILL.md`](file:///d:/workspace/my-projects/ai-artifacts/skills/create-review-artifact/SKILL.md), [`skills/create-review-artifact/references/artifact-contract.md`](file:///d:/workspace/my-projects/ai-artifacts/skills/create-review-artifact/references/artifact-contract.md)
- **Test Suites**:
  - [`test/session-type-registry.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/session-type-registry.test.ts) *(mới)*
  - [`test/conversation-artifact-registry.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/conversation-artifact-registry.test.ts)
  - [`test/review-wait-mcp.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/review-wait-mcp.test.ts)
  - [`test/artifact-contracts.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/artifact-contracts.test.ts), [`test/skill-contract.test.ts`](file:///d:/workspace/my-projects/ai-artifacts/test/skill-contract.test.ts)

### 2. Các lệnh kiểm chứng tự động:
Mở terminal tại thư mục `d:\workspace\my-projects\ai-artifacts` và chạy:
```powershell
# 1. Typecheck: phải không có lỗi TypeScript
npm run check

# 2. Toàn bộ test suite: 33 files / 540 tests phải pass 100%
npm test

# 3. Build bundle: cả 5 targets (extension, uninstall, webview, enhancements, integration) phải build thành công
npm run build
```

### 3. Các invariant kiến trúc cần nghiệm thu:
1. **Không dùng file lock**: Đã loại bỏ hoàn toàn ý tưởng lock file, dùng atomic writes và last-write-wins an toàn.
2. **Nguồn membership độc lập**: `registered-artifacts/<artifactId>.json` là single source of truth cho membership. MCP chỉ ghi file membership con này, không đụng tới `conversation.json` hay `layout.json`.
3. **Dynamic `updatedAt`**: Được tính động từ `max(createdAt, ...registeredAt)`. Khi MCP thêm/inspect artifact, `registeredAt` tăng -> `updatedAt` tự động tăng và đưa Session lên đầu danh sách mà không cần ghi file metadata.
4. **Layout Reconciliation**: Nếu `layout.json` thiếu hoặc có artifact mới chưa xếp vùng, artifact tự động được xếp vào cuối mảng `working` theo thứ tự timestamp tăng dần.
5. **Fail-Closed với Conversation v1**: MCP preflight chặn ngay lập tức nếu caller truyền ID conversation v1 với mã lỗi `CONVERSATION_MIGRATION_REQUIRED`, không tạo file rác hay làm hỏng state trước khi user chủ động migrate.
6. **Retention Cleanup**: Session v2 rỗng không bị xoá metadata/thư mục khi chạy dọn dẹp định kỳ (khác với conversation v1 cũ).

Checkpoint trên ghi lại kết quả Phase 1+2; UI chọn/gán type cho Session và phạm vi tiếp nối theo hướng dẫn Phase 3 mới nhất.

## Quản lý danh sách Session — phạm vi đã chốt

Không đổi contract auto-create/reuse chỉ vì danh sách dài. Session chỉ được tự tạo khi create/inspect theo luồng đã định nghĩa, không phải mỗi lần mở artifact hoặc mỗi lượt chat.

| Cách quản lý | Công việc | Phase phù hợp |
| --- | --- | --- |
| Filter theo type | Quick Pick một type/All Types, áp dụng lên tree; hiện active filter, giữ qua refresh trong cửa sổ, Reload về All Types | 3 |
| Search Sessions | Command Palette + kính lúp, tìm title trên toàn bộ v2 độc lập filter sidebar, chọn mở exact Session ID | 3 |
| Recent Artifacts + Xem tất cả | Recent Artifacts cap 20; Sessions hiện đầy đủ theo filter, không tự áp cap cho Sessions | Đã có ở Phase 2 |
| Pin/Unpin artifact và Session | Ghim lên đầu danh sách tương ứng, lưu trạng thái UI riêng | 5 |
| Archive/Restore/Delete artifact và Session | Search tìm cả mục Archived; mở custom editor để Restore, không Restore trong Quick Pick/menu chuột phải sidebar; Session Archive đủ 30 ngày được cleanup | 5 |

Phase 3 ưu tiên filter theo type và search title, dùng Quick Pick native. Tên, type, số lượng artifact và updatedAt giúp nhận diện Session; không thêm cờ pin/archive vào schema đợt này.

Không tự xoá Session một artifact, Session rỗng hoặc lâu không dùng chỉ vì các điều kiện đó; không tự gộp theo title. Phase 5 chỉ bổ sung cleanup Session đã Archive đủ 30 ngày; các cơ chế cleanup Session khác để sau. Filter/search không ghi recency, membership hoặc metadata Session.

Plan Phase 2 đã chốt Recent Artifacts 20 mục + Xem tất cả, Sessions hiển thị đầy đủ; chưa triển khai nhóm ghim hoặc Archive session.

## Phase 5 — Menu chuột phải, Pin và Archive

Đây là phạm vi đã chốt cho Phase 5, chưa triển khai; thực hiện cùng đợt UI helper text và tổ chức trực quan. Không bổ sung vào required scope của Phase 4.

### Trạng thái UI tách khỏi metadata của MCP

| Đối tượng | File trạng thái |
| --- | --- |
| Artifact | `<artifactDirectory>/artifact-ui-state.json` |
| Session | `<sessionDirectory>/session-ui-state.json` |

Hai file dùng cùng cấu trúc:

```json
{
  "schemaVersion": 1,
  "pinned": true,
  "archivedAt": "2026-11-07T10:00:00.000Z"
}
```

- Extension đọc/ghi trạng thái này; không thêm Pin/Archive vào `artifact.json` hoặc `conversation.json`. Giữ nguyên strict schema của MCP; riêng tính năng Pin/Archive không yêu cầu tăng artifact/session schema hay numeric MCP_VERSION.
- File chưa có thì mặc định chưa Pin/chưa Archive; `pinned` optional, mặc định `false`; `archivedAt` optional, khi thiếu trường này thì chưa Archive. Không lưu thêm boolean `isArchived`.
- Pin đưa mục lên nhóm đầu danh sách tương ứng; trong mỗi nhóm tiếp tục sắp theo recency hiện tại. Pin/Archive không cập nhật recency, membership hoặc layout.
- Artifact Pin/Archive là trạng thái toàn cục của mục trong Recent, độc lập với vùng `archived` trong layout của từng Session. Archive từ Recent không chuyển/xoá artifact trong các Session.
- Archive ẩn mục khỏi danh sách mặc định kể cả đang Pin. Search vẫn tìm được mục Archived để mở custom editor và Restore; Restore xoá `archivedAt`, Archive lại ghi mốc mới. Không đưa Restore vào menu chuột phải của hai danh sách mặc định vì các danh sách đó không hiện mục Archived.
- Giữ Recent cap 20 + Xem tất cả; áp dụng điều kiện hiển thị/filter và sắp Pin/recency trước khi lấy 20 mục.

### Menu trên từng item của danh sách mặc định

Tooltip của item Recent Artifacts hiển thị đầy đủ **Name (title)** và **Kind** theo label hiển thị; item Sessions hiển thị đầy đủ **Name (title)** và **Type** theo label Session type. Không rút gọn tên hoặc kind/type bằng `…` trong tooltip, kể cả khi label/description trên dòng bị cắt do chiều rộng sidebar. Session type độc lập với artifact kind.

| Tree View | Menu |
| --- | --- |
| Recent Artifacts | **Open**, **Copy Connect Prompt**, **Pin / Unpin**, **Archive**, **Delete** |
| Sessions | **Open**, **Rename**, **Change Type**, **Copy Connect Prompt**, **Open Instructions File**, **Copy Instructions File Path**, **Pin / Unpin**, **Archive**, **Delete** |

Tận dụng handler hiện có và luồng Connect/Instructions của Phase 4, truyền đúng ID của item được nhấn chuột phải. Các thao tác mới về trạng thái UI và Delete thuộc Phase 5.

Header Session Manager bổ sung nút **More (⋯)** trong Phase 5, menu gồm **Export**, **Archive**, **Delete**. Export tạo ZIP tài liệu theo cấu trúc bên dưới; Archive/Delete dùng cùng hành vi đã chốt cho menu sidebar. Không tạo More/Export ZIP trong Phase 4.

### Search và Restore trong custom editor

- Search Artifacts và Search Sessions bao gồm cả mục đang hoạt động và mục Archived còn tồn tại, tiếp tục tìm theo title và độc lập với filter sidebar. Kết quả Archived có nhãn **Archived** ở description.
- Chọn kết quả chỉ mở đúng artifact hoặc Session, không tự Restore, không thay `archivedAt` hoặc trạng thái Pin và không gia hạn cleanup/retention. Mục đã xoá/cleanup không còn trong kết quả.
- **Review App** hiển thị nhãn **Archived** và nút **Restore** khi artifact có trạng thái Archive toàn cục. Không suy ra trạng thái này từ vùng `archived` trong layout của Session.
- **Session Manager** hiển thị nhãn **Archived** và nút **Restore** khi chính Session đang Archive. Mục chưa Archive không hiện nút Restore.
- Nhấn Restore xoá `archivedAt` trong file trạng thái UI tương ứng, giữ nguyên `pinned`, và cập nhật sidebar để mục xuất hiện lại nếu phù hợp filter hiện tại. Restore Session đồng thời loại bỏ điều kiện cleanup theo mốc Archive 30 ngày; artifact vẫn theo retention hiện có.
- Search chỉ tìm/mở; không thêm nút Restore trong Quick Pick hoặc menu chuột phải của danh sách mặc định. Không cần một trang quản lý Archived riêng cho luồng này.

### Delete và cleanup

- Delete Session xoá thư mục Session, bao gồm metadata, instructions, layout, membership và file trạng thái UI; không xoá artifact hoặc Session khác.
- Delete artifact xoá artifact toàn cục và dọn membership/layout tham chiếu ở các Session. Đây là thao tác khác với Remove artifact khỏi một Session; xác nhận Delete phải nêu rõ phạm vi ảnh hưởng.
- Session đã Archive đủ 30 ngày tính từ `archivedAt` được xoá trong lần activation cleanup tiếp theo, cùng phạm vi xoá như Delete Session. Không dùng `Session.updatedAt` làm mốc này; Pin không miễn cleanup và hoạt động MCP không tự reset `archivedAt`.
- Giữ nguyên retention artifact hiện tại theo `artifact.json.updatedAt` và setting `agentPlus.artifactRetentionDays`. Artifact không cần Archive mới đủ điều kiện retention; Pin/Archive không gia hạn hoặc miễn retention.
- Chưa bổ sung quy tắc cleanup Session khác, không tự xoá Session chưa Archive chỉ vì rỗng hoặc lâu không dùng.

## Export ZIP Session — cấu trúc tài liệu đã chốt

Export thuộc **Phase 5**, entry là **More → Export** ở header Session Manager; không mở rộng vào Phase 4. Gói dành cho người đọc, không phải gói khôi phục dữ liệu máy. Cấu trúc ZIP:

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

- Thư mục gốc dùng tên Session; artifact dùng title làm tên file, thêm số thứ tự theo layout trong từng vùng. Chuẩn hoá ký tự không hợp lệ để tạo filename hợp lệ; prefix thứ tự phân biệt các title trùng nhau.
- Xuất toàn bộ artifact của cả ba vùng, giữ nguyên nội dung Markdown. `Instructions.md` chứa nội dung Instructions của Session.
- Không xuất metadata JSON, artifact ID trong tên file, membership, manifest, comments, submission hoặc review state. Không thiết kế import/restore lifecycle từ ZIP trong phạm vi export tài liệu này.
- Export chỉ đọc nội dung để đóng gói; không đổi trạng thái Pin/Archive, membership, layout hoặc recency của Session/artifact.

## Session types — phạm vi đã bổ sung

- Mỗi session lưu một `typeId`, mặc định `conversation`; không phải mảng tags và không phải artifact kind/type.
- Danh sách global `~/.ai-artifacts/session-types.json` gồm schemaVersion và các `{ id, label }`; seed Conversation, Project, Feature, Fix khi chưa có file. Type tự tạo dùng chung giữa workspace/session và tồn tại dù chưa sử dụng.
- ID ổn định, label sửa được. Trim/so tên không phân biệt hoa thường để tránh trùng. `conversation` đổi label được nhưng không xoá; xoá type khác đang dùng cần xác nhận chuyển các session về mặc định.
- **Phase 1:** schema/persistence và API types + assignment. **Phase 2:** popup thêm/sửa/xoá từ ⚙ trên Sessions. **Phase 3:** Type ✎ ở trên Hướng dẫn để chọn/tìm/tạo nhanh rồi gán cho Session; filter sidebar theo `typeId`; wording Session Quick Input tiếng Anh.
- Popup quản lý ghi rõ áp dụng cho tất cả phiên. Không có ⚙ quản lý types tại manager, Recent Artifacts hoặc header chung sidebar.
- Hình thức popup đã chốt là Quick Pick native, mở ở vị trí Quick Input chuẩn của VS Code; không phải popover neo cạnh ⚙. Chi tiết service, lỗi ghi và kiểm chứng nằm trong plan chung.

## Để sau bản đầu

Handoff/workflow nâng cao; participant/role; ownership hardening. Mapping Proceed theo artifact kind và Add artifact có sẵn qua Quick Pick đã thuộc Phase 4, không còn là mục hoãn. Không mở rộng required scope bằng các ý tưởng còn lại.
