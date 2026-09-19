# Phase 1 review findings and remediation plan

## 1. Mục tiêu

Hoàn tất producer-side contract cho window-routed artifact connection như một atomic MCP cutover:

- Resolver giữ đúng quan hệ `window + workspace`.
- Selection token bind một exact tuple, single-use và có expiry nhất quán.
- `create_artifact` và explicit `inspect_artifact_review(intent: "reconnect")` phát targeted open request mà không thay đổi review lifecycle.
- Connection state chỉ chứa routing metadata; artifact identity và workspace ownership luôn được derive từ validated artifact manifest.
- Wait/advance không được rebind window.
- Public MCP surface vẫn đúng năm tools; artifact schema vẫn là v5.

Phase 1 chỉ được coi là hoàn tất khi toàn bộ findings trong tài liệu này được đóng và phase-wide gate pass. Automated tests pass nhưng còn P1/P2 chưa xử lý thì không được đánh dấu complete.

## 2. Phạm vi component

### Shared connection contract và safety

- `src/shared/artifact-connection.ts`
- `src/shared/artifact-validation.ts`
- `src/shared/workspace-registry.ts`
- `src/shared/contracts.ts`

### MCP lifecycle integration

- `src/integration/artifact-review-mcp-v4.ts`

### Agent contract

- `skills/create-review-artifact/SKILL.md`
- `skills/create-review-artifact/references/artifact-contract.md`

### Regression tests

- `test/artifact-connection.test.ts`
- `test/review-wait-mcp.test.ts`
- `test/workspace-registry.test.ts`
- `test/skill-contract.test.ts`

## 3. Trạng thái review hiện tại

Tất cả 5 findings (P1.1, P1.2, P1.3, P2.1, P2.2) đã được xử lý triệt để và kiểm chứng bằng automated tests:

- **P1.1**: Đã cập nhật authority order trong `resolveArtifactConnectionTarget` (`selection token -> hint -> existing -> registry`). Explicit hint stale/mismatch ném typed error ngay lập tức trước khi mutate connection.
- **P1.2**: Đã cấu trúc lại `WINDOW_SELECTION_REQUIRED` recovery payload đầy đủ (`code`, `retryable: true`, `expectedNextTool`, `useSameArtifactHandle`, `lifecycleMutated`, `takeoverOccurred`, `windows`, `candidates`). Tách biệt flow create (`create_artifact`) và reconnect (`inspect_artifact_review`), cấm hoàn toàn việc gọi resolver sau khi đã create artifact. Public tool schemas mô tả đúng token provenance cho tagged create/reconnect; active-waiter recovery cũng phân biệt rõ resume wait, pure reconnect và intentional takeover.
- **P1.3**: Đã chuyển toàn bộ invalid connection state sang typed errors (`ArtifactConnectionInvalidError`, `WindowConnectionStaleError`, `WindowConnectionMismatchError`), phân biệt dứt điểm với `ArtifactConnectionWriteError` (atomic write failure). MCP boundary map trực tiếp theo typed error, commit không còn wrap invalid state thành write failure, và invalid routing state là non-retryable without `expectedNextTool` để tránh recovery loop.
- **P2.1**: Đã thêm helper `validateArtifactConnectionParent` tự kiểm tra direct-child của global collection, manifest schema v5, basename khớp artifactId và derive authoritative `workspaceRoot`; manifest được safe-read với bounded retry cho transient missing/malformed state trong atomic lifecycle commit, đồng thời bảo toàn khả năng load/reconnect của connection-less v5 artifacts.
- **P2.2**: Đã thống nhất `WORKSPACE_SELECTION_TTL_MS` làm shared source of truth cho cả candidate expiry lẫn grant map authority; shared target resolver reject grant tại đúng boundary `expiresAt <= now`.

Các automated gates gần nhất đều PASS:

```text
npm.cmd run check  -> pass (0 errors)
npm.cmd test       -> 278 passed, 3 skipped (20 test files)
npm.cmd run build  -> pass
```

Phase 1 đã đáp ứng toàn bộ Completion Criteria kỹ thuật.

## 4. Findings

### [CLOSED] P1.1 — Fresh explicit rebind hint bị existing connection ghi đè

#### Hiện trạng

`resolveArtifactConnectionTarget` kiểm tra existing `artifact-connection.json` trước `connectionHint`. Khi artifact đang bind window A và caller explicit yêu cầu window B, nếu A vẫn fresh thì resolver trả A trước khi xét B.

`inspect_artifact_review` truyền đồng thời `artifactDirectory` và optional `connection.windowInstanceId`, nên bug này làm reconnect ghi thêm open request cho A thay vì rebind sang B.

#### Tác động

- Không thực hiện được use case rebind từ một live window sang live window khác.
- Phase 4 smoke case “rebind từ một window khác” sẽ fail.
- Agent có thể báo reconnect thành công trong khi UI routing target không thay đổi.

#### Đề xuất

Đổi authority order trong `resolveArtifactConnectionTarget` thành:

```text
fresh selection token
  -> explicit windowInstanceId hint
  -> existing connection
  -> unique fresh registry match
  -> selection required / not found
```

Quy tắc chi tiết:

- Hint trùng existing connection và vẫn fresh: reuse existing target.
- Hint khác existing nhưng fresh và vẫn chứa exact manifest workspace: chọn hint và rebind.
- Hint được cung cấp nhưng stale/closed hoặc không còn chứa manifest workspace: trả typed error trước connection mutation; không âm thầm fallback về existing target.
- Không có hint: mới ưu tiên existing connection nếu target đó còn fresh.
- Selection token vẫn có authority cao hơn hint vì đó là capability do MCP issue cho một exact `window + workspace` tuple.

#### Acceptance tests

- Existing A fresh, explicit hint B fresh, cả hai chứa cùng workspace: result target là B và connection revision tăng đúng một.
- Existing A fresh, hint B stale: trả `WINDOW_CONNECTION_STALE`; không rewrite connection và không phát request cho A.
- Existing A fresh, không có hint: reuse A.
- Hint thuộc window không chứa manifest workspace: trả `WINDOW_CONNECTION_MISMATCH` trước takeover/mutation.

### [CLOSED] P1.2 — Ambiguous-window recovery contract chưa đủ và tự mâu thuẫn

#### Hiện trạng

`WINDOW_SELECTION_REQUIRED` hiện trả `status`, `windows` và `candidates`, nhưng chưa trả recovery metadata đủ để agent biết phải retry tool nào và input nào phải giữ lại.

Official skill cũng chưa mô tả rõ hai retry path:

- Tagged create phải giữ tagged-file ownership evidence và retry `create_artifact` với `connection.selectionToken`.
- Reconnect phải giữ exact artifact handle và retry `inspect_artifact_review` với `intent: "reconnect"` cùng `connection.selectionToken`.

Ngoài ra recovery table hiện hướng dẫn gọi `resolve_artifact_workspace` khi reconnect selection token expired/mismatch, trong khi cùng contract cấm resolver sau create và yêu cầu mọi lifecycle operation dùng exact artifact handle.

#### Tác động

- Agent không có deterministic flow để hoàn tất ambiguous tagged create hoặc ambiguous reconnect.
- Agent có thể resolve workspace lại sau create, vi phạm exact-handle invariant và làm lẫn workspace ownership với UI routing.
- String parsing từ human-readable message trở thành implicit contract.

#### Đề xuất

Không dùng một generic prefix mapper cho mọi selection error. Recovery phải được tạo tại caller context để phân biệt create và reconnect.

`WINDOW_SELECTION_REQUIRED` nên trả tối thiểu:

```ts
type WindowSelectionRequiredRecovery = {
  code: "WINDOW_SELECTION_REQUIRED";
  retryable: true;
  expectedNextTool: "create_artifact" | "inspect_artifact_review";
  lifecycleMutated: false;
  takeoverOccurred: false;
  useSameArtifactHandle: boolean;
  windows: ResolvedWindowGroup[];
  candidates: ResolvedFolderCandidate[];
};
```

Context-specific recovery rules:

| Context                                       | Recovery                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Resolver ownership token expired trước create | Gọi `resolve_artifact_workspace` lại                                                                  |
| Tagged create cần chọn window                 | Retry cùng `create_artifact`, giữ tagged evidence, thêm `connection.selectionToken`                   |
| Tagged-create window token expired            | Retry create không connection token để MCP preflight và issue candidates mới                          |
| Reconnect cần chọn window                     | Retry `inspect_artifact_review` trên exact handle với `intent: "reconnect"` và token đã chọn          |
| Reconnect window token expired                | Retry inspect reconnect trên exact handle, không token, để MCP issue candidates mới                   |
| Reconnect token mismatch                      | Fail trước takeover; retry inspect exact handle theo structured recovery, không resolve workspace mới |

Skill và artifact contract phải thêm:

- `WINDOW_SELECTION_REQUIRED` với hai branch theo `expectedNextTool`.
- `WINDOW_SELECTION_EXPIRED` không mặc định gọi resolver sau khi artifact đã tồn tại.
- `WINDOW_CONNECTION_STALE` và `ARTIFACT_CONNECTION_INVALID` recovery behavior.
- Quy tắc trình bày grouped candidates bằng label ngắn như `Window 1 — focused`; không bắt user đọc UUID.

#### Acceptance tests

- Tagged create ambiguity trả `code: "WINDOW_SELECTION_REQUIRED"`, `expectedNextTool: "create_artifact"`, không tạo artifact directory.
- Reconnect ambiguity trả `expectedNextTool: "inspect_artifact_review"`, `useSameArtifactHandle: true`, không detach active waiter.
- Retry tagged create bằng candidate token thành công và consume token đúng một lần.
- Retry reconnect bằng candidate token thành công và replay bị `WINDOW_SELECTION_EXPIRED`.
- Skill-contract test chứng minh post-create recovery không gọi resolver và mô tả đúng cả hai retry paths.

#### Follow-up contract hardening đã kiểm chứng

- `create_artifact.connection.selectionToken` được mô tả là token từ prior tagged-create `WINDOW_SELECTION_REQUIRED`, không phải resolver token.
- `inspect_artifact_review.connection.selectionToken` được mô tả là token từ prior reconnect `WINDOW_SELECTION_REQUIRED` trên exact artifact handle; không hướng dẫn gọi resolver sau create.
- `ARTIFACT_ALREADY_WAITING` không còn dùng wording “reconnect by waiting”: resume wait giữ in-flight call, pure reconnect dùng inspect without takeover, và takeover chỉ dành cho saved feedback/direct update.
- MCP tool-catalog tests và skill-contract tests khóa các wording này để chống regression.

### [CLOSED] P1.3 — Invalid connection state bị phân loại nhầm thành write failure

#### Hiện trạng

`readArtifactConnection` parse JSON rồi gọi connection schema parser trực tiếp. Schema-invalid JSON có thể ném raw validation error không mang `ARTIFACT_CONNECTION_INVALID`.

Trong reconnect, lỗi đọc existing connection đang có thể bị bỏ qua để re-resolve target. Khi commit đọc lại state invalid, broad catch wrap lỗi thành `ARTIFACT_CONNECTION_WRITE_FAILED`.

#### Tác động

- Malformed/schema-invalid/unsafe persisted state bị coi là lỗi ghi retryable.
- Agent có thể retry inspect vô hạn thay vì dừng với lỗi dữ liệu rõ ràng.
- Error contract không phân biệt state không đáng tin với atomic write failure.

#### Đề xuất

Dùng typed internal errors thay vì nhận dạng message prefix:

```ts
class ArtifactConnectionInvalidError extends Error {}
class ArtifactConnectionWriteError extends Error {}
class WindowConnectionStaleError extends Error {}
class WindowConnectionMismatchError extends Error {}
```

Phân loại:

- Malformed JSON, schema version sai, invalid UUID/revision/timestamp, symlink/unsafe connection path: `ARTIFACT_CONNECTION_INVALID`.
- Temp write, chmod, rename/replace hoặc permission failure sau khi input/current state đã validate: `ARTIFACT_CONNECTION_WRITE_FAILED`.
- `resolveArtifactConnectionTarget` không được catch-and-ignore invalid existing connection; lỗi phải propagate trước takeover.
- Commit không được wrap `ArtifactConnectionInvalidError` thành write failure.
- MCP boundary chuyển typed internal errors sang structured recovery một lần; không duy trì legacy duplicate code như `CONNECTION_WRITE_FAILED`.

#### Acceptance tests

- Malformed JSON reconnect trả `ARTIFACT_CONNECTION_INVALID`.
- Valid JSON với `connectionRevision: 0`, invalid window UUID hoặc unsupported schema trả `ARTIFACT_CONNECTION_INVALID`.
- Linked connection/lock/staging target trả `ARTIFACT_CONNECTION_INVALID`.
- Injected atomic write/rename error trả `ARTIFACT_CONNECTION_WRITE_FAILED`.
- Mọi invalid-state case fail trước takeover và giữ nguyên manifest, Markdown, comments, submission, round, waiter và prior connection bytes.

#### Follow-up hardening đã kiểm chứng

- MCP boundary phân loại connection/window errors bằng typed classes thay vì message-prefix matching; legacy `CONNECTION_WRITE_FAILED` mapper đã bị loại bỏ.
- Broad reconnect commit catch chỉ wrap lỗi ghi không xác định; `ArtifactConnectionInvalidError` và `ArtifactConnectionWriteError` được preserve nguyên loại.
- `ARTIFACT_CONNECTION_INVALID` trả `retryable: false` và không trả `expectedNextTool`; skill dừng automated recovery, giữ exact handle và yêu cầu user repair/remove optional routing file thay vì retry inspect vô hạn.
- Regression test inject invalid state tại commit boundary và chứng minh lỗi vẫn là `ARTIFACT_CONNECTION_INVALID`, không mutate prior connection bytes.
- POSIX permissions (`OWNER_ONLY_FILE_MODE`) được assert trực tiếp cho `.artifact-connection.lock` khi đang giữ lock, và cho `artifact-connection.json` trên cả unit commit test và MCP integration create test.
- Tách test độc lập chứng minh reject riêng biệt cho linked connection file và linked lock file.
- Staging-link rejection đi trực tiếp qua `commitArtifactConnectionRequest` thông qua `testOnlyStagingFileName`:
  - Reject bằng `ArtifactConnectionInvalidError` với message chứa `UNSAFE_ARTIFACT_PATH`.
  - Assert `realpath(stagingLinkPath) === realpath(outside)` và external sentinel không bị mutate.
  - So sánh snapshot `entriesBefore` vs `entriesAfter` để chứng minh không phát sinh staging sibling rác.
  - Bảo toàn nguyên vẹn prior connection bytes, revision và window binding.
- Input validation cho `testOnlyStagingFileName`:
  - Khóa chặt các nhánh: absolute path, path traversal/separator (`../`), tên ngoài transaction pattern `^artifact-connection\.json\.tmp-[A-Za-z0-9_-]+$`, và cấm gọi ngoài test environment (`NODE_ENV === "production"` mà không có `VITEST`).
- Rejection phát sinh tại chính filesystem-operation boundary (`writeConnectionStagingFile` và `renameManagedFileOperation`):
  - Staging được tạo bằng exclusive file handle và giữ `dev/ino` identity; regression test ghi partial bytes rồi inject `EIO`, sau đó chứng minh chỉ đúng owned staging file bị cleanup, prior connection bytes/revision giữ nguyên và lỗi được map thành `ArtifactConnectionWriteError`.
  - Transient rename failure (`EBUSY`) được retry đúng 3 attempts rồi thành công và giải phóng lock.
  - Cạn 5 attempts retry rename (`EBUSY`) ném `ArtifactConnectionWriteError`, dọn dẹp temp file và giải phóng lock.
  - Non-transient rename failure (`EIO`) không retry (đúng 1 attempt) và ném `ArtifactConnectionWriteError`.
  - MCP child-process integration test nhận đúng `ARTIFACT_CONNECTION_WRITE_FAILED` với `retryable: true` từ rename syscall rejection bên trong retry loop.

### [CLOSED] P2.1 — Connection module chưa validate manifest binding của parent artifact

#### Hiện trạng

`readArtifactConnection` và `commitArtifactConnectionRequest` đã validate artifact directory là direct child của global collection, nhưng chưa tự đọc `artifact.json` để chứng minh:

- Directory basename khớp `manifest.artifactId`.
- Manifest là supported schema v5.
- `location.workspaceRoot` được derive từ validated manifest.

Production callers hiện thường load artifact context trước, nhưng shared module chưa tự bảo vệ boundary của chính nó.

#### Đề xuất

Thêm shared helper:

```ts
validateArtifactConnectionParent(
  artifactDirectory,
  rootOptions,
): Promise<{
  artifactId: string;
  artifactDirectory: string;
  workspaceRoot: string;
}>;
```

Helper phải:

1. Validate direct-child global artifact directory và reject linked parent.
2. Safe-read `artifact.json` với bounded transient retry phù hợp atomic lifecycle writes.
3. Parse đúng schema v5.
4. Verify `manifest.artifactId === basename(artifactDirectory)`.
5. Trả `manifest.location.workspaceRoot` làm routing context authoritative.

`readArtifactConnection` và `commitArtifactConnectionRequest` đều dùng helper này. Khi reconnect có `artifactDirectory`, target resolver phải derive workspace root từ validated manifest thay vì tin một workspace root rời do caller truyền.

#### Acceptance tests

- Missing manifest, malformed manifest, unsupported schema và artifact ID mismatch đều bị reject.
- Directory bị move/rename hoặc linked parent bị reject.
- Connection payload vẫn không chứa `artifactId` hoặc `workspaceRoot`.
- Existing connection-less v5 artifact vẫn load và reconnect được.

#### Follow-up hardening đã kiểm chứng

- Mỗi manifest read attempt đều chạy lại managed-path safety validation.
- Transient `ENOENT`/Windows access errors và malformed/partially-written JSON được bounded retry trước khi fail closed thành `ARTIFACT_CONNECTION_INVALID`.
- Regression test mô phỏng manifest tạm missing rồi malformed trước khi read thành công ở attempt kế tiếp.

### [CLOSED] P2.2 — Advertised token expiry khác server authority

#### Hiện trạng

Ambiguous connection candidates đang advertise một expiry duration khác thời gian grant map thực sự chấp nhận token.

#### Tác động

- Agent có thể bỏ một token mà server vẫn coi là valid, hoặc dựa vào metadata không phản ánh authority thực tế.
- Test theo response timestamp và test theo server behavior có thể cho kết quả khác nhau.

#### Đề xuất

- Chuyển `WORKSPACE_SELECTION_TTL_MS` thành shared source of truth.
- Candidate `expiresAt`, grant map, pruning và fake-clock tests đều dùng constant này.
- Khi MCP lưu grant từ một returned candidate, dùng `Date.parse(candidate.expiresAt)` thay vì tính một expiry mới.

#### Acceptance tests

- Candidate `expiresAt` bằng chính grant expiry trong map.
- Token valid ngay trước expiry và fail ngay tại/sau expiry.
- Resolver-issued, tagged-create-issued và reconnect-issued tokens dùng cùng TTL policy.

#### Follow-up hardening đã kiểm chứng

- `resolveArtifactConnectionTarget` chỉ chấp nhận selection grant khi `expiresAt > now`.
- Boundary tests chứng minh token valid ngay trước expiry, và fail đúng tại hoặc sau expiry.

## 5. Implementation sequence

### Step 1 — Shared errors, parent validation và TTL

- Thêm typed connection/window errors.
- Thêm `validateArtifactConnectionParent`.
- Chuyển selection TTL thành shared constant.
- Viết focused unit tests trước hoặc cùng lúc.

### Step 2 — Target resolution precedence

- Áp dụng `selection token -> explicit hint -> existing connection -> registry`.
- Fail typed khi explicit hint stale/mismatch.
- Thêm fresh-A/fresh-B rebind tests.

### Step 3 — Context-aware MCP recovery

- Trả structured `WINDOW_SELECTION_REQUIRED` với correct `expectedNextTool`.
- Tách pre-create selection recovery khỏi post-create reconnect recovery.
- Bảo đảm mọi reconnect preflight fail trước takeover.
- Loại legacy/duplicate error codes sau khi tests đã chuyển sang canonical codes.

### Step 4 — Agent contract synchronization

- Cập nhật skill decision table và artifact contract.
- Mô tả tagged-create retry, reconnect retry và window labels.
- Xóa mọi hướng dẫn resolver-after-create trong reconnect recovery.
- Giữ exact five-tool availability contract.

### Step 5 — Phase-wide regression gate

Chạy:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Ngoài full suite, phải có focused coverage cho:

- Live A -> live B rebind.
- Stale/mismatch hint fail before mutation.
- Ambiguous create/reconnect structured recovery.
- Selection token expiry, concurrent claim và replay.
- Invalid state versus write failure classification.
- Parent manifest binding và connection-less v5 compatibility.
- Wait/advance không update connection.
- Connection operations không đổi artifact Markdown bytes/SHA, comments, submission hoặc review round.

## 6. Phase 1 completion criteria

Phase 1 chỉ hoàn tất khi:

- Tất cả P1 và P2 trong tài liệu này được đóng bằng source và regression tests.
- Explicit live-window rebind hoạt động deterministic.
- Ambiguous create/reconnect có machine-readable retry contract và official skill thực hiện được đúng flow.
- Sau create, recovery luôn giữ exact artifact handle và không resolve workspace ownership lại.
- Invalid connection state không bị phân loại thành retryable write failure.
- Connection helper tự validate global parent và manifest binding.
- Token expiry metadata và server authority dùng một source of truth.
- Tool catalog vẫn đúng năm tools; artifact schema vẫn v5; connection schema vẫn optional và độc lập.
- Full `check/test/build` pass.
- Không claim UI/multi-window `openWith` behavior đã pass; đó là Phase 2 manual/extension gate.

## 7. Rollback boundary

Nếu phase-wide gate fail:

- Rollback đồng bộ shared contracts, MCP producer, skill contract và related tests về baseline trước Phase 1.
- Không giữ một consumer dùng grouped/window contract mới trong khi producer đã rollback, hoặc ngược lại.
- Không xóa `artifact-connection.json` đã được tạo trong test/manual fixtures thuộc user artifact directories; connection file là optional user artifact state và code cũ có thể bỏ qua.
- Không thay đổi hoặc xóa `~/.ai-artifacts/artifacts/` trong rollback/uninstall.
