# Manual Test Cases — Window Routing & Schema v6

> **Scope:** MCP 9.0.0 / Artifact Schema v6 / Focused-Window Routing  
> **Target Hosts:** VS Code, Cursor  
> **Reference Plan:** `plans/change-resolve-workspace-contract.md` (§5 Manual Matrix) & `plans/change-resolve-workspace-contract/working.md`

---

## 1. Pre-requisites & Pre-flight Checklist

Trước khi thực hiện các test case, cần chuẩn bị môi trường:

- [ ] **Build VSIX:** Chạy `npm run package` (hoặc `vsce package`) tạo VSIX candidate mới nhất.
- [ ] **Install Extension:** Cài đặt VSIX candidate vào VS Code / Cursor test host.
- [ ] **Install Integrations:** Mở Command Palette (`Ctrl+Shift+P`), chạy `Agent+: Install All Detected Integrations` (hoặc install client tương ứng).
- [ ] **Verify Tool Catalog:** Kiểm tra MCP config của client (VS Code / Cursor / Codex), đảm bảo MCP server `agent-plus` expose đúng **5 tools**:
  1. `create_artifact`
  2. `inspect_artifact_review`
  3. `resolve_artifact_window`
  4. `wait_for_artifact_review`
  5. `advance_and_wait_for_artifact`
  *(Tuyệt đối không còn tool `resolve_artifact_workspace`)*.
- [ ] **Fresh AI Session:** Khởi động lại test host và mở phiên chat AI hoàn toàn mới (tránh prompt/tool cache cũ).

---

## 2. Test Environment Setup & Notation

| Ký hiệu | Ý nghĩa |
|---|---|
| **W1** | VS Code Window 1 (mở Workspace/Folder A) |
| **W2** | VS Code Window 2 (mở Workspace/Folder B hoặc Folder A tùy test case) |
| **W_empty** | VS Code Window không mở bất kỳ folder nào (`File > New Window`) |
| **Focused** | Cửa sổ đang nhận focus từ OS / user vừa click chuột vào editor |
| **Non-focused**| Cửa sổ đang mở nhưng không active |

---

## 3. Manual Test Matrix (18 Test Cases)

### Group A: Deterministic Focus Routing (Default Path)

#### Case 01: Single-window focus (2 live windows, 1 focused)
- **Mục tiêu:** Kiểm tra default `create_artifact` tự động chọn cửa sổ đang focus mà không cần chỉ định window/workspace.
- **Setup:**
  1. Mở song song **W1** và **W2**.
  2. Click chuột vào editor của **W1** (W1 = Focused, W2 = Non-focused).
- **Action:**
  - Trong AI chat, gọi `create_artifact` tạo 1 plan artifact mới (không truyền token hay connection hint).
- **Expected Result:**
  - MCP `create_artifact` trả về status thành công, `windowInstanceId` trỏ về instance của **W1**.
  - Webview Review UI tự động mở trên **W1**. **W2** không bị ảnh hưởng.
  - Connection file sinh ra với `revision: 1`, `openRequestId` mới.

---

#### Case 02: Reconnect with target switched (Connection trỏ W1, focus chuyển sang W2)
- **Mục tiêu:** Kiểm tra default `inspect_artifact_review` tự động rebind sang window hiện tại đang focus.
- **Setup:**
  1. Đã có artifact tạo ở W1 (từ Case 01).
  2. Click chuột sang **W2** (W2 = Focused, W1 = Non-focused).
- **Action:**
  - Trong AI chat, gọi `inspect_artifact_review` với `artifactHandle` đã tạo.
- **Expected Result:**
  - MCP trả về kết quả thành công, connection tự động rebind sang **W2**.
  - `revision` tăng lên (`revision: 2`), sinh `openRequestId` mới.
  - Webview UI mở/reveal trên **W2**.

---

#### Case 03: Reconnect same focused window
- **Mục tiêu:** Reconnect vào chính window đang giữ connection và đang focus.
- **Setup:**
  1. Artifact đang kết nối với W1.
  2. Đảm bảo **W1** vẫn đang Focused.
- **Action:**
  - Gọi `inspect_artifact_review` với `artifactHandle`.
- **Expected Result:**
  - Thành công. `revision` vẫn tăng (atomic increment) và phát sinh `openRequestId` mới.
  - Watcher trên W1 bắt được event và reveal/reopen UI tab.

---

#### Case 04: Sole live window, no explicit focus
- **Mục tiêu:** Khi chỉ có 1 window mở duy nhất nhưng focus đang ở ứng dụng ngoài (browser/terminal).
- **Setup:**
  1. Chỉ mở duy nhất **W1** (đóng hết các cửa sổ VS Code khác).
  2. Click sang một app ngoài (ví dụ Notepad/Browser) để VS Code mất focus.
- **Action:**
  - Gọi `create_artifact` từ external AI client (hoặc qua MCP client script).
- **Expected Result:**
  - Hệ thống nhận diện chỉ có duy nhất 1 live window khả dụng.
  - `create_artifact` thành công và route vào **W1**.

---

### Group B: Ambiguity & Selection Flow (Error Recovery)

#### Case 05: Ambiguity — Multiple live windows, none focused
- **Mục tiêu:** Ngăn chặn auto-guess khi không xác định được focused window rõ ràng.
- **Setup:**
  1. Mở **W1** và **W2**.
  2. Click ra ngoài desktop hoặc app bên ngoài để cả 2 window VS Code đều mất focus (hoặc trigger trạng thái cả 2 đều `isFocused: false`).
- **Action:**
  - Gọi `create_artifact`.
- **Expected Result:**
  - MCP ném lỗi `WINDOW_SELECTION_REQUIRED`.
  - Trả về danh sách `candidates` gồm cả W1 và W2 (gồm `windowTitle`, `workspaceFolders`, `focused: false`, v.v.).
  - **Không có artifact hay connection nào được tạo hoặc commit dở dang**.

---

#### Case 06: Ambiguity — Multi-monitor dual focus race
- **Mục tiêu:** Nếu heartbeat/focus report ghi nhận >1 window báo `focused: true` trong race condition.
- **Setup:** Giả lập hoặc trigger 2 snapshot đều có cờ focused (hoặc kiểm tra qua mock harness).
- **Action:**
  - Gọi `create_artifact`.
- **Expected Result:**
  - Hệ thống từ chối chọn "newest" mù quáng.
  - Ném `WINDOW_SELECTION_REQUIRED` kèm danh sách candidates.

---

#### Case 07: Explicit selection via resolver token
- **Mục tiêu:** User/AI chọn đích danh một non-focused window thông qua token một lần.
- **Setup:**
  1. Đang có **W1** (Focused) và **W2** (Non-focused).
- **Action:**
  1. Gọi `resolve_artifact_window(criteria: { targetFolder: "<path W2>" })` (hoặc title của W2).
  2. Nhận `selectionToken` và `selectedWindow` (W2) từ response.
  3. Gọi `create_artifact(connection: { selectionToken: "<token vừa nhận>" })`.
- **Expected Result:**
  - `resolve_artifact_window` trả token hợp lệ (TTL 30s).
  - `create_artifact` route chính xác vào **W2** (mặc dù W2 không focused).
  - UI Webview mở trên **W2**.

---

#### Case 08: Token expiration / Stale target
- **Mục tiêu:** Token hết hạn hoặc target window bị đóng trước khi token được dùng.
- **Setup:**
  1. Mở W1, W2.
  2. Gọi `resolve_artifact_window` chọn W2, nhận `selectionToken`.
  3. **Đóng cửa sổ W2** (hoặc chờ > 30 giây cho token hết hạn).
- **Action:**
  - Gọi `create_artifact(connection: { selectionToken: "<token>" })`.
- **Expected Result:**
  - MCP ném lỗi `WINDOW_SELECTION_EXPIRED`.
  - Không fallback âm thầm về W1.
  - Trả về danh sách `freshCandidates` nếu còn window live.
  - Không có file artifact rác nào được commit.

---

### Group C: Reconnect & Session Lifecycles

#### Case 09: VS Code restart makes existing connection stale
- **Mục tiêu:** Khi VS Code restart, `windowInstanceId` trong connection cũ không còn tồn tại.
- **Setup:**
  1. Tạo artifact ở W1. Ghi nhận `artifactHandle`.
  2. Tắt hoàn toàn VS Code rồi mở lại (instance ID của window thay đổi).
  3. Focus vào cửa sổ mới mở.
- **Action:**
  - Gọi `inspect_artifact_review(artifactHandle)`.
- **Expected Result:**
  - Hệ thống phát hiện connection cũ trỏ vào instance đã chết.
  - Tự động rebind connection sang window mới đang focus.
  - UI Webview mở lại bình thường với round state hiện tại.

---

#### Case 10: Empty window target (no workspace folders)
- **Mục tiêu:** Window không mở folder/workspace vẫn hỗ trợ artifact review.
- **Setup:**
  1. Mở **W_empty** (`File > New Window`, không mở folder).
  2. Đảm bảo **W_empty** là focused window.
- **Action:**
  - Gọi `create_artifact`.
- **Expected Result:**
  - Snapshot của W_empty vẫn được nhận diện (workspace folders rỗng).
  - `create_artifact` commit thành công và Webview mở trên **W_empty**.
  - Storage artifact lưu đúng global root.

---

#### Case 11: `autoOpen: false`
- **Mục tiêu:** AI tạo artifact ở chế độ headless/background không ép mở giao diện người dùng.
- **Setup:** W1 đang focused.
- **Action:**
  - Gọi `create_artifact(..., autoOpen: false)`.
- **Expected Result:**
  - Artifact và connection file được tạo thành công trên đĩa.
  - `openRequestId` không được tạo hoặc không phát tín hiệu mở tab.
  - Editor tab Webview **không tự động mở** trên W1.
  - Response metadata xác nhận artifact created nhưng không claim UI opened.

---

### Group D: Schema Safety & Non-Interference

#### Case 12: Schema v5 vs Schema v6 handle coexistence
- **Mục tiêu:** Bảo vệ dữ liệu cũ; reject v5 dứt khoát không gây hỏng file.
- **Setup:**
  1. Chuẩn bị 1 artifact cũ có schema v5 trong storage (có trường `location: { workspaceFolder: ... }`).
  2. Chuẩn bị 1 artifact schema v6 mới.
- **Action:**
  1. Gọi `inspect_artifact_review` với v5 handle.
  2. Gọi `inspect_artifact_review` với v6 handle.
- **Expected Result:**
  - Với v5 handle: Bị reject ngay với lỗi `ARTIFACT_SCHEMA_UNSUPPORTED` (hoặc schema version mismatch). File v5 trên đĩa giữ nguyên 100%, không bị sửa hay ghi đè.
  - Với v6 handle: Mở bình thường, tương tác bình thường.

---

#### Case 13: Wait and advance after reconnect
- **Mục tiêu:** Các tool `wait_for_artifact_review` và `advance_and_wait_for_artifact` không được can thiệp vào window routing.
- **Setup:**
  1. Tạo artifact trên W1, mở UI review.
  2. Focus sang ứng dụng khác hoặc W2.
- **Action:**
  - Gọi `wait_for_artifact_review` hoặc `advance_and_wait_for_artifact`.
- **Expected Result:**
  - Tool chỉ lắng nghe round transition / feedback trên connection hiện tại.
  - Không trigger re-resolve window, không emit `openRequestId` mới, không làm nhảy focus editor.

---

#### Case 14: Full Review Lifecycle (Review → Revise / Approve / Save)
- **Mục tiêu:** Đảm bảo toàn bộ chu trình review không bị lỗi round token hay takeover.
- **Setup:** W1 đang focused, mở plan artifact.
- **Action:**
  1. User click "Request Changes" trên UI Webview, nhập feedback.
  2. AI nhận feedback qua `wait_for_artifact_review`.
  3. AI gọi `create_artifact` hoặc update artifact để nộp revision mới.
  4. User click "Approve" và "Save".
- **Expected Result:**
  - Round token và revision tăng tuần tự, UI hiển thị đúng trạng thái từng phase.
  - Không xảy ra lỗi `ROUND_TOKEN_MISMATCH` hoặc takeover conflict.

---

### Group E: Edge Cases & Security Contracts

#### Case 15: Focus changed immediately before request
- **Mục tiêu:** Kiểm tra độ nhạy của heartbeat / window snapshot listener khi user click đổi window chớp nhoáng.
- **Setup:** Mở W1 và W2.
- **Action:** Click từ W1 sang W2 và ngay lập tức gửi prompt gọi `create_artifact`.
- **Expected Result:**
  - Request ăn theo snapshot mới nhất (W2) hoặc nếu rơi đúng khoảng trống heartbeat thì trả về `WINDOW_SELECTION_REQUIRED` an toàn.
  - Không bao giờ ghi nhầm dữ liệu vào cửa sổ đang bị unfocused một cách không chủ ý.

---

#### Case 16: Two windows opening the exact SAME folder
- **Mục tiêu:** Phân biệt window theo `instanceId`, không còn dựa vào folder path hay workspace ownership.
- **Setup:**
  1. Mở 2 cửa sổ VS Code khác nhau nhưng cùng mở 1 thư mục dự án (Folder A).
  2. W1 focused, W2 non-focused.
- **Action:**
  1. Gọi `create_artifact` -> Phải vào W1.
  2. Gọi `resolve_artifact_window` để lấy token của W2 -> Gọi `create_artifact` với token -> Phải vào W2.
- **Expected Result:**
  - Cả 2 request route chính xác vào đúng cửa sổ dự định, chứng minh routing hoạt động hoàn toàn theo Window Instance, không bị conflict folder path.

---

#### Case 17: Token replay / Double-spend prevention
- **Mục tiêu:** `selectionToken` là single-use. Sau khi dùng xong phải bị xóa ngay lập tức.
- **Setup:**
  1. Gọi `resolve_artifact_window` lấy 1 `selectionToken`.
  2. Dùng token đó gọi `create_artifact` lần 1 (thành công).
- **Action:**
  - Dùng lại chính token đó để gọi `create_artifact` lần 2 (hoặc `inspect_artifact_review`).
- **Expected Result:**
  - Lần 2 thất bại với lỗi `WINDOW_SELECTION_EXPIRED` (hoặc invalid token).
  - Không được phép tái sử dụng token đã consume.

---

#### Case 18: Old tool name rejection
- **Mục tiêu:** Đảm bảo tool cũ `resolve_artifact_workspace` đã bị gỡ hoàn toàn.
- **Action:**
  - Gửi direct MCP request gọi `resolve_artifact_workspace`.
- **Expected Result:**
  - MCP server báo lỗi: Unknown tool / Method not found. Không có fallback hay alias ẩn.

---

## 4. Test Execution Log & Evidence Recording

Khi tiến hành test trên từng host (VS Code / Cursor), ghi nhận kết quả theo bảng dưới đây:

| Case # | Description | Target Host | Snapshot IDs (W1/W2) | Result (Pass/Fail) | Notes / Observations |
|:---:|---|:---:|:---:|:---:|---|
| 01 | Default create focused window | | | | |
| 02 | Reconnect to new focused window | | | | |
| 03 | Reconnect same window | | | | |
| 04 | Sole live window | | | | |
| 05 | Ambiguity: no focus | | | | |
| 06 | Ambiguity: dual focus | | | | |
| 07 | Explicit token selection | | | | |
| 08 | Token expired / closed target | | | | |
| 09 | Host restart / stale rebind | | | | |
| 10 | Empty window target | | | | |
| 11 | autoOpen = false | | | | |
| 12 | v5 vs v6 coexistence | | | | |
| 13 | wait/advance no re-route | | | | |
| 14 | Full review lifecycle | | | | |
| 15 | Rapid focus change | | | | |
| 16 | Same folder, dual windows | | | | |
| 17 | Token single-use replay | | | | |
| 18 | Old tool name rejected | | | | |
