# Sessions — Implementation plan

Trạng thái: **Đang review kế hoạch; chưa triển khai code.**

Ngoại lệ chuẩn bị: theo yêu cầu Chú, numeric MCP_VERSION đã tăng **11 → 12** để test phân biệt bản cũ/mới. Session v2, UI gate và migration vẫn chưa triển khai; package 1.1.4 và skill 3 giữ nguyên.

Nguồn yêu cầu: [analyzed.md](analyzed.md) và các quyết định tiếp nối trong chat. Khi khác nhau, quyết định mới trong chat được ưu tiên: `rules` đổi thành `instructions` (một chuỗi Markdown); style/UI library để bàn sau; chọn dnd-kit cho kéo thả.

**Đợt triển khai đầu gộp Phase 1 + 2 trong [plan-phase-1.md](plan-phase-1.md).** Đây là yêu cầu lập plan để triển khai chung, chưa phải thay đổi source đã thực hiện.

## Các phase

| Phase | Kết quả | Trạng thái |
| --- | --- | --- |
| [1. Session model](plan-phase-1.md) | Metadata Session v2 (`title`, `instructions`, `typeId`, `createdAt`), giữ `registered-artifacts/` làm nguồn membership, tách `layout.json` ba mảng, tính `updatedAt` từ `createdAt`/`registeredAt`; auto-create/reuse; migration theo yêu cầu; registry session types và API quản lý | Plan chung Phase 1+2 để review |
| [2. Sidebar và điều hướng](plan-phase-1.md#phase-2--sidebar-quản-lý-session-types-và-điều-hướng) | Recent Artifacts/Sessions v2; gate theo MCP đã cài; phát hiện và popup bulk migration; ⚙ quản lý types; tab session chỉ đọc; Sessions/migration đơn lẻ thay drawer cũ | Plan chung Phase 1+2 để review |
| 3. Session Manager cơ bản | Mở rộng tab đã có: sửa title/instructions/type; Working ở giữa; panel Type/Hướng dẫn/References/Archived; cache đóng/mở; thao tác bằng nút/menu | Chưa triển khai |
| 4. Agent và catalog | Hoàn thiện new/join sau popup inspect tối thiểu ở Phase 2; catalog title/description/type/directory và instructions; đọc file chọn lọc | Chưa triển khai |
| 5. Tổ chức trực quan | Card masonry; filter/search; dnd-kit sắp xếp và chuyển vùng, lưu vào `layout.json` | Chưa triển khai |

## Ranh giới chung

- Một artifact có thể nằm trong nhiều session; `registered-artifacts/<artifactId>.json` là nguồn membership duy nhất của mỗi session, còn `layout.json` lưu ba mảng `working`, `references`, `archived` và thứ tự hiển thị (chỉ lưu một lần sau khi kéo thả/chuyển vùng thành công). Artifact đã đăng ký nhưng chưa có trong `layout.json` mặc định nằm cuối `working`.
- Bỏ file lock riêng cho layout/session; dùng atomic write và chấp nhận quy tắc “bản lưu sau cùng thắng” khi nhiều cửa sổ cùng cập nhật bố cục/metadata.
- `Session.updatedAt` hiển thị được tính khi đọc từ thời điểm lớn nhất giữa `createdAt` và các `registeredAt` trong `registered-artifacts/`. MCP tạo hoặc inspect lại artifact cập nhật `registeredAt` như hiện tại nên tự đẩy Session lên đầu mà không cần sửa `conversation.json`; kéo thả (`layout.json`) hoặc sửa metadata không làm thay đổi `updatedAt`.
- Gỡ artifact khỏi session xoá file trong `registered-artifacts/` và bỏ ID khỏi `layout.json`. Không xoá artifact hoặc ảnh hưởng session khác; Session v2 rỗng vẫn được giữ.
- `instructions` là một nội dung Markdown, không phải mảng rule hay workflow engine.
- Giữ artifact schema v6 và cơ chế ownership/review hiện tại. Session ID không phải reviewSessionId.
- Phase 1 nối model mới vào luồng hiện tại; popup inspect chọn New/Join tối thiểu thuộc đợt Phase 1+2, Phase 4 mới hoàn thiện contract agent/catalog và trải nghiệm new/join đầy đủ.
- Header manager đã thảo luận: Pin → Connect → More → Panel. Panel đóng/mở toàn bộ phần Type, instructions, References, Archived; UI đầy đủ thuộc Phase 3.
- Sidebar Sessions chỉ có ⚙ quản lý types ở góc phải header; **không có + session**. Session tạo qua luồng artifact/new-session. Click điều hướng không tạo session.
- Session được mở theo kết quả kiểm tra MCP đã cài trên đĩa, mốc numeric MCP_VERSION **12**; tạm thời không kiểm tra process đang chạy. MCP chưa đủ version chặn section Sessions và nút Sessions trên Review App, không chặn Recent Artifacts/Connect/review. Version marker đã bump, logic gate còn thuộc plan.
- Sidebar chỉ list Session v2. Conversation v1 được phát hiện/đếm read-only; hiện dòng “Có N conversation có thể chuyển sang Sessions”, click mở popup xác nhận rồi mới chạy bulk tuần tự bằng cùng hàm migration đơn lẻ. Huỷ không ghi; kết thúc báo kết quả và refresh.
- Bỏ drawer conversation cũ. Review App có Sessions cho v2, hành động migration từng conversation cho v1 khi MCP đã đủ version. Không tự migration khi activation, đọc/list, mở artifact hoặc cleanup. Không rollback cả batch nếu một mục lỗi.
- Create và inspect **có truyền ID conversation v1** cùng trả lỗi trước mutation/takeover/cấp token, mã dự kiến `CONVERSATION_MIGRATION_REQUIRED`; không giữ nhánh inspect thành công kèm cảnh báo. Artifact từng thuộc v1 không tự gây lỗi nếu caller không truyền ID v1; ID v2/không có ID vẫn dùng Session API mới và ghi `registered-artifacts/` như hiện tại.
- Skill hướng dẫn đúng hai lựa chọn: mở một artifact đã thuộc conversation cũ để migration rồi retry cùng ID, hoặc user chọn tạo/mở Session mới thì retry không truyền ID và giữ ID mới cho chat. Không tự đổi nhóm, nhập membership cũ, clone artifact hoặc xoá conversation cũ. Hướng dẫn lỗi tối thiểu này làm ngay cùng Phase 1+2 và tăng SKILL_VERSION khi triển khai; skill hiện tại vẫn là 3.
- Popup inspect: conversation v1 thì Join disabled, chỉ cho inspect New Session; Session v2 có thể Join. New không truyền ID cũ và yêu cầu skill bỏ active ID cho request, Join chỉ định đúng ID v2. Có nhiều membership thì chỉ disable các đích v1. Extension copy prompt cho AI, không tự gọi MCP/mutate; chi tiết và nhánh MCP cũ ở mục 12 plan chung. Nhãn nút điều hướng đã chốt là **Sessions**.
- **Đã chốt:** MCP cũ giữ Connect như hiện tại, click copy prompt exact artifact handle trực tiếp; không mở popup New/Join hoặc yêu cầu tạo Session v2. Chỉ MCP mới đủ mốc Session mới dùng popup/luồng New/Join. Recent Artifacts dùng 20 mục + Xem tất cả; quản lý types dùng Quick Pick native.
- Chưa thêm dependency UI/style trong giai đoạn lập plan.

## 7 bước nhỏ trong đợt Phase 1+2

Hướng dẫn từng file/hàm, luồng xử lý, khả năng phải đạt và kiểm chứng ở mục 13.1–13.7 của [plan chi tiết](plan-phase-1.md). Đã đối chiếu source ngày 2026-11-06; tên module/API/command mới trong hướng dẫn là đề xuất triển khai. MCP_VERSION 11 → 12 là phần chuẩn bị đã làm; các bước dưới đây chưa triển khai.

| Bước | Công việc |
| --- | --- |
| 1 | Model/persistence Session v2 và types global: giữ `registered-artifacts/` làm nguồn membership, tách `layout.json` ba mảng, tính `updatedAt` từ `createdAt`/`registeredAt`. |
| 2 | Phát hiện v1, hàm migration từng conversation dùng chung; cleanup theo schema, giữ Session v2 rỗng. |
| 3 | Nối MCP create/reuse/rollback và skill; create/inspect có ID v1 cùng trả lỗi, AI hướng dẫn migration hoặc chủ động tạo Session mới. |
| 4 | Sidebar Recent/Sessions v2, gate MCP đã cài từ version 12, ⚙ quản lý types, thông báo số conversation có thể migration. |
| 5 | Tab Session chỉ đọc, hiện ba vùng và mở artifact; refresh dữ liệu. |
| 6 | Bỏ drawer cũ, Sessions và migration đơn lẻ tại Review App; popup inspect New/Join (disable Join v1), popup/bulk migration từ sidebar; nối điều hướng vào tab Session. |
| 7 | Kiểm chứng kết hợp bằng tests/check/build và Extension Host theo plan. |

Không đổi phạm vi Phase 3–5; UI chọn/gán type cho session vẫn thuộc Phase 3.

## Quản lý nhiều session tự tạo — đề xuất để review

Không đổi contract auto-create/reuse chỉ vì danh sách dài. Session chỉ được tự tạo khi create/inspect theo luồng đã định nghĩa, không phải mỗi lần mở artifact hoặc mỗi lượt chat.

| Cách quản lý | Công việc | Phase phù hợp |
| --- | --- | --- |
| **Đã ghim → Gần đây** | Một cờ `isPinned` của session; nhóm ghim lên trên, các phiên còn lại theo updatedAt; không hiện trùng | 2–3 |
| Giới hạn Recent + Xem tất cả | Sidebar hiển thị số lượng hữu hạn, mở danh sách đầy đủ khi cần | 2 |
| Archive/Restore session | Cất phiên khỏi danh sách hoạt động, vẫn truy cập lại được; độc lập với mảng artifact `archived` | 3 |
| Tìm theo title session | Tìm phiên cũ khi danh sách tăng | 2 hoặc sau bản đầu tuỳ nhu cầu |

Khuyến nghị: bắt đầu bằng ghim, Recent giới hạn và Archive thủ công. Pin đơn giản về dữ liệu/UI; không cần thư viện riêng. Tên, số lượng artifact và updatedAt giúp nhận diện session mà không mở manager.

Ghim, archive và search nâng cao ở trên vẫn là **đề xuất**, chưa tự thêm `isPinned` hoặc trạng thái archive vào đợt này. Recent Artifacts 20 mục + Xem tất cả đã được chốt riêng. Không tự xoá session một artifact, session rỗng hoặc session lâu không dùng; không tự gộp theo title. Những cách đó có thể làm mất cách tổ chức/instructions của user.

Plan Phase 2 đã chốt Recent Artifacts 20 mục + Xem tất cả, Sessions hiển thị đầy đủ; chưa triển khai nhóm ghim hoặc Archive session.

## Session types — phạm vi đã bổ sung

- Mỗi session lưu một `typeId`, mặc định `conversation`; không phải mảng tags và không phải artifact kind/type.
- Danh sách global `~/.ai-artifacts/session-types.json` gồm schemaVersion và các `{ id, label }`; seed Conversation, Project, Feature, Fix khi chưa có file. Type tự tạo dùng chung giữa workspace/session và tồn tại dù chưa sử dụng.
- ID ổn định, label sửa được. Trim/so tên không phân biệt hoa thường để tránh trùng. `conversation` đổi label được nhưng không xoá; xoá type khác đang dùng cần xác nhận chuyển các session về mặc định.
- **Phase 1:** schema/persistence và API types + assignment. **Phase 2:** popup thêm/sửa/xoá từ ⚙ trên Sessions. **Phase 3:** Type ✎ ở trên Hướng dẫn để chọn/tìm/tạo nhanh rồi gán cho session.
- Popup quản lý ghi rõ áp dụng cho tất cả phiên. Không có ⚙ quản lý types tại manager, Recent Artifacts hoặc header chung sidebar.
- Hình thức popup đã chốt là Quick Pick native, mở ở vị trí Quick Input chuẩn của VS Code; không phải popover neo cạnh ⚙. Chi tiết service, lỗi ghi và kiểm chứng nằm trong plan chung.

## Để sau bản đầu

Handoff; next action theo type; tìm artifact ngoài session để thêm; participant/role; ownership hardening. Không mở rộng required scope bằng các mục này.
