# Work Session — Phân tích, quyết định và hướng triển khai — 2026-11-06

> **Cập nhật tiếp nối — Session types và gộp Phase 1+2:** Phần này ưu tiên hơn snapshot phân tích bên dưới khi có khác biệt. Plan thực hiện mới nhất ở [plan-phase-1.md](plan-phase-1.md), tổng quan ở [plan.md](plan.md); chưa triển khai code.
>
> - `rules` đổi tên thành `instructions`, một chuỗi Markdown; nhãn UI “Hướng dẫn”.
> - Mỗi session có một `typeId` mặc định `conversation`, độc lập với artifact kind/type. Danh sách global tại `~/.ai-artifacts/session-types.json` chứa `{ id, label }`, mặc định Conversation/Project/Feature/Fix, cho user tạo type riêng dùng chung.
> - Đổi label giữ ID; xoá type đang dùng cần xác nhận chuyển các session về mặc định; không xoá được ID `conversation`. Đây là thiết kế đích, chưa có implementation.
> - Panel manager: **Type → Hướng dẫn → References → Archived**. Type có ✎ để chọn/tìm/tạo nhanh, không có nút quản lý danh sách global tại đây.
> - Sidebar có Recent Artifacts và Sessions; **⚙ ở góc phải header Sessions** mở popup quản lý types. Không có **+ session**, không tạo session bằng thao tác mở sidebar/item. Các vị trí ⚙ ở header chung hoặc cạnh Type trong manager đã bị thay thế.
> - Chú yêu cầu gộp plan Phase 1+2 trong một file để triển khai một lần. Phase 1 có model/API types; Phase 2 có sidebar/popup và đề xuất tab session chỉ đọc tối thiểu để điều hướng có điểm đến; Phase 3 mở rộng manager đầy đủ và selector Type.
> - Native Tree View/Quick Pick, cách migration/storage và tab chỉ đọc là đề xuất kỹ thuật trong plan để review. Pin/group Recent/Archive chưa tự trở thành required scope đợt này. Style để bàn sau, dnd-kit đã được chọn cho Phase 5.

> **Reception Rules cho AI tiếp nhận:**
>
> 1. Kế thừa đúng trạng thái [Decided], [Verified (source)], [AI-inferred], [Candidate] và [Unverified]. Không biến đề xuất của AI thành quyết định của Chú.
> 2. Đây là bản hợp nhất handoff cũ và toàn bộ thảo luận tiếp nối trong chat, đến khi Chú chốt layout ba vùng và yêu cầu cập nhật file này. Các hướng cũ bị thay thế được ghi riêng.
> 3. ideas.md còn chứa ý tưởng lịch sử mâu thuẫn với quyết định mới. Dùng tài liệu này để hiểu hướng sản phẩm; dùng source/docs chuẩn để xác định hành vi đang chạy.
> 4. Chú đã duyệt thiết kế ban đầu và yêu cầu cập nhật phân tích, **chưa yêu cầu triển khai code**. Các phase là đề xuất tổng quát; schema, contract MCP và patch chi tiết thiết kế theo từng phase.
> 5. Không đưa lại hardening ownership, extract toàn bộ artifact, workflow engine hoặc tính năng đã hoãn vào required scope.
> 6. Đọc AGENTS.md và docs/INSTRUCTION.md trước khi làm repo; repo không dùng skill ai-assisted-phased-planner. Chỉ sửa phạm vi được yêu cầu.

## 1. Bối cảnh, phạm vi bằng chứng và điểm dừng

- **Mục tiêu:** Breaking change từ conversation registry hiện tại thành đối tượng **Session** độc lập, có sidebar và Session Manager, tổ chức artifact và ngữ cảnh làm việc giữa user/agent.
- **Bản chất kỹ thuật:** Tận dụng base conversation; bổ sung metadata, UI và catalog/rules cho agent. Không xây lại artifact lifecycle.
- **Thiết kế đã chốt:** Working card masonry ở giữa; panel phải **Rules → References → Archived**; đóng/mở panel có cache; session metadata chứa ba mảng có thứ tự.
- **Lượt cập nhật này:** Chỉ cập nhật plans/work-session-artifact/analyzed.md và tóm tắt plan trong chat. Không sửa source, ideas.md, plan.md, docs chuẩn hoặc review artifact.
- **Bằng chứng:** Đã đọc docs, skill/contract và source liên quan trong cuộc thảo luận; một phần test được đọc, chưa chạy test hoặc runtime đa client cho feature mới.
- **Snapshot source:** Extension 1.1.4, numeric MCP_VERSION = 11, SKILL_VERSION = 3, artifact schema v6, conversation registry schema v1. Phiên bản breaking change chưa chốt.
- **Điểm dừng:** Phân tích và layout bản đầu đã rõ. Tiếp theo là review thứ tự phase và thiết kế phase được chọn; chưa có phase đang triển khai.

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
- Kéo thả sắp xếp trong vùng hoặc chuyển giữa các vùng.
- Đây là tổ chức trực quan, thay thế đề xuất roadmap dọc có đường nối; không gán dependency/execution flow cho vị trí card.

### 3.3. Panel phải: Rules → References → Archived

- **Rules trên cùng:** một nội dung hướng dẫn dùng chung, có chỉnh sửa.
- **References dưới Rules:** blueprint, design, architecture và tài liệu dùng xuyên suốt session; card gọn, ưu tiên title/type.
- **Archived dưới References, vẫn trong panel phải:** cất artifact khỏi Working, có thể thu gọn và kéo trở lại.
- References vẫn chứa artifact bình thường, sửa/review được; không tạo loại lifecycle riêng.
- Type độc lập với vùng: không phải mọi artifact type design đều tự vào References.
- Kéo vào Archived không phải Proceed, không có nghĩa completed và không xoá file.
- **[Candidate UX]** Hiện rõ drop zone khi kéo; menu chuyển vùng có thể hỗ trợ lúc panel đóng. Không bắt buộc cơ chế tự mở panel phức tạp.

### 3.4. Recent, search và xoá

- **[Decided]** Recent dùng updatedAt, không thêm lastOpenedAt. Nghĩa là cập nhật gần nhất, không phải lịch sử mở; không có yêu cầu ghi artifact.json.updatedAt mỗi lần mở.
- Search/filter bản đầu áp dụng artifact đã thuộc session. Search artifact bên ngoài rồi thêm vào session để sau.
- **[Decided]** Gỡ artifact chỉ xoá membership của session hiện tại, giữ artifact gốc và các session khác; Chú đã chọn trực tiếp phương án này.
- **[Candidate]** Archive session giữ dữ liệu, ẩn khỏi danh sách hoạt động; Delete session xoá session/membership, giữ artifact gốc. Header actions thuộc thiết kế duyệt, nhưng semantics vật lý chi tiết cần chốt theo phase. Không nhầm archive session với mảng archived chứa artifact.

## 4. Metadata ba mảng

**[Decided]** Chú chốt: “archived ở dưới refs luôn. Vậy trong session metadata sẽ lưu 3 mảng.”

    working:    [artifactId, ...]
    references: [artifactId, ...]
    archived:   [artifactId, ...]

Mô hình logic đã thống nhất; chưa phải full schema/file layout cuối cùng.

- Mảng xác định vùng, vị trí phần tử xác định thứ tự.
- **Không thêm order, zone hoặc pinned song song** để lưu lại cùng thông tin.
- Artifact mới vào working; **[Candidate]** mặc định append cuối mảng theo thứ tự thêm mới.
- Kéo cùng vùng: đổi vị trí phần tử.
- Kéo khác vùng: bỏ khỏi mảng nguồn, chèn vào vị trí đích.
- Trong một session, mỗi artifact chỉ nằm trong một trong ba mảng.
- Cùng artifact có thể có vùng/thứ tự khác ở session khác; kéo thả không tác động session kia.
- Gỡ khỏi session chỉ bỏ ID, không xoá artifact.
- Metadata catalog không nhân bản vào ba mảng; các mảng tham chiếu artifact ID.

**[AI-inferred — lợi ích/đánh đổi]** Mô hình khớp UI và đơn giản hơn zone + order. Các producer cần dùng chung quy tắc cập nhật membership để không nhân đôi một ID ở hai vùng; đây là consistency của feature, không mở thêm hardening ownership.

**[Chưa chốt vật lý]** Catalog nằm cùng session document, index riêng hay được dựng từ registry/manifest sẽ chọn trong phase. Chốt ba mảng không mặc nhiên bỏ mọi helper/validation/index đang có.

## 5. Base hiện tại và đánh giá độ khó

| Thành phần | Đã đối chiếu | Ý nghĩa |
| --- | --- | --- |
| Registry | Có create/register và tìm conversation chứa artifact | Kế thừa membership nhiều–nhiều; đổi model và thêm thuộc tính |
| Create/inspect | Có ID thì dùng conversation đó; thiếu ID tạo mới; inspect có takeover | Có nền cho hai lựa chọn inject |
| Inspect result | Trả artifact hiện tại và conversation, chưa full catalog session | Cần bổ sung catalog/rules cho agent |
| Kind/type | Kind là chuỗi hợp lệ; manifest đã có kind | Có nền phân loại; skill luôn tạo implementation-plan nên cần điều chỉnh khi cho AI chọn type |
| Proceed | Chỉ plan/implementation-plan có execute directive | Proceed tuỳ biến là phần riêng đã hoãn |
| Service/UI | Title/kind lấy từ manifest; có drawer và custom editor/provider | Dùng lại mở artifact và pattern webview; không nhân bản metadata vô cớ |
| Registry schema | Strict schema; cleanup xoá conversation hết artifact | Cập nhật contract/consumer và empty-session cleanup khi làm model mới |
| Retention | Dựa trên artifact.json.updatedAt; đọc/inspect không gia hạn | References/Archived chỉ tổ chức tài liệu, không tự miễn retention |

**[AI-inferred] Tổng thể: mức vừa.** Model chủ yếu đổi tên, thêm dữ liệu và cập nhật consumer; sidebar nhẹ. Manager/drag-drop là công sức frontend. MCP/catalog/skill là phần nối nhiều component nhất, nhưng catalog là danh sách metadata, không phải search engine.

Chú đã phản hồi rằng AI hỏi nhiều và làm scope có vẻ phức tạp hơn cần thiết. Không dựng lại framing “kiến trúc khó”, không đưa các cơ chế tương lai vào bản đầu. Chưa có ước lượng thời gian được kiểm chứng.

## 6. Plan tổng quát theo tính năng — đề xuất

Thứ tự sau cập nhật theo layout ba mảng. Chưa kích hoạt phase hoặc cho phép code.

| Phase | Kết quả | Component dự kiến ảnh hưởng |
| --- | --- | --- |
| **1. Session model** | Session với title, một trường Rules, ba mảng có thứ tự; auto-create/reuse khi tạo artifact; session rỗng; xử lý dữ liệu conversation cũ | Shared contracts/registry, create/inspect integration, cleanup liên quan |
| **2. Sidebar điều hướng** | Activity Bar; Recent Artifacts theo updatedAt; Sessions; tạo/mở session và artifact; nút Work Session | Package contributions, extension commands/views, mở editor |
| **3. Session Manager cơ bản** | Custom editor; title/edit; menu session; panel có cache; Rules → References → Archived; mở/gỡ artifact | Session provider/service, webview, UI persistence |
| **4. Agent entry và catalog** | Inject tạo mới/join; rules + catalog; description/type/directory; đọc file chọn lọc; cập nhật skill | MCP, registry/catalog, prompt builders, skill/contract |
| **5. Masonry và tổ chức trực quan** | Working masonry; References/Archived card gọn; type chips, search/filter; kéo thả trong/giữa ba mảng | Webview layout/drag-drop, typed messages, lưu session |

Phase 3 dựng cấu trúc và thao tác cơ bản; Phase 5 hoàn thiện card layout và sắp xếp. Card và agent dùng chung metadata/catalog. File chi tiết chọn khi mở phase, không mặc định refactor toàn dự án.

### Kiểm chứng trọng tâm khi triển khai

- Tạo artifact auto-create/reuse session, inject new/join đúng lựa chọn.
- Sidebar/nút Work Session mở đúng session; title/Rules lưu được, agent đọc lại thấy đúng.
- Kéo trong/giữa mảng không nhân đôi membership; gỡ giữ artifact gốc và session khác.
- Panel nhớ trạng thái; search/filter/card layout hoạt động ở độ rộng editor thực.
- Catalog trả directory/metadata đúng, không nạp toàn bộ nội dung; đọc file không chạy lifecycle action.
- Session rỗng và dữ liệu cũ theo contract đã chọn.
- Focused tests và check/build theo repo khi triển khai; UI cần Extension Host evidence. Không thêm gate hardening xuyên process đã loại.

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
| Rules và workflow riêng | Một metadata Rules |
| Roadmap timeline/đường nối/workflow engine | Card masonry để tổ chức trực quan |
| Pinned ở giữa trên cùng, Archived dưới Working | References và Archived đều ở panel phải, dưới Rules |
| order, rồi pinned/zone | Ba mảng; vị trí là thứ tự |
| Toggle description card | Toggle toàn bộ panel phải, có cache |
| Recent cần lastOpenedAt | Dùng updatedAt |
| Gỡ card xoá artifact toàn cục | Chỉ gỡ membership session hiện tại |
| Khóa trước schema cho participant/provenance/mọi tính năng | Thiết kế đủ cho phase; mở rộng đã hoãn |
| MCP mới là 11.0.0 theo handoff đầu | Snapshot đã có numeric MCP 11, skill 3; số mới chưa chọn |

Chỉ mở lại hướng đã bác/hoãn khi Chú đổi yêu cầu; không tăng scope ngầm.

## 9. Điểm còn mở theo loại

### Awaiting User Decision — chốt khi đến phase liên quan

- Dữ liệu registry conversation cũ: migrate, đọc tương thích hay cutoff. Breaking change không phải quyền xoá dữ liệu cũ.
- Semantics chi tiết Archive/Delete **session**, phân biệt với mảng archived. Đề xuất trước: archive giữ dữ liệu, delete session giữ artifact gốc; chưa có quyết định riêng về dữ liệu vật lý.
- Số phiên bản, tên tool/tham số. Không cần hỏi lại hàng loạt trước khi mở phase cụ thể.

### Chi tiết triển khai để đề xuất trong phase

- File layout/schema, nơi lưu description/catalog, map type với kind.
- AI-supplied description hay fallback trích đoạn theo lựa chọn “cái nào tiện” của Chú.
- Cache panel chung hay per-session; search/filter Working hay cả panel; kéo thả khi filter.
- Empty-session lifecycle và cleanup. References không mặc nhiên miễn retention; nếu cần giữ suốt session bất kể thời gian thì phải có yêu cầu retention riêng.

### Unknown External / Empirical Facts

- Thời gian triển khai và UX thực tế chưa đo; chưa có prototype hoặc Extension Host validation của manager mới.
- Luồng client/agent tiếp nhận catalog, đọc rules/directory cần kiểm chứng khi có implementation.

### Unverified Hypotheses / Discrepancies

- Tương thích registry mới với cleanup/installer chưa được chứng minh bằng việc đọc source.
- Review artifact round 2 vẫn chứa phase cũ, chưa đồng bộ các quyết định về catalog, bỏ hardening và layout. Không dùng nó làm plan mới nhất.

## 10. Reference Map và provenance

| Nguồn | Nội dung đã giữ inline | Khi cần mở sâu |
| --- | --- | --- |
| plans/work-session-artifact/ideas.md | Ý tưởng gốc và chuyển sang manager; có đoạn cũ bị sửa trong chat | Lịch sử yêu cầu, không lấn quyết định mới |
| plans/work-session-artifact/plan.md | Đang trống lúc cập nhật; chưa có implementation plan chi tiết | Khi Chú yêu cầu lập/triển khai plan |
| AGENTS.md, docs/INSTRUCTION.md | Scope, component ownership, validation, không tự code | Trước khi làm repo |
| docs/PHILOSOPHY.md, docs/ARCHITECTURE.md | Lifecycle, retention, exact handles, product intent hiện hành | Khi đồng bộ docs với thay đổi được triển khai |
| src/shared/contracts.ts | Artifact v6, kind string, strict registry schemas, numeric versions | Thiết kế schema/contract |
| src/shared/conversation-artifact-registry.ts | Create/register/list membership và cleanup conversation rỗng | Chuyển model, ba mảng, dữ liệu cũ |
| src/integration/artifact-review-mcp-v4.ts | Inspect new/reuse, waiter/tokens process-local, Proceed theo kind, advance-and-wait | Entry/catalog; không mở rộng hardening |
| src/extension/conversation-artifact-service.ts | Discovery/validation, title/kind từ manifest | Catalog/provider manager |
| src/extension/artifact-retention.ts | Retention riêng với tổ chức session | Cleanup/empty session |
| src/extension/extension.ts, package.json | Commands và custom editor hiện có | Activity Bar/sidebar/manager |
| src/webview/ConversationArtifactsDrawer.tsx, ReviewApp.tsx | Drawer, card và Connect hiện tại | UI/navigation mới |
| src/shared/artifact-connect-prompt.ts | Exact handle prompt | Hai lựa chọn inject |
| skills/create-review-artifact/SKILL.md và references/artifact-contract.md | Conversation ID, kind implementation-plan, create → wait | Session context/catalog/type/rules |
| test/conversation-artifact-registry.test.ts, test/review-wait-mcp.test.ts | Đã đọc một phần test many-to-many và registration; chưa chạy trong đợt này | Cập nhật test theo contract |
| Ảnh và wireframe trong chat | Header edit/more/toggle; masonry; Rules → References → Archived | Dựng UI, không suy ra feature từ ảnh khác |

**Review artifact lịch sử:** C:/Users/Admin/.ai-artifacts/artifacts/work-session-artifact-phan-tich-va-e-xuat-pham-vi-20261106-16184f10; conversation ID fc6dbff4-3385-43d3-9a83-67c27688cea8. Round 2 đã được kiểm tra lưu thành công trước các quyết định mới. Muốn tiếp tục review thì inspect đúng handle qua MCP; không chỉnh lifecycle file trực tiếp. Lượt cập nhật analyzed này không cập nhật review artifact.

**Quyền thực hiện hiện tại:** Chỉ cập nhật file phân tích và trình bày plan tổng quát. Chưa triển khai source, cập nhật canonical docs hoặc xác nhận release mới.
