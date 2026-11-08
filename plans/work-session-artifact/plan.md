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

**[Hướng dẫn Phase 4](plan-phase-4.md) gồm 7 bước / 3 chặng — Đã hoàn thành 100%:** Chặng 1 (storage & resolver), Chặng 2 (MCP Join & Proceed directives), và Chặng 3 (UI Connect/Add Session/Add Artifact/Recent kind filter, Skill v6 bump và docs canonical) đã hoàn tất và nghiệm thu toàn diện. Giữ MCP **12** cho toàn bộ feature chưa release và nhận metadata có `instructions` optional; nội dung hiệu dụng chỉ từ Markdown. Skill v6 với 6 tools. Không mở lại Chặng 1 cho phần UI Add bổ sung.

Validation đính chính Chặng 1: check/build pass, toàn bộ **43 test files / 611 tests pass, 3 skipped** (2026-11-07). Chưa kiểm chứng lại sidebar với dữ liệu global trong Extension Host; checkpoint này không đánh dấu hoàn thành Chặng 2–3.

Hướng dẫn phần còn lại đã được rà lại với code hiện tại: [mục 3.7](plan-phase-4.md#37-shape-entry-result-và-ranh-giới-commit-của-chặng-2) chốt response/commit, Bước 3 có checkpoints tách core → context/recovery → Join, Bước 5 có checkpoints events/actions → prompt/UI → Add, Bước 6 nối filter hai đầu, Bước 7 chốt skill/asset contract. Giữ chip type/layout UI Chú đang chỉnh, MCP 12 và phạm vi Phase 5. Baseline review riêng: 8 suites / 145 tests pass, 1 skipped; không phải bằng chứng đã triển khai Chặng 2–3.

**[Hướng dẫn Phase 4.5](plan-phase-4.5.md) gồm 6 bước / 3 chặng; Chặng 1 đã triển khai theo xác nhận của Chú ngày 2026-11-08:** artifact standalone và Session opt-in → Chặng 2: Start từ artifact/Inspect trực tiếp, hai skills và [README/branding đã chốt nguyên văn](phase-4.5-wording/readme-branding.md) → Chặng 3: version/installer/validation và hoàn tất docs install/version. [Bộ wording skills nguyên văn](phase-4.5-wording/manifest.json) là nguồn bắt buộc khi triển khai, không tự diễn đạt lại. Giữ MCP 12; artifact skill 7 và Session skill 1 có counter/receipt riêng; customize chỉ artifact skill. Hành vi này thay auto-create và popup Inspect New/Join đã triển khai ở Phase 4, không mở lại lịch sử phase đó. Lượt bổ sung docs không kiểm chứng lại implementation Chặng 1.

**[Hướng dẫn Phase 5](plan-phase-5.md) gồm 8 bước / 3 chặng, chưa triển khai:** nền UI state/deletion và Module seed-only → sidebar menus/Search/Restore/cleanup → grid/card/filter/helper text, edit title/type artifact + Proceed nhận kind mới, Export ZIP và nghiệm thu. Phần edit artifact nằm ở **Bước 6.2 / Chặng 3**, UI/host/MCP làm cùng đợt. Triển khai trên baseline Phase 4.5, giữ grid, header Archived chỉ Restore primary và reuse retention/prune; không đưa các tính năng này vào 4.5.

**README/branding của Chặng 2 Phase 4.5:** đã áp dụng text/structure README và package displayName/description theo [spec](phase-4.5-wording/readme-branding.md) ngày 2026-11-08; extension ID/version giữ nguyên. GIF còn chờ; Chặng 3 đồng bộ thông tin installer/version khi hai skills hoàn tất. Đây là tiến độ tài liệu/metadata, không xác nhận toàn Chặng 2 hoặc runtime behavior.

## Các phase

| Phase | Kết quả | Trạng thái |
| --- | --- | --- |
| [1. Session model](plan-phase-1-2.md) | Metadata Session v2 (`title`, `instructions`, `typeId`, `createdAt`), giữ `registered-artifacts/` làm nguồn membership, tách `layout.json` ba mảng, tính `updatedAt` từ `createdAt`/`registeredAt`; auto-create/reuse; migration theo yêu cầu; registry session types và API quản lý | ✅ **Đã hoàn thành trong Chặng 1** |
| [2. Sidebar và điều hướng](plan-phase-1-2.md#phase-2--sidebar-quản-lý-session-types-và-điều-hướng) | Recent Artifacts/Sessions v2; gate theo MCP đã cài; phát hiện và popup bulk migration; ⚙ quản lý types; tab session chỉ đọc; Sessions/migration đơn lẻ thay drawer cũ | ✅ **Đã hoàn thành trong Chặng 2 & Chặng 3** |
| [3. Session Manager cơ bản](plan-phase-3.md) | Manager editing, scoped refresh, menu move/reorder/remove, panel preference, filter/search và English Quick Input; bổ sung contract một active Session cho mỗi chat AI | ✅ **Đã hoàn thành toàn bộ (Bước 1–7)** |
| [4. Agent và catalog](plan-phase-4.md) | Add Session rỗng / Add Artifact; shared context/catalog, Join và Instructions Markdown; fixed/open kinds/Proceed; Connect/filter/English UI, skill v6 | Hoàn thành theo checkpoint Phase 4; contract standalone/Inspect mới tiếp nối ở 4.5 |
| [4.5. Artifact độc lập và Work Session skill](plan-phase-4.5.md) | Standalone mặc định khi không active Session; active S tự thêm create/inspect trừ explicit standalone; Start từ artifact + mở/copy Connect; bỏ Inspect New/Join; tách hai skills với wording frozen, version độc lập, customize chỉ artifact; README/branding trong Chặng 2 | Chặng 1 đã triển khai theo xác nhận của Chú; tiếp tục Chặng 2 — hướng dẫn và wording đã có |
| [5. Tổ chức trực quan và quản lý danh sách](plan-phase-5.md) | Card grid theo thứ tự array, description và filter/search artifact; helper text/padding side panel; Review header ROUND trước type, sửa title/type và tạo kind mở, MCP trả Proceed theo kind mới; đổi tên (Rename) và đổi loại (Change Type) cho artifact từ menu More trên thẻ và trên Session header; menu chuột phải/tooltip; manager More → Export ZIP/Archive/Delete, header Archived chỉ Restore; Pin/Archive với UI state riêng; Delete dùng lại retention/prune, cleanup Session sau 30 ngày Archive; seed type Module khi chưa có file types. Sắp xếp/chuyển vùng dùng menu hiện có, ghi `layout.json` độc lập membership MCP | Đã hoàn thành triển khai Chặng 1, 2, 3 — Đang review & nghiệm thu |

## Ranh giới chung

- Một artifact có thể nằm trong nhiều session; `registered-artifacts/<artifactId>.json` là nguồn membership duy nhất của mỗi session, còn `layout.json` lưu ba mảng `working`, `references`, `archived` và thứ tự hiển thị, cập nhật qua menu move/reorder. Artifact đã đăng ký nhưng chưa có trong `layout.json` mặc định nằm cuối `working`.
- Bỏ file lock riêng cho layout/session; dùng atomic write và chấp nhận quy tắc “bản lưu sau cùng thắng” khi nhiều cửa sổ cùng cập nhật bố cục/metadata.
- `Session.updatedAt` hiển thị được tính khi đọc từ thời điểm lớn nhất giữa `createdAt` và các `registeredAt` trong `registered-artifacts/`. MCP tạo hoặc inspect lại artifact cập nhật `registeredAt` như hiện tại nên tự đẩy Session lên đầu mà không cần sửa `conversation.json`; move/reorder (`layout.json`) hoặc sửa metadata không làm thay đổi `updatedAt`.
- Gỡ artifact khỏi session xoá file trong `registered-artifacts/` và bỏ ID khỏi `layout.json`. Không xoá artifact hoặc ảnh hưởng session khác; Session v2 rỗng vẫn được giữ, trừ khi user Delete hoặc Session đã Archive đủ hạn theo quy tắc Phase 5.
- `instructions` là nội dung Markdown chứa rules, workflows và các hướng dẫn khác cho AI trong Session. Phase 4 dùng `instructions.md` làm nguồn chính; textarea sửa Markdown thẳng + Save và Open Markdown File dùng cùng file. Schema metadata v2 strict chấp nhận `instructions` optional string cũ nhưng không dùng làm fallback; metadata writer mới omit field. Read/list không tự migrate hoặc rewrite. DTO vẫn có chuỗi instructions đọc từ file, thiếu file thì rỗng. Attach file/folder và rich editor để sau.
- Helper text cho các zone và Instructions là công việc UI của Phase 5, không phải trường metadata mới. Wording Instructions: “Rules, workflows, and other guidance for AI in this session.” Description ngắn của artifact trong catalog vẫn thuộc Phase 4; đây là hai loại description khác nhau.
- Giữ artifact schema v6 và cơ chế ownership/review hiện tại. Session ID không phải reviewSessionId.
- Phase 4 thêm `join_session(sessionId, artifactId?)`: join-only trả context và không takeover/register; có artifact thì dùng chung core inspect và trả inspection trong một call. Create/inspect trả thêm context; đọc tài liệu tham khảo theo catalog exact path không cần readonly inspect. `artifactConversationId` ở API cũ và `sessionId` mới cùng là Work Session ID, không rename toàn bộ API trong đợt này.
- Phase 4 đã có English UI/Tree Views; Phase 4.5 bỏ popup New/Join ở artifact Inspect. Nút Inspect chỉ copy exact handle, không chọn/tạo/chuyển phiên. Artifact không có cả v2 lẫn legacy membership hiện **Start a work session** + helper: “For ongoing work, keep related artifacts and shared instructions together across agents and chats.” Nhập tên → tạo/đăng ký vào Working → mở manager + copy Connect prompt; có memberships thì giữ Sessions/migration như cũ. Session Connect mang metadata/Instructions/catalog, không transcript chat khác. Wording đầy đủ ở bộ payload của 4.5.
- Artifact kind theo bộ cố định `plan`, `implementation-plan`, `idea`, `analysis`, `design`, `spec`, `checklist`, `report`, `guide`, `note` và cho phép kind mở. Hai kind plan Proceed trả `execute-approved-plan`; mọi kind khác trả `approved`. Recent filter All Types/từng kind cố định/Other thuộc Phase 4; manager artifact filters thuộc Phase 5.
- Phase 5 cho user sửa artifact title/kind qua native input/picker, gồm tạo kind mở; header ROUND đứng trước type. Chỉ patch metadata title/kind, giữ updatedAt/round/Markdown/comments/membership; bản ghi sau cùng thắng. MCP đọc lại manifest đúng artifact/round khi xử lý submission để kind/nextAction thống nhất ở cả hai wait flows; không đổi policy Proceed hoặc phát lại saved decision. Đây là ngoại lệ hẹp cho extension sửa hai trường metadata, không mở quyền ghi review lifecycle khác.
- Một Session có thể được nhiều chat dùng, mỗi chat giữ 0 hoặc 1 active Session. Theo contract 4.5: chưa active thì create/inspect không ID/tên phiên là standalone; đang S thì mặc định truyền S để thêm/làm mới membership. Explicit standalone bỏ cả ID/tên phiên cho request đó nhưng vẫn giữ S; explicit New phải truyền `conversationName` và omit ID cũ. Join/New đổi active sau thành công, không xoá membership hoặc handle mappings khác. Không lưu chat mapping trong registry.
- Các controls đã được chấp nhận là baseline cho các phase sau: Quick Pick chọn/tạo type, Input Box đổi title, textarea + Save cho instructions, menu Move to / Move Up / Move Down. Không có yêu cầu thay bằng inline editor, rich editor hoặc kéo thả.
- Popup Inspect New/Join là output lịch sử Phase 1–4; Phase 4.5 loại khỏi luồng artifact, đưa Session entry về Start/Sessions/sidebar/manager Connect và skill Session riêng. Giữ các chức năng context/catalog/Join đã triển khai.
- Header manager Phase 3 có title/đổi tên và toggle panel; Working ở giữa, panel phải Type → Hướng dẫn → References → Archived. Nhớ panel theo Session ID bằng extension `globalState`. Connect và nút ＋ Add Artifact của Working thuộc Phase 4/Bước 5. Menu More → Export ZIP/Archive/Delete cùng Pin/Archive/Delete artifact/Session thuộc Phase 5.
- Sidebar Sessions có ⚙ quản lý types, filter và Search Sessions. Quyết định bổ sung cho Phase 4/Bước 5: thêm **Add Session** trên header Tree View, nhập title rồi tạo phiên rỗng với type mặc định Conversation và mở manager. Quyết định này thay giới hạn cũ “không có + session”; điều hướng/filter/search vẫn không tự tạo Session. Add Artifact dùng Quick Pick chọn artifact có sẵn, loại member đã thuộc Session và đăng ký vào cuối Working; không inspect/takeover.
- Phase 3 refresh theo loại thay đổi và ID: card/membership/layout hoặc title/type đổi không set lại ô Hướng dẫn. Nếu chính instructions trên đĩa đổi, gửi patch và nhận giá trị mới kể cả đang gõ; so với giá trị persisted trước đó, không so với ô nhập để phát hiện dirty. Không thêm `isDirty`, draft recovery, dirty dialog hoặc conflict handling AI–user/nhiều manager; chấp nhận bản ghi sau cùng thắng.
- Session được mở theo kiểm tra MCP trên đĩa, giữ MCP_VERSION/gate **12** cho feature chưa release; không kiểm tra process đang chạy. Runtime/receipt phải khớp bundle và AI client cần restart theo luồng cài đặt hiện có. Phase 4 kết thúc với artifact skill 6; Phase 4.5 dùng artifact skill **7**, Session skill **1**, receipt map độc lập theo skill/target và chỉ customize artifact skill. MCP cũ giữ đường review/Inspect legacy; không hứa semantics standalone mới khi runtime chưa cập nhật.
- Sidebar chỉ list Session v2. Conversation v1 được phát hiện/đếm read-only; hiện dòng “Có N conversation có thể chuyển sang Sessions”, click mở popup xác nhận rồi mới chạy bulk tuần tự bằng cùng hàm migration đơn lẻ. Huỷ không ghi; kết thúc báo kết quả và refresh.
- Bỏ drawer conversation cũ. Review App có Sessions cho v2, hành động migration từng conversation cho v1 khi MCP đã đủ version. Không tự migration khi activation, đọc/list, mở artifact hoặc cleanup. Không rollback cả batch nếu một mục lỗi.
- Create và inspect **có truyền ID conversation v1** vẫn lỗi trước mutation/takeover/token, mã `CONVERSATION_MIGRATION_REQUIRED`. Artifact từng thuộc v1 không tự gây lỗi nếu caller không truyền ID v1. Theo 4.5, ID v2 chọn Session, tên không ID tạo mới, không cả hai thì standalone không đọc/ghi registry; không tự migrate vì artifact có membership cũ.
- Session recovery 4.5 giữ hai lựa chọn khi gặp v1: mở artifact để migrate rồi retry cùng ID, hoặc user chủ động bắt đầu Session mới qua tên không ID/UI tạo phiên + Connect. Chỉ omit ID không còn có nghĩa tạo mới. Không tự đổi nhóm, copy membership, clone artifact hoặc xoá conversation cũ.
- Artifact Inspect không còn Session options; muốn kết nối phiên thì mở từ Sessions/sidebar rồi dùng manager Connect. Prompt Inspect không nhắc phiên vẫn áp active S nếu chat đã kết nối; chỉ explicit standalone mới bỏ đăng ký cho request. Start từ artifact là mutation tổ chức do extension host thực hiện, khác với Inspect/Connect chỉ copy prompt.
- Recent Artifacts giữ cap 20 + View all và native type/kind controls. Toàn bộ semantic standalone, Start, hai skill và nguyên văn prompts nằm trong Phase 4.5; không tự thêm công cụ MCP hoặc tự gửi prompt vào chat thay user.
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

## Phase 5 — Trình bày, sửa metadata artifact và quản lý danh sách

Đây là phạm vi đã chốt cho Phase 5, chưa triển khai; hướng dẫn theo component, file cần sửa, checkpoints và validation tại [plan-phase-5.md](plan-phase-5.md). Không bổ sung vào required scope của Phase 4.

### Review App — Round, title và type có thể chỉnh

- Header hiển thị **ROUND n · Type**; pencil riêng ở type và title. Rename dùng Input Box (trim, 1–200 ký tự); Change artifact type dùng Quick Pick bộ fixed + kinds mở hiện được sử dụng + **Create new type…**. Kind mở nhập slug theo schema hiện có, label thay `-` bằng khoảng trắng và in hoa chữ đầu. Không thêm registry/CRUD taxonomy; Session Type giữ độc lập.
- Extension chỉ patch `artifact.json.title`/`kind` qua bound artifact và atomic write, bản ghi sau cùng thắng với AI; không xử lý conflict. Không đổi `updatedAt`, round, nội dung Markdown hoặc các file review/membership. Rename metadata không tự đổi heading Markdown. Header Archived vẫn chỉ Restore, ẩn cả hai nút edit.
- Metadata patch cập nhật header/sidebar/card/filter/catalog, giữ feedback và Instructions draft. MCP shared submission result đọc lại manifest cùng identity/round cho `kind` và `nextAction`: plan/implementation-plan thực thi plan, các kind khác approved. Không thêm field vào submission, restart waiter hoặc reexecute approval cũ.
- Hướng dẫn file/API/actions/picker wording/tests ở **Bước 6.2 / Chặng 3** của phase chi tiết; UI và sửa MCP phải hoàn thành cùng checkpoint. Schema artifact v6 không đổi; MCP Resources/Composer Mentions chưa thuộc phạm vi này.

### Grid, card và helper text trong manager

- **Grid thay masonry:** render trái sang phải rồi xuống hàng theo array của từng zone; Move Up/Down đổi index array và giao diện tự áp lại. Không drag/drop, column layout/dense packing hoặc lưu vị trí card riêng.
- Breakpoint tính theo content container **toàn manager**: Small dưới 800px, Medium 800–1099px, Large từ 1100px là ngưỡng triển khai ban đầu. Panel đóng: Large 3 / Medium 2 / Small 1 cột Working. Panel mở: Large 2 / Medium 1 / Small 1; không trừ thêm cột sau khi đo container Working.
- References và Archived luôn hai cột trong side panel rộng khoảng 360px; Small xếp panel dưới Working để tránh tràn. Padding các block Type/Instructions/References/Archived giảm nhẹ, bằng nhau từ 14px 16px xuống 12px 14px; giữ chip Type/header alignment/textarea đã chấp nhận.
- Card có title/kind label/description ngắn từ Markdown bằng helper Phase 4; search theo title và filter kind thực có trong Session (gồm kind mở) chỉ tạo visible arrays. Không ghi array đã lọc vào layout hoặc làm đổi recency; menu reorder dùng thứ tự gốc.
- Helper text cố định cho Working/References/Archived/Instructions, không thêm zone description vào metadata. Giữ câu Instructions: “Rules, workflows, and other guidance for AI in this session.”

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
- **Review App** hiển thị nhãn **Archived** khi artifact có trạng thái Archive toàn cục; giữ tên nhưng ẩn các action buttons bình thường trên header, chỉ hiện nút **Restore** màu primary. Không suy ra trạng thái này từ vùng `archived` trong layout của Session.
- **Session Manager** áp dụng cùng header Restore-only khi chính Session đang Archive; ẩn Rename/Connect/More/panel toggle trên header. Mục chưa Archive không hiện Restore. Không suy ra chính sách read-only toàn bộ nội dung hoặc thay review lifecycle từ quyết định header này.
- Nhấn Restore xoá `archivedAt` trong file trạng thái UI tương ứng, giữ nguyên `pinned`, và cập nhật sidebar để mục xuất hiện lại nếu phù hợp filter hiện tại. Restore Session đồng thời loại bỏ điều kiện cleanup theo mốc Archive 30 ngày; artifact vẫn theo retention hiện có.
- Search chỉ tìm/mở; không thêm nút Restore trong Quick Pick hoặc menu chuột phải của danh sách mặc định. Không cần một trang quản lý Archived riêng cho luồng này.

### Delete và cleanup

- Delete Session xoá thư mục Session, bao gồm metadata, instructions, layout, membership và file trạng thái UI; không xoá artifact hoặc Session khác.
- Delete artifact xoá artifact toàn cục và dọn membership/layout tham chiếu ở các Session. Tách phần xác thực/staging/xoá một target từ retention để dùng chung, rồi gọi `cleanupStaleConversations` đã có để prune membership và ba mảng layout; không gọi nguyên sweep theo tuổi hoặc viết lại scanner. Cleanup tham chiếu vẫn best-effort, giữ Session v2 rỗng và báo đúng nếu artifact đã xoá nhưng dọn tham chiếu chưa hoàn tất. Đây là thao tác khác với Remove khỏi một Session; xác nhận Delete phải nêu rõ phạm vi ảnh hưởng.
- Mở Session hiện không tự prune artifact đã mất: reconciliation chỉ đối chiếu layout với membership, manager hiện `unavailable` nếu nguồn artifact lỗi/mất. Không thêm watcher tự dọn mọi thao tác xoá ngoài extension; các mục này có thể được dọn ở lượt cleanup tiếp theo.
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
- Danh sách global `~/.ai-artifacts/session-types.json` gồm schemaVersion và các `{ id, label }`; Phase 5 thêm **Module** (`module`) vào seed theo thứ tự Conversation, Project, Module, Feature, Fix khi chưa có file. Không backfill/merge/migrate file types đã tồn tại vì feature chưa release; không tự xoá file global để test. Conversation vẫn là type được gán mặc định khi tạo Session. Type tự tạo dùng chung giữa workspace/session và tồn tại dù chưa sử dụng.
- ID ổn định, label sửa được. Trim/so tên không phân biệt hoa thường để tránh trùng. `conversation` đổi label được nhưng không xoá; xoá type khác đang dùng cần xác nhận chuyển các session về mặc định.
- **Phase 1:** schema/persistence và API types + assignment. **Phase 2:** popup thêm/sửa/xoá từ ⚙ trên Sessions. **Phase 3:** Type ✎ ở trên Hướng dẫn để chọn/tìm/tạo nhanh rồi gán cho Session; filter sidebar theo `typeId`; wording Session Quick Input tiếng Anh.
- Popup quản lý ghi rõ áp dụng cho tất cả phiên. Không có ⚙ quản lý types tại manager, Recent Artifacts hoặc header chung sidebar.
- Hình thức popup đã chốt là Quick Pick native, mở ở vị trí Quick Input chuẩn của VS Code; không phải popover neo cạnh ⚙. Chi tiết service, lỗi ghi và kiểm chứng nằm trong plan chung.

## Để sau bản đầu

Handoff/workflow nâng cao; participant/role; ownership hardening. Mapping Proceed theo artifact kind và Add artifact có sẵn qua Quick Pick đã thuộc Phase 4, không còn là mục hoãn. Không mở rộng required scope bằng các ý tưởng còn lại.
