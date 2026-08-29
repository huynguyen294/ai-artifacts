# Agent Plus — Technical Highlight Inventory

> **Trạng thái:** Derived reference artifact — dùng để khám phá, đối chiếu và tổng hợp; không phải source of truth, không phải CV-ready wording và không thay thế `ASSESSMENT.md`.
> **Snapshot/date:** 2026-08-29, commit `cfc2457e1c3c09d259a6e3c78b063d7264160f00`, package `0.4.3`.
> **Repositories inspected:** `agent-plus`.
> **Audit coverage:** README/architecture/philosophy/changelog/TODO, package/build configuration, extension host, webview, shared contracts, hook, MCP server, integration installer, all tracked tests, package contents and Git history.
> **Known blind spots:** Không chạy Extension Development Host E2E; không có CI hoặc evidence macOS/Linux; không có clean-machine install/upgrade/uninstall trace; owner xác nhận dự án vẫn đang thử nghiệm, chưa có field-usage/soak evidence.

## Primary differentiators

### H-01 — Contract và identity binding xuyên bốn process boundary

- **Category:** `primary differentiator`
- **Evidence state:** `verified`
- **Capability tags:** `browser-tooling`, `protocol-design`, `security-boundary`, `data-integrity`
- **Problem/constraint:** Artifact đi qua skill, Codex hook, extension host/webview và MCP process; stale hoặc cross-artifact state có thể gửi quyết định sai cuộc hội thoại.
- **Implementation:** Schema v3 dùng Zod; manifest, comments và submission cùng bind `artifactId`, `reviewRound`, workspace root, thread, artifact SHA-256 và comments SHA-256. Sai schema/path/root/round/hash bị reject.
- **Ownership:** Git snapshot chỉ có một author; theo owner context đây là dự án tự làm. README công khai AI-assisted implementation, nên inventory không suy thêm decision authorship ngoài evidence.
- **Decision/trade-off:** Dùng file protocol minh bạch và validation fail-closed thay vì state ẩn trong extension. Đổi lại lifecycle phụ thuộc consistency của nhiều file và local filesystem.
- **Capability demonstrated:** Thiết kế protocol cục bộ có invariant rõ, shared contract và validation dùng lại giữa các boundary.
- **Peer comparison:** Mạnh hơn baseline extension CRUD/webview thông thường; đây là phần kỹ thuật đáng defend nhất của repository.
- **Hiring signal:** Ngoài scope assessment hiện tại; không chuyển thành CV wording.
- **Confidence:** High.
- **Source pointers:** `src/shared/contracts.ts`, `src/shared/artifact-validation.ts`, `src/extension/artifact-store.ts`, `src/integration/stamp-origin.ts`, `src/integration/artifact-review-mcp.ts`, `test/artifact-store.test.ts`, `test/review-wait-mcp.test.ts`.
- **Selected for ASSESSMENT:** yes
- **Combination hooks:** `protocol design + local data integrity + multi-process integration`

### H-02 — Review-round update có token dùng một lần và rollback

- **Category:** `primary differentiator`
- **Evidence state:** `verified`, với durability boundary ghi dưới đây.
- **Capability tags:** `transaction-design`, `reliability`, `windows-compatibility`, `mcp`
- **Problem/constraint:** Một lần Review phải cập nhật đúng artifact/round, reset comments/submission và vẫn hoạt động khi Windows khóa file đang mở.
- **Implementation:** MCP cấp update token ngẫu nhiên có TTL, bind token với directory/id/thread/round, stage file mới, backup target, commit ba file, xóa submission và rollback khi failure được phát hiện. Có nhánh copy fallback khi rename bị `EPERM`/`EACCES`/`EBUSY`.
- **Decision/trade-off:** Giữ một artifact ID/path qua nhiều round đơn giản hóa UX, nhưng không giữ history và cần transaction nhiều file.
- **Capability demonstrated:** Xử lý lifecycle state machine, failure injection và platform-specific filesystem behavior.
- **Peer comparison:** Strong supporting-to-differentiating signal cho developer tooling nhỏ.
- **Confidence:** High cho failure trong process; medium cho crash/power-loss durability.
- **Source pointers:** `src/integration/artifact-review-mcp.ts`, `test/review-wait-mcp.test.ts`, `docs/ARCHITECTURE.md`.
- **Owner clarification:** Dự án vẫn thử nghiệm; chưa có evidence soak/recovery sau process kill thực tế.
- **Selected for ASSESSMENT:** yes
- **Combination hooks:** `protocol design + transactional update + Windows behavior`

### H-03 — Global Codex integration bảo tồn cấu hình không liên quan

- **Category:** `primary differentiator`
- **Evidence state:** `verified`
- **Capability tags:** `codex-integration`, `configuration-management`, `developer-experience`, `migration`
- **Problem/constraint:** Extension phải cài skill, trusted hook và MCP server vào user scope mà không ghi đè hook/MCP không thuộc dự án, đồng thời xử lý legacy workspace integration.
- **Implementation:** Managed marker block cho TOML, hook upsert/remove theo marker, asset equality verification, `hooks/list` qua App Server và status `trusted/untrusted/disabled/missing/outdated`.
- **Decision/trade-off:** User-scope integration dùng chung giữa Codex surfaces và giảm cấu hình lặp; đổi lại installer ghi vào nhiều global resource và hiện chưa có transaction/clean uninstall toàn cục.
- **Capability demonstrated:** Tích hợp nhiều config surface, migration idempotent và trust-state feedback.
- **Peer comparison:** Vượt baseline extension chỉ đóng gói UI; mức production bị giới hạn bởi cleanup/rollback và compatibility validation.
- **Confidence:** High cho code path/tested transforms; medium cho fresh-machine lifecycle.
- **Source pointers:** `src/extension/workspace-integration.ts`, `src/extension/hook-config.ts`, `src/extension/mcp-config.ts`, `src/extension/app-server-client.ts`, `test/hook-config.test.ts`, `test/mcp-config.test.ts`, `test/app-server-client.test.ts`.
- **Selected for ASSESSMENT:** yes
- **Combination hooks:** `VS Code extension + Codex hook + MCP + installer`

## Strong supporting strengths

### H-04 — Webview có boundary an toàn và host-side revalidation

- **Category:** `strong supporting strength`
- **Evidence state:** `verified`
- **Capability tags:** `webview-security`, `react`, `input-validation`, `ux`
- **Implementation:** React render Markdown thành text nodes, không inject HTML; CSP default-none với nonce; `localResourceRoots` chỉ vào bundle; mọi message webview được Zod-parse; selection được kiểm tra lại trên block text trong extension host.
- **Boundary:** Nonce dùng `Math.random`; chưa có accessibility automation hoặc Extension Host/browser E2E.
- **Source pointers:** `src/extension/artifact-review-provider.ts`, `src/extension/artifact-store.ts`, `src/webview/App.tsx`, `src/shared/markdown-blocks.ts`.
- **Selected for ASSESSMENT:** yes
- **Combination hooks:** `safe rendering + host validation + review UX`

### H-05 — Workspace ownership và multi-root được xem như security invariant

- **Category:** `strong supporting strength`
- **Evidence state:** `verified`
- **Capability tags:** `multi-root`, `path-safety`, `workspace-resolution`
- **Implementation:** Skill yêu cầu evidence-based root selection; manifest lưu absolute `workspaceRoot`; hook/store/MCP kiểm tra directory theo root và artifact ID; regression tests reject root mismatch.
- **Boundary:** Path comparison là lexical `path.resolve`, chưa dùng `realpath`; symlink/junction boundary chưa có test.
- **Source pointers:** `skills/create-review-artifact/SKILL.md`, `skills/create-review-artifact/references/artifact-contract.md`, `src/shared/artifact-validation.ts`, `test/stamp-origin.test.ts`, `test/review-wait-mcp.test.ts`.
- **Selected for ASSESSMENT:** yes
- **Combination hooks:** `workspace UX + path validation + multi-root`

### H-06 — Failure-oriented automated test suite

- **Category:** `strong supporting strength`
- **Evidence state:** `verified`
- **Capability tags:** `testing`, `reliability`, `regression`
- **Implementation:** 35 tests pass, bao phủ legacy schema rejection, hash mismatch, single submission, one-time token, multiple rounds, malformed comments, root mismatch, Windows open-file fallback và rollback injection.
- **Boundary:** Test chủ yếu là unit/process-level; không khởi động VS Code Extension Host, không test React/webview interaction, installer end-to-end hoặc OS matrix.
- **Source pointers:** `test/`, `package.json`.
- **Selected for ASSESSMENT:** yes
- **Combination hooks:** `protocol invariants + failure injection + regression discipline`

## Specialized and breadth signals

### H-07 — Contextual Markdown review UX

- **Category:** `specialized/role-specific`
- **Evidence state:** `verified`
- **Capability tags:** `markdown-review`, `text-selection`, `custom-editor`, `react`
- **Implementation:** Markdown được chia thành selectable block ổn định; comment lưu quote/range/prefix/suffix; UI highlight, comment draft, Review/Proceed/Just save và raw Markdown copy.
- **Boundary:** Parser cố ý chỉ hỗ trợ controlled Markdown blocks, không phải CommonMark renderer đầy đủ; keyboard-only selection và screen-reader flow chưa được chứng minh.
- **Source pointers:** `src/shared/markdown-blocks.ts`, `src/webview/App.tsx`, `src/webview/styles.css`, `test/markdown-blocks.test.ts`.
- **Selected for ASSESSMENT:** yes

### H-08 — Build, package và tài liệu kiến trúc có thể tái tạo

- **Category:** `breadth/additional technology`
- **Evidence state:** `verified`
- **Capability tags:** `build-tooling`, `distribution`, `documentation`
- **Implementation:** TypeScript strict, esbuild/Vite bundle, VSIX package 15 file/280.95 KB, README + architecture + philosophy + changelog. `npm audit` tại snapshot báo 0 vulnerability.
- **Boundary:** Không có CI, `vscode:prepublish`, public publisher/repository metadata, signed/reproducible release evidence hoặc automated Marketplace publish.
- **Source pointers:** `package.json`, `tsconfig.json`, `vite.config.ts`, `.vscodeignore`, `README.md`, `docs/`, `CHANGE_LOGS.md`.
- **Selected for ASSESSMENT:** yes

## Pending owner/operational verification

| Candidate | Evidence state | Điều còn thiếu | Ảnh hưởng |
| --- | --- | --- | --- |
| Repeated real-work lifecycle | `owner-confirmed`: vẫn thử nghiệm | Duration, số artifact/round, lỗi gặp trong sử dụng thật | Maturity, operational confidence |
| Cross-platform support | `no evidence` | macOS/Linux CI hoặc manual trace | Public compatibility gate |
| Clean install/upgrade/uninstall | `no evidence` | Fresh profile test, partial-failure recovery, removal of global hook/MCP/skill | Public release gate |
| Extension-host/webview E2E | `no evidence` | VS Code test runner flow cho open/comment/review/proceed/save | Functional/public quality gate |
| Crash recovery | `no evidence` | Kill MCP giữa transaction, stale-lock recovery, corrupted-backup handling | Reliability gate |

## Downgraded or rejected claims

| Claim/candidate | Classification | Reason |
| --- | --- | --- |
| “Production ready cho Marketplace công khai” | `downgraded/rejected` | Automated core pass nhưng public security/release/compatibility/operational gates chưa đủ evidence. |
| “Mature” | `downgraded/rejected` | Repository mới, năm commit trong khoảng hai ngày, owner xác nhận vẫn thử nghiệm, chưa có field-use/maintenance evidence. |
| “Transaction đảm bảo hoàn toàn” | `downgraded` | Rollback được test cho exception trong process; không có journal/stale-lock recovery hoặc process-kill durability test. |
| “Đúng originating thread được enforce độc lập” | `pending/downgraded` | File bind thread ID và token bind grant, nhưng MCP tool call không nhận caller thread ID để tự so sánh; cần xác minh isolation của MCP process trong runtime thật. |
| “Full Markdown rendering” | `rejected` | Parser hỗ trợ controlled block subset; tables, nested lists, setext headings và nhiều CommonMark construct không được parse như renderer đầy đủ. |
| “Multi-platform ready” | `rejected` | Chỉ có evidence chạy hiện tại trên Windows; không có OS matrix. |

