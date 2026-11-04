# Kịch bản Reproduce, Fix & Validation (GitHub Copilot Turn-Back)

## 1. Kịch bản Reproduce (Tái hiện lỗi nhanh)

**Điều kiện chuẩn bị:**
- Đã cài AI Artifacts integration cho **GitHub Copilot (VS Code)**.
- Đảm bảo trong VS Code Settings đã bật **`Chat > Agent: Enabled` (`"chat.agent.enabled": true`)**.
- Mở **GitHub Copilot Chat** ở chế độ **Agent Mode** (có thể dùng model nhẹ như `MAI-Code-1.1-Flash`, `GPT-4o-mini` để xem lỗi dừng turn, hoặc dùng `Codex` qua `9router` để xem log tự chữa cháy).

**Các bước thực hiện (chỉ mất ~1 phút, bấm Review ngay để không dính lỗi timeout):**

1. **Tạo Artifact (Round 1):**
   Nhập prompt vào Copilot Chat:
   > `Create a review artifact with a simple 3-step plan to add a sum(a, b) function in TypeScript.`
2. **Kiểm tra trạng thái chờ:**
   - Copilot gọi `create_artifact` $\rightarrow$ mở giao diện Artifact Review (Round 1).
   - Copilot gọi tiếp `wait_for_artifact_review` (trạng thái đang xoay chờ trong chat).
3. **Bấm Review:**
   - Trên giao diện Artifact Review, bôi đen 1 dòng bất kỳ, thêm inline comment: `Rename function to addNumbers`.
   - Bấm nút **Review** ngay lập tức.
4. **Quan sát lỗi nhận được (Đã Reproduced thực tế):**
   - Trong Copilot Chat, tool `wait_for_artifact_review` hoàn tất và trả về payload chỉ có `"decision": "revise"` (không có mảng `comments`, không có `nextAction`).
   - **Với model nhỏ (`MAI-Code-1.1-Flash` của user):**
     - **Triệu chứng 1 (Turn-back failure):** Tự kết thúc lượt chat mà **không** sửa nội dung và **không** gọi `advance_and_wait_for_artifact` để lên Round 2.
     - **Triệu chứng 2 (Integrity error):** Hoặc tự dùng tool edit file của VS Code sửa thẳng vào `~/.ai-artifacts/artifacts/<id>/artifact.md` và bị lỗi `artifact.md changed outside the artifact review update protocol.`
   - **Với model thông minh (`9Router/Codex` - Đã chụp log thực tế):**
     - Xuất hiện dòng thought: **`Inspecting missing comment payloads`** và phải tốn thêm 1 bước gọi **`Inspect artifact review`** để lấy nội dung comment bị thiếu rồi mới gọi được `Advance and wait for artifact review`.

---

## 2. Hướng Fix (Nhỏ gọn, đúng trọng tâm)

**Component sửa đổi:** [`src/integration/artifact-review-mcp-v4.ts`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts) (và type/test liên quan trong `src/shared/`, `test/`)

1. **Trả về `comments` trong kết quả chờ (`readValidatedSubmissionOnce`):**
   - Đưa `comments: currentComments` vào object trả về của `readValidatedSubmissionOnce` để cả `wait_for_artifact_review` và `advance_and_wait_for_artifact` đều trả về đầy đủ nội dung comment ngay khi user bấm **Review** (đồng bộ với `inspect_artifact_review`).
2. **Bổ sung `nextAction` cho nhánh `decision === "revise"`:**
   - Khi `submission.decision === "revise"`, trả kèm `nextAction`:
     - Chỉ dẫn rõ: Đọc `comments` vừa trả về, trả lời câu hỏi (nếu có) trong chat, sinh toàn bộ nội dung Markdown mới (nếu có yêu cầu sửa), **tuyệt đối không sửa trực tiếp file `artifact.md` trên đĩa**, và **gọi ngay `advance_and_wait_for_artifact` kèm `roundToken` trong cùng turn này**.

---

## 3. Kịch bản Validation (Kiểm chứng sau khi Fix)

### Bước 1: Kiểm chứng bằng Automated Tests
Chạy tại root repo `ai-artifacts`:
```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```
- Đảm bảo test xác nhận `wait_for_artifact_review` và `advance_and_wait_for_artifact` khi `decision === "revise"` có trả về đầy đủ `comments` và `nextAction`.

### Bước 2: Kiểm chứng thực tế trên GitHub Copilot (End-to-End)
Sau khi build và cập nhật bản MCP server mới, lặp lại đúng kịch bản ở Mục 1:

1. **Test Round 1 $\rightarrow$ Round 2 (Sửa nội dung):**
   - Thêm comment `Rename function to addNumbers` $\rightarrow$ bấm **Review**.
   - **Kỳ vọng đạt:**
     - Kết quả tool `wait_for_artifact_review` hiển thị có sẵn trường `comments` và `nextAction`.
     - **Không còn bước thừa `Inspecting missing comment payloads` $\rightarrow$ `Inspect artifact review`** (trên `Codex`) và **không còn bị dừng turn** (trên các model nhỏ).
     - Agent gọi thẳng `advance_and_wait_for_artifact` ngay sau khi chờ xong để lên **Round 2** với nội dung mới, và tiếp tục chờ ở Round 2.
2. **Test Round 2 $\rightarrow$ Round 3 (Chỉ hỏi câu hỏi - Question-only):**
   - Thêm comment `Why use TypeScript here?` $\rightarrow$ bấm **Review**.
   - **Kỳ vọng đạt:** Copilot trả lời câu hỏi trong khung chat, gọi `advance_and_wait_for_artifact` (không truyền `markdown`), giao diện lên **Round 3** giữ nguyên nội dung và tiếp tục chờ.
3. **Test Proceed (Kết thúc review & thực thi):**
   - Bấm **Proceed** ở Round 3.
   - **Kỳ vọng đạt:** Copilot nhận `nextAction.type: "execute-approved-plan"` và thực thi kế hoạch ngay trong turn đó.

