# Handoff — Skill Customization (`USER CUSTOM RULES`) & MCP/Skill Independent Versioning — 2026-11-01

> **Reception Rules for the Next AI:**
>
> 1. Inherit the decisions and analyses below according to their recorded status (`[Approved Verbatim]`, `[Decided]`, `[Verified]`, `[User-confirmed]` vs. `[AI-inferred]`, `[Unverified]`). Do not re-derive settled analysis from scratch; reopen a conclusion only when new evidence, a contradiction, or an explicit user review request requires it.
> 2. Do not re-propose directions listed under **Rejected Angles** unless their reopening condition is met.
> 3. Do not re-read workspace documents merely to reconstruct analyses already captured here. Consult files in the **Reference Map** when the next step requires unextracted detail, conflict verification, or updated scope.
> 4. Distinguish **Awaiting User Decision** (do not choose on the user's behalf) from **Unknown External Facts** and **Unverified Discrepancies**.
> 5. Follow repository rules in `AGENTS.md`: always address the user as **"Chú"**, never modify code without explicit authorization, and always group work and impact analysis by **Components** (`docs/COMPONENTS.md`).

---

## 1. Context, History Coverage & Current Stopping Point

- **Active Objective:**
  1. Hoàn tất cập nhật Marketplace SEO (`description`, `keywords` trong `package.json`) và chuẩn hóa thứ tự AI clients trong `README.md` (kế thừa từ `handoff-1.md`).
  2. Thiết kế cơ chế **Skill Customization** cho phép người dùng tùy biến hành vi của skill `create-review-artifact` (kèm các Presets Manual / Auto trong `README.md` và vùng `USER CUSTOM RULES` không bị ghi đè khi upgrade/reinstall).
  3. Thiết kế cơ chế **Independent Versioning cho MCP Runtime & Skill** (lưu trong `~/.ai-artifacts/managed/`) để chỉ thông báo yêu cầu Reinstall khi MCP hoặc Skill thực sự tăng version, thay vì thông báo ở mọi bản cập nhật `package.json.version` như hiện tại.
- **Compacted History Scope:** Full conversation (tiếp nối từ `handoff-1.md` ngày `2026-11-01`).
- **State at Pause:**
  - **Đã thực thi xong (trên working tree):** Cập nhật `description` và 28 `keywords` trong `package.json`; cập nhật câu mở đầu và sắp xếp lại thứ tự 6 AI clients (`Cursor → Codex → Claude → GitHub Copilot → Cline → Windsurf`) tại bảng Compatibility, danh sách Install và danh sách Uninstall trong `README.md`.
  - **Đã chốt định hướng kiến trúc sơ bộ:** Chốt **Cách A1 (Inline Marker Block trực tiếp trong `SKILL.md`)** với contract cho phép `USER CUSTOM RULES` override hành vi mặc định của skill gốc; chốt hướng dùng file version trong `~/.ai-artifacts/managed/` kết hợp kiểm tra version cho MCP & Skill.
  - **Bước tiếp theo ngay sau Handoff này:** Mở rộng **Research toàn diện** trong codebase (kiểm tra sâu toàn bộ luồng install/reinstall/verify/uninstall của 6 client drivers, `skill-contract.test.ts`, `upgrade-notification.test.ts`, `workspace-integration.test.ts`, cơ chế frontmatter trigger của các AI clients) để phân tích khả năng triển khai chi tiết và lập Implementation Plan hoàn chỉnh theo từng Component.

---

## 2. Valuable Synthesized Analyses

### 2.1. Phân tích Cơ chế Đọc Skill của AI Agents & Bài toán Độ trễ (Latency) vs. Bảo toàn qua Upgrade

- **Hiện trạng cơ chế cài đặt và kiểm tra Skill trong codebase `[Verified (src/extension/mcp-clients/skill-helper.ts, src/extension/workspace-integration.ts)]`:**
  - Bộ skill đóng gói tại `skills/create-review-artifact/` gồm đúng 3 file được khai báo trong hằng số `REVIEW_SKILL_ASSETS`:
    1. `SKILL.md`
    2. `references/artifact-contract.md`
    3. `agents/openai.yaml`
  - Khi chạy lệnh cài đặt (`setupBaseMcpServer` hoặc `ClaudeClientDriver.install`), hàm `replaceSkillDirectory(source, target)` copy toàn bộ thư mục `source` sang thư mục tạm `.create-review-artifact-install-*` rồi dùng `fs.rename` thay thế nguyên cả thư mục `target` (`~/.agents/skills/create-review-artifact` và `~/.claude/skills/create-review-artifact`). Do đó, mọi chỉnh sửa trực tiếp của user trong `target/SKILL.md` đều bị xóa sạch khi reinstall/upgrade.
  - Khi chạy lệnh `AI Artifacts: Verify All Integrations` (`checkAllIntegrations` → `skillAssetsAreCurrent`), hệ thống dùng `sameFile(left, right)` (`leftContents.equals(rightContents)`) để so sánh byte-for-byte cả 3 file trong `REVIEW_SKILL_ASSETS`. Nếu user sửa 1 ký tự trong `target/SKILL.md`, `skillAssetsAreCurrent` trả về `false`, kéo theo toàn bộ các client đã cài bị đánh dấu `outdated`.
- **Chuỗi nhân quả về độ trễ (Latency) khi tách file `custom-rules.md` rời `[Verified & User-confirmed]`:**
  - Ở thiết kế hiện tại, khi AI Agent kích hoạt skill `create-review-artifact`, AI đã phải thực hiện **2 lượt đọc file tuần tự**: (1) đọc `SKILL.md` → (2) đọc `references/artifact-contract.md` (theo dòng 13 của `SKILL.md`).
  - Mỗi lệnh `read_file` tách rời làm phát sinh thêm **1 vòng lặp suy luận (LLM inference round-trip, tốn ~2–5 giây và chi phí prefill context)**. Nếu tách thêm file thứ 3 (`custom-rules.md`), AI sẽ phải tốn 3 lượt đọc file ở mọi phiên làm việc (kể cả khi user không viết rule tùy chỉnh nào).
- **Giải pháp Kiến trúc Cách A1 — Khối Marker nội tuyến (`Inline Marker Block`) ngay cuối `SKILL.md` `[Decided]`:**
  - Đặt một vùng đánh dấu cố định ở cuối `SKILL.md` (ví dụ `<!-- >>> USER CUSTOM RULES >>> --> ... <!-- <<< USER CUSTOM RULES <<< -->`).
  - **Lợi ích Runtime (Zero Extra Latency):** AI Agent đọc `SKILL.md` trong **1 lần duy nhất** là nạp được cả rule gốc lẫn `USER CUSTOM RULES` của user mà không phát sinh thêm bất kỳ tool call `read_file` nào.
  - **Cơ chế Bảo toàn khi Reinstall/Upgrade (`replaceSkillDirectory`):** Trước khi swap thư mục `stagedSkill` vào `target`, hàm cài đặt đọc `target/SKILL.md` (nếu đã tồn tại), trích xuất nội dung nằm giữa cặp marker `USER CUSTOM RULES` của user và ghép đè vào khối marker tương ứng của `stagedSkill/SKILL.md`. Nếu marker trong file cũ bị hỏng/xóa mất, fallback an toàn về bản `source/SKILL.md` chuẩn.
  - **Cơ chế Kiểm tra `Verify All Integrations` (`skillAssetsAreCurrent`):** Khi so sánh `SKILL.md` giữa `source` và `target`, hàm kiểm tra chuẩn hóa (bỏ qua phần nội dung bên trong cặp marker `USER CUSTOM RULES`) trước khi so sánh byte/chuỗi. Nhờ vậy:
    - Nếu user sửa bên trong khối marker → `Verify` vẫn báo `Ready`.
    - Nếu bản cập nhật Extension thay đổi phần lõi của `SKILL.md` (bên ngoài marker) → `Verify` phát hiện chính xác là `Outdated`, và khi user bấm Reinstall thì phần lõi được cập nhật còn khối marker của user vẫn được giữ nguyên.

### 2.2. Phân biệt "Trigger Policy" (Manual vs. Auto) và "Post-Trigger Behavior Override"

- **Cơ chế kích hoạt Skill của các AI IDE/Agents `[Verified]`:**
  - Trước khi quyết định gọi một skill, AI Agent **chỉ nhìn thấy phần YAML Frontmatter (`name`, `description`) của `SKILL.md`** (và `agents/openai.yaml` đối với Codex), cùng với các file Global/Workspace Rules luôn được nạp sẵn trong System Prompt (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`). AI **chưa đọc** phần thân (body) của `SKILL.md` cho đến khi skill được kích hoạt.
  - Hiện tại, dòng 3 của `SKILL.md` (`description: Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact...`) và dòng 60 của `docs/PHILOSOPHY.md` quy định mặc định là **Manual / Explicit Trigger** (chỉ tạo artifact khi user yêu cầu rõ).
- **Hệ quả đối với thiết kế Customization & README Presets `[AI-inferred — Cần khảo sát sâu ở bước Research tiếp theo]`:**
  1. **Post-Trigger Override (Bên trong khối `USER CUSTOM RULES` ở cuối `SKILL.md`):** Khi skill đã được kích hoạt, khối `USER CUSTOM RULES` ở cuối `SKILL.md` hoàn toàn có thể **override (ghi đè) mọi hành vi trong thân bài của skill gốc** (ngôn ngữ phản hồi, cấu trúc đề mục của plan, cách chia phase, quy tắc trả lời comment...).
  2. **Trigger Policy Override (Manual vs. Auto-Trigger khi lập plan):**
     - *Cách 1 (Qua Global/Workspace Rules `AGENTS.md` / `CLAUDE.md` / `.cursorrules`):* User copy Preset `Auto-Plan` từ `README.md` dán vào `AGENTS.md` / `CLAUDE.md`. Vì file này luôn nằm trong System Prompt, nó ra lệnh cho AI tự động kích hoạt skill `create-review-artifact` mỗi khi user yêu cầu lập plan/spec.
     - *Cách 2 (Sửa trực tiếp YAML Frontmatter `description` của `SKILL.md`):* Như Chú đã nêu (`[User-confirmed]`), user hoàn toàn có thể sửa trực tiếp phần ngoài khối marker (như sửa `description` ở đầu `SKILL.md` từ preset trong `README.md`), chỉ là phần ngoài marker sẽ bị reset về mặc định khi chạy lại Installer lúc nâng cấp; hoặc ở bước Research tiếp theo có thể khảo sát thêm việc có nên bảo toàn cả trường `description` nếu user custom hay chỉ giữ nguyên quy tắc 1 khối marker duy nhất cho đơn giản.

### 2.3. Phân tích Cơ chế Versioning Độc lập cho MCP Runtime & Skill (`~/.ai-artifacts/managed/`)

- **Hiện trạng cơ chế thông báo nâng cấp (`upgrade-notification.ts` & `extension.ts`) `[Verified (src/extension/upgrade-notification.ts, src/extension/extension.ts, test/upgrade-notification.test.ts)]`:**
  - Tại `src/extension/extension.ts` (dòng 366–380), mỗi khi extension `activate()`, nó gọi `maybeShowUpgradeNotification()` và truyền `currentVersion: context.extension.packageJSON.version`.
  - `maybeShowUpgradeNotification()` so sánh `currentVersion` với `context.globalState.get("upgradeNotification.lastNotifiedVersion")`.
  - Nếu khác nhau, nó lập tức lưu `currentVersion` mới vào `globalState` và bật popup:
    > `"AI Artifacts v${version} is ready. The MCP integration and agent skill may have changed. Follow the installation guide and run the installer to sync them with this version..."` kèm 3 nút: `Run Installer`, `View Installation Guide`, `Later`.
  - **Điểm bất cập:** Mọi bản release tăng `package.json.version` (dù chỉ sửa `README.md`, sửa từ khóa SEO hay sửa giao diện Webview) đều báo user phải chạy lại Installer và khởi động lại AI client.
- **Hiện trạng quản lý Version của MCP và Skill trong codebase `[Verified]`:**
  - **MCP Server:** Trong `src/integration/artifact-review-mcp-v4.ts`, đã có hằng số `SERVER_VERSION = "10.0.0"` (trả về trong handshake `initialize` của giao thức MCP). File runtime được cài đặt tại `~/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs`.
  - **Agent Skill:** Hiện tại trong `skills/create-review-artifact/SKILL.md` và `src/shared/contracts.ts` **chưa có hằng số version riêng cho Skill**.
  - **Thư mục `~/.ai-artifacts/managed/`:** Được định nghĩa trong `src/shared/artifact-files.ts` (`managedAssetsRoot`), hiện chứa 2 thư mục con là `runtime/` và `workspaces/` (cùng `cleanup/` khi chạy retention), và được xóa sạch khi gỡ cài đặt (`cleanupBaseMcpServer` trong `src/extension/mcp-clients/base-cleanup.ts`).
- **Cơ chế hoạt động của giải pháp Versioning qua `~/.ai-artifacts/managed/` `[Decided + AI-inferred mechanics]`:**
  1. **Định nghĩa Version Đóng gói (Bundled Target Versions):**
     - Khai báo tường minh `MCP_RUNTIME_VERSION` (ví dụ `"10.0.0"`) và `SKILL_VERSION` (ví dụ `"1.0.0"` hoặc `"1.1.0"`) tại tầng dùng chung (`src/shared/`).
  2. **Lưu trữ Version Đã cài đặt (Installed Version File trong `managed/`):**
     - Khi chạy `setupBaseMcpServer()` (lúc user bấm `Run Installer` hoặc chạy bất kỳ lệnh `Install Integration for ...` nào), ghi file `~/.ai-artifacts/managed/integration-version.json` (hoặc tên tương đương) lưu `{ mcpVersion, skillVersion, updatedAt }`.
  3. **3 Kịch bản Edge Cases cần giải quyết triệt để trong bước Research & Plan tiếp theo `[AI-inferred]`:**
     - *Edge Case A — Chống lặp thông báo khi User bấm `"Later"`:* Nếu chỉ so sánh `Bundled Version !== Installed File Version`, khi user bấm `"Later"` (chưa chạy Installer), file trong `managed/` chưa được cập nhật nên lần mở VS Code tiếp theo sẽ bị hiện lại popup. Do đó cần kết hợp lưu khóa tổng hợp (ví dụ `"mcp:10.0.0|skill:1.1.0"`) vào `globalState`: chỉ hiện thông báo khi **vừa có sự thay đổi version của MCP/Skill trong bản build mới, vừa lệch với bản đã cài trong `managed/`**.
     - *Edge Case B — Chuyển tiếp cho User hiện hữu từ `v1.1.2` (chưa có file version trong `managed/`) và User cài mới lần đầu (Fresh Install):* Cần phân biệt rõ máy chưa cài tích hợp bao giờ (chưa có `managed/runtime/ai-artifacts-review-mcp.mjs`) với máy nâng cấp từ `v1.1.2` (đã có `ai-artifacts-review-mcp.mjs` nhưng chưa có `integration-version.json`).
     - *Edge Case C — Đồng bộ với `ClaudeClientDriver` (`~/.claude/skills/create-review-artifact/`):* Hiện tại `ClaudeClientDriver.check()` (trong `src/extension/mcp-clients/claude-client.ts` dòng 68–70) chỉ kiểm tra `fsSync.existsSync(skillMain)` chứ chưa kiểm tra nội dung hay version của `SKILL.md` trong `~/.claude/skills/`. Cần rà soát trong đợt Research tới để đảm bảo cả `.agents` và `.claude` đều đồng nhất về version và bảo toàn `USER CUSTOM RULES`.

---

## 3. User Decisions, Verbatim Approvals & Corrections

- **[Approved Verbatim — `package.json` Description (Đã áp dụng vào `package.json`)]**:
  ```text
  Interactive artifact review editor for AI-generated planning artifacts, markdown specs, and proposals with inline comments. Connects via MCP to Cursor, Codex, Claude, GitHub Copilot, Cline, Windsurf, and more.
  ```
- **[Approved Verbatim — `package.json` Keywords (Đã áp dụng 28 từ khóa vào `package.json`)]**:
  ```json
  [
    "artifact", "artifacts", "ai-artifact", "ai-artifacts",
    "mcp", "model-context-protocol", "markdown", "markdown-preview", "markdown-editor",
    "inline-review", "spec-review", "planning", "ai-planning", "proposal", "prd", "rfc", "design-doc", "annotation",
    "cursor", "codex", "claude", "copilot", "github-copilot", "cline", "windsurf", "roo-code",
    "agent", "workflow"
  ]
  ```
- **[Approved Verbatim — `README.md` Intro & Client Ordering (Đã áp dụng vào `README.md`)]**:
  - Đoạn mở đầu dòng 7:
    ```markdown
    **AI Artifacts** is an **interactive artifact review** editor that lets AI coding agents such as **Cursor**, **Codex**, **Claude**, **GitHub Copilot**, **Cline**, and **Windsurf** create dedicated planning artifacts and markdown specs directly in your IDE. Use it for implementation plans, design proposals, or technical write-ups. Add inline comments and let your agent revise the document based on your feedback. It connects to your agent through **MCP** and the **create-review-artifact** skill.
    ```
  - Thứ tự chuẩn của 6 AI clients trên toàn bộ `README.md` (Bảng Compatibility dòng 55, danh sách lệnh Install dòng 84, danh sách lệnh Uninstall dòng 252): **`Cursor` → `Codex` → `Claude` → `GitHub Copilot` → `Cline` → `Windsurf`** (Windsurf luôn nằm ở cuối danh sách client).
- **[Decided — Chọn Cách A1 (Inline Marker Block trong `SKILL.md`) cho Custom Rules]**:
  - *Stated Reason:* Không tạo file `custom-rules.md` rời để tránh làm AI bị chậm do phải đọc qua nhiều file (`read_file` nhiều lần), và không cần cơ chế phức tạp để track sự thay đổi của file phụ. Khối custom trong `SKILL.md` đóng vai trò là vùng được tự động giữ lại (preserved) qua các lần update/reinstall; nếu user sửa trực tiếp bên ngoài vùng đó trong `SKILL.md` thì vẫn chạy bình thường, chỉ bị mất khi update.
- **[Decided — Contract ưu tiên của Custom Rules trong `SKILL.md`]**:
  - Custom rules của user sẽ **override (ghi đè) behavior của skill gốc**.
- **[Decided — Hướng Versioning cho MCP & Skill]**:
  - Bổ sung versioning cho MCP và Skill (tận dụng thư mục `~/.ai-artifacts/managed/`) để mỗi khi cập nhật extension, chỉ khi nào MCP hoặc Skill tăng version thì mới thông báo nhắc user reinstall (thay vì báo ở mọi version của extension như hiện tại).
- **[Key Correction — Phong cách Tóm tắt & Trình bày]**:
  - *Flawed prior AI view:* Trình bày phân tích ban đầu quá dài khi user chỉ hỏi công việc đầu tiên cần làm; và đề xuất `DESC-3` (lược bỏ chữ `artifacts` số nhiều).
  - *Corrected conclusion:* Tóm tắt ngắn gọn, đi thẳng vào từng đầu việc cụ thể; chọn biến thể mở rộng từ `DESC-2` để giữ đồng thời cả token số ít `artifact` lẫn số nhiều `artifacts` ngay trong `description`, có đủ 6 clients với `Windsurf` ở cuối và giữ `, and more.`.

---

## 4. Analyzed but Rejected Angles

| Rejected Angle / Option | Technical or Practical Reason | Reopening Condition (if any) |
| :--- | :--- | :--- |
| **Tách file `custom-rules.md` riêng để AI đọc thêm lúc runtime** | Làm AI Agent phải tốn thêm 1 lượt gọi tool `read_file` (tăng độ trễ 2–5 giây ở mỗi phiên chat) `[User-confirmed]`. | Không mở lại (Do not reopen). |
| **Cách A2: Tạo file `custom-skill-rules.md` riêng rồi dùng `onDidSaveTextDocument` đồng bộ ngầm vào `SKILL.md`** | Phức tạp hóa kiến trúc không cần thiết (phải track sự kiện lưu file và quản lý thêm 1 file phụ), trong khi mục tiêu chỉ là giúp user có một vùng không bị mất custom rules khi upgrade `[User-confirmed]`. | Chỉ xem xét nếu sau này phát sinh nhu cầu quản lý nhiều profile custom rules khác nhau. |
| **Bỏ cụm `, and more.` ở cuối `description` trong `package.json`** | Không cần bỏ vì độ dài 209 ký tự vẫn hoàn toàn hợp lệ trên VS Code Marketplace / Open VSX và được index 100% `[Decided]`. | Không mở lại. |

---

## 5. Open Threads (Agenda for Next Deep Research & Planning Session)

- **[Awaiting Comprehensive Technical Research & Design Plan]:**
  Ở phiên làm việc tiếp theo, AI cần thực hiện **Research toàn diện trên codebase** và lập **Implementation Plan (chia theo Components)** cho 2 hạng mục lớn:
  1. **Hạng mục 1 — Skill Customization (`USER CUSTOM RULES` & `README.md` Presets):**
     - Rà soát `skills/create-review-artifact/SKILL.md` và `test/skill-contract.test.ts`: Thiết kế câu chữ chính xác cho khối `<!-- >>> USER CUSTOM RULES >>> -->` sao cho khẳng định rõ quyền **override behavior của skill gốc**, nhưng không làm gãy bất kỳ assertion nào trong `test/skill-contract.test.ts` (hoặc cập nhật test tương ứng).
     - Rà soát `src/extension/mcp-clients/skill-helper.ts`, `src/extension/workspace-integration.ts`, và `src/extension/mcp-clients/claude-client.ts`: Thiết kế thuật toán parse/merge khối marker khi `replaceSkillDirectory()` chạy và khi `skillAssetsAreCurrent()` kiểm tra (bao gồm cả đồng bộ cho `~/.claude/skills/create-review-artifact/`).
     - Xác định xem có cần thêm Command Palette command (ví dụ `AI Artifacts: Open Skill Custom Rules`) để mở nhanh `~/.agents/skills/create-review-artifact/SKILL.md` hay chỉ cần hướng dẫn đường dẫn + lệnh copy trong `README.md`.
     - Thiết kế nội dung mục **Customization & Skill Presets** trong `README.md` (giải thích cơ chế skill, cách hoạt động của khối `USER CUSTOM RULES` qua các lần update, và các bộ Preset: Manual mode, Auto-trigger mode, Custom workflow/formatting để user copy-paste).
  2. **Hạng mục 2 — MCP & Skill Versioning (`~/.ai-artifacts/managed/` & `upgrade-notification.ts`):**
     - Rà soát toàn bộ `src/extension/upgrade-notification.ts`, `src/extension/extension.ts`, `src/extension/workspace-integration.ts`, `src/extension/integration-verification.ts`, và `test/upgrade-notification.test.ts`.
     - Thiết kế cấu trúc file version trong `~/.ai-artifacts/managed/` (ví dụ `integration-version.json`), nơi đặt hằng số `MCP_RUNTIME_VERSION` & `SKILL_VERSION`, và luồng kiểm tra kết hợp giữa `managed/integration-version.json` với `context.globalState` để:
       - Chỉ báo Reinstall khi `mcpVersion` hoặc `skillVersion` tăng.
       - Không báo lặp lại nếu user bấm `Later` trên cùng một version MCP/Skill.
       - Xử lý mượt cho cả Fresh Install, Upgrade từ bản `1.1.2` (chưa có file version), và lệnh `Verify All Integrations`.
- **[Awaiting User Decision (Minor items from Handoff 1)]:**
  - Có bổ sung tường minh 2 trường `"homepage": "https://github.com/huynguyen294/ai-artifacts#readme"` và `"bugs": { "url": "https://github.com/huynguyen294/ai-artifacts/issues" }` vào `package.json` cùng đợt này không.

---

## 6. Reference Map (Workspace Documents & Codebase Files)

| Path & Section | Core Substance Preserved Inline | When Deeper Reading Is Needed |
| :--- | :--- | :--- |
| `plans/customizations-and-versionning/handoff-1.md` | Toàn bộ phân tích tăng trưởng Open VSX (5.870 tải) vs. VS Marketplace (118 tải) và lý do chọn `description`/`keywords` đã được thực thi xong vào `package.json` & `README.md` (Mục 3). | Không cần đọc lại trừ khi cần tra cứu số liệu thống kê lượt tải lịch sử. |
| `package.json` (dòng 1–55) & `README.md` (dòng 1–95, 245–260) | Đã được cập nhật trực tiếp với `description` mới (209 ký tự), 28 `keywords`, đoạn mở đầu `README.md` mới và thứ tự 6 clients (`Cursor → Codex → Claude → GitHub Copilot → Cline → Windsurf`). | Đọc khi cần chèn thêm mục **Customization** vào `README.md` hoặc thêm command mới vào `package.json`. |
| `skills/create-review-artifact/SKILL.md` & `test/skill-contract.test.ts` | Cấu trúc 98 dòng của `SKILL.md` và bộ test kiểm tra hợp đồng skill đã được tóm tắt ở Mục 2.1 & 2.2. | Đọc kỹ ở phiên Research tiếp theo để chọn vị trí và câu chữ chính xác cho khối `USER CUSTOM RULES` mà không xung đột với `skill-contract.test.ts`. |
| `src/extension/mcp-clients/skill-helper.ts` & `src/extension/mcp-clients/claude-client.ts` | Cơ chế `REVIEW_SKILL_ASSETS`, `sameFile()`, `replaceSkillDirectory()` và cách Claude cài đặt bản sao skill vào `~/.claude/skills/` đã được phân tích ở Mục 2.1 & 2.3. | Mở đọc khi thiết kế chi tiết hàm merge khối marker và kiểm tra version cho cả `.agents` và `.claude`. |
| `src/extension/workspace-integration.ts` & `src/extension/integration-verification.ts` | Luồng `setupBaseMcpServer`, `skillAssetsAreCurrent`, `baseScriptIsCurrent`, `checkAllIntegrations` và thông báo Verify đã được tóm tắt ở Mục 2.1 & 2.3. | Mở đọc khi thiết kế việc ghi/đọc file version trong `~/.ai-artifacts/managed/` và cập nhật thông báo Verify. |
| `src/extension/upgrade-notification.ts`, `src/extension/extension.ts` (dòng 366–380) & `test/upgrade-notification.test.ts` | Cơ chế so sánh `package.json.version` với `LAST_NOTIFIED_VERSION_KEY` trong `globalState` và các unit test hiện hữu đã được trích xuất ở Mục 2.3. | Mở đọc ở phiên Research tiếp theo để thiết kế lại điều kiện kích hoạt popup Reinstall dựa trên `mcpVersion` và `skillVersion`. |

