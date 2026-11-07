# Sessions — Implementation plan

Trạng thái: **Đợt Phase 1+2 ĐÃ HOÀN THÀNH 100% (Cả 3 Chặng: Chặng 1, 2, 3). Phase 3 đã có hướng dẫn triển khai chi tiết, chưa triển khai code.**

> [!NOTE]
> - **Tiến độ triển khai:**
>   - ✅ **Chặng 1 (Bước 1 + 2 + 3):** Headless Session v2, Layout ba mảng, Session Types global, Migration v1→v2 kèm backup, Retention cleanup, Tích hợp MCP & Skill v4 fail-closed với lỗi `CONVERSATION_MIGRATION_REQUIRED`. Đã xong 100% tests (540/540 passed), tsc clean, build clean.
>   - ✅ **Chặng 2 (Bước 4 + 5):** Sidebar Activity Bar (Recent Artifacts cap 20 + Xem tất cả, Sessions v2), MCP v12 gate, Quick Pick native ⚙ quản lý types, Custom readonly Editor cho Session tab (`agentPlus.workSession`), webview `SessionApp.tsx` ba vùng (Working/References/Archived), click routing mở artifact review. Đã xong 100% tests (550/550 passed, 36/36 files), tsc clean, build clean cả 5 targets.
>   - ✅ **Chặng 3 (Bước 6 + 7):** ĐÃ HOÀN THÀNH: Gỡ bỏ hoàn toàn `ConversationArtifactsDrawer` cũ; thêm nút **Sessions** trên `ReviewApp.tsx` gated MCP v12; tạo dialog `ArtifactConnectDialog.tsx` (New vs Join, disabled v1 kèm tooltip & badge); mở rộng prompt connect với các mode; tạo coordinator migration `session-migration-command.ts` (single & bulk có progress/xác nhận); cập nhật icon container `layers.svg`, title `AI Artifacts`, views `visibility: "visible"`. Đã xong 100% tests (548/548 passed, 37/37 files), tsc clean, build clean cả 5 targets.

Ngoại lệ chuẩn bị: theo yêu cầu Chú, numeric MCP_VERSION đã tăng **11 → 12** để test phân biệt bản cũ/mới; `SKILL_VERSION` đã được nâng lên **4** để hỗ trợ hợp đồng phục hồi lỗi v1; package giữ 1.1.4.

Nguồn yêu cầu: [analyzed.md](analyzed.md) và các quyết định tiếp nối trong chat. Khi khác nhau, quyết định mới trong chat được ưu tiên: `rules` đổi thành `instructions` (một chuỗi Markdown); style/UI library để bàn sau; chọn dnd-kit cho kéo thả.

**Đợt triển khai đầu gộp Phase 1 + 2 trong [plan-phase-1-2.md](plan-phase-1-2.md).**

**Đợt tiếp theo: [hướng dẫn Phase 3](plan-phase-3.md), gồm 6 bước / 3 chặng.** Phạm vi mới nhất của Phase 3 được chốt tại đây, thay các đề xuất cũ về header/session actions.

## Các phase

| Phase | Kết quả | Trạng thái |
| --- | --- | --- |
| [1. Session model](plan-phase-1-2.md) | Metadata Session v2 (`title`, `instructions`, `typeId`, `createdAt`), giữ `registered-artifacts/` làm nguồn membership, tách `layout.json` ba mảng, tính `updatedAt` từ `createdAt`/`registeredAt`; auto-create/reuse; migration theo yêu cầu; registry session types và API quản lý | ✅ **Đã hoàn thành trong Chặng 1** |
| [2. Sidebar và điều hướng](plan-phase-1-2.md#phase-2--sidebar-quản-lý-session-types-và-điều-hướng) | Recent Artifacts/Sessions v2; gate theo MCP đã cài; phát hiện và popup bulk migration; ⚙ quản lý types; tab session chỉ đọc; Sessions/migration đơn lẻ thay drawer cũ | ✅ **Đã hoàn thành trong Chặng 2 & Chặng 3** |
| [3. Session Manager cơ bản](plan-phase-3.md) | Refresh theo phần; sửa `title`/`instructions`/`typeId`; Working và panel phải; nhớ panel riêng từng Session; menu move/reorder/remove artifact; filter Sessions theo type, Search Sessions bằng Quick Pick; English Quick Input | Đã có hướng dẫn, chưa triển khai |
| 4. Agent và catalog | Connect từ manager; hoàn thiện new/join sau popup inspect tối thiểu ở Phase 2; catalog title/description/type/directory và instructions; cung cấp exact Session ID/metadata path và hướng dẫn AI sửa instructions bằng công cụ file; đọc file chọn lọc | Chưa triển khai |
| 5. Tổ chức trực quan | Card masonry, hiển thị metadata/description theo catalog đã chốt; filter/search artifact; `dnd-kit` sắp xếp và chuyển vùng, chỉ ghi `layout.json` một lần sau khi thả thành công (tách biệt với `registered-artifacts/` của MCP, bản lưu sau cùng thắng) | Chưa triển khai |

## Ranh giới chung

- Một artifact có thể nằm trong nhiều session; `registered-artifacts/<artifactId>.json` là nguồn membership duy nhất của mỗi session, còn `layout.json` lưu ba mảng `working`, `references`, `archived` và thứ tự hiển thị (chỉ lưu một lần sau khi kéo thả/chuyển vùng thành công). Artifact đã đăng ký nhưng chưa có trong `layout.json` mặc định nằm cuối `working`.
- Bỏ file lock riêng cho layout/session; dùng atomic write và chấp nhận quy tắc “bản lưu sau cùng thắng” khi nhiều cửa sổ cùng cập nhật bố cục/metadata.
- `Session.updatedAt` hiển thị được tính khi đọc từ thời điểm lớn nhất giữa `createdAt` và các `registeredAt` trong `registered-artifacts/`. MCP tạo hoặc inspect lại artifact cập nhật `registeredAt` như hiện tại nên tự đẩy Session lên đầu mà không cần sửa `conversation.json`; kéo thả (`layout.json`) hoặc sửa metadata không làm thay đổi `updatedAt`.
- Gỡ artifact khỏi session xoá file trong `registered-artifacts/` và bỏ ID khỏi `layout.json`. Không xoá artifact hoặc ảnh hưởng session khác; Session v2 rỗng vẫn được giữ.
- `instructions` là một nội dung Markdown do user kiểm soát, AI được hỗ trợ sửa trường này trong `conversation.json` bằng công cụ file riêng khi user yêu cầu. Phase 3 có textarea cố định số dòng/chiều cao, cuộn bên trong và Save, đồng thời nhận giá trị instructions thực sự đổi trên đĩa. Không thêm tool MCP sửa Hướng dẫn; Phase 4 bổ sung metadata path/quy tắc chỉnh instructions vào agent context/skill. Attach file/folder và rich editor để sau.
- Giữ artifact schema v6 và cơ chế ownership/review hiện tại. Session ID không phải reviewSessionId.
- Phase 1 nối model mới vào luồng hiện tại; popup inspect chọn New/Join tối thiểu thuộc đợt Phase 1+2, Phase 4 mới hoàn thiện contract agent/catalog và trải nghiệm new/join đầy đủ.
- Header manager Phase 3 có title/đổi tên và toggle panel; Working ở giữa, panel phải Type → Hướng dẫn → References → Archived. Nhớ panel theo Session ID bằng extension `globalState`. Connect thuộc Phase 4; Pin/Archive/Delete Session để sau, không thuộc Phase 3.
- Sidebar Sessions đã có ⚙ quản lý types; Phase 3 thêm phễu filter theo type và kính lúp Search Sessions, giữ Tree Views native. **Không có + session**. Session tạo qua luồng artifact/new-session; điều hướng/filter/search không tạo session.
- Phase 3 refresh theo loại thay đổi và ID: card/membership/layout hoặc title/type đổi không set lại ô Hướng dẫn. Nếu chính instructions trên đĩa đổi, gửi patch và nhận giá trị mới kể cả đang gõ; so với giá trị persisted trước đó, không so với ô nhập để phát hiện dirty. Không thêm `isDirty`, draft recovery, dirty dialog hoặc conflict handling AI–user/nhiều manager; chấp nhận bản ghi sau cùng thắng.
- Session được mở theo kết quả kiểm tra MCP đã cài trên đĩa, mốc numeric MCP_VERSION **12**; tạm thời không kiểm tra process đang chạy. MCP chưa đủ version chặn section Sessions và nút Sessions trên Review App, không chặn Recent Artifacts/Connect/review. MCP server v12 đã xong ở Chặng 1, phần UI gate ở extension thuộc Chặng 2.
- Sidebar chỉ list Session v2. Conversation v1 được phát hiện/đếm read-only; hiện dòng “Có N conversation có thể chuyển sang Sessions”, click mở popup xác nhận rồi mới chạy bulk tuần tự bằng cùng hàm migration đơn lẻ. Huỷ không ghi; kết thúc báo kết quả và refresh.
- Bỏ drawer conversation cũ. Review App có Sessions cho v2, hành động migration từng conversation cho v1 khi MCP đã đủ version. Không tự migration khi activation, đọc/list, mở artifact hoặc cleanup. Không rollback cả batch nếu một mục lỗi.
- Create và inspect **có truyền ID conversation v1** cùng trả lỗi trước mutation/takeover/cấp token, mã `CONVERSATION_MIGRATION_REQUIRED`; không giữ nhánh inspect thành công kèm cảnh báo. Artifact từng thuộc v1 không tự gây lỗi nếu caller không truyền ID v1; ID v2/không có ID vẫn dùng Session API mới và ghi `registered-artifacts/` như hiện tại.
- Skill hướng dẫn đúng hai lựa chọn: mở một artifact đã thuộc conversation cũ để migration rồi retry cùng ID, hoặc user chọn tạo/mở Session mới thì retry không truyền ID và giữ ID mới cho chat. Không tự đổi nhóm, nhập membership cũ, clone artifact hoặc xoá conversation cũ. Hướng dẫn lỗi tối thiểu này đã được triển khai trong Chặng 1 cùng với việc nâng `SKILL_VERSION` từ **3 → 4**.
- Popup inspect: conversation v1 thì Join disabled, chỉ cho inspect New Session; Session v2 có thể Join. New không truyền ID cũ và yêu cầu skill bỏ active ID cho request, Join chỉ định đúng ID v2. Có nhiều membership thì chỉ disable các đích v1. Extension copy prompt cho AI, không tự gọi MCP/mutate; chi tiết và nhánh MCP cũ ở mục 12 plan chung. Nhãn nút điều hướng đã chốt là **Sessions**.
- **Đã chốt:** MCP cũ giữ Connect như hiện tại, click copy prompt exact artifact handle trực tiếp; không mở popup New/Join hoặc yêu cầu tạo Session v2. Chỉ MCP mới đủ mốc Session mới dùng popup/luồng New/Join. Recent Artifacts dùng 20 mục + Xem tất cả; quản lý types dùng Quick Pick native.
- **Lựa chọn icon mới nhất:** Activity Bar dùng Codicon `library` có sẵn qua `icon: "$(library)"`, thay lựa chọn `layers` trước đó; label/tiêu đề container là **AI Artifacts**, không thêm Manager/Management. Giữ hai section **Recent Artifacts** và **Sessions**.
- Chưa thêm dependency UI/style trong giai đoạn lập plan.

## 6 bước nhỏ trong Phase 3 (Tổ chức theo 3 Chặng)

Chi tiết file, luồng xử lý, khả năng phải đạt và kiểm chứng ở [plan-phase-3.md](plan-phase-3.md).

| Chặng | Bước | Công việc |
| --- | --- | --- |
| 1 | 1 + 2 | Scoped events từ watcher tới consumer; typed manager actions qua host/registry, lỗi tại thao tác. |
| 2 | 3 | UI sửa tên/Hướng dẫn/type; bố cục Working + panel, preference riêng từng Session; menu move/reorder/remove artifact. |
| 3 | 4 + 5 + 6 | Filter/search Sessions bằng native Quick Pick; English Quick Input; tests/check/build, Extension Host và bàn giao. |

Toàn bộ các bước Phase 3 **chưa triển khai**. Không có migration/schema mới, dirty dialog, conflict handling, Pin/Archive/Delete Session hoặc Connect manager trong đợt này.

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
| Pin Session | Ghim và tổ chức nhóm phiên | Để sau Phase 3 |
| Archive/Restore/Delete Session | Quản lý trạng thái/vòng đời Session; độc lập với vùng artifact `archived` | Để sau Phase 3 |

Phase 3 ưu tiên filter theo type và search title, dùng Quick Pick native. Tên, type, số lượng artifact và updatedAt giúp nhận diện Session; không thêm cờ pin/archive vào schema đợt này.

Không tự xoá Session một artifact, Session rỗng hoặc lâu không dùng; không tự gộp theo title. Những cách đó có thể làm mất cách tổ chức/instructions của user. Filter/search không ghi recency, membership hoặc metadata Session.

Plan Phase 2 đã chốt Recent Artifacts 20 mục + Xem tất cả, Sessions hiển thị đầy đủ; chưa triển khai nhóm ghim hoặc Archive session.

## Session types — phạm vi đã bổ sung

- Mỗi session lưu một `typeId`, mặc định `conversation`; không phải mảng tags và không phải artifact kind/type.
- Danh sách global `~/.ai-artifacts/session-types.json` gồm schemaVersion và các `{ id, label }`; seed Conversation, Project, Feature, Fix khi chưa có file. Type tự tạo dùng chung giữa workspace/session và tồn tại dù chưa sử dụng.
- ID ổn định, label sửa được. Trim/so tên không phân biệt hoa thường để tránh trùng. `conversation` đổi label được nhưng không xoá; xoá type khác đang dùng cần xác nhận chuyển các session về mặc định.
- **Phase 1:** schema/persistence và API types + assignment. **Phase 2:** popup thêm/sửa/xoá từ ⚙ trên Sessions. **Phase 3:** Type ✎ ở trên Hướng dẫn để chọn/tìm/tạo nhanh rồi gán cho Session; filter sidebar theo `typeId`; wording Session Quick Input tiếng Anh.
- Popup quản lý ghi rõ áp dụng cho tất cả phiên. Không có ⚙ quản lý types tại manager, Recent Artifacts hoặc header chung sidebar.
- Hình thức popup đã chốt là Quick Pick native, mở ở vị trí Quick Input chuẩn của VS Code; không phải popover neo cạnh ⚙. Chi tiết service, lỗi ghi và kiểm chứng nằm trong plan chung.

## Để sau bản đầu

Handoff; next action theo type; tìm artifact ngoài session để thêm; participant/role; ownership hardening. Không mở rộng required scope bằng các mục này.
