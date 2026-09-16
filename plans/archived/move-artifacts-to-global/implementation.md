# Implementation Plan: Global AI Artifact Storage v1.0.0

> **Authority:** Plan này đã áp dụng quyết định review của Chú và thay thế các kết luận xung đột trong `analized.md`, cụ thể: giữ Workspace Registry/5 tools/`location.workspaceRoot`, không triển khai deep link và chỉ chuyển lifecycle storage sang global root.

## 1. Outcome đã chốt

Chuyển AI Artifacts sang mô hình global hoàn toàn:

```text
~/.ai-artifacts/artifacts/<artifact-id>/
├── artifact.json
├── artifact.md
├── comments.json
└── review-submission.json
```

Contract đích:

- Chỉ hỗ trợ schema v5; bỏ hoàn toàn v3/v4.
- Không migration và không read-only viewer.
- Manifest tiếp tục chứa `location.workspaceRoot` để ghi nhận repository mà artifact mô tả.
- Giữ Workspace Registry, publisher, workspace evidence/token và `resolve_artifact_workspace` để AI xác định đúng workspace đang làm việc.
- MCP tiếp tục có 5 tools; `create_artifact` vẫn nhận `workspaceRoot`, `workspaceEvidence`, `title`, `kind` và `markdown`.
- Workspace evidence chỉ được gửi khi create; các lifecycle call sau dùng exact handle nhưng vẫn revalidate `location.workspaceRoot` qua registry như behavior hiện tại.
- Extension watch global root bằng RelativePattern.
- Extension bảo đảm global collection root tồn tại an toàn trước khi đăng ký watcher để không bỏ lỡ artifact đầu tiên.
- Chỉ VS Code window đang focused được auto-open.
- Auto-open và command mở custom editor qua `openWith`; không triển khai review deep-link/URI handler.
- `artifactLink` tiếp tục là regular `file://` link và không được mô tả như deep link hoặc custom-editor guarantee.
- Giữ nguyên waiter, round token, transaction, rollback và Windows lock fallback.
- Trên POSIX, managed directories dùng owner-only mode `0700` và lifecycle/transaction files dùng `0600`; Windows tiếp tục dựa vào inherited ACL.
- Uninstall không xóa ~/.ai-artifacts.

## 2. Cách triển khai chậm và kiểm soát rủi ro

Đây là thay đổi lớn, nên không gom toàn bộ thành một lần sửa rồi mới test.

Quy tắc thực hiện:

1. Chỉ làm một phase tại một thời điểm.
2. Trong phase lớn, làm theo từng work package nhỏ.
3. Chạy verification ngay sau mỗi work package phù hợp.
4. Cuối phase phải báo:
   - Component/file đã đổi.
   - Automated verification đã chạy và kết quả.
   - Manual verification đã làm được/chưa làm được.
   - Regression hoặc rủi ro mới.
   - Độ ổn định thực tế sau phase.
5. Chỉ sang phase tiếp theo khi gate hiện tại pass.
6. Nếu cần thay đổi kiến trúc ngoài plan, dừng và trao đổi với Chú trước.
7. Không edit trực tiếp dist, VSIX hoặc global integration đã cài; luôn đổi source rồi build/install qua workflow chính thức.

Dependency bắt buộc:

```text
schema v5
  → MCP producer
  → Extension consumer
  → Workspace resolution + exact-handle validation
  → Skill/integration contract
```

Phase 2 là atomic cutover end-to-end ở mức branch: có thể sửa theo work package, nhưng không merge, handoff hoặc xem phase là usable khi shared schema, MCP, Extension Store, production skill/contract, MCP config verification và contract tests chưa cùng hiểu v5/global storage.

## 3. Tổng quan phase và stability target

| Phase | Mục tiêu                                   |     Rủi ro | Stability target khi qua gate | Trạng thái release         |
| ----- | ------------------------------------------ | ---------: | ----------------------------: | -------------------------- |
| 0     | Baseline và khóa contract                  |       Thấp |                           5/5 | Không đổi behavior         |
| 1     | Global path foundation dạng additive       |       Thấp |                           5/5 | Safe nhưng chưa có feature |
| 2     | Atomic schema v5 + global MCP cutover      |        Cao |                         3.5/5 | Chưa release               |
| 3     | Focused auto-open + safe custom-editor open | Trung bình |                          4/5 | Chưa release               |
| 4     | Installed integration synchronization       | Trung bình |                          4/5 | Release candidate          |
| 5     | Docs, packaging và full validation         |       Thấp |                           5/5 | Có thể release             |

## Phase 0 — Baseline và contract freeze

### Mục tiêu

Xác nhận repository đang ổn định trước khi sửa và tách failure có sẵn khỏi regression mới.

### Components

- Repository/worktree
- Existing test/build pipeline
- plans/move-artifacts-to-global/analized.md
- Runtime-host/support matrix

### Thay đổi

Không sửa runtime code.

Ghi nhận worktree hiện tại và khóa acceptance contract:

- v5-only.
- `location.workspaceRoot` tiếp tục mô tả target repository, không quyết định storage path.
- Giữ Workspace Registry, evidence/token và 5 MCP tools.
- RelativePattern watcher.
- Focused-window auto-open.
- Không có review deep-link; `artifactLink` là regular file link.
- `openWith` là đường bảo đảm mở custom editor cho watcher và command.
- Uninstall bảo toàn global artifacts.

Khóa support matrix trước khi sửa runtime:

- Local VS Code và Cursor local.
- WSL.
- Remote SSH/dev container/Codespaces.
- Trường hợp AI client/MCP và extension host chạy khác máy hoặc khác home directory.
- Chỉ tuyên bố hỗ trợ môi trường nơi MCP producer và extension consumer cùng nhìn thấy một global artifact root.

### Verification

Chạy baseline:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Kiểm tra thêm:

```powershell
git status --short
git diff --stat
```

Ghi lại:

- Tổng số tests và test files.
- Failure/warning có sẵn.
- File dirty thuộc công việc của Chú.
- Build artifacts nào được project track.

### Điều kiện qua gate

- Check, test và build có kết quả baseline rõ.
- Không ghi đè thay đổi có sẵn.
- Mọi failure baseline được ghi nhận trước khi sửa code.
- Support matrix đã phân loại rõ supported, unsupported hoặc MANUAL_REQUIRED; không để quyết định host/filesystem tới Phase 5.

### Đánh giá ổn định

- **Target:** 5/5.
- **Rủi ro:** Thấp.
- **Rollback:** Không cần.
- **Dừng nếu:** Baseline đang fail mà chưa xác định được nguyên nhân.

## Phase 1 — Global path foundation dạng additive

### Mục tiêu

Xây và kiểm chứng global storage boundary trước khi nối nó vào MCP/extension runtime.

### Components sẽ sửa

- src/shared/artifact-files.ts
- src/shared/artifact-validation.ts
- test/artifact-store.test.ts hoặc test mới cho path safety

### Thay đổi

1. Thêm globalArtifactsRoot():
   - Production: path.join(os.homedir(), ".ai-artifacts", "artifacts").
   - MCP và extension dùng cùng một shared resolver.
   - Test process dùng temp root riêng qua test-only seam không thể thay đổi production behavior.
2. Thêm safe global-root creation:
   - Tạo từng segment.
   - Canonicalize root.
   - Từ chối symlink/junction.
   - Trên POSIX, tạo và duy trì `.ai-artifacts`, `artifacts` và từng artifact directory với mode `0700`.
   - Nếu managed directory POSIX đã tồn tại với group/other permission, siết về `0700`; nếu không thể siết an toàn thì fail trước artifact mutation.
   - Trên Windows, không giả lập POSIX mode; dùng inherited ACL và giữ path/symlink checks hiện có.
3. Thêm assertGlobalArtifactDirectory():
   - Input phải absolute.
   - Artifact là direct child của collection root.
   - Basename khớp artifactId.
   - Chặn ../ escape và sibling prefix collision.
   - So sánh path theo case semantics của OS.
4. Tách validation thành hai lớp:
   - Lexical validation đồng bộ cho absolute path, direct-child, basename và prefix collision.
   - Async filesystem validation bằng `lstat`/`realpath` trước mọi read/write.
5. Async validation phải từ chối symlink/junction không chỉ ở root/artifact directory mà cả lifecycle files, lock file, staging và backup targets.
6. Thêm permission helpers dùng chung:
   - Lifecycle files, lock, staging và backup files được tạo với POSIX mode `0600`.
   - Atomic rename/copy/rollback không được làm rộng permission của target.
   - Existing managed lifecycle file có permission rộng phải được siết hoặc fail closed trước write.
7. Chưa chuyển v4 runtime sang helper mới trong phase này.

### Verification

Focused automated tests:

```powershell
npm.cmd run check
npx.cmd vitest run test/artifact-store.test.ts
```

Các case bắt buộc:

- Global direct child hợp lệ.
- Nested artifact directory bị từ chối.
- Path ngoài root bị từ chối.
- Prefix collision như artifacts-evil bị từ chối.
- artifactId mismatch bị từ chối.
- Symlink/junction root hoặc artifact directory bị từ chối.
- Symlink tại artifact.json, artifact.md, comments.json, review-submission.json hoặc transaction target bị từ chối trước read/write/copy fallback.
- Parent/path bị thay đổi giữa validation và mutation phải fail closed trong phạm vi có thể kiểm chứng bằng fixture.
- Trên POSIX, global/artifact directories có mode `0700`; lifecycle/transaction files có mode `0600` sau create, advance và rollback.
- POSIX fixture có mode quá rộng được siết an toàn hoặc bị từ chối trước mutation; test phải xác nhận không giữ group/other bits.
- Trên Windows, permission test được đánh dấu not-applicable và không dùng kết quả giả lập POSIX làm bằng chứng.
- Root chưa tồn tại được tạo an toàn.
- Hai test processes dùng hai temp roots khác nhau.
- Test không tạo file trong real ~/.ai-artifacts.

Static verification:

```powershell
rg -n "globalArtifactsRoot|assertGlobalArtifactDirectory" src test
```

Manual spot-check trong temp root:

- Xem directory layout được tạo đúng hai cấp .ai-artifacts/artifacts.
- Thử path escape và xác nhận lỗi xảy ra trước mutation.

### Điều kiện qua gate

- Tất cả path-safety tests pass.
- POSIX permission tests pass trên môi trường POSIX; Windows ACL boundary được ghi rõ là inherited/manual scope.
- Runtime v4 hiện hành vẫn pass regression.
- Không file nào xuất hiện trong real user home.

### Đánh giá ổn định

- **Target:** 5/5.
- **Rủi ro:** Thấp vì code additive.
- **Rollback:** Xóa helper/tests mới.
- **Dừng nếu:** Test seam làm thay đổi production root, symlink validation không fail-closed, hoặc managed POSIX paths/files không đạt owner-only mode.

## Phase 2 — Atomic schema v5 và MCP global-storage cutover

### Mục tiêu

Chuyển shared contract, MCP producer và extension store consumer sang v5 trong cùng một integration boundary.

### Components sẽ sửa

- src/shared/contracts.ts
- src/shared/artifact-files.ts
- src/shared/artifact-validation.ts
- src/integration/artifact-review-mcp-v4.ts
- src/extension/artifact-store.ts
- src/extension/mcp-config.ts
- src/extension/workspace-integration-v4.ts
- skills/create-review-artifact/SKILL.md
- skills/create-review-artifact/references/artifact-contract.md
- test/artifact-contracts.test.ts hoặc contract-focused test tương đương
- test/review-wait-mcp.test.ts
- test/artifact-store.test.ts
- test/skill-contract.test.ts
- test/mcp-config.test.ts
- test/workspace-integration.test.ts

### Quy tắc triển khai atomic

- Các mục 2A–2E là internal checkpoints để giới hạn blast radius và giúp chẩn đoán lỗi; chúng không phải các phase có thể merge, release hoặc handoff độc lập.
- Extension release target là `1.0.0`; MCP server target được khóa là `7.0.0`.
- Có thể tạo local checkpoint trong quá trình làm, nhưng chỉ tạo commit Phase 2 hoàn chỉnh sau khi gate 2E pass.
- Trạng thái trung gian có thể chưa typecheck hoặc chưa chạy end-to-end; không được cài vào integration thật hay chuyển sang Phase 3.
- Nếu dừng hoặc rollback, quay lại checkpoint Phase 1 đã commit; không giữ lại một phần contract v5 trong source/runtime.

### Work package 2A — Shared contract v5-only

- ARTIFACT_SCHEMA_VERSION: 4 → 5.
- Giữ `location.workspaceRoot`, nhưng định nghĩa nó là target repository metadata chứ không phải storage root.
- Xóa Legacy* và Any* schemas/types.
- ReviewState chỉ dùng v5 types.
- Chỉ giữ reviewSessionId binding.

#### Verification 2A

```powershell
npx.cmd vitest run test/artifact-contracts.test.ts
```

Expected:

- Contract unit tests xác nhận v3/v4 bị reject, v5 có `location.workspaceRoot` hợp lệ được parse.
- Không dùng full `npm.cmd run check` làm gate khi producer/consumer chưa migrate xong.
- Không thêm compatibility shim để làm im lỗi.
- Full typecheck chỉ chạy sau khi hoàn thành 2B và 2C trong cùng atomic cutover.

### Work package 2B1 — MCP global create/load

- Giữ resolver imports/constants/grants/handlers và toàn bộ selection-token behavior hiện tại.
- `CreateArtifactInput` tiếp tục nhận `workspaceRoot`, `workspaceEvidence`, `title`, `kind` và `markdown`.
- Resolve và validate workspace evidence trước mutation như hiện tại.
- `safeArtifactCollectionRoot()` dùng global root thay vì đặt collection dưới workspace.
- `persistArtifact()` vẫn nhận canonical `workspaceRoot` để ghi `location.workspaceRoot`, nhưng không dùng nó để tính storage path và không dùng `process.cwd()`.
- Artifact directory được tạo owner-only dưới exact global collection root; collision retry và create rollback chỉ thao tác trên directory vừa cấp phát.
- `loadArtifactContext()` dùng exact handle + global containment, rồi revalidate manifest workspace qua registry như behavior hiện tại.
- Giữ `workspaceRoot` trong context/result.
- `tools/list` tiếp tục có 5 tools.
- Bump MCP server từ `6.0.0` lên target đã khóa `7.0.0`.
- Creation result tiếp tục trả `artifactUrl` và `artifactLink`; `artifactLink` là regular file link, không phải deep link và không bảo đảm custom editor.

#### Verification 2B1

```powershell
npm.cmd run build:integration
npx.cmd vitest run test/review-wait-mcp.test.ts
```

Protocol checks:

- tools/list trả đúng resolve, create, wait, inspect và advance-and-wait.
- create có additionalProperties=false và tiếp tục yêu cầu workspaceRoot/workspaceEvidence.
- Resolver selection token vẫn single-use, expiring và context-bound.
- Artifact được tạo dưới temp global root.
- Manifest/comments là v5 và manifest giữ canonical `location.workspaceRoot`.
- Trên POSIX, artifact directory là `0700` và files do MCP tạo là `0600`.
- Exact handle ngoài root bị từ chối.
- Workspace không còn được registry công nhận vẫn bị từ chối theo behavior hiện tại.
- Create collision retry vẫn hoạt động.
- Failure sau manifest write rollback đúng directory.

Không coi 2B1 là pass độc lập nếu lifecycle mutation ở 2B2 chưa dùng cùng global-path/permission contract.

### Work package 2B2 — MCP lifecycle transaction và permissions

- Áp dụng global lexical assertion và async `lstat`/`realpath` validation ngay trước mọi lifecycle read/write.
- Validate manifest, Markdown, comments, submission, lock, staging và backup targets bằng managed-file allowlist.
- Create, staged writes và lock files dùng POSIX mode `0600`; artifact directory dùng `0700`.
- Backup bằng rename/copy, staged replacement, rollback và Windows editor-lock fallback không được làm rộng target permission.
- Existing managed POSIX file có permission rộng phải được siết an toàn hoặc fail trước mutation.
- Giữ transaction order, rollback semantics, waiter ownership và round-token state binding hiện tại.

#### Verification 2B2

```powershell
npm.cmd run build:integration
npx.cmd vitest run test/global-artifact-path.test.ts test/review-wait-mcp.test.ts
```

Lifecycle regression:

- create → wait.
- cancellation và takeover.
- inspect comments.
- question-only advance giữ artifact SHA.
- revise/approve/save.
- round token expiry/replay/concurrency/state binding.
- transaction rollback.
- Windows editor-lock fallback.
- Linked lifecycle/lock/staging/backup target fail trước read/write/copy fallback.
- Sau successful advance hoặc rollback, POSIX target files vẫn là `0600` và không còn lock/staging/backup rác.

### Work package 2C1 — Extension Store load và validation

- ArtifactStore.load() parse v5-only.
- Giữ reviewRound, artifact SHA, comments SHA và reviewSessionId validation.
- Giữ `location.workspaceRoot` trong ReviewState; nó không được dùng để suy ra artifact directory.
- Schema v3/v4 trả unsupported error; không mở read-only.
- Trước khi đọc manifest, Markdown, comments, submission hoặc quan sát lock, Store validate exact global artifact directory và từng managed file path.

#### Verification 2C1

```powershell
npm.cmd run check
npx.cmd vitest run test/artifact-store.test.ts
npm.cmd run build:extension
```

Negative cases:

- v3/v4 reject.
- Modified artifact.md reject vì hash mismatch.
- Wrong session/round reject.
- Artifact path ngoài global root reject.
- Lifecycle file hoặc lock path là symlink/junction bị reject trước read.

### Work package 2C2 — Extension Store writes và permissions

- Comment/submission writes dùng global lexical + async filesystem assertion trước mutation.
- Temporary files được tạo `0600`; rename, hard-link/copy fallback và replacement không làm rộng permission.
- Revalidate managed source/target ngay sát thao tác; target bị thay bằng link hoặc non-regular file phải fail closed.
- Giữ create-once submission semantics, comments atomic replace retry và Windows lock/copy fallback hiện tại.

#### Verification 2C2

```powershell
npm.cmd run check
npx.cmd vitest run test/global-artifact-path.test.ts test/artifact-store.test.ts
npm.cmd run build:extension
```

Write checks:

- Comment add/remove và revise/approve/save vẫn đúng binding.
- Symlink/junction tại comments, submission hoặc temporary target bị reject trước mutation.
- Comment/submission writes và copy/rename replacement giữ POSIX file mode `0600`.
- Failed write không để lại temporary file và không thay đổi lifecycle state hợp lệ trước đó.

### Work package 2C3 — MCP ↔ Extension Store round-trip

Chạy một contract fixture xuyên producer và consumer thay vì chỉ chứng minh từng component riêng lẻ.

#### Verification 2C3

```powershell
npm.cmd run check
npx.cmd vitest run test/artifact-store.test.ts test/review-wait-mcp.test.ts
```

Cross-component test:

1. MCP test process tạo artifact v5.
2. ArtifactStore load cùng artifact.
3. Ghi comment.
4. Submit review.
5. MCP waiter nhận submission hợp lệ.
6. Advance round và load lại bằng store.

Cross-boundary negative cases:

- Workspace registration stale/missing reject theo behavior hiện tại.
- Producer và consumer dùng hai global roots khác nhau phải fail thay vì suy đoán hoặc scan.
- Producer/consumer schema, review session, round hoặc hash lệch phải fail closed.
- Toàn bộ fixture dùng temp home và không tạo file dưới real user home.

### Work package 2D1 — Production skill và artifact contract

- Cập nhật production skill và artifact contract trong cùng cutover:
  - Giữ resolver/5-tool availability check và workspace-selection rules.
  - Mô tả schema v5, global artifact directory và `location.workspaceRoot` là target metadata.
  - Giữ create input với workspaceRoot/workspaceEvidence/title/kind/markdown.
  - Mô tả artifactLink là regular file link, không phải deep link/custom-editor guarantee.
- Không thay đổi trigger boundary, exact-handle rules, feedback policy, recovery flow hoặc Proceed execution semantics.

#### Verification 2D1

```powershell
npx.cmd vitest run test/skill-contract.test.ts
```

Contract checks:

- Production skill và contract không còn mô tả workspace-local artifact storage hoặc schema v4.
- Production skill vẫn yêu cầu resolver và đúng 5 tools.
- Sau create, wait/inspect/advance chỉ dùng exact global handle; không yêu cầu resolver lần nữa và không scan “latest artifact”.
- `artifactLink` được mô tả rõ là regular file link, không phải deep link hay custom-editor guarantee.

### Work package 2D2 — MCP config, bundle và temp-installed assets

- Verify Codex MCP config/allowlist tiếp tục khai báo đúng 5 tools; không thêm hoặc bỏ tool trong cutover này.
- Build bundled MCP và dùng temp-home fixture để install source MCP/skill.
- Verify installed bundle, installed skill và configured tool surface khớp source trước khi Phase 2 được qua gate.
- Không sửa trực tiếp global integration thật; mọi end-to-end installation check dùng temp home/config.

#### Verification 2D2

```powershell
npx.cmd vitest run test/mcp-config.test.ts test/workspace-integration.test.ts
npm.cmd run build
```

Contract/integration checks:

- Temp-installed MCP bundle/skill byte-match source build/assets.
- Config allowlist có đúng resolver, create, wait, inspect và advance-and-wait.
- Temp-installed tool catalog tạo được artifact v5 global và Extension Store đọc/submit được cùng artifact.

### Work package 2E — Atomic final gate

2E không thêm behavior mới. Mục đích là chứng minh toàn bộ 2A–2D2 tạo thành một cutover unit nhất quán và không để trạng thái trung gian lọt sang Phase 3.

#### Điều kiện qua gate Phase 2

```powershell
npm.cmd run check
npm.cmd run build:integration
npx.cmd vitest run test/artifact-contracts.test.ts test/global-artifact-path.test.ts test/artifact-store.test.ts test/review-wait-mcp.test.ts test/skill-contract.test.ts test/mcp-config.test.ts test/workspace-integration.test.ts
npm.cmd test
npm.cmd run build:extension
npm.cmd run build
git diff --check
```

Tất cả pass. Chỉ khi đó mới tạo commit Phase 2 hoàn chỉnh. Không được merge, handoff, cài integration thật hoặc sang Phase 3 nếu shared schema, MCP, ArtifactStore, production skill/contract, config allowlist và temp-installed assets chưa hoàn thành round-trip v5/global-storage end-to-end.

### Đánh giá ổn định

- **Target:** 3.5/5.
- **Rủi ro:** Cao nhất vì đổi persistence protocol.
- **Ổn định đạt được:** Core lifecycle và source/temp-installed contract đã chạy end-to-end trên v5; auto-open chưa chuyển sang global watcher.
- **Rollback:** Revert toàn bộ Phase 2 như một unit.
- **Dừng nếu:** Có lifecycle regression, test chạm real home, hoặc producer/consumer schema lệch nhau.

## Phase 3 — Global watcher và safe custom-editor open

### Mục tiêu

Hoàn thiện UX extension trên global storage trong khi giữ nguyên workspace routing cho artifact creation.

### Components sẽ sửa

- src/extension/extension.ts
- src/shared/artifact-files.ts hoặc shared global-root helper đã tạo ở Phase 1
- Helper mới dưới src/extension/ cho watcher/open coordinator nếu cần
- Test mới cho activation order, focus guard, path validation và open coordinator
- package.json, MCP/skill contract và tests liên quan chỉ verify; chỉ sửa nếu phát hiện contract lệch Phase 2

### Quy tắc thực hiện và đánh giá từng substep

- 3A1–3D là các checkpoint chẩn đoán; không coi Phase 3 hoàn tất hoặc handoff UX trước khi 3D pass.
- Trước mỗi substep, AI phải đọc lại current source/tests, chạy `git status --short`, xác nhận checkpoint trước đã pass và báo cho Chú component dự kiến sửa.
- Sau mỗi substep, AI phải chạy focused tests phù hợp và xuất báo cáo theo mẫu sau:

```text
## Phase 3 <substep> Evaluation

- Components changed:
- Behavior completed:
- Automated verification:
  - <command> -> PASS/FAIL, exit code, test count
- Acceptance evidence:
- Manual verification: NOT_REQUIRED / MANUAL_REQUIRED / PASS / FAIL
- Regressions or remaining risks:
- Stability assessment:
- Substep decision: PASS / FAIL / BLOCKED
- Ready for next substep: YES / NO
```

- AI chỉ được ghi `PASS` cho automated command đã thực sự chạy thành công; đọc code hoặc mock chưa đủ thay cho manual behavior của VS Code.
- Nếu substep có manual verification, báo cáo phải ghi `MANUAL_REQUIRED`, nhắc trực tiếp Chú thực hiện, đưa checklist đơn giản trong plan và chờ Chú trả kết quả. AI không được tự suy đoán manual test đã pass.
- AI phải chuẩn bị build/fixture/test data cần thiết trước khi nhờ Chú thao tác. Hướng dẫn cho Chú chỉ nên yêu cầu focus, click, chạy command palette hoặc quan sát tab; không yêu cầu Chú viết code.
- Không xóa hoặc đổi tên real `~/.ai-artifacts` để tạo fresh-home test. Fresh-home manual phải dùng disposable OS profile, sandbox/VM hoặc isolated test home do AI chuẩn bị; nếu chưa có môi trường an toàn thì đánh dấu `MANUAL_REQUIRED`, không hạ tiêu chuẩn gate.
- Sau manual feedback, AI phải ghi lại từng case PASS/FAIL và không sang substep tiếp theo nếu case bắt buộc fail.

### Substep 3A1 — Testable watcher/open foundation

Tạo boundary có thể test cho Phase 3 trước khi thay watcher production:

- Tách logic chuẩn bị watcher, xử lý create event và mở artifact khỏi `activate()` thành helper nhỏ có dependency injection cho VS Code boundary.
- Dùng shared global-root/path validation từ Phase 1–2; không tạo một path-safety contract thứ hai.
- Định nghĩa một entrypoint mở review nhận exact `artifact.md` URI, validate global direct-child/artifact manifest trước khi gọi `openWith`.
- Giữ `extension.ts` là composition root; không đưa lifecycle mutation vào watcher/open helper.
- Chưa đổi production watcher glob trong 3A1 nếu test seam chưa đủ để chứng minh activation order và failure behavior.

#### Verification 3A1

Automated tests:

- Valid exact global artifact URI đi qua validation và gọi đúng injected open function.
- URI ngoài global root, nested artifact, sai filename, artifact-id mismatch, linked path hoặc invalid manifest bị từ chối trước open.
- Helper không scan global storage, workspace hoặc tab list để tìm artifact.
- Dependency failure được propagate/ghi nhận mà không tạo filesystem mutation ngoài safe root helper.
- Existing Phase 2 Store/MCP tests tiếp tục pass.

#### AI evaluation 3A1

- Manual verification: `NOT_REQUIRED` vì 3A1 chỉ tạo testable boundary và chưa chuyển watcher production.
- Báo cáo phải chỉ rõ helper nào là validation/open entrypoint, test nào chứng minh invalid target không tới `openWith`, và production behavior có còn nguyên hay không.
- Chỉ cho phép sang 3A2 khi focused tests và `npm.cmd run check` pass.

### Substep 3A2 — Global RelativePattern watcher cutover

- Trước khi đăng ký watcher, extension phải await shared `ensureSafeGlobalArtifactsRoot()` để collection root đã tồn tại và vượt qua canonical/symlink/permission validation.
- Không đăng ký watcher nếu root creation/validation thất bại; báo lỗi rõ và không tiếp tục với watcher ở trạng thái không chắc chắn.
- Watch globalArtifactsRootUri với pattern \*/comments.json.
- Chỉ xử lý create event.
- Return nếu auto-open disabled.
- Return nếu window không focused.
- Validate manifest/path trước khi mở.
- Giữ semantics watcher hiện tại: xử lý `comments.json` create event, kể cả event phát sinh từ lifecycle transition; không thêm filter `reviewRound === 1`.
- Dispose watcher trong context.subscriptions.

#### Verification 3A2

Automated/mock tests:

- Fresh temp home chưa có `.ai-artifacts`: activation tạo collection root an toàn trước watcher registration.
- Spy/order assertion chứng minh root ensure hoàn tất trước `createFileSystemWatcher`.
- Root creation/validation fail: watcher và openWith không được gọi.
- MCP tạo artifact đầu tiên ngay sau watcher registration: event đầu tiên tạo đúng một `openWith`.
- focused=false: openWith không được gọi.
- focused=true: gọi đúng artifact URI/viewType.
- invalid manifest/path: không mở.
- autoOpen=false: không mở.
- Một create event tạo đúng một open request; concurrent duplicate-event dedup được kiểm chứng ở 3B cùng single-flight.
- Round-transition create event giữ behavior mở/reveal hiện tại.

Manual:

1. Dùng fresh home/profile chưa có global root, activate extension rồi tạo artifact đầu tiên: artifact phải auto-open.
2. Xác nhận global root đã tồn tại trước thời điểm watcher bắt đầu theo dõi.
3. Mở hai VS Code windows.
4. Focus window A và tạo artifact: chỉ A mở.
5. Focus window B và tạo artifact mới: chỉ B mở.
6. Không focus VS Code và tạo artifact: không window nào mở.

#### AI evaluation 3A2

- Manual verification: `MANUAL_REQUIRED`; automated mocks không thay thế fresh-host và two-window behavior thật.
- Trước khi nhắc Chú, AI phải build extension, chuẩn bị disposable/isolated home và một cách tạo fixture/artifact không chạm dữ liệu thật. Không được yêu cầu Chú xóa global artifacts hiện có.
- Hướng dẫn đơn giản cho Chú:
  1. Mở Extension Development Host theo lệnh/cấu hình AI đã chuẩn bị.
  2. Khi AI báo sẵn sàng, tạo artifact thử thứ nhất và xác nhận nó tự mở.
  3. Mở thêm một VS Code window; lần lượt focus A rồi B trước mỗi artifact thử và báo window nào mở review.
  4. Chuyển focus ra ngoài VS Code, tạo artifact thử cuối và xác nhận không window nào tự mở.
- AI ghi riêng kết quả `first artifact`, `window A`, `window B`, `no focused window`; cả bốn phải PASS để 3A2 pass.
- Nếu không thể cung cấp isolated manual environment an toàn, quyết định là `MANUAL_REQUIRED`, không phải PASS; Chú có thể cho phép tiếp tục chuẩn bị 3B nhưng Phase 3 gate vẫn mở.

### Substep 3B — Shared open coordinator/tab dedup

Tạo một đường mở dùng chung cho watcher và command:

```text
validate → canonical key → single-flight → openWith
```

Không quét tab rồi cố focus một `TabInputCustom`, vì VS Code Tab API không có public API để đặt một tab tùy ý thành active. Luôn đi qua `vscode.openWith`; `supportsMultipleEditorsPerDocument: false` là cơ chế để VS Code reuse/reveal editor hiện có.

#### Verification 3B

- Hai open requests đồng thời, kể cả concurrent duplicate watcher events, chỉ tạo một openWith call.
- Artifact khác không bị dedup nhầm.
- In-flight Map luôn cleanup sau success/error.
- supportsMultipleEditorsPerDocument vẫn false.
- Manual test xác nhận gọi `openWith` lại cùng URI reuse/reveal tab thay vì tạo duplicate.

Manual:

- Phát nhiều create/change events liên tiếp.
- Đóng/mở lại cùng artifact.
- Mở hai artifact khác nhau.

#### AI evaluation 3B

- Manual verification: `MANUAL_REQUIRED` vì VS Code reuse/reveal tab là behavior của editor host, không có stable API hoặc unit mock đủ để chứng minh.
- Trước khi nhắc Chú, AI phải mở sẵn một valid test artifact trong Extension Development Host và chuẩn bị command cần dùng.
- Hướng dẫn đơn giản cho Chú:
  1. Chạy **AI Artifacts: Open Artifact Review** hai lần cho cùng artifact và xác nhận chỉ có một review tab được reuse/reveal.
  2. Đóng tab, chạy command lại và xác nhận tab mở lại bình thường.
  3. Mở artifact thứ hai và xác nhận hai artifact khác nhau có hai review tabs riêng.
- AI ghi số `openWith` calls từ automated test và kết quả tab quan sát từ Chú thành hai bằng chứng riêng.
- Chỉ pass 3B khi same-artifact single-flight, cleanup after success/error, different-artifact isolation và manual reuse/reveal đều pass.

### Substep 3C — Regular file-link contract

- Không đăng ký URI handler và không thêm `onUri` activation.
- MCP không trả `reviewUrl`.
- `artifactUrl` tiếp tục là RFC 8089 `file://` URI.
- `artifactLink` tiếp tục là Markdown link trỏ tới `artifactUrl`.
- Skill và contract phải gọi đây là regular file link, không phải deep link và không phải custom-editor guarantee.
- Watcher và command là các đường mở custom editor qua `openWith`.

#### Verification 3C

Automated:

- artifactUrl được encode đúng cho space, `#`, parentheses và Unicode.
- artifactLink escape title đúng và trỏ chính xác tới artifactUrl.
- Không còn `reviewUrl`, URI handler hoặc `onUri` trong source/package contract.
- Command từ chối artifact không hợp lệ trước khi gọi `openWith`.

Manual:

- Click artifactLink từ chat.
- Xác nhận link mở file theo behavior của editor; không yêu cầu nó phải mở custom editor.
- Dùng **Open Artifact Review** để xác nhận command mở đúng custom editor.
- Thử regular file link có space, #, parentheses và Unicode.

#### AI evaluation 3C

- Manual verification: `MANUAL_REQUIRED` cho click behavior; encoding/contract absence vẫn phải có automated/static evidence riêng.
- Trước khi nhắc Chú, AI phải tạo hoặc cung cấp một regular `artifactLink` test an toàn có path/title chứa space, `#`, parentheses và Unicode.
- Hướng dẫn đơn giản cho Chú:
  1. Click link AI cung cấp và xác nhận editor mở file; không cần custom editor tự mở từ link.
  2. Chạy **AI Artifacts: Open Artifact Review** cho file đó và xác nhận custom review editor mở.
  3. Báo lại link có mở đúng file hay không và command có mở đúng review editor hay không.
- AI phải xác nhận bằng static search rằng không có `reviewUrl`, URI handler hoặc `onUri`; không được suy ra điều này chỉ từ manual click.
- Chỉ pass 3C khi automated URL/link tests, static contract checks, invalid-command rejection và hai manual observations đều pass.

### Substep 3D — Final Phase 3 gate và consolidated manual validation

3D không thêm behavior mới. Nếu gate phát hiện regression, quay lại đúng substep sở hữu behavior đó, sửa và chạy lại focused verification trước khi lặp 3D.

#### Automated gate 3D

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build:extension
npm.cmd run build
git diff --check
```

AI phải chạy thêm focused Phase 3 suite theo tên test thực tế đã tạo và báo riêng test count cho watcher, open coordinator và link contract.

#### Manual gate 3D

- Nếu 3A2, 3B hoặc 3C có code thay đổi sau manual run tương ứng, manual case bị ảnh hưởng phải chạy lại.
- Critical cases bắt buộc có kết quả thật: fresh-home first artifact, focused two-window routing, no-focused-window no-open, same-URI reuse/reveal, second-artifact isolation, regular link click và command custom-editor open.
- AI phải nhắc Chú rằng đây là final manual gate, gom các case còn thiếu/thay đổi thành một checklist ngắn và chờ phản hồi trước khi kết luận Phase 3.
- Hướng dẫn đơn giản cho Chú:
  1. Mở Extension Development Host/isolated environment mà AI đã chuẩn bị.
  2. Làm lần lượt từng thao tác AI đánh số; sau mỗi thao tác chỉ cần trả lời “pass” hoặc mô tả điều thấy khác.
  3. Không xóa, di chuyển hoặc chỉnh file global artifacts thật; AI chịu trách nhiệm tạo và dọn fixture thử nghiệm.

#### AI evaluation 3D

- Báo cáo phải dùng mẫu Phase 3 evaluation, liệt kê từng automated command và từng manual critical case.
- `Manual verification` chỉ là `PASS` khi Chú đã xác nhận tất cả critical cases; nếu thiếu bất kỳ case nào thì giữ `MANUAL_REQUIRED`.
- Phase 3 chỉ được đánh dấu PASS khi automated gate, manual gate, path-safety validation và no-real-user-data check đều pass.
- Sau PASS, AI cập nhật progress report, audit commit scope và đề xuất checkpoint commit; không tự cài integration thật vì đó là Phase 4.

### Điều kiện qua gate Phase 3

- Toàn bộ automated tests của 3A1–3C và final gate 3D pass.
- Fresh-home first-artifact test pass; không chấp nhận watcher-delay race như một giới hạn đã biết.
- Manual two-window test pass.
- Watcher và command mở custom review editor qua `openWith`.
- artifactLink được mô tả và kiểm thử đúng như regular file link.
- Missed auto-open có fallback qua command hiện tại; không mở rộng UX recovery command trong scope này.
- Không manual case nào được AI tự đánh dấu pass và không fixture nào chạm/xóa dữ liệu artifact thật của Chú.

### Đánh giá ổn định

- **Target:** 4/5.
- **Rủi ro:** Trung bình.
- **Ổn định đạt được:** Runtime và UX auto-open/custom-command local hoàn chỉnh.
- **Giới hạn chấp nhận:** Không window focused tại thời điểm event thì không auto-open.
- **Dừng nếu:** Artifact đầu tiên có thể bị lỡ, nhiều windows cùng mở, hoặc watcher/command bypass path validation.

## Phase 4 — Installed integration synchronization

### Mục tiêu

Bảo đảm mọi supported client install/reinstall đúng MCP bundle và production skill đã hoàn tất trong atomic Phase 2.

### Components sẽ sửa/verify

- src/extension/workspace-integration-v4.ts
- src/extension/mcp-config.ts — verify, chỉ sửa nếu packaging/install cần adapt
- skills/create-review-artifact/SKILL.md — verify source đã khóa từ Phase 2
- skills/create-review-artifact/references/artifact-contract.md — verify source đã khóa từ Phase 2
- Integration/skill tests

### Thay đổi

1. Giữ publisher activation, registry directory provisioning và workspace resolver contract.
2. Giữ resolve tool approval/verification trong Codex config; tools/list và config tiếp tục có 5 tools.
3. JSON client-driver command/args logic giữ nguyên.
4. Giữ marker/removal logic để uninstall legacy hook an toàn.
5. Không migration hoặc compatibility cho schema v3/v4; sau update user phải reinstall integrations và restart AI client theo README.
6. Không trì hoãn semantic skill/contract changes tới phase này; chỉ đóng gói và xác minh đúng source đã pass Phase 2.
7. Reinstall trên temp fixtures phải thay installed MCP/skill lệch source bằng đúng current source mà không làm đổi unrelated config.
8. `.agents/skills/create-review-artifact` là test/workflow fixture ngoài production scope và không được đưa vào synchronization gate.

### Verification

Focused tests:

```powershell
npm.cmd run check
npx.cmd vitest run test/skill-contract.test.ts test/workspace-integration.test.ts test/mcp-config.test.ts test/mcp-client-drivers.test.ts
npm.cmd run build
```

Static removal audit:

```powershell
rg -n "LEGACY_ARTIFACT_SCHEMA_VERSION|AnyArtifactManifest|AnyCommentsDocument|AnyReviewSubmission|reviewUrl|registerUriHandler|onUri" src skills test package.json --glob "!src/integration/review-wait-mcp.ts" --glob "!src/integration/stamp-origin.ts"
```

Expected:

- Không còn active runtime/production-skill reference tới schema compatibility hoặc deep-link contract đã bỏ.
- `resolve_artifact_workspace`, workspace evidence/token và WorkspaceRegistryPublisher vẫn tồn tại có chủ đích.
- `src/integration/review-wait-mcp.ts`, `src/integration/stamp-origin.ts` và `.agents/**` nằm ngoài audit vì là excluded legacy/test-workflow fixtures theo scope đã chốt.
- Chỉ cho phép legacy marker trong cleanup test/code có chủ đích.

Integration verification:

1. Build source MCP/skill.
2. Chạy install integration vào temp home/config fixtures.
3. Verify installed MCP bundle khớp source.
4. Verify installed skill khớp source.
5. Verify config khai báo đúng 5 tools, gồm resolver.
6. Reinstall current-version fixture và xác nhận runtime/skill được đồng bộ; không kiểm thử backward-compatible schema migration.
7. Verify unrelated user config còn nguyên.
8. Uninstall fixture:
   - Runtime/skill/config được dọn.
   - Global artifact directory còn nguyên.
   - Workspace registry cleanup giữ behavior hiện hành của base integration.

### Điều kiện qua gate

- Focused tests và build pass.
- Static removal audit sạch.
- Install/reinstall/uninstall fixtures không gây data loss.
- Verification command nhận diện installed runtime/skill lệch source là outdated và bản đồng bộ là ready.

### Đánh giá ổn định

- **Target:** 4/5.
- **Rủi ro:** Trung bình do source/installed asset drift và yêu cầu user reinstall sau update.
- **Ổn định đạt được:** Release candidate sau khi reinstall integration.
- **Rollback:** Reinstall lại source runtime tương ứng với version được revert.
- **Dừng nếu:** Install/uninstall chạm user artifacts hoặc unrelated MCP/hook configuration.

## Phase 5 — Docs, packaging và full release validation

### Mục tiêu

Đóng release v1.0.0 với code, skill, package và tài liệu đồng nhất.

### Components sẽ sửa

- package.json và package-lock.json
- README.md
- docs/PHILOSOPHY.md
- docs/ARCHITECTURE.md
- docs/COMPONENTS.md
- docs/INSTRUCTION.md
- docs/CHANGE_LOGS.md
- CHANGELOG.md
- .gitignore/.vscodeignore nếu còn workspace-local rules
- plans/move-artifacts-to-global/implementation.md nếu lưu plan sau review

### Thay đổi

- Bump extension 1.0.0.
- Đồng bộ MCP server major version.
- Xóa .codex-artifacts custom-editor selector.
- Giữ selector global .ai-artifacts/artifacts/\*\*/artifact.md.
- Docs ghi rõ global storage, `location.workspaceRoot`, v5-only, 5 tools, focused auto-open, regular file link và uninstall behavior.
- README tiếp tục yêu cầu reinstall tất cả integrations và restart AI client sau update; không hứa hẹn compatibility với installed runtime cũ.
- Ghi architecture change vào docs/CHANGE_LOGS.md và release notes vào CHANGELOG.md.
- Không edit generated dist trực tiếp.

### Verification

Full automated gate:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Package/static checks:

- tools/list trong bundled MCP có đúng 5 tools.
- Bundled skill/contract khớp source.
- package version và lockfile đồng bộ.
- Registry publisher/resolver được đóng gói và tiếp tục hoạt động.
- Không đóng gói schema-v3/v4 parser/viewer runtime ngoài cleanup marker có chủ đích.
- Không có artifact test trong real user home.
- POSIX package/runtime path tạo directories `0700`, files `0600`; Windows không tuyên bố POSIX-mode guarantee.
- Review git diff theo component; không có unrelated edits.

Full manual matrix:

1. Create → wait → revise → advance.
2. Question-only review giữ Markdown SHA.
3. Proceed và Just save.
4. Cancel/takeover/reconnect.
5. Two-window focused auto-open.
6. Auto-open disabled.
7. artifactLink mở như regular file link; command mở custom editor qua `openWith`.
8. Windows editor-lock fallback.
9. Install/verify/reinstall/uninstall từng supported client.
10. Uninstall giữ nguyên ~/.ai-artifacts.
11. Chạy matrix cho các local/remote environment đã được Phase 0 tuyên bố hỗ trợ.
12. Trên POSIX, kiểm tra permission sau create, comment, submission, advance và rollback.

### Điều kiện qua gate

- Full check/test/build pass.
- Mọi P0/P1 regression đều đóng.
- Manual critical paths pass.
- Docs và installed assets phản ánh đúng runtime.
- Không publish nếu focused auto-open, command custom-editor open, uninstall data safety hoặc core lifecycle còn không chắc chắn.

### Đánh giá ổn định

- **Target:** 5/5.
- **Rủi ro:** Thấp về code; chủ yếu release/config drift.
- **Release status:** Chỉ sẵn sàng publish khi automated và manual gates cùng đạt.
- **Rollback:** Publish rollback phải đi cùng reinstall runtime/skill; artifact v5 không tương thích v0.9.x theo quyết định hard cutoff.

## 4. AI Verification Protocol

Phần này là hướng dẫn bắt buộc để AI tự verify trong quá trình triển khai.

### 4.1. Chu trình verify chuẩn cho mỗi phase

AI thực hiện tuần tự:

1. Đọc lại AGENTS.md, docs/INSTRUCTION.md và scope của phase.
2. Chạy git status --short để ghi nhận file dirty trước khi sửa.
3. Chỉ sửa các component đã khai báo trong phase.
4. Chạy focused verification ngay sau từng work package.
5. Chạy phase-level gate sau khi các focused tests pass.
6. Chạy git diff --check và review diff theo từng component.
7. Đối chiếu từng acceptance criterion; không suy luận pass chỉ vì build thành công.
8. Báo stability thực tế và rủi ro còn lại trước khi sang phase tiếp theo.

Không chain các lệnh verification. Chạy riêng từng lệnh để exit code và failure source rõ ràng.

### 4.2. Quy tắc kết luận kết quả

Mỗi check phải được gắn một trạng thái:

- **PASS:** Lệnh đã chạy, exit code 0 và output chứng minh đúng acceptance criterion.
- **FAIL:** Lệnh/test thất bại, output sai kỳ vọng hoặc phát hiện regression.
- **MANUAL_REQUIRED:** Không thể chứng minh bằng automated test trong môi trường hiện tại.
- **BLOCKED:** Không thể tiếp tục phase an toàn nếu thiếu quyền, môi trường hoặc quyết định kiến trúc.

AI không được:

- Đánh dấu PASS khi chỉ đọc code.
- Đánh dấu PASS khi command chưa hoàn tất.
- Bỏ qua test fail vì cho rằng “không liên quan” mà chưa chứng minh bằng baseline.
- Dùng real user home cho destructive/global-storage tests.
- Tự coi GUI behavior pass nếu chưa quan sát được VS Code thực tế.

### 4.3. Evidence AI phải thu thập

Cuối mỗi phase, báo theo mẫu:

```markdown
## Phase N Verification Report

- Components changed:
- Files changed:
- Focused commands:
  - <command> → PASS/FAIL, exit code, test count
- Phase gate commands:
  - <command> → PASS/FAIL, exit code
- Static checks:
- Filesystem/data-safety checks:
- Manual checks:
  - PASS / FAIL / MANUAL_REQUIRED
- Regressions found:
- Remaining risks:
- Stability score: X/5
- Gate decision: PASS / FAIL / BLOCKED
```

Không cần dán toàn bộ log dài; phải ghi command, exit code, số test và failure summary. Giữ log chi tiết khi có lỗi để chẩn đoán.

### 4.4. Self-verification theo loại thay đổi

#### Contract/schema

AI phải chứng minh cả positive và negative behavior:

- v5 hợp lệ được parse.
- v3/v4 bị từ chối.
- Producer, consumer và fixtures dùng cùng schema.
- Static search không còn Legacy*/Any* runtime types.

#### Filesystem safety

AI phải dùng temp root cô lập và kiểm tra:

- Direct child hợp lệ.
- Escape/nested/prefix collision bị từ chối.
- Symlink/junction ở root, artifact directory, lifecycle files và transaction targets bị từ chối.
- Lexical validation và async canonical filesystem validation đều chạy trước mutation tương ứng.
- POSIX directories giữ `0700`; lifecycle/lock/staging/backup files giữ `0600` xuyên suốt create, comment, submission, advance và rollback.
- Existing managed POSIX paths có group/other bits được siết an toàn hoặc fail trước mutation.
- Windows permission kết luận dựa trên inherited ACL và manual scope, không suy từ POSIX-mode test.
- Rollback không xóa sibling hoặc parent.
- Real ~/.ai-artifacts không bị tạo hoặc sửa bởi test.

Sau test, AI kiểm tra temp root và real global root để xác nhận không có contamination.

#### MCP lifecycle

AI phải chạy focused suite chứng minh:

- tools/list có đúng 5 tools.
- Resolver và selection-token contract vẫn hoạt động.
- create input tiếp tục yêu cầu workspaceRoot/workspaceEvidence.
- Manifest v5 giữ canonical `location.workspaceRoot` trong khi artifact directory nằm dưới global root.
- create/wait/inspect/advance round-trip pass.
- Cancellation/takeover/reconnect pass.
- Token replay/concurrency/state binding pass.
- Rollback và Windows lock fallback pass.

Không chỉ dựa vào typecheck vì lỗi lifecycle chủ yếu là runtime/state transition.

#### Extension watcher và custom editor

Logic thuần phải được tách đủ để unit test focus guard, global-path validation và single-flight open coordination.

Các hành vi phụ thuộc VS Code window thật được đánh dấu MANUAL_REQUIRED cho tới khi:

- Quan sát hai windows.
- Xác nhận chỉ focused window mở.
- Xác nhận watcher và command dùng đúng Artifact Review viewType.
- Xác nhận duplicate event/open request không tạo duplicate tab.
- Xác nhận artifactLink chỉ được kỳ vọng mở regular file URL, không phải deep link.

Nếu có GUI automation phù hợp và được phép dùng, AI có thể tự chạy kịch bản; nếu không thì cung cấp checklist ngắn để Chú xác nhận.

#### Integration và uninstall

AI dùng temp home/config fixtures để tự verify:

- Install triển khai đúng MCP bundle/skill.
- Verify nhận diện installed assets lệch/khớp source đúng.
- Reinstall đồng bộ current MCP bundle/skill; không kiểm thử schema migration hoặc backward compatibility.
- Uninstall bảo toàn ~/.ai-artifacts.
- Unrelated JSON/TOML/hook configuration không thay đổi.

Không chạy uninstall test trực tiếp trên home thật.

#### Docs/package

AI static-search các thuật ngữ contract cũ và kiểm tra:

- Docs giữ resolver/workspace evidence nhưng không còn mô tả artifact storage nằm dưới workspace.
- Docs không gọi artifactLink là deep link và không còn reviewUrl/URI-handler contract.
- package.json và lockfile cùng version.
- Bundled MCP/skill khớp source sau build.
- Changelog release và docs/CHANGE_LOGS.md đều có entry phù hợp.

### 4.5. Stop conditions

AI phải dừng phase và báo Chú khi:

- P0/P1 test fail.
- Path containment hoặc rollback chưa chứng minh được.
- Test chạm real user data.
- Producer/consumer schema không đồng bộ.
- Cleanup có nguy cơ xóa unrelated config/data.
- Cần mở rộng kiến trúc hoặc component ngoài plan.
- Manual critical path thất bại.

Nếu chỉ còn MANUAL_REQUIRED nhưng automated gate đã pass, AI báo rõ phase chưa đạt stability target cuối cùng; không tự nâng điểm ổn định.

### 4.6. Điều kiện AI được tự chuyển phase

AI chỉ tự chuyển sang phase tiếp theo khi:

- Mọi automated gate bắt buộc PASS.
- Không còn P0/P1 regression.
- Diff chỉ nằm trong scope hoặc phần mở rộng đã được Chú chấp nhận.
- Data-safety checks PASS.
- Stability score đạt target của phase, ngoại trừ manual checks đã được plan cho phép hoãn rõ ràng.

Phase 5 và quyết định release luôn yêu cầu manual critical paths hoàn tất; automated success một mình không đủ.

## 5. Stability scorecard theo component

| Component              | Target sau hoàn tất | Cách chứng minh                                 |
| ---------------------- | ------------------: | ----------------------------------------------- |
| Global path safety     |                 5/5 | Containment/symlink/direct-child tests          |
| Global data permissions |                5/5 | POSIX mode tests + Windows ACL scope statement  |
| MCP lifecycle/token    |                 5/5 | Full create/wait/inspect/advance/recovery suite |
| Schema v5-only         |                 5/5 | Positive v5 + negative v3/v4 tests              |
| Workspace resolution   |                 5/5 | Registry/evidence/token regression suite        |
| Artifact creation UX   |                 5/5 | 5-tool list và create schema test               |
| Focused auto-open      |                 4/5 | Automated focus guard + manual two-window test  |
| Custom editor open     |                 4/5 | Single-flight/openWith + command manual test    |
| Installed integrations |                 5/5 | Temp-home install/verify/reinstall/uninstall    |
| Uninstall data safety  |                 5/5 | Fixture chứng minh ~/.ai-artifacts không bị xóa |

## 6. Definition of Done

- Resolver/registry/evidence flow tiếp tục xác định đúng target workspace.
- create_artifact tiếp tục yêu cầu workspaceRoot/workspaceEvidence/title/kind/markdown.
- tools/list có đúng 5 tools.
- Artifact mới chỉ nằm dưới ~/.ai-artifacts/artifacts.
- Manifest/comments/submission chỉ dùng schema v5; manifest giữ `location.workspaceRoot` làm target metadata.
- v3/v4 bị từ chối và không còn parser/viewer runtime.
- Chỉ focused VS Code window auto-open.
- Watcher và command mở Artifact Review qua openWith.
- artifactLink là regular file link; không có reviewUrl/deep-link contract.
- Exact handle, hashes, round tokens và rollback vẫn fail-closed.
- POSIX managed directories/files giữ owner-only modes `0700`/`0600`; Windows permission boundary được ghi rõ theo inherited ACL.
- Tests không ghi vào home thật.
- Uninstall không xóa global artifacts.
- Mỗi phase có verification evidence và stability assessment thực tế.
- Full check, test, build và manual critical paths pass.
- Docs, bundled skill, MCP runtime và package version đồng bộ.
