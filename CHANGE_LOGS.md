# Change Logs

Tất cả các thay đổi quan trọng của dự án **Codex Artifacts** (`agent-plus`) sẽ được ghi nhận tại tài liệu này.

Lịch sử phát hành được chuẩn hóa và bắt đầu ghi nhận lại từ phiên bản **0.2.6**. Các gói build mang số phiên bản thấp hơn không được xem là một phần của changelog chính thức này.

---

## [0.7.0] - 2026-08-31

### Breaking MCP API

- Xóa hoàn toàn `create_and_wait_for_artifact` và `update_and_wait_for_artifact`; thay bằng bốn tool tách biệt: `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review` và `advance_and_wait_for_artifact`.
- Nâng extension lên `0.7.0` và MCP server lên `5.0.0`. Sau khi nâng cấp, người dùng phải chạy lại **Codex Artifacts: Install Global Codex Integration**, restart Codex và bắt đầu chat mới.
- Giữ nguyên artifact schema v4 nên artifact hiện có không cần migration; schema v3 tiếp tục chỉ đọc.

### Chat escape và reconnect

- Tách dữ liệu artifact bền vững khỏi waiter tạm thời theo nguyên tắc `artifact lifetime > waiter lifetime > chat-turn lifetime`.
- Cho phép người dùng lưu comment rồi nhắn “hãy xem review” hoặc yêu cầu tương đương mà không cần bấm **Review**. Skill hủy waiter cũ bằng takeover, inspect đúng artifact handle, trả lời câu hỏi trong chat, áp dụng yêu cầu sửa và mở round mới.
- Nút **Review** và chat “hãy xem review” dùng chung một feedback policy: question-only trả lời trong chat rồi advance không đổi Markdown; change-only cập nhật artifact; mixed vừa trả lời chat vừa cập nhật; feedback chưa rõ được hỏi lại trước khi consume round.
- Không còn tạo hoặc cập nhật mục `Review responses` trong artifact; câu trả lời hội thoại luôn thuộc Codex chat.
- Question-only feedback vẫn tăng round và reset comment đã xử lý nhưng giữ nguyên bytes và SHA của `artifact.md`.
- **Proceed** và **Just save** chỉ kết thúc round hiện tại, không kill artifact và không tự mở round mới. Với `plan` và `implementation-plan`, Proceed trả thêm runtime directive `execute-approved-plan`, bắt buộc AI thực thi toàn bộ plan đã duyệt ngay trong cùng turn thay vì chỉ xác nhận. Artifact có thể được reconnect rõ ràng về sau mà không thực thi lại hành động cũ.
- Bắt buộc reconnect bằng exact `artifactDirectory` còn trong conversation hoặc path do người dùng cung cấp; không chọn “artifact mới nhất” và không suy luận từ cwd.

### Waiter ownership và round token

- Thay active-waiter `Set` bằng registry có request key, review round, `AbortController` và settled state; ownership được reserve trước I/O để loại bỏ race giữa wait và chat takeover.
- JSON-RPC cancellation và takeover dùng chung cơ chế detach, chỉ đóng watcher/timer và giải phóng ownership, không sửa lifecycle files.
- Tổng quát hóa update token thành round token in-memory, single-use, hết hạn sau một giờ và bind vào artifact/session/round, artifact hash, comments hash cùng submission presence/hash.
- Inspection có thể cấp token từ comment đã lưu khi chưa có `review-submission.json`; MCP restart làm mất token/waiter nhưng inspection có thể cấp token mới từ persistent state đã validate.
- Token chỉ bị consume sau transaction commit thành công. Cancellation sau commit để lại round mới hợp lệ ở trạng thái detached và có thể reconnect.

### Skill, integration và tài liệu

- Cập nhật bundled skill cho default create → wait, chat escape, mixed/question-only feedback, no-comment reattach, exact-handle resolution và reconnect sau Proceed/Just save.
- Managed `config.toml` cấp approval cho đúng bốn tool mới.
- Cập nhật `README.md`, `ARCHITECTURE.md`, `PHILOSOPHY.md`, `COMPONENTS.md`, project instructions và artifact contract theo lifetime/ownership mới; không thay đổi webview, provider, Artifact Store, renderer hoặc workspace registry.
- Hoàn thiện README onboarding và phân phối VSIX: bổ sung prerequisite, đường dẫn cài đặt, phạm vi `CODEX_HOME`, auto-open setting, UI labels, Just save, schema-v3 compatibility, contributor commands và các liên kết tài liệu; bổ sung repository metadata để VSCE resolve các link tương đối, không thay đổi runtime/API/schema behavior.

### Verification

- Bổ sung regression coverage cho create detached, default Review flow, cancellation/reattach, takeover không race, inspect trước submission, question-only SHA preservation, exact-state token rejection, MCP restart, concurrent consumption, reconnect sau Just save, rollback và Windows editor-lock fallback.
- `npm.cmd run check`, toàn bộ 57 tests và `npm.cmd run build` đều pass.

## [0.6.1] - 2026-08-29

- Khôi phục workspace evidence gate chặt từ trước migration MCP; `package.json`, project contents, cwd và folder order không còn được dùng để tự chọn root.
- Nâng workspace registry lên schema v2 với focused-window và active-file context.
- Bắt buộc `workspaceEvidence` có kiểu; MCP fail closed trước filesystem mutation khi multi-root mơ hồ hoặc evidence không khớp.
- `Review responses` chỉ chứa phản hồi cho comment round ngay trước đó và được thay thế ở lần Review kế tiếp, không tích lũy toàn bộ lịch sử.
- Thêm regression tests cho multi-root ambiguity, active-file evidence, explicit user path/folder, focused-window scoping và skill contract.

## [0.6.0] - 2026-08-29

### MCP-owned lifecycle

- Thay creation hook và App Server trust flow bằng hai MCP tool `create_and_wait_for_artifact` và `update_and_wait_for_artifact`.
- MCP tạo artifact ID/session, ghi schema v4, chờ quyết định và cập nhật cùng `artifact.md` trong đúng tool call gốc.
- Dùng update token in-memory, một lần, gắn với artifact/session/round; giữ transaction rollback và Windows editor-lock fallback.

### Workspace boundary

- Extension công bố registry heartbeat cho toàn bộ `workspaceFolders` thực sự đang mở; MCP chỉ chấp nhận exact canonical root còn hiệu lực.
- Chặn workspace stale/unregistered, nested root không được đăng ký, path escape và artifact storage qua symlink/junction.
- Skill vẫn bắt buộc xác định workspace từ bằng chứng trong yêu cầu/IDE/hội thoại và không chọn folder đầu tiên.

### Migration

- Installer chỉ cài MCP + skill, không cần `/hooks` trust, đồng thời gỡ an toàn các hook/skill legacy do extension quản lý.
- Artifact schema v3 vẫn mở được ở chế độ read-only; schema v4 là lifecycle duy nhất được phép review/update.
- Bổ sung test end-to-end create → Review → update-and-wait → Proceed, registry TTL, token replay, rollback và legacy read-only.

### Review semantics

- **Proceed** trên `implementation-plan` là quyền triển khai plan đã duyệt ngay trong cùng turn, không chỉ xác nhận approve hoặc yêu cầu thêm một lần xác nhận.
- Khi comment là câu hỏi, Codex trả lời trực tiếp trong mục `Review responses` ở cuối artifact mới để câu trả lời tồn tại và tiếp tục được review ở round kế tiếp.

## [0.5.0] - 2026-08-29

### Markdown viewer

- Thay renderer thủ công bằng `react-markdown`, `remark-gfm` và remark AST có source positions dùng chung với comment blocks.
- Hỗ trợ nested list, task list, table, link, inline formatting, fenced code và Mermaid.
- Dùng Shiki fine-grained bundle cho syntax highlighting; Shiki và Mermaid chỉ tải khi artifact cần đến.
- Tự động theo theme light, dark và high contrast của VS Code.

### Contextual review

- Hiển thị comment composer bằng Floating UI popover ngay cạnh vùng chọn.
- Thay sidebar cố định bằng comments drawer có thể ẩn, điều hướng từ comment về đúng highlight.
- Nút `Review (N)` hiển thị số comment và trở thành primary khi có feedback; `Proceed` luôn primary trong toàn bộ vòng review.
- Không còn báo nhầm cross-block khi selection kết thúc tại offset đầu tiên của block kế tiếp hoặc khi click comment highlight.
- Giảm shadow/backdrop của document, popover và drawer để giao diện phẳng, sát VS Code hơn.
- Giảm padding hai lớp của workspace/document và compact popover/drawer để tăng diện tích đọc.
- Chuyển `Comments (N)` khỏi lifecycle control bar xuống utility bar riêng ngay bên dưới.
- Đổi utility action thành icon + `View comments` + count badge, kèm trạng thái drawer cho accessibility.
- Giữ nguyên inline Markdown khi highlight comment thay vì biến cả block thành plain text.

### Security và verification

- Tắt raw HTML/MDX execution, chặn unsafe URL và remote image, mở external link qua VS Code host.
- Giữ nonce-based CSP; Shiki render token bằng React, Mermaid strict SVG chạy trong data-image context.
- Bổ sung regression tests cho legacy block IDs, GFM/source positions, action state, URL policy, raw HTML và annotation qua inline markup.

## [0.4.3] - 2026-08-29

- Không còn xem Codex cwd, `environment_context` hoặc workspace folder đầu tiên là folder đang active/được chọn.
- Bắt buộc có tín hiệu UI/path tường minh và kiểm chứng bằng file dự án liên quan; nếu thiếu phải hỏi người dùng trước khi tạo Artifact.
- Chuẩn hóa thứ tự xác định workspace: path/file/attachment trong hội thoại; file có path từ IDE context; repository được nhắc đến và kiểm chứng; cuối cùng hỏi người dùng.

## [0.4.2] - 2026-08-29

- Tự động tạo Artifact Review khi người dùng yêu cầu tạo, xem hoặc cập nhật một plan, kể cả khi không nhắc đến từ "artifact".
- Phân biệt implementation plan (`implementation-plan`) với plan thông thường (`plan`).

## [0.4.1] - 2026-08-29

- Cho phép cập nhật `artifact.md` khi Windows chặn thao tác đổi tên do file đang được mở trong editor.
- Bắt buộc skill xác định workspace từ bằng chứng cụ thể; không chọn theo thứ tự workspace, kết quả tìm kiếm đầu tiên hoặc chỉ dựa vào cwd.
- Thêm regression test cho fallback cập nhật file đang mở trên Windows.

## [0.4.0] - 2026-08-28

### Breaking changes

- Chuyển sang `schemaVersion: 3` và cấu trúc `.codex-artifacts/artifacts/<id>/artifact.md`.
- Một request giữ cùng artifact ID qua nhiều review round; Review cập nhật cùng file thay vì tạo replacement artifact.
- Bỏ runtime `operation: replace`, `replacesArtifactId` và `.trash` cho artifact mới.
- Đổi skill thành `create-review-artifact` và MCP tools thành `wait_for_artifact_review`/`update_artifact`.
- Không tự migrate review schema v2 đang tồn tại.

### Artifact lifecycle

- Thêm `reviewRound`, `updatedAt` và round-aware bindings cho comments/submission.
- MCP cấp update token dùng một lần và commit Markdown/manifest/comments theo transaction có rollback.
- Review reset comments/submission trên cùng artifact; Proceed và Just save kết thúc lifecycle.

### Extension và skill

- Generic hóa Plan Review thành Artifact Review và hỗ trợ `kind` tổng quát.
- Chặn lifecycle actions khi có comment draft chưa lưu.
- Chỉ auto-trigger implementation plan; các artifact kind khác yêu cầu explicit user request.
- Installer thay skill cũ ở user scope và verify bộ asset mới.

### Verification

- Thêm regression test nhiều review round trên cùng directory/ID và token không reuse được.
- Cập nhật hook, store, MCP, multi-root và invalid-binding tests cho schema v3.

## [0.3.0] - 2026-08-28

### Breaking changes
- Chuyển toàn bộ artifact protocol sang `schemaVersion: 2`; artifact phiên bản 1 không còn được hỗ trợ hoặc tự động migrate.
- Tách `location.workspaceRoot` khỏi `origin.codexCwd`, cho phép Codex tạo và review artifact trong bất kỳ root phù hợp của multi-root workspace.
- Chuẩn hóa việc tạo `artifact.json` và `plan.md` bằng một lần `apply_patch`; Hook xác minh exact path từ patch thay vì scan theo Codex `cwd`.
- Hook chỉ xử lý `apply_patch`; MCP và replacement lifecycle xác minh artifact luôn thuộc workspace root đã khai báo.

### Build & integration
- Skill yêu cầu Codex chọn target root theo context và hỏi người dùng khi mơ hồ.
- Cài đặt, verify và legacy cleanup xử lý toàn bộ workspace roots đang mở thay vì root đầu tiên.

---

## [0.2.7] - 2026-08-28

### 🐛 Sửa lỗi
- Bỏ thông báo `Plan saved` ngay sau khi chọn **Just save**, vì ở thời điểm đó Codex chưa nhận vị trí đích và chưa tạo bản sao kế hoạch.
- Siết validation của MCP khi nhận submission: đọc lại và kiểm tra `schemaVersion`, `artifactId`, plan hash, cấu trúc comments và từng comment hiện tại trước khi trả quyết định về Codex.
- Sửa màu icon copy Markdown: dấu tích sau khi copy dùng màu thành công; màu lỗi đỏ chỉ còn áp dụng cho nút xóa comment.

### 📚 Contract & tài liệu
- Đồng bộ đầy đủ ba quyết định `revise`, `approve`, `save` trong MCP metadata, skill contract, README và tài liệu kiến trúc.
- Cập nhật hướng dẫn cho các nút **Review**, **Proceed** và **Just save** theo đúng hành vi runtime.
- Ghi nhận việc ngăn submit khi comment draft chưa được lưu vào `TODO.md`; hành vi này chưa được thay đổi trong phiên bản này.

### ✅ Kiểm thử
- Bổ sung regression test cho trường hợp `comments.json` bị thay đổi sai schema trong khi MCP đang chờ, kể cả khi submission chứa hash khớp với nội dung sai đó.

---

## [0.2.6] - 2026-08-28

### 🚀 Tính năng & Giao diện mới (Topbar UI)
- **Nút "Proceed"** *(Primary màu xanh, ngoài cùng bên phải)*:
  - Cho phép người dùng duyệt và yêu cầu Codex tiến hành thực thi kế hoạch ngay lập tức.
  - Luôn được kích hoạt (enabled) cả khi có hoặc không có comment. Nếu có để lại comment, Codex sẽ đọc và kết hợp áp dụng ngay trong quá trình code.
- **Nút "Review"** *(Thay thế cho label "Request revision")*:
  - Kích hoạt khi có ít nhất 1 comment trên tài liệu.
  - Gửi toàn bộ danh sách góp ý về cho Codex để viết lại bản kế hoạch mới.
- **Nút "Just save"** *(Style Ghost đồng bộ)*:
  - Cho phép lưu lại kế hoạch mà không tiến hành code.
  - Gửi quyết định `decision: "save"` để Codex hỏi vị trí lưu file trong workspace và dừng lại.
- **Nút Icon Copy Markdown**:
  - Tích hợp icon clipboard trên thanh Topbar giúp sao chép nhanh toàn văn Markdown gốc vào Clipboard.
  - Hiển thị hiệu ứng tích xanh ✓ trong 2 giây khi copy thành công.

### 🐛 Sửa lỗi & Nâng cấp hệ thống (Core & MCP)
- **Sửa lỗi xác thực Hash trong MCP Server (`review-wait-mcp.mjs`)**:
  - Khắc phục lỗi `"The plan or comments changed after review submission"` khi người dùng thêm comment trong quá trình mở review.
  - Cập nhật hàm `readValidatedSubmission` để đọc và tính toán mã băm SHA256 trực tiếp từ file `comments.json` và `plan.md` trên đĩa tại thời điểm submit.
- **Mở rộng Contracts & Schema (`contracts.ts`)**:
  - Bổ sung giá trị `"save"` vào `reviewDecisionSchema`: `z.enum(["revise", "approve", "save"])`.
  - Bổ sung trường `markdown: string` vào `ReviewState` để webview truy cập trực tiếp nội dung Markdown raw.
- **Nới lỏng ràng buộc Comment (`artifact-store.ts`, `review-wait-mcp.mjs`)**:
  - Bỏ kiểm tra bắt buộc xóa hết comment khi duyệt (`approve`/Proceed) và khi chỉ lưu (`save`).
- **Cập nhật Codex Skill (`create-plan-artifact`)**:
  - Hướng dẫn AI xử lý chi tiết cho cả 3 kịch bản: `revise`, `approve` (Proceed), và `save`.
