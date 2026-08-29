# Agent Plus — Independent Maturity and Production Readiness Assessment

> **Assessment date:** 2026-08-29  
> **Snapshot:** commit `cfc2457e1c3c09d259a6e3c78b063d7264160f00`, package `0.4.3`  
> **Target:** Public distribution, including VS Code Marketplace expectations  
> **Scope boundary:** Independent product assessment only. This document does not update candidate level, improvement source-of-truth, CV wording or cross-project conclusions.

## Executive conclusion

**Agent Plus chưa mature và chưa production-ready cho phát hành công khai.**

- **Maturity band:** `alpha` — core workflow đã coherent, installable và có automated regression đáng kể, nhưng lifecycle vận hành vẫn được owner xác nhận là thử nghiệm; chưa có extension-host E2E, cross-platform CI, clean install/upgrade/uninstall evidence hoặc field soak.
- **Public production verdict:** `not ready`.
- **Project engineering score:** **76/100** — phản ánh chất lượng kỹ thuật của artifact hiện tại, không phải production readiness.
- **Evidence confidence:** **85%** — source, Git, tests, build và VSIX đã được audit rộng; confidence bị giới hạn bởi thiếu VS Code live E2E, OS matrix và operational evidence.
- **Peer position:** `meets expected`, với một số strong signals về protocol/data integrity; chưa đạt `strong` cho cohort public developer tool vì release, reliability và adoption gaps làm giảm giá trị chính.

Core architecture không còn ở mức tutorial/prototype đơn giản: schema binding, one-time token, failure-oriented tests, host-side validation và best-effort rollback đều là implementation thật. Tuy nhiên public readiness là một gate khác. Build/test/package pass không chứng minh extension an toàn, recoverable và supportable trên máy người dùng không kiểm soát.

## Project profile and evidence boundary

| Axis | Classification | Evidence |
| --- | --- | --- |
| Context | `independent` | Owner xác nhận đây là dự án tự làm. |
| Artifact | `developer tool / VS Code extension` | `package.json`, extension host, custom editor, hook và MCP source. |
| Lifecycle | `experimental` | Owner xác nhận vẫn đang thử nghiệm; version `0.4.3`; chưa có field-use evidence. |
| Collaboration | `solo` | Git history có một author trong năm commit. |
| Distribution target | `public` | Owner chọn chuẩn công khai/Marketplace cho assessment. |

README ghi rõ dự án được xây bằng AI-assisted/vibe coding. Assessment chấp nhận product ownership theo owner context và xác minh implementation tồn tại trong source/Git; nó không tự suy rằng mọi architecture rationale hoặc generated code đều do owner thiết kế độc lập. Boundary này không thay đổi product-readiness verdict.

## External benchmark

Assessment dùng baseline của một **publicly distributed VS Code developer tool** có tích hợp Codex local:

- Webview phải giới hạn capability/resource roots, có CSP và sanitize/validate mọi dữ liệu từ workspace/webview theo [VS Code Webview security guidance](https://code.visualstudio.com/api/extension-guides/webview).
- Extension có khả năng đọc workspace hoặc spawn executable phải đưa ra lựa chọn Workspace Trust rõ ràng và bảo vệ setting nhạy cảm theo [Workspace Trust Extension Guide](https://code.visualstudio.com/api/extension-guides/workspace-trust).
- Unit tests không thay thế Extension Development Host integration tests; VS Code có test runner chính thức cho API/UI integration theo [Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension).
- Public release cần repeatable prepublish/package flow, metadata phù hợp và release discipline theo [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) và [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration).
- Codex hook input, trust flow, `PostToolUse`, App Server `hooks/list` và STDIO MCP configuration được đối chiếu với current Codex manual: [Hooks](https://learn.chatgpt.com/docs/hooks), [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp).

Baseline mạnh không đòi mọi extension phải có telemetry hoặc cloud backend. Nó đòi core lifecycle được test trong host thật, global side effects có install/upgrade/removal story, compatibility được khai báo và release có thể lặp lại.

## Engineering score

Weights được chọn trước theo rubric `developer tool/extension`.

| Dimension | Weight | Score | Weighted contribution | Judgment |
| --- | ---: | ---: | ---: | --- |
| Problem framing | 15 | 85 | 12.75 | Một problem cụ thể, workflow coherent và scope được giới hạn rõ. |
| Platform architecture | 25 | 82 | 20.50 | Shared schema và boundary separation tốt; global integration và filesystem transaction còn durability gaps. |
| Implementation/integration depth | 20 | 84 | 16.80 | VS Code custom editor + Codex hook + App Server + MCP + file protocol là integration depth thật. |
| Security/reliability/quality | 15 | 74 | 11.10 | Fail-closed validation, CSP, hashes và rollback tốt; thiếu explicit trust/config boundary, symlink/crash recovery và live-host validation. |
| DX/documentation/distribution | 15 | 66 | 9.90 | README, verify command và compact VSIX tốt; thiếu public metadata, prepublish guard, CI và clean uninstall. |
| Ownership/evolution/outcome | 10 | 50 | 5.00 | Solo provenance rõ, nhưng lịch sử rất ngắn và chưa có operational outcome. |
| **Total** | **100** |  | **76.05 → 76** | `meets expected` engineering artifact; không đồng nghĩa public-ready. |

Không áp dụng hidden cap vào engineering score. Production verdict dùng explicit gates bên dưới.

## Production-readiness gates

| Gate | Status | Verified evidence | Missing or failing evidence |
| --- | --- | --- | --- |
| Core functional lifecycle | `partial pass` | 35 tests pass; multi-round Review, Proceed/approve, Just save, schema rejection, root mismatch và Windows locked-file fallback được test ở process/unit level. | Không có Extension Host E2E cho open → select → comment → Review/Proceed/Save; demo files không thay thế live test. |
| Security and trust | `partial pass` | React text rendering, nonce CSP, constrained resource roots, Zod message parsing, path/round/hash/thread binding. | Chưa khai báo Workspace Trust chủ động; `agentPlus.codexCommand` là executable-affecting setting nhưng chưa có explicit user/machine scope boundary; path validation chưa `realpath`/symlink-test. |
| Reliability and recovery | `fail for public` | Failure injection rollback trong process; atomic/create-once techniques; one-time token; Windows copy fallback. | Process kill/power loss có thể để stale `.artifact-update.lock`; không có journal/recovery command; restore errors bị best-effort suppression; MCP restart làm mất token và cần lifecycle mới. |
| Install, upgrade and uninstall | `fail for public` | Hook/MCP config transforms idempotent và bảo tồn block không liên quan; asset freshness được verify. | Cài đặt ghi nhiều user-global resource nhưng không transaction toàn bộ; không có clean uninstall/removal flow, fresh-profile matrix hoặc partial-install recovery test. |
| Compatibility | `fail for public` | Build/test/package pass trên môi trường Windows hiện tại; có explicit Windows command and locked-file handling. | Không có CI macOS/Linux, remote workspace matrix, Node/Codex version preflight hoặc compatibility policy được test. Runtime hook/MCP giả định `node` có trong PATH. |
| Release discipline | `fail for public` | `npm run check`, 35 tests, full production build, `npm audit` và VSIX package đều pass; package chứa 15 file, 280.95 KB. | Không có CI, `vscode:prepublish`, registered public publisher/repository/support metadata, automated release gate hoặc signed/published artifact evidence. |
| UX and accessibility | `partial pass` | Coherent review actions, draft guard, comments/highlights, theme-token styling và error feedback. | Không có keyboard-only, screen-reader, high-contrast hoặc webview interaction automation; controlled parser không phải full CommonMark renderer. |
| Operational maturity | `fail` | Changelog và several internal demo artifacts cho thấy iteration. | Owner xác nhận vẫn thử nghiệm; năm commit trong khoảng hai ngày; không có usage duration, failure rate, user feedback, upgrade history hoặc maintenance window. |

**Gate rule applied:** một unresolved public blocker ở security boundary, crash recovery, install/uninstall, compatibility hoặc release validation đủ để verdict là `not ready`, dù engineering score trên 70.

## Strongest technical evidence

1. **Cross-boundary artifact binding:** schema v3 + directory/root/id/round/thread/hash invariants được dùng lại giữa hook, extension và MCP, với negative tests thực tế.
2. **Round-aware MCP lifecycle:** update token dùng một lần, submitted-state validation, multi-round state transition và rollback injection cho thấy deliberate state-machine work.
3. **Safe webview boundary:** không execute artifact HTML, CSP khóa nguồn, React escape output và extension host revalidate selection/message.
4. **Integration management:** App Server đọc hook trust state; hook và MCP config upsert có marker/idempotency, không tùy tiện replace toàn file.
5. **Tests tập trung vào failure:** test suite không chỉ happy path mà có schema mismatch, tampering, root mismatch, locked file và rollback.

Toàn bộ candidate và các claim bị hạ nằm trong `HIGHLIGHTS.md`.

## Public production blockers

### P0 — Add real VS Code integration validation

Thiết lập Extension Development Host E2E cho ít nhất: fresh artifact auto-open, comment selection, Review round transition, Proceed, Just save, invalid artifact display, stale integration và multi-root. Chạy trên Windows/macOS/Linux CI. Đây là blocker lớn nhất vì phần chưa test chính là wiring người dùng thật.

### P0 — Make global integration lifecycle recoverable

Thiết kế install/upgrade/uninstall như một lifecycle có preflight, backup/rollback và explicit cleanup. Test failure sau từng bước ghi skill/hook/MCP/config. Extension uninstall không được để hook/MCP/skill orphaned mà không có cảnh báo hoặc removal path rõ.

### P0 — Close trust and executable-setting boundaries

Khai báo `capabilities.untrustedWorkspaces` có chủ đích; bảo vệ `agentPlus.codexCommand` khỏi workspace-controlled override hoặc giới hạn nó ở user/machine scope; kiểm tra symlink/junction bằng canonical real path trước khi đọc/ghi artifact.

### P0 — Add crash/stale-lock recovery

Lock cần owner/transaction metadata, stale detection và recovery có thể chứng minh. Test process kill giữa backup/commit/cleanup và đảm bảo artifact được restore hoặc được đánh dấu recoverable, không kẹt vĩnh viễn hay âm thầm corrupt.

### P1 — Define and enforce public compatibility

Khai báo minimum Node/Codex/VS Code versions, preflight executable/version khi install/verify và chạy OS matrix. Nếu chỉ support desktop/local workspace, nói rõ; không để Marketplace user tự suy remote/web support.

### P1 — Establish a reproducible public release gate

Thêm prepublish build/check/test, CI, publisher/repository/issue/support metadata, clean VSIX inspection và documented release checklist. Không publish trực tiếp bằng `vsce` ngoài build script vì có thể đóng gói stale `dist`.

### P1 — Prove operational behavior

Sau khi P0 hoàn tất, dùng bản pre-release trong công việc thật đủ lâu để ghi failure modes, upgrade behavior và compatibility. Không cần telemetry bắt buộc; manual release log và structured feedback cũng đủ nếu có trace.

## Non-blocking limitations if documented

- Không giữ revision history là product decision hợp lệ nếu người dùng được thông báo rõ.
- Controlled Markdown block parser có thể đủ cho plan artifacts; chỉ không được quảng bá như full Markdown renderer.
- MCP update token mất khi server restart có thể là accepted limitation nếu UI/skill đưa recovery guidance rõ và artifact hiện tại không mất.
- Public v1 không cần tự động tạo mọi artifact kind; scope implementation plan + explicit artifact request là coherent.

## Adversarial validation

- **Public user:** Có thể cài VSIX, nhưng chưa có đủ guarantees cho machine không kiểm soát vì installer để lại global state và chưa có uninstall/recovery story.
- **Maintainer:** Source boundaries khá rõ; dead compatibility shims (`plan-review-provider.ts`, `review-wait-mcp.ts`) và thiếu CI làm tăng ambiguity/maintenance risk.
- **Security reviewer:** Webview boundary tốt, nhưng executable config scope, lexical path comparison và cross-thread runtime isolation cần verify trước public release.
- **Skeptical reviewer:** Claim mạnh nhất đứng vững ở source/tests; claim “mature”, “fully transactional”, “cross-platform” hoặc “production ready” không đứng vững với evidence hiện có.

## Final answer

**Đã mature chưa? — Chưa.** Dự án ở band `alpha`: architecture vượt prototype thông thường nhưng product lifecycle còn rất trẻ và đang thử nghiệm.

**Có production ready chưa? — Chưa cho phát hành công khai.** Có thể tiếp tục dùng như controlled experimental build cho owner, nhưng Marketplace/public release nên bị chặn cho đến khi P0 gates về live E2E/CI, global integration cleanup/rollback, trust boundary và crash recovery được đóng bằng test evidence.

## Verification record

| Check | Result at snapshot |
| --- | --- |
| `npm run check` | Pass |
| `npm test` | Pass — 8 files, 35 tests |
| `npm run build` | Pass outside restricted assessment sandbox |
| `npm audit --json` | 0 known vulnerabilities |
| `vsce package --allow-missing-repository` | Pass — 15 files, 280.95 KB |
| Git history | 5 commits, one author, 2026-08-28 to 2026-08-29 |
| VS Code Extension Host E2E | No evidence |
| CI / cross-platform matrix | No evidence |
| Field-use/soak | Owner-confirmed experimental only |

## References

### Repository evidence

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PHILOSOPHY.md`
- `CHANGE_LOGS.md`
- `TODO.md`
- `package.json`, `tsconfig.json`, `vite.config.ts`, `.vscodeignore`
- `src/extension/`, `src/integration/`, `src/shared/`, `src/webview/`
- `test/`
- Git history through `cfc2457`

### External calibration

- [VS Code Webview API — Security](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code Workspace Trust Extension Guide](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- [VS Code Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [VS Code Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
- [VS Code Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp)

