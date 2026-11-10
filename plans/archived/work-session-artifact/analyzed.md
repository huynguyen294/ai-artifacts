# Work Session — Phân tích, quyết định và hướng triển khai — 2026-11-06

> **Cập nhật tiếp nối — Session types, thiết kế lưu trữ tách `registered-artifacts/` + `layout.json` và gộp Phase 1+2:** Phần này ưu tiên hơn snapshot phân tích bên dưới khi có khác biệt. Phase 1+2 theo [plan-phase-1-2.md](plan-phase-1-2.md) và phạm vi ban đầu của [Phase 3](plan-phase-3.md) đã hoàn thành theo tiến độ ghi nhận; Bước 7 mở rộng Chặng 3 chưa triển khai. Tổng quan ở [plan.md](plan.md).
>
> - `rules` đổi tên thành `instructions`, một chuỗi Markdown; nhãn UI “Hướng dẫn”.
> - **Tách biệt lưu trữ Session v2 thành 3 phần để tránh xung đột ghi giữa MCP và Manager:**
>   - `conversation.json` (schema v2): chỉ lưu `sessionId`, `title`, `typeId`, `instructions`, `createdAt`.
>   - `registered-artifacts/<artifactId>.json` (giữ nguyên schema v1): là **nguồn membership duy nhất** của mỗi Session. MCP khi create/inspect chỉ ghi/cập nhật file này (giữ nguyên cơ chế cập nhật `registeredAt` và rollback `previousMembershipRegisteredAt` hiện tại), không đụng tới `conversation.json` (khi reuse) hay `layout.json`.
>   - `layout.json`: lưu ba mảng ID có thứ tự (`working`, `references`, `archived`), do Manager ghi qua menu move/reorder. Artifact có trong `registered-artifacts/` nhưng chưa có trong `layout.json` mặc định được nối vào cuối `working` theo thứ tự `registeredAt` tăng dần.
>   - **Bỏ file lock cho session/layout:** dùng atomic write, chấp nhận quy tắc “bản lưu sau cùng thắng” (last write wins) kết hợp watcher refresh.
>   - **Quy tắc `Session.updatedAt` hiển thị:** tính động khi đọc bằng `max(createdAt, ...registeredAt)`. MCP tạo mới hoặc inspect lại artifact đều cập nhật `registeredAt` nên tự đẩy Session lên đầu danh sách Recent; move/reorder (`layout.json`) hoặc sửa metadata (`title`, `instructions`, `typeId`) không làm thay đổi `updatedAt`.
> - Mỗi session có một `typeId` mặc định `conversation`, độc lập với artifact kind/type. Danh sách global tại `~/.ai-artifacts/session-types.json` chứa `{ id, label }`, mặc định Conversation/Project/Feature/Fix, cho user tạo type riêng dùng chung.
> - Đổi label giữ ID; xoá type đang dùng cần xác nhận chuyển các session về mặc định; không xoá được ID `conversation`.
> - Panel manager: **Type → Hướng dẫn → References → Archived**. Type có ✎ để chọn/tìm/tạo nhanh, không có nút quản lý danh sách global tại đây.
> - Sidebar có Recent Artifacts (giới hạn **20 mục + Xem tất cả**) và Sessions; **⚙ ở góc phải header Sessions** mở Quick Pick native quản lý types. Không có **+ session**, không tạo session bằng thao tác mở sidebar/item.
> - **Xử lý dữ liệu conversation v1 & Gate MCP:**
>   - Mở tính năng Sessions theo MCP đã cài trên đĩa đạt mốc `MCP_VERSION = 12`. MCP cũ giữ nguyên nút Connect (copy prompt exact artifact handle trực tiếp); chỉ MCP mới đủ mốc 12 mới mở popup Connect New/Join.
>   - Khi caller truyền ID conversation v1 vào `create_artifact` hoặc `inspect_artifact_review`, MCP chặn preflight fail-closed với mã lỗi `CONVERSATION_MIGRATION_REQUIRED` trước mọi side effect; Skill (`SKILL_VERSION = 4`) hướng dẫn user chọn 1 trong 2 hướng: migrate conversation đó hoặc chủ động tạo Session mới.
>   - Migration v1 → v2 chỉ chạy khi user yêu cầu (từng conversation tại Review App hoặc bulk từ dòng phát hiện ở Sidebar Sessions), có lưu backup `conversation.v1.backup.json` và giữ nguyên `registered-artifacts/`.
>   - Retention cleanup giữ nguyên Session v2 rỗng, chỉ xoá file membership stale và đồng bộ `layout.json`.
> - Đợt Phase 1+2 được gộp thành **3 Chặng**: Chặng 1 (Data + Migration Core + MCP/Skill — đã hoàn thành), Chặng 2 (Sidebar + Quản lý Types + Tab Session chỉ đọc), Chặng 3 (Nút Sessions, Connect Dialog New/Join, Bulk Migration UI & Nghiệm thu). Style để bàn sau. Quyết định mới: giữ menu tổ chức artifact, bỏ drag/drop và dnd-kit khỏi roadmap; xem [plan tổng thể](plan.md).
> - **Baseline sau Phase 3:** Quick Pick chọn/tạo type, Input Box đổi title, textarea + Save cho instructions, menu Move to / Move Up / Move Down. Contract một active Session cho mỗi chat AI được bổ sung sau Chặng 3 gốc tại Bước 7 của [plan Phase 3](plan-phase-3.md); không phải đổi UI manager.

> **Reception Rules cho AI tiếp nhận:**
>
> 1. Kế thừa đúng trạng thái [Decided], [Verified (source)], [AI-inferred], [Candidate] và [Unverified]. Không biến đề xuất của AI thành quyết định của Chú.
> 2. Đây là bản hợp nhất handoff cũ và toàn bộ thảo luận tiếp nối trong chat, đã đồng bộ các quyết định kiến trúc mới nhất của Phase 1+2. Các hướng cũ bị thay thế được ghi riêng.
> 3. ideas.md còn chứa ý tưởng lịch sử mâu thuẫn với quyết định mới. Dùng tài liệu này cùng [plan.md](plan.md), [plan-phase-1-2.md](plan-phase-1-2.md) và [plan-phase-3.md](plan-phase-3.md) để hiểu hướng sản phẩm; dùng source/docs chuẩn để xác định hành vi đang chạy.
> 4. Chặng 1 của Phase 1+2 đã triển khai xong; các chặng/phase tiếp theo chỉ triển khai khi Chú yêu cầu.
> 5. Không đưa lại hardening ownership, extract toàn bộ artifact, workflow engine hoặc tính năng đã hoãn vào required scope.
> 6. Đọc AGENTS.md và docs/INSTRUCTION.md trước khi làm repo; repo không dùng skill ai-assisted-phased-planner. Chỉ sửa phạm vi được yêu cầu.

## 1. Bối cảnh, phạm vi bằng chứng và điểm dừng

- **Mục tiêu:** Breaking change từ conversation registry hiện tại thành đối tượng **Session** độc lập, có sidebar và Session Manager, tổ chức artifact và ngữ cảnh làm việc giữa user/agent.
- **Bản chất kỹ thuật:** Tận dụng base conversation và giữ nguyên `registered-artifacts/`; bổ sung metadata Session v2 (`conversation.json`), bố cục ba mảng (`layout.json`), session types global (`session-types.json`), UI và catalog/instructions cho agent. Không xây lại artifact lifecycle.
- **Thiết kế đã chốt:** Working card masonry ở giữa; panel phải **Type → Hướng dẫn (Instructions) → References → Archived**; đóng/mở panel có cache; `registered-artifacts/` giữ vai trò nguồn membership duy nhất và `layout.json` lưu ba mảng có thứ tự.
- **Bằng chứng:** Đã đọc docs, skill/contract, source liên quan và đã hoàn thành triển khai + kiểm chứng tự động (540/540 tests passed) cho Chặng 1 (Bước 1 + 2 + 3).
- **Snapshot source hiện tại:** Extension 1.1.4, numeric `MCP_VERSION = 12`, `SKILL_VERSION = 4`, artifact schema v6, Session metadata schema v2 + `layout.json` schema v1 (song song hỗ trợ phát hiện/migrate conversation schema v1).
- **Điểm dừng:** Chặng 1 đã hoàn tất; tiếp theo là triển khai và nghiệm thu Chặng 2 & Chặng 3 của đợt Phase 1+2.

## 2. Quyết định và các chỉnh sửa quan trọng

### 2.1. Session độc lập, kế thừa base conversation

**[Decided]** Chú làm rõ: “không phải nâng cấp conversation nữa mà là breaking change hẳn thành 1 đối tượng session”.

- Có điểm truy cập ở Activity Bar bên trái, tương tự cách mở panel của extension như Cline.
- Sidebar có **Recent Artifacts** và **Sessions**, cho phép tạo/mở session và mở artifact.
- Session mở trong một **custom editor / Session Manager**, tận dụng vùng editor giữa.
- Artifact có nút **Work Session** để mở manager liên quan.
- Title session chỉnh được qua nút edit cạnh tên; mặc định theo cách đặt tên conversation hiện tại.
- Một session có nhiều artifact; **một artifact vẫn có thể thuộc nhiều session**.
- Giữ artifact.json schema v6. Schema/file layout mới của Session chưa chốt.

**[AI-inferred — hệ quả của đối tượng độc lập]** Session cần giữ title/Rules khi chưa có artifact hoặc khi artifact cuối bị gỡ. Không giữ máy móc cleanup hiện tại xoá conversation rỗng; chi tiết lifetime sẽ thiết kế trong phase model.

### 2.2. Tạo artifact và hai lựa chọn inject

**[Decided]** Giữ behavior từ base conversation:

| Tình huống | Hành vi đích |
| --- | --- |
| Tạo artifact khi chưa có session | Tự tạo session và đăng ký artifact |
| Tạo artifact khi đã có session hiện tại | Dùng session hiện tại cho artifact mới |
| Inject từ artifact → session mới | Inspect tạo session mới, đăng ký **cùng artifact ID**, giữ membership cũ |
| Inject từ artifact → join session đã chọn | Dùng session đích, **vẫn takeover artifact mục tiêu**, agent biết và đọc được các artifact liên quan |

Lời sửa của Chú: “hướng ko phải là 1 artifact 1 session… AI vẫn take over arrtifact nhưng không tạo cuộc trò chuyện mới mà là join vào cuộc trò chuyện hiện tại”.

- Không clone artifact; các session cùng tham chiếu một lifecycle.
- Join không tự takeover tất cả artifact trong session.
- **[AI-inferred]** Nếu artifact thuộc nhiều session, prompt cần exact artifact handle và session được chọn; không chọn theo recency.
- **[Candidate]** Vào trực tiếp từ manager nhận catalog/Rules; chỉ có session handle chưa chỉ định artifact cần takeover.
- Ý tưởng tool thứ 6 đã có từ đầu. Tuy nhiên, tên, số tool và phân bố trách nhiệm với inspect **chưa chốt**. Câu cũ “join không dùng inspect” đã bị làm rõ bởi luồng inject/join mới; không dùng nó để cấm luồng đã chốt.

### 2.3. Catalog trước, đọc file chọn lọc

**[Decided]**

- Agent nhận catalog metadata để chọn tài liệu cần đọc.
- Directory là **đường dẫn thư mục artifact**. Chú sửa hiểu lầm của AI rằng “dictionary” là topics/chỉ mục nội dung.
- Catalog cần ID, title, description, type và artifactDirectory; đây là ngữ nghĩa, chưa phải signature tool cuối cùng.
- Agent có filesystem access đọc artifact.md từ directory chính xác; không bắt buộc một MCP inspect/observe cho mỗi lần đọc tham khảo.
- **Bỏ tool extract toàn bộ nội dung**; không tự nạp tất cả artifact vào context.
- Takeover, xử lý review và cập nhật lifecycle vẫn theo MCP/skill. Đọc file tham khảo không tự cấp quyền xử lý Review/Proceed.
- Join không chia sẻ transcript chat của agent khác.

**Description:** Chú cho phép chọn cách tiện: lấy các dòng/đoạn đầu hoặc AI tạo. **[Candidate]** Dùng description đã có, fallback đoạn văn bản có nghĩa đầu tiên từ Markdown; không thêm lượt gọi AI chỉ để render preview. Card hiển thị ngắn, không đổ toàn bộ nội dung.

**Type:** Có trong catalog/card và filter; đã thảo luận cho AI điền/chọn type. **[Candidate]** Tận dụng kind hiện có nếu phù hợp, tránh hai hệ phân loại trùng nghĩa. Taxonomy và cách cập nhật type chưa chốt.

### 2.4. Ownership giữ như hiện tại

**[Decided]** Chú yêu cầu: “chỗ này vẫn giữ như cũ đi, ko cần harden thêm”.

- Không có phase hardening ownership xuyên process.
- Không đưa owner epoch, shared lease hoặc hệ thống quyền mới vào required scope.
- **[Verified (source)]** activeArtifactWaiters và token maps nằm trong bộ nhớ process. detachActiveArtifactWaiter chỉ tìm/hủy waiter trong map đó.
- **[AI-inferred từ source]** Takeover cùng process có thể hủy waiter cũ; process B không nhìn thấy waiter của process A. Hai process cùng wait có thể cùng đọc submission. Chưa chạy lại bằng hai client trong đợt phân tích này.
- Giữ ghi nhận để không tuyên bố bảo đảm xuyên process mới; **không dùng giới hạn này đưa hardening trở lại scope Chú đã loại**.

### 2.5. Rules và workflow là một

**[Decided]** Chú sửa: “rule và workflow là 1, chỉ là 1 metedata trong session manager”.

- Một trường nội dung Markdown **Rules**, thuộc Session.
- User/agent viết nguyên tắc, flow phối hợp, thứ tự đọc artifact vào cùng trường này.
- Agent vào session đọc Rules cùng catalog.
- Không tạo đối tượng workflow riêng, graph dependency hay workflow engine.
- **[AI-inferred]** Rules hướng dẫn làm việc, không thay thế submission của user hoặc tự cấp quyền thực thi; không cần push realtime tới các chat đang chạy trong bản đầu.

## 3. Layout Session Manager đã chốt

**[Decided]** Sau khi xem wireframe, Chú xác nhận: “Có thể đóng mở panel. Tôi thấy thiết kế ban đầu vậy là quá tốt rồi.”

    ┌──────────────────────────────────────────────────────────────────────┐
    │ Tên Session  ✎                                    [Panel ▥]  [⋯]     │
    ├──────────────────────────────────────────┬───────────────────────────┤
    │ [Tất cả] [Plan] [Design] [Analysis]      │ RULES                   ✎ │
    │ [Search artifact…]                     │                           │
    │                                        │ Quy tắc / flow Markdown  │
    │ WORKING                                ├───────────────────────────┤
    │                                        │ REFERENCES                │
    │ ┌────────────────┐ ┌────────────────┐ │                           │
    │ │ Artifact card  │ │ Artifact card  │ │ [Blueprint] [Design]     │
    │ │ Description…   │ │ Description…   │ │ [Architecture]           │
    │ │ Type        ⋯  │ └────────────────┘ ├───────────────────────────┤
    │ └────────────────┘ ┌────────────────┐ │ ARCHIVED                ▾ │
    │ ┌────────────────┐ │ Artifact card  │ │                           │
    │ │ Artifact card  │ │ Description…   │ │ [Artifact cũ]            │
    │ └────────────────┘ └────────────────┘ │ [Artifact khác]          │
    └──────────────────────────────────────────┴───────────────────────────┘

### 3.1. Header và panel

- Tên session và nút edit ngay cạnh.
- Bên phải header: toggle panel và menu More có **Archive session / Delete session**.
- Toggle đóng/mở **toàn bộ panel phải**, không ẩn description card.
- Nhớ trạng thái đóng/mở; đóng panel thì Working mở rộng.
- **[Candidate]** Cache là preference UI của user; dùng chung hay theo session là chi tiết triển khai còn chọn.
- **[Candidate]** Copy join prompt đặt trong panel/session actions; vị trí cụ thể chưa cố định.

### 3.2. Working ở giữa

- Các type hiển thị thành chip/tag filter, có search box dưới title bên trái.
- Artifact dạng **card grid masonry**, theo ảnh tham khảo thứ ba trong chat.
- Card có title, description ngắn, type và action.
- **[Candidate]** Có thể thêm updatedAt; title khoảng hai dòng, description khoảng 3–5 dòng để card không quá dài.
- Sắp xếp trong vùng bằng Move Up/Move Down; chuyển vùng bằng menu Move to. Không có yêu cầu kéo thả.
- Đây là tổ chức trực quan, thay thế đề xuất roadmap dọc có đường nối; không gán dependency/execution flow cho vị trí card.

### 3.3. Panel phải: Rules → References → Archived

- **Rules trên cùng:** một nội dung hướng dẫn dùng chung, có chỉnh sửa.
- **References dưới Rules:** blueprint, design, architecture và tài liệu dùng xuyên suốt session; card gọn, ưu tiên title/type.
- **Archived dưới References, vẫn trong panel phải:** cất artifact khỏi Working, có thể chuyển lại qua menu.
- References vẫn chứa artifact bình thường, sửa/review được; không tạo loại lifecycle riêng.
- Type độc lập với vùng: không phải mọi artifact type design đều tự vào References.
- Chuyển vào Archived không phải Proceed, không có nghĩa completed và không xoá file.
- **[Decided UX]** Dùng menu chuyển vùng và lên/xuống để tổ chức artifact; không cần drop zone hoặc cơ chế tự mở panel khi kéo.

### 3.4. Recent, search và xoá

- **[Decided]** Recent dùng updatedAt, không thêm lastOpenedAt. Nghĩa là cập nhật gần nhất, không phải lịch sử mở; không có yêu cầu ghi artifact.json.updatedAt mỗi lần mở.
- Search/filter bản đầu áp dụng artifact đã thuộc session. Search artifact bên ngoài rồi thêm vào session để sau.
- **[Decided]** Gỡ artifact chỉ xoá membership của session hiện tại, giữ artifact gốc và các session khác; Chú đã chọn trực tiếp phương án này.
- **[Candidate]** Archive session giữ dữ liệu, ẩn khỏi danh sách hoạt động; Delete session xoá session/membership, giữ artifact gốc. Header actions thuộc thiết kế duyệt, nhưng semantics vật lý chi tiết cần chốt theo phase. Không nhầm archive session với mảng archived chứa artifact.

## 4. Tách biệt Membership (`registered-artifacts/`) và Layout ba mảng (`layout.json`)

**[Decided]** Ban đầu dự kiến đưa trực tiếp ba mảng vào `conversation.json` và bỏ `registered-artifacts/`. Sau khi phân tích ranh giới ghi giữa MCP và Session Manager, Chú đã chốt thiết kế tối ưu hơn: **giữ nguyên `registered-artifacts/` làm nguồn membership duy nhất và tách bố cục ba mảng sang file `layout.json` riêng**:

```text
~/.ai-artifacts/conversation-registry/<sessionId>/
  conversation.json              # Metadata v2: sessionId, title, typeId, instructions, createdAt
  registered-artifacts/          # Nguồn membership duy nhất (giữ nguyên schema v1 từng file)
    <artifactId>.json            # { schemaVersion: 1, artifactConversationId, artifactId, registeredAt }
  layout.json                    # Bố cục 3 vùng: { schemaVersion: 1, working: [...], references: [...], archived: [...] }
```

- **Trách nhiệm ghi tách biệt hoàn toàn:**
  - **MCP (`create_artifact`, `inspect_artifact_review`):** chỉ tạo `conversation.json` lần đầu và ghi/cập nhật file con trong `registered-artifacts/<artifactId>.json` (kể cả khi inspect lại artifact cũ vẫn cập nhật `registeredAt`). MCP không sửa `conversation.json` khi reuse và không đụng tới `layout.json`.
  - **Session Manager:** ghi `conversation.json` khi sửa `title`/`instructions`/`typeId`; ghi `layout.json` qua menu move/reorder; xoá file trong `registered-artifacts/` kèm dọn `layout.json` khi gỡ artifact.
- **Quy tắc hợp nhất khi đọc Session (`readSession` / `listSessions`):**
  - Membership thực tế lấy từ `registered-artifacts/`.
  - Các ID trong `layout.json` không còn file trong `registered-artifacts/` sẽ bị lọc bỏ.
  - Các artifact có trong `registered-artifacts/` nhưng chưa xuất hiện trong `layout.json` mặc định được nối vào cuối `working` theo thứ tự `registeredAt` tăng dần (tie-break bằng `artifactId`).
- **Không dùng file lock cho session/layout:** dùng atomic write, chấp nhận quy tắc “bản lưu sau cùng thắng” (last write wins) và watcher tự refresh UI.
- **Quy tắc `Session.updatedAt` hiển thị:**
  - Không lưu `updatedAt` trong `conversation.json` hay `layout.json`.
  - Tính động khi đọc: `Session.updatedAt = max(createdAt, ...registeredAt của các membership hiện có)`.
  - Chỉ khi tạo Session hoặc MCP thêm/inspect artifact thì `updatedAt` mới tăng (đẩy Session lên đầu danh sách); move/reorder hay sửa metadata không làm thay đổi `updatedAt`.
- **Không thêm `order`, `zone` hoặc `pinned` vào từng file `registered-artifacts/*.json`:** mảng và vị trí phần tử trong `layout.json` đã biểu diễn vùng và thứ tự.
- Metadata catalog không nhân bản vào ba mảng; các mảng chỉ chứa artifact ID.

## 5. Base hiện tại và đánh giá độ khó

| Thành phần | Đã đối chiếu | Ý nghĩa |
| --- | --- | --- |
| Registry | Có create/register và tìm conversation chứa artifact qua `registered-artifacts/` | Giữ nguyên cơ chế membership nhiều–nhiều và rollback; nâng metadata lên v2 và thêm `layout.json` |
| Create/inspect | Có ID thì dùng conversation đó; thiếu ID tạo mới; inspect có takeover | Giữ luồng hiện tại cho Session v2; chặn preflight fail-closed `CONVERSATION_MIGRATION_REQUIRED` nếu truyền ID v1 |
| Inspect result | Trả artifact hiện tại và conversation, chưa full catalog session | Giữ adapter tên tham số ở Phase 1+2; Phase 4 bổ sung catalog/instructions đầy đủ cho agent |
| Kind/type | Kind là chuỗi hợp lệ; manifest đã có kind; Session có `typeId` riêng trong `session-types.json` | Phân biệt rõ `Session.typeId` (Conversation/Project/Feature/Fix/custom) với `Artifact.kind` |
| Proceed | Chỉ plan/implementation-plan có execute directive | Proceed tuỳ biến là phần riêng đã hoãn |
| Service/UI | Title/kind lấy từ manifest; có custom editor/provider | Thay drawer cũ bằng Sidebar + Tab Session (`agentPlus.workSession`) và nút Sessions trên Review App |
| Registry schema & Cleanup | Cleanup cũ xoá conversation hết artifact | Cleanup mới phân nhánh theo schema: giữ Session v2 rỗng, chỉ xoá membership stale và đồng bộ `layout.json` |
| Retention | Dựa trên artifact.json.updatedAt; đọc/inspect không gia hạn | References/Archived chỉ tổ chức tài liệu, không tự miễn retention |

**[AI-inferred] Tổng thể: mức vừa.** Nhờ giữ nguyên `registered-artifacts/` và bỏ file lock, tầng dữ liệu và MCP gọn. Menu tổ chức artifact thay cho yêu cầu kéo thả; các phần tiếp nối theo plan mới nhất tập trung vào agent contract/catalog và metadata/card.

## 6. Plan tổng quát theo tính năng

Chi tiết triển khai theo bước/chặng nằm tại [plan.md](plan.md), [plan-phase-1-2.md](plan-phase-1-2.md) và [plan-phase-3.md](plan-phase-3.md).

| Phase | Kết quả | Trạng thái |
| --- | --- | --- |
| **1. Session model** | Metadata Session v2 (`title`, `instructions`, `typeId`, `createdAt`), giữ `registered-artifacts/`, tách `layout.json` ba mảng, tính động `updatedAt`; auto-create/reuse; migration v1 → v2 theo yêu cầu; registry session types global; MCP/Skill v4 chặn ID v1 fail-closed | ✅ **Đã hoàn thành (Chặng 1)** |
| **2. Sidebar và điều hướng** | Activity Bar; Recent Artifacts (20 mục + Xem tất cả); Sessions v2 gated theo `MCP_VERSION >= 12`; ⚙ Quick Pick quản lý types; phát hiện và popup bulk migration; Tab Session chỉ đọc; nút Sessions + Connect New/Join thay drawer cũ | ⏳ **Đang triển khai (Chặng 2 & 3)** |
| **3. Session Manager cơ bản** | Mở rộng tab đã có: sửa `title`/`instructions`/`typeId` (ghi `conversation.json`); Working ở giữa; panel Type/Hướng dẫn/References/Archived có cache; chuyển vùng bằng menu (ghi `layout.json`), gỡ artifact (xoá trong `registered-artifacts/` và lọc khỏi `layout.json`) | Chưa triển khai |
| **4. Agent entry và catalog** | Hoàn thiện new/join sau popup inspect tối thiểu ở Phase 2; catalog title/description/type/directory và instructions; đọc file chọn lọc | Chưa triển khai |
| **5. Masonry và tổ chức trực quan** | Working masonry; References/Archived card gọn; metadata/description, artifact type chips và search/filter; giữ menu move/reorder hiện có | Chưa triển khai |

### Kiểm chứng trọng tâm khi triển khai

- Tạo artifact auto-create/reuse session, inject new/join đúng lựa chọn; truyền ID v1 trả lỗi `CONVERSATION_MIGRATION_REQUIRED` trước mọi side effect.
- Sidebar/nút Sessions mở đúng session; `title`/`instructions`/`typeId` lưu vào `conversation.json`, `layout.json` lưu đúng 3 vùng.
- Kéo trong/giữa mảng chỉ cập nhật `layout.json`, không nhân đôi membership và không đổi `Session.updatedAt`; gỡ artifact xoá membership trong `registered-artifacts/` và lọc khỏi `layout.json`, giữ artifact gốc và session khác.
- Panel nhớ trạng thái; search/filter/card layout hoạt động ở độ rộng editor thực.
- Catalog trả directory/metadata đúng, không nạp toàn bộ nội dung; đọc file không chạy lifecycle action.
- Session v2 rỗng được giữ qua cleanup; dữ liệu v1 chỉ migrate khi user chủ động kích hoạt (đơn lẻ hoặc bulk) kèm backup `conversation.v1.backup.json`.
- Focused tests và check/build theo repo khi triển khai; UI cần Extension Host evidence.

## 7. Để sau bản đầu và phân tích giữ lại

**[Decided — hoãn]** Chú xác nhận nhóm tính năng “để sau bản đầu”, và nhắc riêng handoff không cần làm trước:

- Search artifact bên ngoài rồi thêm vào session.
- Proceed/next action cấu hình theo type.
- Participant UI, role, tag tự do và filter nâng cao; **type chip/filter cơ bản vẫn trong bản đầu**.
- Artifact thảo luận/handoff và cập nhật không chờ review.

**Các phân tích sau đây chỉ để tham khảo khi mở rộng:**

- **[AI-inferred] Proceed theo type:** AI đề xuất directive; user cần thấy ý nghĩa trước khi bấm. Nếu config thuộc session trong khi artifact có nhiều session thì phải xác định session áp dụng. Không cần callback/code thực thi tuỳ ý.
- **[Verified (source/docs)] Handoff:** Advance hiện gắn với wait; mỗi round thay thế Markdown và reset comments. Hợp với ghi chú trạng thái hiện tại hơn log lịch sử. Non-plan kind không phát execute-plan directive; skill sẽ cần chọn kind phù hợp nếu làm.
- **[User-confirmed lịch sử]** “Trò chuyện” được hiểu là handoff bất đồng bộ. Message log append-only không được chọn; không suy ra có push/scheduler.
- **[AI-inferred] Participant:** Số đăng ký không phải online; label/role tự khai không xác thực quyền. Provenance bổ sung sau chỉ ghi từ lúc hỗ trợ, không backfill bằng suy đoán.
- **[Chưa được chọn] Agent comments:** Chưa có scope agent ghi comments như user. Nếu làm sau cần author và không đánh đồng với Review/Proceed/Just save của user.

**Out of scope:** Shared ownership hardening, workflow engine, realtime presence/push, concurrent multi-writer, điều phối sửa code, driver mới hoặc topology remote/cloud. Không so sánh Antigravity trừ khi Chú yêu cầu lại.

## 8. Các hướng đã bị thay thế

| Hướng cũ | Quyết định/hiểu đúng hiện tại |
| --- | --- |
| Một artifact–một session; clone/migration loại membership trùng | Giữ nhiều session; new-session đăng ký cùng artifact ID |
| Join chỉ đọc, không đi qua inspect | Inject join vẫn takeover artifact mục tiêu; thiết kế tool cụ thể để sau |
| Phase hardening ownership bắt buộc | Chú yêu cầu giữ cơ chế hiện tại |
| MCP observe riêng cho mọi lần đọc | Catalog + directory; đọc file chọn lọc khi có filesystem access |
| Extract toàn bộ nội dung | Chú yêu cầu bỏ qua |
| Dictionary/topics là chỉ mục | Directory là thư mục artifact |
| Rules và workflow riêng | Một metadata `instructions` (Markdown, nhãn UI “Hướng dẫn”) |
| Roadmap timeline/đường nối/workflow engine | Card masonry để tổ chức trực quan |
| Pinned ở giữa trên cùng, Archived dưới Working | References và Archived đều ở panel phải, dưới Type và Hướng dẫn |
| order, rồi pinned/zone trong membership | Giữ nguyên `registered-artifacts/` cho membership; tách 3 mảng vào `layout.json` |
| Bỏ `registered-artifacts/`, gộp 3 mảng vào `conversation.json` kèm file lock | Giữ `registered-artifacts/` làm nguồn membership duy nhất, thêm `layout.json` cho 3 mảng, bỏ file lock (last write wins) |
| Ghi `updatedAt` vào `conversation.json` mỗi khi sắp xếp hoặc sửa metadata | Tính động `Session.updatedAt = max(createdAt, ...registeredAt)`; chỉ tăng khi tạo Session hoặc MCP thêm/inspect artifact |
| Drag/drop sắp xếp artifact và thêm dnd-kit | Giữ menu Move to / Move Up / Move Down ở mọi phase trong roadmap |
| Toggle description card | Toggle toàn bộ panel phải, có cache |
| Recent cần lastOpenedAt | Dùng `updatedAt` |
| Gỡ card xoá artifact toàn cục | Chỉ xoá membership trong `registered-artifacts/` và lọc khỏi `layout.json` của session hiện tại |
| Tự động migrate conversation v1 ngầm khi đọc/list/cleanup | Chỉ migrate khi user chủ động bấm (đơn lẻ ở Review App hoặc bulk ở Sidebar); MCP chặn ID v1 bằng `CONVERSATION_MIGRATION_REQUIRED` |

Chỉ mở lại hướng đã bác/hoãn khi Chú đổi yêu cầu; không tăng scope ngầm.

## 9. Điểm đã chốt ở Phase 1+2 và các điểm còn mở cho Phase 3–5

### Đã chốt và áp dụng trong Phase 1+2

- **Storage & Schema Session v2:** tách `conversation.json` (v2) + `registered-artifacts/` (membership v1) + `layout.json` (3 mảng) + `~/.ai-artifacts/session-types.json` (types global); bỏ file lock, dùng atomic write; `Session.updatedAt` tính động từ `createdAt` và `registeredAt`.
- **Dữ liệu conversation v1 & Migration:** không tự động migrate ngầm; MCP trả `CONVERSATION_MIGRATION_REQUIRED` khi truyền ID v1; Skill (`SKILL_VERSION = 4`) đưa 2 lựa chọn (migrate hoặc dùng Session mới); UI hỗ trợ migrate đơn lẻ từ Review App và bulk từ Sidebar kèm backup `conversation.v1.backup.json`.
- **Gate phiên bản MCP & Connect:** kiểm tra file MCP đã cài đạt `MCP_VERSION = 12`; MCP cũ giữ nguyên nút Connect copy exact handle trực tiếp, chỉ MCP mới mới mở popup Connect New/Join.
- **Empty-session lifecycle & Cleanup:** Session v2 rỗng được giữ lại khi gỡ hết artifact hoặc khi chạy retention cleanup.
- **Sidebar & Quản lý Types:** Recent Artifacts giới hạn 20 mục + “Xem tất cả”; nút ⚙ ở header Sessions mở Quick Pick native quản lý types.

### Chờ chốt / Chi tiết triển khai cho Phase 3–5

- Semantics chi tiết của **Archive session / Delete session** (trong menu More của Manager ở Phase 3) và nhóm **Pin session** trên Sidebar, phân biệt với mảng `archived` chứa artifact.
- Nơi lưu/cách trích xuất `description` cho catalog/card ở Phase 4–5 (AI-supplied description hay fallback trích đoạn Markdown đầu tiên) và cách map filter chip trên Working.
- Cache đóng/mở panel phải lưu chung toàn cục hay theo từng session (Phase 3).

## 10. Reference Map và provenance

| Nguồn | Nội dung đã giữ inline | Khi cần mở sâu |
| --- | --- | --- |
| [ideas.md](ideas.md) | Ý tưởng gốc và chuyển sang manager; có đoạn cũ bị sửa trong chat | Lịch sử yêu cầu, không lấn quyết định mới |
| [plan.md](plan.md), [plan-phase-1-2.md](plan-phase-1-2.md), [plan-phase-3.md](plan-phase-3.md) | Kế hoạch tổng, kết quả các chặng đã ghi nhận và Bước 7 mở rộng Phase 3 | Khi triển khai và nghiệm thu phần tiếp theo |
| [conversation.md](conversation.md) | Toàn bộ lịch sử thảo luận và chốt thiết kế tách `registered-artifacts/` + `layout.json` | Khi cần đối chiếu ngữ cảnh ra quyết định |
| AGENTS.md, docs/INSTRUCTION.md | Scope, component ownership, validation, không tự code | Trước khi làm repo |
| docs/PHILOSOPHY.md, docs/ARCHITECTURE.md | Lifecycle, retention, exact handles, product intent hiện hành | Khi đồng bộ docs với thay đổi được triển khai |
| src/shared/contracts.ts, src/shared/artifact-files.ts | Artifact v6, Session metadata v2, layout v1, session types v1, numeric versions (`MCP_VERSION = 12`, `SKILL_VERSION = 4`) | Đã cập nhật ở Chặng 1 |
| src/shared/conversation-artifact-registry.ts, src/shared/session-type-registry.ts | Session CRUD, reconciliation `registered-artifacts/` + `layout.json`, migration v1→v2, cleanup và quản lý types global | Đã cập nhật ở Chặng 1 |
| src/integration/artifact-review-mcp-v4.ts | Preflight chặn ID v1 (`CONVERSATION_MIGRATION_REQUIRED`), tạo/reuse Session v2 và giữ rollback membership | Đã cập nhật ở Chặng 1 |
| src/extension/conversation-artifact-service.ts, src/extension/artifact-retention.ts | Cleanup phân nhánh v1/v2 giữ Session v2 rỗng; service phục vụ Sidebar/Tab Session | Cleanup đã xong ở Chặng 1; Service/UI ở Chặng 2 & 3 |
| src/extension/extension.ts, package.json | Activity Bar, Tree Views, Commands và Custom Readonly Editor `agentPlus.workSession` | Chặng 2 & 3 |
| src/webview/ReviewApp.tsx, SessionApp.tsx, ArtifactConnectDialog.tsx | Bỏ drawer cũ, thêm Tab Session chỉ đọc, nút Sessions và Connect New/Join | Chặng 2 & 3 |
| skills/create-review-artifact/SKILL.md và references/artifact-contract.md | Xử lý `CONVERSATION_MIGRATION_REQUIRED` với 2 lựa chọn và hỗ trợ prompt New/Join | Đã cập nhật ở Chặng 1 |

**Review artifact lịch sử:** C:/Users/Admin/.ai-artifacts/artifacts/work-session-artifact-phan-tich-va-e-xuat-pham-vi-20261106-16184f10; conversation ID fc6dbff4-3385-43d3-9a83-67c27688cea8. Round 2 đã được kiểm tra lưu thành công trước các quyết định mới.

**Trạng thái theo plan mới nhất:** Phase 1+2 và phạm vi ban đầu của Phase 3 đã hoàn thành theo kết quả ghi nhận; tiếp theo là Bước 7 mở rộng Chặng 3 trong [plan-phase-3.md](plan-phase-3.md), chưa triển khai. Kết quả kiểm chứng cũ không bao gồm phần mở rộng.
