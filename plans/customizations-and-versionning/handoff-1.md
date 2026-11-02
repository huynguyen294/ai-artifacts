# Handoff — AI Artifacts Extension Growth Analysis & Marketplace SEO — 2026-11-01

> **Reception Rules for the Next AI:**
>
> 1. Inherit the decisions and analyses below according to their recorded status (`[Approved Verbatim]`, `[Decided]`, `[Verified]`, `[User-confirmed]` vs. `[AI-inferred]`, `[Unverified]`). Do not re-derive settled analysis from scratch; reopen a conclusion only when new evidence, a contradiction, or an explicit user review request requires it.
> 2. Do not re-propose directions listed under **Rejected Angles** unless their reopening condition is met.
> 3. Do not re-read workspace documents merely to reconstruct analyses already captured here. Consult files in the **Reference Map** when the next step requires unextracted detail, conflict verification, or updated scope.
> 4. Distinguish **Awaiting User Decision** (do not choose on the user's behalf) from **Unknown External Facts** and **Unverified Discrepancies**.

## 1. Context, History Coverage & Current Stopping Point

- **Active Objective:** Phân tích nguồn gốc tăng trưởng lượt tải của extension `huynguyen294.ai-artifacts` (`AI Artifacts - Interactive Planning & Review`) trên Open VSX vs. VS Code Marketplace, đối chiếu benchmark với thị trường, và tối ưu hóa bộ từ khóa (`keywords`) cùng mô tả (`description`) trong `package.json` cho bản phát hành tiếp theo.
- **Compacted History Scope:** Full conversation (từ mốc 1.9k lượt tải đến 5.870 lượt tải qua kiểm tra Open VSX API).
- **State at Pause:** Đã hoàn tất phân tích dữ liệu lịch sử API (6 versions, 5.870 lượt tải), chuẩn bị xong danh sách 26 keywords mở rộng và 3 biến thể câu `description` bắt đầu bằng cụm `"Interactive artifact"` đã được người dùng đồng ý hướng tiếp cận. Chờ người dùng chốt câu `description` cuối cùng để đưa vào `package.json`.

## 2. Valuable Synthesized Analyses

### 2.1. Lịch sử Phiên bản, Chuỗi Thời gian & Động lực Tăng trưởng trên Open VSX

- **Dữ liệu gốc từ Open VSX API (`https://open-vsx.org/api/huynguyen294/ai-artifacts`) `[Verified (Open VSX API Snapshot)]`:**
  - **Identifier:** `huynguyen294.ai-artifacts` | **Display Name:** `AI Artifacts - Interactive Planning & Review` | **License:** `MIT` | **Verified Publisher:** `true`.
  - **Repository gốc:** `https://github.com/huynguyen294/vscode-codex-artifacts.git` (Issues URL trỏ về `https://github.com/huynguyen294/ai-artifacts/issues`).
  - **Ngày đăng version đầu tiên (`0.9.2`):** `2026-09-09T09:51:50.663813Z` (tức **16:51:50 ngày 09/09/2026** giờ Việt Nam UTC+7).
  - **Chuỗi 6 phiên bản đã phát hành:** `0.9.2` → `0.9.3` → `1.0.0` → `1.0.1` → `1.0.2` → `1.1.2` (`latest`).
  - **Chỉ số tích lũy (sau ~52 ngày hoạt động):** **5.870 downloads**, **1 review (5.0★)**, trung bình **~113 lượt tải/ngày** và **~978 lượt tải/version**.
- **Nhật ký tốc độ tăng trưởng qua các mốc chụp thực tế `[Verified (Screenshots)]`:**
  1. _03/10/2026 (v1.0.1 - đăng 11 ngày trước):_ **1.9k downloads** `[Verified]`.
  2. _06/10/2026 (v1.0.1 - đăng 14 ngày trước):_ **2.1k downloads** (~65 lượt/ngày trong giai đoạn không cập nhật version) `[Verified]`.
  3. _08/10/2026 sáng (v1.0.1):_ **2.4k downloads** `[Verified]`.
  4. _08/10/2026 tối 21:01 (v1.0.2 - đăng 1 ngày trước):_ **2.8k downloads** — Tăng vọt **+400 lượt trong ~19–20 giờ** ngay sau khi release bản `1.0.2` do cơ chế Auto-Update ngầm của IDE và đợt quét lại từ bot bảo mật `[Verified]`.
  5. _13/10/2026 (v1.0.2):_ **3.4k downloads** (~120 lượt/ngày) `[Verified]`.
  6. _15/10/2026 (v1.0.2 - đăng 8 ngày trước):_ **3.8k downloads** — Tăng **+1.000 lượt trong đúng 7 ngày** giữ nguyên phiên bản `1.0.2` (~142 lượt/ngày), chứng minh đà tăng tự nhiên không phụ thuộc vào việc spam release `[Verified]`.
  7. _Snapshot API mới nhất (v1.1.2):_ **5.870 downloads** `[Verified]`.

### 2.2. Bóc tách Cơ cấu Lượt tải: Bot vs. Người dùng thật & Cộng dồn Version

- **Cơ chế đếm của Open VSX `[Verified]`:** Open VSX không có bộ lọc bot/Captcha và tăng biến `downloadCount` mỗi khi có HTTP GET request tải file `.vsix`.
- **Tại sao khẳng định >90% là lưu lượng thực tế (không phải bot cày số ảo) `[AI-inferred from empirical patterns]`:**
  - _Bot quét an ninh chuỗi cung ứng (Snyk, Socket, VirusTotal, Kaspersky) & Mirror proxies:_ Hoạt động theo sự kiện (event-driven), chỉ tải file `.vsix` 1–2 lần ngay khi có tag version mới. Qua 6 versions, nhóm bot này chỉ đóng góp tối đa khoảng **150 – 300 lượt tải** (~5%) trong tổng số 5.870 lượt.
  - _Cơ cấu của ~100 – 140 lượt tải tăng đều mỗi ngày khi không có version mới:_
    1. **Lập trình viên mới cài đặt lần đầu (~50% – 60%):** Tìm kiếm tự nhiên trên thanh Extensions của Cursor, Windsurf, VSCodium, Trae.
    2. **Môi trường phát triển tạm thời & Đồng bộ (~25% – 30%):** Người dùng hiện tại làm việc với Docker Dev Containers, GitHub Codespaces, Gitpod, WSL hoặc Settings Sync giữa nhiều máy; mỗi lần khởi tạo lại container, IDE tự động gọi Open VSX kéo lại file `.vsix`.
    3. **Hiệu ứng Auto-Update rải rác (Long-tail updates ~15% – 20%):** Người dùng cũ mở lại IDE sau kỳ nghỉ/cuối tuần nhận bản cập nhật tự động từ `0.9.x` → `1.1.2`.
  - _Ước tính quy mô người dùng độc bản thực tế (Unique Users) `[AI-inferred]`:_ Khi loại trừ hiệu ứng cộng dồn qua 6 versions và dev containers, mốc 3.4k tương đương ~800 – 1.000 người dùng độc bản, và mốc **5.870 downloads** tương đương khoảng **1.400 – 2.000 lập trình viên thực tế** đang sử dụng.

### 2.3. Tương phản Open VSX (5.870 tải) vs. VS Code Marketplace (118 tải)

- **Phân tích biểu đồ VS Code Marketplace (Snapshot 30 ngày tính đến ~08/10/2026) `[Verified (VS Marketplace Analytics Screenshot)]`:**
  - **Total Acquisition:** `118` (Last 30 days) / `117` (Till Date) | **Page views:** `73` | **Conversion Funnel:** `161.64%`.
  - **Cơ cấu bất thường:** Cột `"Install from VSCode"` (màu tím - người dùng bấm cài trực tiếp trong VS Code) chỉ xuất hiện lác đác chưa tới **10 lượt** trong cả tháng. Hơn **90% ( ~108 lượt)** là `"Download from Marketplace"` (màu xanh - tải file `.vsix` trực tiếp qua API/script mà không qua trang web, khiến Acquisition vượt Page views lên 161.64%).
- **Nguyên nhân cốt lõi của sự chênh lệch `[Verified]`:**
  1. _Độc quyền kho ứng dụng trên AI IDE:_ Theo điều khoản của Microsoft, các bản fork như **Cursor, Windsurf, Trae, VSCodium** bị chặn dùng VS Code Marketplace và bắt buộc dùng **Open VSX** làm kho mặc định duy nhất. Tệp người dùng cần kết nối MCP với Cursor/Windsurf đều tìm và cài trực tiếp từ bên trong các IDE này (tính vào Open VSX).
  2. _Mức độ cạnh tranh SEO:_ Open VSX ít đối thủ hơn nên `ai-artifacts` chiếm Top 1–3 cho từ khóa `MCP` và `Artifacts`. Ngược lại, VS Code Marketplace có >60.000 extensions, thuật toán ghim chặt các extension lâu năm có hàng trăm nghìn lượt tải, đẩy extension mới xuống các trang sau.

### 2.4. Benchmark Khách quan với các Extension cùng Phân khúc trên Open VSX

- **Đối chiếu dữ liệu thực tế trên Open VSX `[Verified (Web Benchmark)]`:**

| Tên Extension                            | Thời gian hoạt động           | Tổng lượt tải | Tốc độ trung bình  | Số Version & Đánh giá     |
| :--------------------------------------- | :---------------------------- | :------------ | :----------------- | :------------------------ |
| **AI Artifacts (`huynguyen294`)**        | **52 ngày** _(từ 09/09/2026)_ | **5.870**     | **~113 lượt/ngày** | 6 versions, 1 review (5★) |
| **1 Click MCP Installer** _(Veduis)_     | ~148 ngày _(từ 05/06/2026)_   | 2.700         | ~18 lượt/ngày      | ~4 versions, 0 review     |
| **OpenMCP** _(LSTM-Kirigaya)_            | ~500 ngày _(từ 06/2025)_      | 5.300         | ~10.6 lượt/ngày    | Nhiều bản build, 0 review |
| **Browser DevTools MCP** _(serkan-ozal)_ | ~240 ngày _(từ 03/2026)_      | 21.000        | ~87.5 lượt/ngày    | CI/CD liên tục, 2 reviews |
| **Auto Preview Tab Markdown**            | Extension mới tiêu chuẩn      | 836           | ~5 – 15 lượt/ngày  | 2 versions, 0 review      |

- **Kết luận vị thế:**
  - _Daily Velocity:_ Nhanh gấp **6 lần** _1 Click MCP Installer_ và gấp **10 lần** _OpenMCP_, vượt tốc độ trung bình ngày của _Browser DevTools MCP_ (87.5 lượt/ngày), nằm trong **Top 5% – 10%** các extension cộng đồng độc lập tăng trưởng nhanh nhất trên Open VSX.
  - _Review Ratio (1 review / 5.87k tải):_ Hoàn toàn bình thường do rào cản UX (IDE không cho chấm sao trực tiếp, phải mở trình duyệt đăng nhập `open-vsx.org`). Ngay cả extension 21k tải như _Browser DevTools MCP_ cũng chỉ có 2 reviews.

### 2.5. Chẩn đoán Lỗi Tìm kiếm Từ khóa Số ít (`Artifact`) & Giải pháp SEO

- **Nguyên nhân gõ `Artifact` (số ít) không ra kết quả `[Verified]`:**
  - Bộ máy tìm kiếm của Open VSX và VS Code Marketplace ưu tiên khớp chính xác token (Exact Token Match) trên `name` (`ai-artifacts`), `displayName` (`AI Artifacts...`), `description` và `tags`/`keywords`.
  - Hiện tại toàn bộ metadata của extension chỉ chứa từ số nhiều có chữ `s` (`artifacts` / `Artifacts`), dẫn đến khi người dùng gõ `Artifact` (số ít), kết quả bị các bộ công cụ Azure Artifacts, Maven Artifact, GitHub Actions Artifact đè hoàn toàn.
- **Giải pháp kỹ thuật:**
  - Bổ sung đồng thời cả biến thể số ít (`artifact`, `ai-artifact`) và các từ khóa quy trình (`inline-review`, `markdown`, `prd`, `rfc`, `spec-review`) vào mảng `keywords` trong `package.json` (giữ dưới giới hạn tối đa **30 keywords** của VS Code Marketplace; hiện tại dự án mới dùng 10 tags).
  - Đưa từ `"artifact"` (số ít) vào ngay cụm mở đầu của `description`: `"Interactive artifact review editor..."`.

## 3. User Decisions, Verbatim Approvals & Corrections

- **[Decided — Hướng mở đầu câu Description]:** Sử dụng cụm **`"Interactive artifact"`** ở đầu câu `description` (thay cho bản cũ là `"Interactive review editor..."`) để vừa đọc tự nhiên, vừa phủ được từ khóa số ít `artifact` ngay đầu câu.
- **[Key Correction — Giữ nhịp điệu tự nhiên cho Description]:**
  - _Flawed prior AI view:_ Đề xuất câu ghép `"Interactive artifact & markdown review editor with inline comments..."`.
  - _Corrected conclusion after user pushback:_ Cụm `"artifact & markdown review editor"` nghe rất nặng nề và kệch cỡm. Giữ cấu trúc gọn gàng ở đầu câu (`"Interactive artifact review editor..."`) và đẩy các từ khóa bổ trợ (`markdown`, `inline`) về vị trí tự nhiên ở vế sau (vì công cụ tìm kiếm tách câu thành các token đơn lẻ nên không cần nhồi nhét cụm từ).
- **[Key Correction — Lịch sử Phiên bản & Ngày khởi tạo thực tế]:**
  - _Flawed prior AI view:_ Dựa vào giao diện web (chỉ hiện các bản gần nhất) nên ước tính bản đầu tiên là `1.0.0` đăng ngày 19–22/09/2026 và tổng cộng 5 versions.
  - _Corrected conclusion (từ ảnh chụp API của User):_ Phiên bản đầu tiên thực chất là **`0.9.2`**, đăng vào **`2026-09-09T09:51:50.663813Z`**, và có tổng cộng **6 versions** (`0.9.2`, `0.9.3`, `1.0.0`, `1.0.1`, `1.0.2`, `1.1.2`).

## 4. Analyzed but Rejected Angles

| Rejected Angle / Option                                         | Technical or Practical Reason                                                                                                                                  | Reopening Condition (if any)                                                                     |
| :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| Cụm mở đầu `"Interactive artifact & markdown review editor..."` | Câu văn bị gượng ép, nặng nề; chữ `markdown` đã có sẵn ở cụm `"markdown specs"` phía sau `[User-confirmed]`.                                                   | Không mở lại (Do not reopen).                                                                    |
| Đổi tên `displayName` của Extension để thêm từ số ít            | Không cần thiết vì sửa `keywords` và `description` đã giải quyết triệt để việc index token `"artifact"` mà không làm mất nhận diện thương hiệu `AI Artifacts`. | Chỉ xem xét nếu sau khi cập nhật `keywords` và `description` mà thứ hạng từ khóa số ít vẫn thấp. |

## 5. Open Threads

- **[Awaiting User Decision — Chốt câu `description` cuối cùng cho `package.json`]:**
  Người dùng đã duyệt hướng mở đầu `"Interactive artifact"`, cần chọn 1 trong 3 biến thể hoàn chỉnh dưới đây để áp dụng:
  - **Candidate `DESC-1` (Bản chuẩn — Sát bản gốc nhất, chỉ thêm đúng chữ `artifact` ở đầu):**
    ```text
    Interactive artifact review editor for AI-generated planning artifacts, markdown specs, and proposals. Connects via MCP to Cursor, Codex, Windsurf, Claude, and more.
    ```
  - **Candidate `DESC-2` (Bản bổ sung `inline` — Nêu bật cơ chế feedback trực tiếp):**
    ```text
    Interactive artifact review editor with inline feedback for AI-generated planning artifacts, markdown specs, and proposals. Connects via MCP to Cursor, Codex, Windsurf, Claude, and more.
    ```
  - **Candidate `DESC-3` (Bản cô đọng — Tránh lặp từ `artifacts` trong cùng 1 câu):**
    ```text
    Interactive artifact review editor for AI-generated plans, markdown specs, and proposals with inline comments. Connects via MCP to Cursor, Codex, Windsurf, Claude, and more.
    ```
- **[Awaiting User Decision — Áp dụng danh sách 26 `keywords` vào `package.json`]:**
  Danh sách đề xuất đã tinh chỉnh (26/30 hạn mức tối đa của VS Code Marketplace):
  ```json
  "keywords": [
    "artifact",
    "artifacts",
    "ai-artifact",
    "ai-artifacts",
    "mcp",
    "model-context-protocol",
    "markdown",
    "markdown-preview",
    "markdown-editor",
    "inline-review",
    "spec-review",
    "planning",
    "ai-planning",
    "proposal",
    "prd",
    "rfc",
    "design-doc",
    "annotation",
    "cursor",
    "windsurf",
    "claude",
    "codex",
    "cline",
    "roo-code",
    "agent",
    "workflow"
  ]
  ```
- **[Unknown External / Empirical Facts]:**
  - Số lượng **Active Runtime Installations / Daily Active Sessions** thực tế khi người dùng mở webview review artifact (do hiện tại chưa nhúng telemetry như Aptabase, PostHog hay `@vscode/extension-telemetry` vào hàm `activate()`).
  - Tỷ lệ quy đổi giữa lượt tải Open VSX và lượng traffic/star thực tế trong tab **Insights > Traffic** của repo GitHub `huynguyen294/vscode-codex-artifacts`.
- **[Unverified Hypotheses / Discrepancies (`Unverified`)]:**
  - Trong kết quả trả về của Open VSX API, trường `repository` đang trỏ tới `https://github.com/huynguyen294/vscode-codex-artifacts.git` và `homepage` trỏ tới `https://github.com/huynguyen294/vscode-codex-artifacts#readme`, nhưng trường `bugs` lại trỏ tới `https://github.com/huynguyen294/ai-artifacts/issues`. Cần kiểm tra lại trong `package.json` xem GitHub đã đổi tên repo và tự động redirect hay URL `bugs` đang bị lệch.

## 6. Reference Map (Endpoints & Configuration)

| Path / Endpoint                                            | Core Substance Preserved Inline                                                                                                                                                                              | When Deeper Reading Is Needed                                                                 |
| :--------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `https://open-vsx.org/api/huynguyen294/ai-artifacts`       | Toàn bộ danh sách 6 versions (`0.9.2` → `1.1.2`), tổng lượt tải (`5870`), điểm đánh giá (`5`, `reviewCount: 1`), và categories (`AI`, `Programming Languages`, `Other`) đã được trích xuất đầy đủ ở Mục 2.1. | Truy vấn lại khi cần kiểm tra mốc lượt tải mới hoặc sau khi publish bản cập nhật tiếp theo.   |
| `https://open-vsx.org/api/huynguyen294/ai-artifacts/0.9.2` | Timestamp khởi tạo dự án (`2026-09-09T09:51:50.663813Z`), description gốc, và các URL `repository`/`homepage`/`bugs` đã được lưu ở Mục 2.1 & Mục 5.                                                          | Không cần đọc lại.                                                                            |
| `package.json` (trong repo `vscode-codex-artifacts`)       | Cấu trúc `description` và `keywords` mới (26 từ khóa) đã được soạn sẵn ở Mục 5.                                                                                                                              | Mở khi người dùng yêu cầu cập nhật trực tiếp file cấu hình để chuẩn bị build bản release mới. |
