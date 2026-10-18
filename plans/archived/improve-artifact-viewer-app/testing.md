# Core Feature Test Checklist: Artifacts in Conversations (v1.1.0)

Tài liệu này định nghĩa danh sách các kịch bản kiểm thử tính năng cốt lõi (Core Feature Tests) cho tính năng **Artifacts in Conversations** trên extension AI Artifacts (v1.1.0).

---

## 1. Môi trường chuẩn bị (Setup)

1. Mở VS Code trong workspace `d:\workspace\my-projects\ai-artifacts`.
2. Chạy `npm run build` để đảm bảo code extension và webview đã được build mới nhất.
3. Nhấn **F5** để mở cửa sổ **Extension Development Host**.
4. Chuẩn bị AI client (Claude Desktop / Cursor / Codex / Copilot) đã được kết nối với MCP server 10.0.0 hoặc tạo artifact mẫu qua lệnh test.

---

## 2. Kịch bản kiểm thử tính năng (Test Scenarios)

### Test Case 1: Tạo nhiều Artifacts trong cùng 1 cuộc trò chuyện (Same Conversation)
- **Mục tiêu:** Kiểm tra AI Agent tự động gom nhóm các artifact được tạo trong cùng phiên chat vào 1 Conversation duy nhất.
- **Các bước thực hiện:**
  1. Trong cùng một phiên chat AI, yêu cầu tạo Artifact thứ 1 (ví dụ: `Plan Phase 1`).
  2. Tiếp tục trong phiên chat đó, yêu cầu tạo Artifact thứ 2 (ví dụ: `Checklist Phase 1`).
  3. Mở Artifact Review tab trên VS Code cho một trong hai artifact.
- **Kết quả mong đợi (Expected):**
  - [ ] Nút **Conversation Artifacts (2)** xuất hiện ở thanh công cụ góc trên bên trái, hiển thị tổng số 2 artifacts.
  - [ ] Hover vào nút hiển thị tooltip: `View artifacts in this conversation (2)`.
  - [ ] Bấm vào nút mở drawer: hiển thị 1 accordion mang tên conversation (mặc định lấy theo title của artifact đầu tiên).
  - [ ] Bên trong accordion có đầy đủ 2 artifacts:
    - Artifact đang xem có badge `Current` và nút bị disable (không click lại chính nó).
    - Artifact còn lại có thể click được, hiển thị đúng `kind`, `title` và timestamp đăng ký.

---

### Test Case 2: Điều hướng mở Artifact khác từ Drawer (Navigation & Switching)
- **Mục tiêu:** Kiểm tra mở artifact khác từ drawer mà không làm đứt kết nối hay mất state của tab hiện tại.
- **Các bước thực hiện:**
  1. Mở drawer **Conversation Artifacts** từ Test Case 1.
  2. Bấm vào artifact thứ 2 (không phải current).
- **Kết quả mong đợi (Expected):**
  - [ ] Editor mở tab Artifact Review mới cho artifact thứ 2 (hoặc focus vào tab đó nếu đã mở trước đó).
  - [ ] Tab thứ 2 mở ở dạng editor thông thường (non-preview tab).
  - [ ] Trên tab mới, nút **Conversation Artifacts** tiếp tục hiển thị `(2)`. Mở drawer ở tab mới sẽ thấy artifact thứ 2 được đánh dấu là `Current`.
  - [ ] Tab thứ 1 vẫn giữ nguyên trạng thái kết nối, comment draft và markdown mà không bị reload ngoài ý muốn.

---

### Test Case 3: Artifact tham gia nhiều Conversations (Multi-Conversation Accordion)
- **Mục tiêu:** Kiểm tra khi 1 artifact cũ được inspect/tiếp tục trong một phiên chat mới (conversation mới), nó sẽ xuất hiện ở cả 2 conversation.
- **Các bước thực hiện:**
  1. Mở một phiên chat AI **mới hoàn toàn** (chat session 2).
  2. Cung cấp handle của Artifact thứ 1 từ Test Case 1 và yêu cầu AI inspect/cập nhật artifact này (hoặc gọi MCP tool `inspect_artifact_review` với `intent: "reconnect"` mà không truyền `artifactConversationId`).
  3. Tạo tiếp Artifact thứ 3 trong phiên chat mới này.
  4. Mở Artifact Review của Artifact thứ 1.
- **Kết quả mong đợi (Expected):**
  - [ ] Drawer của Artifact thứ 1 hiển thị **2 accordions** tương ứng với 2 conversations mà nó tham gia.
  - [ ] **Thứ tự Accordion:** Conversation mới nhất (nơi Artifact 1 vừa được re-register gần đây nhất) phải nằm ở trên cùng.
  - [ ] **Hành vi Accordion:** Mặc định conversation đầu tiên được mở ra (expanded), conversation thứ hai đóng (collapsed). Có thể click mở cả 2 conversation cùng lúc (multi-open).
  - [ ] Badge số lượng trên mỗi accordion thể hiện chính xác số artifact của conversation đó.

---

### Test Case 4: Quy tắc sắp xếp thứ tự Artifacts bên trong Accordion
- **Mục tiêu:** Kiểm tra thứ tự hiển thị của các artifacts bên trong 1 conversation.
- **Các bước thực hiện:**
  1. Trong 1 conversation có từ 3 artifacts trở lên (tạo lần lượt: A, B, C).
  2. Mở drawer xem danh sách bên trong accordion.
- **Kết quả mong đợi (Expected):**
  - [ ] Các artifacts bên trong accordion sắp xếp theo thứ tự thời gian đăng ký tăng dần (`registeredAt` cũ nhất ở trên, mới nhất ở dưới theo đúng trình tự diễn tiến hội thoại).
  - [ ] Timestamp hiển thị định dạng rõ ràng (ví dụ: `Oct 18, 12:45`).

---

### Test Case 5: Tương tác Drawer & Giao diện (Responsive & Focus/Keyboard)
- **Mục tiêu:** Kiểm tra phối hợp giữa Conversation Artifacts Drawer và Comments Drawer, cùng khả năng điều hướng bàn phím.
- **Các bước thực hiện:**
  1. Bấm nút **Conversation Artifacts** mở drawer trái $\rightarrow$ bấm phím `Escape` hoặc nút `×` hoặc click backdrop ra ngoài.
  2. Mở drawer trái $\rightarrow$ bấm nút mở **Comments (N)** ở thanh công cụ bên phải.
  3. Thu nhỏ chiều rộng cửa sổ VS Code (màn hình hẹp/split editor).
- **Kết quả mong đợi (Expected):**
  - [ ] Phím `Escape`, nút `×`, và click backdrop đều đóng drawer mượt mà, focus trả về vị trí hợp lý.
  - [ ] Trên màn hình rộng: có thể mở đồng thời cả **Conversation Artifacts** (bên trái) và **Comments Drawer** (bên phải) mà không bị vỡ layout.
  - [ ] Trên màn hình hẹp: mở drawer bên này sẽ tự động đóng drawer bên kia để tối ưu không gian đọc Markdown.

---

### Test Case 6: Xử lý Artifact bị xóa hoặc mất file (Resilience & Self-Healing)
- **Mục tiêu:** Kiểm tra hệ thống chịu lỗi an toàn khi file artifact trên đĩa bị xóa ngoài ý muốn.
- **Các bước thực hiện:**
  1. Mở drawer đang có 2 artifacts.
  2. Mở File Explorer hệ thống, tìm đến thư mục `~/.ai-artifacts/artifacts/<id-cua-artifact-thu-2>/` và xóa thư mục này đi (giả lập artifact hết hạn hoặc bị xóa thủ công).
  3. Quay lại VS Code:
     - Trường hợp A: Bấm trực tiếp vào artifact vừa bị xóa trên drawer đang mở.
     - Trường hợp B: Tắt drawer đi và mở lại (hoặc reload tab).
- **Kết quả mong đợi (Expected):**
  - [ ] **Trường hợp A:** VS Code hiển thị thông báo lỗi thân thiện: `Artifact "..." is no longer available on disk.` và drawer tự động kích hoạt refresh để ẩn item đó đi; không gây crash hay đơ webview.
  - [ ] **Trường hợp B:** Khi drawer đọc lại, item đã bị xóa được tự động bỏ qua (skip), không còn hiển thị trong danh sách. File membership tương ứng trong `conversation-registry` được dọn dẹp sạch.

---

## 3. Bảng ghi nhận kết quả kiểm thử (Test Execution Sign-off)

| Test Case | Mô tả kiểm thử | Người test | Kết quả (Pass/Fail) | Ghi chú |
| :--- | :--- | :---: | :---: | :--- |
| **TC1** | Gom nhóm cùng Conversation (Same Conversation) | Chú | | |
| **TC2** | Mở & chuyển đổi Artifact từ Drawer | Chú | | |
| **TC3** | Artifact trong nhiều Conversations (Multi-open Accordion) | Chú | | |
| **TC4** | Sắp xếp thứ tự Accordion và Artifacts | Chú | | |
| **TC5** | Tương tác Drawer, Keyboard & Responsive | Chú | | |
| **TC6** | Tự phục hồi khi Artifact bị xóa (Resilience) | Chú | | |
