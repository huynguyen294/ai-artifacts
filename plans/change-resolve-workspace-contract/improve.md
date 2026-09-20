# IDEAS

- AI giữ `windowInstanceId` theo từng `artifactDirectory`, lấy từ kết quả `create_artifact` hoặc `inspect_artifact_review(intent: "reconnect")` thành công.
- Generic reconnect gửi lại ID này làm artifact-window affinity hint; không gửi và không so sánh `connectionRevision`.
- Nếu user nói “mở trong window hiện tại”, bỏ affinity hint để dùng focused resolution. Nếu user chỉ rõ window X, dùng `explicit-window` selection token.
- Khi không có explicit-window intent: `sole fresh window` -> valid artifact affinity -> unique focused window -> user selection.
- Affinity chỉ hợp lệ khi ID của AI trùng `artifact-connection.json.windowInstanceId` và registry còn fresh snapshot của ID đó; window không cần focused.
- Affinity missing, mismatch hoặc stale không phải lỗi: fallback focused resolution rồi trả committed window ID mới để AI thay cache.
- Plain inspect, wait và advance không refresh window affinity.

# ANALYZED

## 1. Kết luận

Thay đổi khả thi nhưng là một thay đổi public MCP/skill behavior, không chỉ là sửa priority trong `window-routing.ts`.

Contract hiện tại là focused-first hoàn toàn: reconnect không nhận raw window ID, không dùng connection cũ làm affinity và chỉ cho explicit selection token override focus. Contract mới thêm một **advisory artifact-window affinity** cho generic reconnect:

- artifact connection hiện tại vẫn là server-side routing state;
- ID AI giữ chỉ là hint, không tự có authority;
- hint chỉ được dùng nếu khớp connection đang lưu và window đó vẫn fresh;
- user intent vẫn có priority cao hơn affinity;
- không dùng `connectionRevision` làm input hoặc concurrency guard.

Không đổi artifact identity, schema-v6 lifecycle, connection schema v1, registry schema v2 hoặc extension watcher protocol.

## 2. Routing priority đã chốt

Explicit user intent được xử lý riêng trước default routing:

```text
User yêu cầu exact window X
  -> validate explicit-window selection token
  -> target exact X
  -> stale/invalid token: fail, không fallback
```

Khi user không yêu cầu một window cụ thể:

```text
0 fresh windows
  -> WINDOW_NOT_FOUND

1 fresh window
  -> chọn sole window ngay

multiple fresh windows
  -> AI ID == stored artifact connection ID
     và ID đó có fresh snapshot
       -> chọn artifact-affinity window, kể cả không focused
  -> affinity missing/mismatch/stale
       -> đúng 1 focused window: chọn focused
       -> 0 hoặc nhiều focused windows: WINDOW_SELECTION_REQUIRED
```

Điều kiện sole window đứng trước affinity. Vì vậy khi chỉ còn một fresh window, MCP chọn nó dù AI đang giữ ID khác hoặc artifact connection đang trỏ window cũ.

Ví dụ affinity thắng focus:

```text
AI giữ ID                  = A
artifact-connection ID     = A
Window A                   = live, not focused
Window B                   = live, focused

Result                     = A
```

Ví dụ affinity bị refresh ngầm:

```text
AI giữ ID                  = A
artifact-connection ID     = B
Window B                   = live, focused

Affinity                   = mismatch
Result                     = B
MCP commit request mới     = B
AI thay cached ID          = B
```

## 3. AI state contract

Skill giữ state tối thiểu theo artifact:

```ts
artifactDirectory -> {
  reviewRound: number;
  windowInstanceId: string;
}
```

Nguồn được phép refresh `windowInstanceId`:

- `create_artifact` thành công: khởi tạo mapping;
- `inspect_artifact_review(intent: "reconnect")` thành công: thay ID cũ bằng committed ID mới.

Không refresh mapping từ:

- `inspect_artifact_review` không có reconnect intent, vì nó chỉ trả persisted connection và không validate window còn live;
- `wait_for_artifact_review`;
- `advance_and_wait_for_artifact`;
- search result trong feature search sau này.

Nếu AI/new chat có exact artifact handle nhưng không có cached window ID, reconnect omit affinity và dùng sole/focused default. Reconnect thành công sẽ khởi tạo lại mapping.

Skill behavior theo user wording:

| User intent | AI input |
|---|---|
| “Mở/reopen artifact” | Gửi cached artifact-window affinity nếu có |
| “Mở trong window hiện tại/đang focus” | Omit affinity để force sole/focused resolution |
| “Mở trong window X” | Resolve/select X và gửi `explicit-window` token |

## 4. Reconnect input contract đề xuất

Giữ create input như hiện tại: create chưa có artifact connection để so affinity, nên optional `connection` của create chỉ nhận explicit-window token.

```ts
type CreateConnectionInput = {
  targetMode: "explicit-window";
  selectionToken: string;
};
```

Riêng `inspect_artifact_review(intent: "reconnect")` nhận discriminated union:

```ts
type ReconnectConnectionInput =
  | {
      targetMode: "artifact-window";
      windowInstanceId: string;
    }
  | {
      targetMode: "explicit-window";
      selectionToken: string;
    };
```

Không nhận:

- raw `windowInstanceId` thiếu `targetMode`;
- đồng thời ID và token;
- `connectionRevision` từ AI;
- affinity input cho non-reconnect inspect.

`artifact-window` là non-authoritative hint. `explicit-window` là user-selected exact target và vì vậy không fallback.

## 5. MCP reconnect flow mục tiêu

Preflight phải hoàn tất trước takeover, round-token grant và connection mutation.

```text
load exact artifact context
  -> read fresh window snapshots
  -> explicit-window?
       yes: claim/validate exact token target
       no:
         -> sole fresh window?
              yes: use sole
              no:
                -> read existing artifact connection
                -> artifact-window hint matches stored ID and is live?
                     yes: use affinity target
                     no: use unique focused target or return candidates
  -> perform requested takeover/inspection work
  -> commit one new connection request
  -> return committed connection metadata
```

Affinity mismatch hoặc stale không surface `WINDOW_CONNECTION_MISMATCH`/`WINDOW_CONNECTION_STALE`; đó là expected refresh path. Chỉ explicit target stale mới phải fail thay vì âm thầm chuyển window.

Kể cả khi target ID không đổi, reconnect vẫn commit:

- `connectionRevision + 1`;
- `openRequestId` mới;
- `source: "inspect"`;
- `updatedAt` mới.

Request mới là cần thiết để extension watcher reopen/reveal artifact.

## 6. Connection revision và concurrency

Không thay đổi schema hoặc revision algorithm trong `src/shared/artifact-connection.ts`.

Current commit behavior tiếp tục là:

```ts
const connectionRevision = existing
  ? existing.connectionRevision + 1
  : 1;
```

Phép tăng chạy dưới artifact-scoped lock, nên concurrent commits được serialize và revision vẫn monotonic. AI không gửi revision và không quyết định revision mới.

Quyết định không so revision có hệ quả rõ ràng:

- affinity validity chỉ dựa trên ID equality + fresh registry presence;
- một reconnect khác có thể commit trong lúc request đang preflight;
- existing lock bảo vệ file integrity/revision nhưng không tạo ownership cho một chat;
- final connection là request commit thành công sau cùng — last-successful-reconnect wins.

Đây là behavior chấp nhận theo contract đã chốt. Không thêm optimistic concurrency failure chỉ vì AI không biết revision mới nhất.

Malformed existing connection vẫn fail closed qua `ARTIFACT_CONNECTION_INVALID`; không reset revision hoặc bỏ qua file hỏng để lấy affinity.

## 7. Tool behavior boundary

### `create_artifact`

- Không có artifact affinity input.
- Default vẫn sole/focused routing.
- Explicit user-selected window vẫn dùng selection token.
- Result hiện đã trả committed `windowInstanceId`; skill dùng ID này để khởi tạo mapping.

### `inspect_artifact_review(intent: "reconnect")`

- Là tool duy nhất dùng artifact affinity sau create.
- Có thể commit sang same ID hoặc refreshed/focused ID.
- Result hiện đã trả committed connection metadata; không cần output field mới.

### Non-reconnect inspect

- Ngoài feature này.
- Không validate live window và không refresh AI affinity cache.
- Không emit open request.

### Wait và advance

- Không resolve, compare hoặc rebind window.
- Không sửa `artifact-connection.json`.

### `resolve_artifact_window`

- Chỉ dùng cho proactive discovery hoặc explicit window selection.
- Không cần đổi tool name/catalog.
- Generic reconnect có valid affinity không cần gọi resolver.

## 8. Ảnh hưởng theo component

### Shared contracts

- `src/shared/contracts.ts`: thêm artifact-window input schema và reconnect connection union; giữ create explicit schema riêng.
- Không đổi `ArtifactConnection`, schema version 1 hoặc `connectionRevision` rules.

### Window routing

- `src/shared/window-routing.ts`: bổ sung reconnect selection logic hoặc helper mới cho priority sole -> affinity -> focused -> ambiguity.
- Không thực hiện rename `selectFocusedWindowTarget` trong scope này theo quyết định của Chú.
- Candidate/token logic cho explicit-window giữ nguyên.

### MCP runtime

- `src/integration/artifact-review-mcp-v4.ts`: parse reconnect union, read current connection cho affinity comparison, validate fresh snapshot và commit chosen target.
- Tách rõ advisory affinity branch khỏi explicit token branch.
- Preserve preflight-before-takeover và existing connection error classification.

### Artifact connection persistence

- `src/shared/artifact-connection.ts`: không đổi persisted schema hoặc revision formula.
- Chỉ cần refactor nếu implementation muốn đặt ID comparison gần/ở trong connection lock; không thêm revision compare.

### Skill và artifact contract

- `skills/create-review-artifact/SKILL.md`: mapping trở thành `artifactDirectory -> reviewRound + last committed window ID`.
- Generic reconnect gửi artifact-window hint; current-window intent omit; named-window intent dùng explicit token.
- Chỉ update cached ID từ create/reconnect success.

### Extension, registry và installer

- Extension watcher/open flow không đổi: vẫn match committed `windowInstanceId` và dedupe `openRequestId`.
- Workspace registry snapshot/publisher không đổi.
- Public tool names và five-tool catalog không đổi; `mcp-config.ts` không cần tool-table change.
- Runtime + bundled skill vẫn phải cutover cùng nhau vì old MCP sẽ reject `targetMode: "artifact-window"`.

### Product docs

Nếu implementation được Chú phê duyệt, current focused-first descriptions trong README, philosophy, architecture, skill contract và changelog phải được cập nhật thành sole -> validated affinity -> focused. Chưa cập nhật docs trong bước phân tích này.

## 9. Automated test matrix cần có

### Routing unit tests

- 0 fresh windows -> not-found.
- 1 fresh window -> chọn sole trước mọi affinity/focus comparison.
- Multiple windows + valid live affinity non-focused + another focused -> chọn affinity.
- Multiple windows + valid affinity + no focused -> chọn affinity.
- Affinity ID khác stored connection -> fallback unique focused.
- Affinity ID trùng stored nhưng snapshot stale/missing -> fallback unique focused.
- Invalid affinity + focus ambiguous -> selection-required.
- Không có affinity -> giữ current focused behavior.
- Explicit token target luôn override affinity/default selection.

### MCP integration tests

- Create result trả ID và connection revision 1.
- Generic reconnect gửi artifact-window ID hợp lệ và commit same ID với revision/open-request mới.
- Mismatch/stale hint refresh ngầm sang focused ID rồi trả ID mới.
- Sole-window reconnect bỏ qua stale/mismatch hint.
- Same-ID reconnect vẫn emit request mới.
- Không có `connectionRevision` trong artifact-window input schema.
- Artifact-window input bị reject trên create hoặc non-reconnect inspect.
- Malformed stored connection fail closed trước takeover/commit.
- Concurrent commits giữ revision monotonic và final state theo last successful commit.
- Plain inspect, wait và advance không thay connection file.

### Skill contract tests

- Skill giữ per-artifact window ID từ create/reconnect result.
- Generic reconnect gửi artifact-window mode.
- “Window hiện tại” omit affinity.
- Named non-focused window dùng explicit token.
- Plain inspect result không refresh cached window ID.
- Không có instruction gửi hoặc so `connectionRevision`.

## 10. Compatibility và rollout

Behavior mới không đổi tool count hoặc persisted schemas, nhưng thêm một reconnect input variant mà MCP hiện tại không hiểu. Vì vậy source runtime, bundled skill, skill contract và tests phải thay cùng một release candidate.

- Old skill + new MCP vẫn hoạt động theo focused fallback vì old skill omit affinity.
- New skill + old MCP sẽ nhận `INVALID_ARTIFACT_INPUT` cho `targetMode: "artifact-window"`.
- Installer phải deploy runtime và skill cùng nhau; AI client cần restart/new chat để tránh cached tool schema.
- Nếu MCP 9.0.0 hiện chưa release, có thể fold behavior vào cùng candidate. Nếu đã được deploy như contract ổn định, cần bump server version theo release policy.

## 11. Out of scope

- So sánh hoặc gửi `connectionRevision` từ AI.
- Dùng plain inspect để refresh window affinity.
- Đổi tên `selectFocusedWindowTarget`.
- Thay đổi explicit selection-token lifecycle.
- Editor-open acknowledgement.
- Search artifact, retention cleanup hoặc artifact schema changes.

# IMPLEMENTATION PLAN

## 1. Mục tiêu và chiến lược delivery

Triển khai artifact-window affinity cho `inspect_artifact_review(intent: "reconnect")` mà không thay đổi artifact identity, persisted schemas, extension watcher protocol hoặc lifecycle của wait/advance.

Thực hiện theo **4 work units nhưng phát hành như một atomic release**. Các unit trung gian phục vụ review và verification, không deploy riêng vì skill mới gửi `targetMode: "artifact-window"` mà runtime cũ không hiểu.

Thứ tự dependency:

```text
Shared input contracts + pure routing selector
  -> MCP reconnect preflight + tool schema
  -> skill/contract/product docs
  -> full build, package, installed-host manual validation
```

Các quyết định đã khóa cho toàn bộ implementation:

- explicit user-selected window có priority cao nhất và không fallback;
- default routing là `sole fresh window -> valid artifact affinity -> unique focused -> selection required`;
- affinity hợp lệ khi AI ID bằng persisted connection ID và ID đó có fresh snapshot;
- affinity missing/mismatch/stale là refresh path, không phải error;
- không nhận, gửi hoặc so sánh `connectionRevision` để quyết định affinity;
- reconnect thành công luôn commit request mới, kể cả target ID không đổi;
- last-successful-reconnect wins khi có concurrent reconnect;
- plain inspect, wait và advance không resolve hoặc rebind window;
- editor-open acknowledgement, search, cleanup và schema migration ngoài scope.

## 2. Pre-implementation baseline

### 2.1. Xác nhận working tree và version state

- Ghi nhận `git status --short`; không ghi đè thay đổi không liên quan hoặc các plan untracked của user.
- Xác nhận `package.json` version, `SERVER_VERSION`, tool count và trạng thái release của candidate hiện tại.
- Nếu extension `1.0.0`/MCP `9.0.0` chưa phát hành, fold feature vào candidate đó.
- Nếu contract này đã được phát hành, bump phiên bản theo release policy trước packaging; cập nhật đồng bộ source, assertions và docs có version cố định.

### 2.2. Chạy baseline trước khi sửa

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Nếu baseline fail:

- ghi nhận chính xác test/command đang fail;
- phân biệt lỗi có sẵn với regression của feature;
- không mở rộng scope để sửa lỗi không liên quan nếu chưa được Chú phê duyệt.

Baseline gate:

- source hiện tại build được hoặc mọi failure có sẵn đã được ghi nhận;
- tool catalog vẫn có đúng 5 tools;
- create/reconnect focused-first hiện tại có test evidence để so behavior trước/sau.

## 3. Work Unit 1 — Shared contracts và deterministic routing

### 3.1. Shared input contracts

File chính:

- `src/shared/contracts.ts`

Thay đổi:

1. Giữ nguyên `explicitWindowConnectionInputSchema` cho create và explicit target.
2. Thêm strict schema cho affinity input:

   ```ts
   const artifactWindowConnectionInputSchema = z.object({
     targetMode: z.literal("artifact-window"),
     windowInstanceId: z.string().uuid(),
   }).strict();
   ```

3. Thêm `reconnectConnectionInputSchema` là discriminated union giữa:
   - `artifact-window` + `windowInstanceId`;
   - `explicit-window` + `selectionToken`.
4. Export corresponding inferred types để MCP runtime không tự định nghĩa schema/type lần hai.
5. Không thêm `connectionRevision`; strict schema phải reject field thừa, input có cả ID và token, raw ID thiếu `targetMode`, UUID sai và target mode lạ.
6. Không thay đổi `ArtifactConnection`, `ARTIFACT_CONNECTION_SCHEMA_VERSION` hoặc error contracts không liên quan.

### 3.2. Pure reconnect selector

File chính:

- `src/shared/window-routing.ts`

Thêm một pure helper dành riêng cho default reconnect routing; không rename `selectFocusedWindowTarget` trong scope này. Helper nhận:

- danh sách fresh snapshots đã được registry reader lọc;
- optional AI affinity `windowInstanceId`;
- optional persisted artifact connection `windowInstanceId`.

Helper trả result union tương thích với các trạng thái hiện có:

- `matched` với reason `sole-live`, `artifact-affinity` hoặc `focused`;
- `selection-required` với candidates/reason hiện hành;
- `not-found`.

Thuật toán bắt buộc:

```text
snapshots.length == 0
  -> not-found

snapshots.length == 1
  -> sole-live

multiple snapshots
  -> affinity ID tồn tại
     và affinity ID == persisted connection ID
     và snapshot cùng ID tồn tại
       -> artifact-affinity
  -> ngược lại delegate/reuse focused selector hiện tại
```

Ràng buộc:

- helper không đọc filesystem, không mint/claim token và không commit connection;
- persisted ID chỉ dùng để chứng minh AI hint vẫn khớp server state;
- snapshot `focused` không ảnh hưởng một valid affinity match;
- missing persisted connection làm affinity invalid và fallback, không throw;
- malformed connection không được đưa vào helper; MCP preflight phải fail khi đọc file đó.

### 3.3. Unit tests

Files dự kiến:

- `test/window-routing.test.ts`
- test contract phù hợp hiện có, hoặc bổ sung assertions tại `test/review-wait-mcp.test.ts` nếu input schema chỉ được expose ở MCP boundary.

Cases bắt buộc:

- 0 snapshot -> `not-found`;
- 1 snapshot focused/unfocused -> luôn `sole-live`, bỏ qua stale/mismatch affinity;
- multiple + valid affinity non-focused + unique focused khác -> affinity thắng;
- multiple + valid affinity + không focused -> affinity thắng;
- AI affinity thiếu -> focused fallback;
- persisted connection thiếu -> focused fallback;
- AI ID khác persisted ID -> focused fallback;
- ID khớp persisted nhưng snapshot không còn fresh -> focused fallback;
- fallback có 0 hoặc nhiều focused -> selection required;
- artifact input schema accept valid UUID;
- schema reject unknown fields, revision, mixed ID/token và invalid UUID;
- existing `selectFocusedWindowTarget` và explicit token tests vẫn pass.

Completion gate:

- selector có deterministic result cho toàn bộ matrix;
- create routing chưa đổi;
- chưa có filesystem mutation mới;
- focused tests và TypeScript check pass.

Rollback gate:

- có thể revert toàn bộ Unit 1 mà không đụng persisted artifacts vì chưa đổi schema hoặc data.

## 4. Work Unit 2 — MCP reconnect runtime và public tool schema

### 4.1. Parse reconnect input theo intent

File chính:

- `src/integration/artifact-review-mcp-v4.ts`

Thay đổi:

1. Create tiếp tục parse duy nhất `explicitWindowConnectionInputSchema`; `artifact-window` trên create phải bị reject.
2. Với `intent: "reconnect"`, parse `connection` bằng `reconnectConnectionInputSchema`.
3. `artifact-window` trên non-reconnect inspect phải bị reject trước takeover, token grant hoặc mutation.
4. Không mở rộng scope bằng cách thay đổi behavior legacy của explicit-window input trên non-reconnect inspect nếu không cần cho feature.
5. Tách rõ ba input paths:
   - explicit-window;
   - artifact-window affinity;
   - omitted connection/default routing.

### 4.2. Reconnect preflight

Giữ preflight trước takeover và lifecycle mutation. Trình tự mục tiêu:

```text
load and validate exact artifact context
  -> validate expectedReviewRound
  -> read fresh window snapshots
  -> read/validate current artifact connection with allowMissing=true
  -> choose explicit or default reconnect target
  -> only then continue takeover/inspection/token work
```

Connection phải được đọc trong preflight kể cả khi chỉ có một fresh window. Mục đích là phát hiện malformed `artifact-connection.json` trước takeover; routing vẫn **sử dụng sole window trước affinity**.

Explicit path:

- claim token;
- tìm exact target trong fresh snapshots;
- nếu target không còn live: release claim và trả `WINDOW_SELECTION_EXPIRED`;
- consume token theo lifecycle hiện tại khi target hợp lệ;
- không fallback sang sole/focused/affinity.

Default/affinity path:

- gọi pure reconnect selector bằng fresh snapshots, AI hint nếu có và persisted connection ID nếu có;
- matched -> giữ chosen `windowInstanceId` cho commit;
- selection-required -> build candidates/token và trả `WINDOW_SELECTION_REQUIRED` với `expectedNextTool: inspect_artifact_review`, `useSameArtifactHandle: true`;
- not-found -> `WINDOW_NOT_FOUND`;
- mismatch hoặc stale affinity không emit `WINDOW_CONNECTION_MISMATCH`/`WINDOW_CONNECTION_STALE`.

### 4.3. Commit semantics

Giữ nguyên `commitArtifactConnectionRequest` và artifact-scoped lock:

- commit `source: "inspect"`;
- server tự tính `connectionRevision + 1`;
- tạo `openRequestId` mới;
- giữ schema v1;
- return committed connection metadata trong inspect result.

Không chuyển affinity comparison thành revision compare. Nếu persisted connection đổi giữa preflight và commit, request commit sau cùng vẫn thắng; lock chỉ bảo vệ integrity và monotonic revision.

Không thay đổi:

- `src/shared/artifact-connection.ts`, trừ refactor nội bộ thật sự cần thiết và behavior-preserving;
- wait/advance connection behavior;
- artifact Markdown, comments, submission, round hoặc round-token semantics;
- extension watcher/open coordinator.

### 4.4. Public MCP schema và instructions

Trong tool declaration của `inspect_artifact_review`:

- đổi `connection` schema thành `oneOf`/equivalent cho hai target modes;
- mô tả rõ `artifact-window` là advisory reconnect hint;
- mô tả `explicit-window` là exact user-selected target;
- không expose `connectionRevision` trong input;
- giữ create tool schema chỉ có explicit-window;
- cập nhật server instructions từ focused-only thành sole/validated-affinity/focused behavior;
- giữ đúng 5 public tools.

### 4.5. MCP integration tests

File chính:

- `test/review-wait-mcp.test.ts`

Cases bắt buộc:

1. Create default vẫn chọn sole/focused và trả connection revision 1.
2. Reconnect không affinity giữ backward-compatible sole/focused behavior.
3. Valid affinity tới non-focused window thắng một focused window khác.
4. Same-ID reconnect vẫn tăng revision đúng một lần và tạo `openRequestId` mới.
5. AI ID khác persisted ID -> silently route sang unique focused window, commit và trả ID mới.
6. Matching ID nhưng snapshot stale/missing -> silently route sang focused window.
7. Sole window thắng stale/mismatch hint.
8. Invalid affinity + ambiguous focus -> `WINDOW_SELECTION_REQUIRED`; không thay đổi lifecycle/connection bytes.
9. Explicit selection token thắng affinity/default routing.
10. Explicit token stale -> fail, không fallback.
11. Missing connection file + affinity hint -> fallback; successful reconnect tạo revision 1.
12. Malformed connection -> `ARTIFACT_CONNECTION_INVALID` trước takeover và không sửa file.
13. `artifact-window` bị reject trên create và non-reconnect inspect.
14. Tool JSON schema chứa hai reconnect variants nhưng create chỉ chứa explicit variant.
15. Wait, advance và plain inspect giữ nguyên connection bytes.
16. Concurrent reconnect commits tạo monotonic revisions; final file phản ánh request commit sau cùng.

Failure assertions phải kiểm tra cả:

- error code/recovery metadata;
- exact artifact handle được giữ;
- không tạo extra open request khi preflight fail;
- waiter/round state không bị takeover hoặc mutate ngoài ý muốn.

Completion gate:

- targeted MCP tests pass;
- no-affinity clients vẫn hoạt động;
- reconnect result luôn trả committed target ID khi commit thành công;
- persistence schema/revision algorithm không đổi;
- diff không chạm extension/webview ngoài test regression thật sự cần thiết.

Rollback gate:

- revert runtime + shared contract cùng nhau;
- giữ nguyên mọi `artifact-connection.json` đã tạo vì format không đổi và runtime cũ vẫn đọc được.

## 5. Work Unit 3 — Agent skill, contract và product documentation

### 5.1. Skill state và intent mapping

Files:

- `skills/create-review-artifact/SKILL.md`
- `skills/create-review-artifact/references/artifact-contract.md`

Cập nhật state instruction thành:

```text
artifactDirectory -> {
  reviewRound,
  windowInstanceId
}
```

Đây là chat/agent working state, không phải persisted database mới.

Behavior phải ghi rõ:

- sau create success: cache committed `windowInstanceId` cho exact handle;
- generic “open/reconnect artifact”: gửi cached ID bằng `targetMode: "artifact-window"` nếu có;
- “open trong window hiện tại/đang focus”: omit connection affinity;
- “open trong window X”: resolve/select X và gửi explicit selection token;
- sau reconnect success: thay cached ID bằng committed ID trả về;
- nếu không có cached ID: omit affinity và dùng server default;
- plain inspect/wait/advance/search result không refresh cached ID;
- không gửi hoặc so sánh `connectionRevision`;
- `WINDOW_SELECTION_REQUIRED` vẫn trình bày candidate labels thay vì raw UUIDs.

Đồng bộ recovery table:

- affinity mismatch/stale là server-side fallback bình thường;
- explicit token stale vẫn yêu cầu resolve/retry;
- malformed connection vẫn fail closed và skill không tự sửa lifecycle file;
- giữ exact artifact handle qua mọi retry.

### 5.2. Product/architecture docs

Files cần review và cập nhật nơi thực sự mô tả focused-first reconnect:

- `README.md`
- `docs/INSTRUCTION.md`
- `docs/PHILOSOPHY.md`
- `docs/ARCHITECTURE.md`
- `docs/CHANGE_LOGS.md`
- `CHANGELOG.md`

Nội dung phải thống nhất:

- create default vẫn focused/sole, không có artifact affinity;
- generic reconnect dùng sole -> validated artifact affinity -> focused;
- user-selected explicit window vẫn exact và fail-closed;
- `connectionRevision` chỉ phục vụ ordering/diagnostics, không phải AI concurrency token;
- five-tool catalog và persisted schemas không đổi;
- runtime/skill cần reinstall + AI client restart khi cutover;
- chưa có editor-open acknowledgement.

Không cập nhật:

- `mcp-config.ts` tool table vì tool names/count không đổi;
- generated `dist/`, installed global runtime hoặc VSIX bằng chỉnh tay;
- search/cleanup plans ngoài cross-reference tối thiểu cần thiết.

### 5.3. Contract tests

Files dự kiến:

- `test/skill-contract.test.ts`
- `test/artifact-link-contract.test.ts`
- `test/release-contract.test.ts`
- `test/workspace-integration.test.ts` nếu packaged skill synchronization assertions bị ảnh hưởng.

Assertions bắt buộc:

- skill yêu cầu giữ per-artifact window ID;
- generic reconnect gửi artifact-window hint khi có cache;
- current-window wording omits affinity;
- named-window wording dùng explicit token;
- only create/reconnect success refreshes cache;
- skill không hướng dẫn gửi `connectionRevision`;
- docs không còn claim reconnect luôn focused-first;
- create behavior không bị mô tả nhầm thành affinity-based;
- release contract vẫn xác nhận đúng 5 tools và matching runtime/skill.

Completion gate:

- runtime schema, MCP descriptions, skill và reference contract dùng cùng field names và priority;
- không còn contradictory focused-only reconnect guidance;
- docs changelog ghi rõ behavioral change và compatibility action;
- skill/install tests pass.

Rollback gate:

- rollback runtime bắt buộc rollback bundled skill/docs contract cùng version;
- không rollback bằng cách chỉ thay skill hoặc chỉ thay MCP.

## 6. Work Unit 4 — Validation, packaging và installed-host evidence

### 6.1. Focused automated validation

Chạy trước các suite gần thay đổi:

```powershell
npm.cmd exec -- vitest run test/window-routing.test.ts test/review-wait-mcp.test.ts test/skill-contract.test.ts test/artifact-link-contract.test.ts test/release-contract.test.ts
```

Nếu integration build cần được refresh trước test, dùng script chính thức thay vì chỉnh `dist/` trực tiếp.

### 6.2. Full repository gate

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Yêu cầu:

- zero TypeScript errors;
- full test suite pass, hoặc skipped tests được giải thích và không thuộc feature path;
- integration bundle build thành công;
- không có generated/runtime artifact ngoài output dự kiến;
- review `git diff --check` và scoped diff trước package.

### 6.3. Package and integration cutover

Chỉ package sau khi automated gates pass:

```powershell
npm.cmd run package
```

Inspect package:

- bundled MCP chứa reconnect union mới;
- bundled skill chứa artifact affinity workflow mới;
- exactly five tools;
- package/version metadata đúng quyết định release;
- không đóng gói `.env`, artifact data, workspace snapshots hoặc plan files ngoài ý muốn.

Installed cutover:

1. Cài VSIX candidate.
2. Chạy integration installer chính thức; không chỉnh runtime global trực tiếp.
3. Verify installed runtime và installed skill cùng version/content.
4. Restart VS Code extension hosts khi cần.
5. Restart AI client và bắt đầu fresh chat để bỏ cached old tool schema.

### 6.4. Manual multi-window matrix

Ghi evidence cho từng case: window labels/IDs, focused state trước call, input mode, returned ID/revision/openRequestId, window thực sự mở editor và error nếu có.

| Case | Setup | Action | Expected |
|---|---|---|---|
| M1 | Một fresh window | Generic reconnect với/không hint | Sole window được chọn; result trả ID đó |
| M2 | A non-focused, B focused; artifact + AI cache đều A | Generic reconnect | A mở artifact; affinity thắng focus |
| M3 | Artifact connection B, AI cache A, B focused | Generic reconnect | Affinity mismatch; B được chọn và AI nhận ID B |
| M4 | AI/stored ID A nhưng A đã đóng; B focused | Generic reconnect | Stale affinity fallback B, không trả stale error |
| M5 | Multiple windows, không/multiple focused, affinity invalid | Generic reconnect | `WINDOW_SELECTION_REQUIRED`, chưa commit |
| M6 | A affinity-valid, B focused | User nói “window hiện tại” và skill omit hint | B được chọn |
| M7 | A non-focused được user chỉ rõ | Resolve A rồi explicit reconnect | A được chọn; focus không override |
| M8 | Explicit token target bị đóng trước retry | Retry explicit reconnect | `WINDOW_SELECTION_EXPIRED`, không fallback/commit |
| M9 | VS Code reload tạo ID mới | Generic reconnect với ID cũ | Old ID stale; sole/focused window mới được commit và trả về |
| M10 | Reconnect hai lần cùng target | Generic reconnect liên tiếp | Mỗi lần revision +1 và openRequestId mới; editor reveal/reopen event chạy |
| M11 | Hai reconnect cạnh tranh tới hai windows | Gửi gần đồng thời | Không corrupt file; revisions monotonic; last successful commit là final target |
| M12 | `autoOpenArtifactReview=false` | Reconnect | MCP vẫn commit đúng; editor không auto-open theo setting |

Manual evidence phải phân biệt:

- **connection commit success** từ MCP result/file;
- **watcher nhận request**;
- **editor thực sự open/reveal**.

Do acknowledgement ngoài scope, không diễn giải MCP success thành bảo đảm `openWith` đã hoàn tất.

### 6.5. Release completion gate

Feature chỉ được coi là hoàn tất khi:

- shared schema và routing matrix pass;
- MCP integration tests pass toàn bộ success/failure/no-mutation cases;
- skill và runtime được package đồng bộ;
- docs không còn contract mâu thuẫn;
- full check/test/build pass;
- M1-M10 pass trên installed VS Code host;
- M11 xác nhận concurrency semantics hoặc được ghi rõ là known operational limitation với approval;
- M12 xác nhận setting boundary;
- không có regression ở create, wait, advance, watcher dedupe hoặc manual open command.

## 7. Rollback strategy

Nếu automated hoặc installed-host gate fail:

1. Dừng release; không tiếp tục deploy skill mới với runtime cũ hoặc ngược lại.
2. Thu thập exact artifact handle, connection file, registry snapshots, MCP error/result và extension logs cho case fail.
3. Revert source contract, runtime, bundled skill và docs như một unit.
4. Rebuild/package lại matching prior version.
5. Reinstall prior runtime + skill bằng installer chính thức và restart AI client.
6. Giữ nguyên user artifacts và `artifact-connection.json`; schema không đổi nên rollback không cần migration hoặc xóa dữ liệu.

Không rollback bằng cách:

- xóa global artifact collection;
- reset `connectionRevision`;
- sửa installed MCP/skill thủ công;
- làm yếu path validation, token validation hoặc malformed-connection failure.

## 8. Explicit non-goals khi triển khai

- Không thêm editor-open ack/timeout protocol.
- Không persist AI affinity mapping ở extension hoặc MCP.
- Không dùng search result để tự thiết lập affinity.
- Không đổi `resolve_artifact_window` thành workspace resolver.
- Không đổi tên `selectFocusedWindowTarget`.
- Không xóa legacy error classes chỉ vì generic affinity không còn emit mismatch/stale.
- Không thay artifact schema v6, connection schema v1 hoặc registry schema v2.
- Không thay đổi retention, cleanup hoặc artifact search.
