# Implementation plan: window-routed artifact connection without a new MCP tool

# Phần I — Phân tích và quyết định kiến trúc

## 1. Mục tiêu

Mở Artifact Review đúng VS Code window đã được chọn khi tạo hoặc reconnect artifact, kể cả khi window đó không còn focus tại thời điểm `vscode.openWith` chạy.

Thay đổi phải mở rộng hành vi hiện tại, không làm AI yếu hơn:

- Vẫn giữ đúng năm MCP tools công khai: `resolve_artifact_workspace`, `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, và `advance_and_wait_for_artifact`.
- Không thêm `open_artifact`, `connect_artifact` hay tool công khai tương đương.
- AI vẫn được tự chọn một workspace khi lời người dùng và resolver metadata tạo ra một candidate mạnh nhất duy nhất.
- Nhiều window hoặc nhiều folder không tự động buộc phải hỏi người dùng. Chỉ hỏi khi còn từ hai cặp `window + folder` hợp lý ngang nhau.
- Việc mở editor là side effect nội bộ của `create_artifact` và `inspect_artifact_review`, thông qua shared internal connection helpers.
- `location.workspaceRoot` tiếp tục là workspace ownership/context. `windowInstanceId` là UI routing state tạm thời và được lưu riêng trong `artifact-connection.json`.

## 2. Ngoài phạm vi

- Không thêm deep link hoặc URI handler.
- Không cho MCP gọi trực tiếp VS Code API.
- Không thay đổi Markdown, comments, submission, review-round hoặc round-token semantics.
- Không biến window binding thành ownership của AI hay waiter.
- Không thêm lịch sử connection lâu dài. Connection hợp lệ cuối cùng thắng.
- Không mở rộng support matrix sang Remote SSH, WSL, container, Codespaces hoặc split-host filesystem trong thay đổi này.
- Không thay đổi schema artifact v5 nếu connection file có schema độc lập và optional đối với artifact v5 hiện có.

## 3. Hiện trạng và khoảng trống

- Mỗi extension window đã publish một workspace snapshot có `instanceId`, `focused`, workspace folders, active file và TTL.
- Resolver hiện chọn một workspace scope, deduplicate folders xuyên các snapshots trong scope, rồi trả một danh sách folder phẳng. Quá trình này làm mất quan hệ `folder -> window instance`.
- `create_artifact` hiện chấp nhận tagged-file evidence hoặc một resolver selection token, nhưng selection grant chưa bind `windowInstanceId`.
- Auto-open hiện watch lúc `comments.json` được tạo và chỉ mở trong window đang focus.
- Reconnect/inspect có thể nối lại lifecycle nhưng không có MCP-to-extension request channel để mở lại UI.
- MCP không thể gọi `vscode.openWith` trong một window cụ thể. Mỗi extension window phải nhận cùng một filesystem event, tự so sánh target ID với local `instanceId`, và chỉ window khớp mới gọi `openWith`.

## 4. Quyết định kiến trúc

### 4.1. Resolver trả dữ liệu grouped by window

Không flatten hoặc deduplicate workspace folders xuyên window. `resolve_artifact_workspace` trả các fresh snapshots dưới dạng nhóm:

```ts
type ResolvedWindowGroup = {
  windowInstanceId: string;
  focused: boolean;
  snapshotUpdatedAt: string;
  workspaceFile: string | null;
  activeFile: {
    path: string;
    workspaceRoot: string;
  } | null;
  folders: Array<{
    candidateId: string;
    name: string;
    path: string;
    match: "exact-path" | "exact-name" | "similar-name" | "single-folder" | "available";
    selectionToken: string;
    expiresAt: string;
  }>;
};
```

Response giữ `status` và `matchMode` nếu còn hữu ích, nhưng `windows[]` là cấu trúc authoritative. Mỗi candidate đại diện cho đúng một tuple:

```text
windowInstanceId + canonical workspaceRoot
```

Hai window cùng mở một folder phải tạo hai candidates khác nhau. `candidateId` và selection grant phải gồm cả window ID; không tiếp tục hash chỉ workspace path.

Không trả `processId` cho AI. Đây là implementation detail của registry, không giúp người dùng lựa chọn.

### 4.2. Ý nghĩa của `focused`

`focused` là snapshot hint tại thời điểm registry refresh gần nhất:

- Không chứng minh AI caller đang ở window đó.
- Không ghi đè exact path/name hoặc tagged evidence từ lời người dùng.
- Có thể làm tie-breaker khi người dùng nói “window này”, “window hiện tại”, hoặc “window đang focus”.
- Sau khi user/AI đã chọn explicit một candidate, selection vẫn hợp lệ nếu window mất focus. MCP chỉ yêu cầu instance còn fresh và vẫn chứa workspace đã chọn.

Skill phải trình bày window bằng label ngắn trong lượt hiện tại, ví dụ `Window 1 — đang focus`; không bắt người dùng đọc UUID. Label không được persist hoặc dùng để validate. `selectionToken` mới là capability authoritative.

### 4.3. AI giữ nguyên quyền lựa chọn hiện tại

AI xem mỗi `window + folder` là một candidate và chọn candidate mạnh nhất dựa trên:

1. Tagged folder exact match kết hợp tagged-file containment.
2. Exact absolute workspace path trong lời người dùng.
3. Tagged file chỉ nằm trong một registered workspace candidate.
4. Exact workspace name duy nhất.
5. Active file trùng tagged file hoặc active workspace trùng target.
6. Fresh connection hiện tại khi reconnect.
7. `focused` khi phù hợp với wording của người dùng.
8. Similar-name hoặc semantic match duy nhất.

Nhiều window tự nó không phải ambiguity. AI chỉ hỏi khi hai hoặc nhiều candidates vẫn ngang nhau sau khi áp dụng toàn bộ user input và resolver metadata.

Ví dụ:

- Window A có `agent-plus`, Window B có `script-runner`, user nói `agent-plus`: tự chọn A.
- Window A và B cùng có `agent-plus`, user nói `window đang focus`: chọn group có `focused: true` nếu duy nhất.
- Window A và B cùng có `agent-plus`, không có thêm tín hiệu: hỏi user chọn A/B hoặc yêu cầu focus window mong muốn rồi resolve lại.
- Hai window mỗi window có một folder khác nhau: exact name/path vẫn đủ để AI tự chọn.

### 4.4. Tagged path không làm AI yếu hơn

Giữ tagged-file creation evidence hiện tại. AI nhận concrete path từ user tag/attachment, còn MCP là thành phần xác minh:

- Requested workspace là một fresh registered root.
- Tagged file tồn tại, là file thật, và canonical path nằm trong root.
- Window candidate còn fresh và chứa root đó.

Khi folder và file đều được tag, AI dùng tagged folder làm `workspaceRoot` claim và tagged file làm ownership evidence. Nếu tuple `window + folder` là duy nhất, internal preflight tự bind mà không hỏi user.

Folder tag chưa cần trở thành evidence kind mới nếu đã có tagged file nằm trong folder. Nếu sau này cần hỗ trợ folder-only evidence, thực hiện bằng một contract riêng; không nới `tagged-file` để chấp nhận directory ngầm.

Nếu tagged file/root xuất hiện trong nhiều windows:

- Dùng active-file, focused metadata và lời người dùng để tìm unique strongest candidate.
- Nếu vẫn hòa, fail trước artifact mutation và trả grouped candidates/selection tokens để skill hỏi user rồi retry.

### 4.5. Selection grants bind cả workspace và window

Mỗi resolver grant phải lưu:

```ts
type WorkspaceWindowSelectionGrant = {
  query: string;
  candidateId: string;
  workspaceRoot: string;
  windowInstanceId: string;
  snapshotIdentity: string;
  expiresAt: number;
};
```

Grant vẫn là in-memory, expiring và single-use. Trước khi consume, MCP revalidate đúng `windowInstanceId` còn fresh và snapshot đó vẫn chứa canonical workspace root. Focus thay đổi không làm token stale; window reload/close hoặc folder removal làm token stale.

Selection token có thể được consume bởi create binding hoặc reconnect binding. Replay, mismatch hoặc stale snapshot fail trước lifecycle mutation.

### 4.6. Connection file là routing state độc lập

Thêm optional file trong artifact directory:

```text
~/.ai-artifacts/artifacts/<artifact-id>/artifact-connection.json
```

Schema riêng:

```ts
type ArtifactConnection = {
  schemaVersion: 1;
  windowInstanceId: string;
  connectionRevision: number;
  openRequestId: string;
  source: "create" | "inspect";
  updatedAt: string;
};
```

Quy tắc:

- File phải được ghi atomically, canonical-path/symlink safe và `0600` trên POSIX.
- Connection file không lưu `artifactId` hoặc `workspaceRoot`. Artifact directory và validated `artifact.json` là source of truth cho artifact identity và `location.workspaceRoot`; connection payload không được quyền override hai giá trị đó.
- `openRequestId` luôn là UUID mới cho mỗi yêu cầu mở được commit thành công, kể cả target window không đổi. Extension dùng field này để deduplicate filesystem events.
- `connectionRevision` là positive safe integer: bắt đầu từ `1` khi connection chưa tồn tại và tăng đúng một đơn vị cho mỗi create/reconnect connection request được commit thành công.
- Revision read-modify-write chạy dưới một artifact-scoped connection lock. Validation ambiguity, preflight failure hoặc failed atomic write không được làm thay đổi persisted revision; malformed existing connection không được âm thầm reset về `1`.
- Revision biểu diễn thứ tự request và hiện chỉ dùng cho validation, diagnostics và tests. Extension không dùng revision thay `openRequestId`, không từ chối một request hợp lệ chỉ vì chưa có persistent processed-revision cursor.
- Concurrent reconnect hợp lệ được serialize bởi connection lock; request commit hợp lệ cuối cùng là state còn lại trong file.
- Connection file không tham gia artifact Markdown/comments/submission hashes hoặc round-token binding.
- Advance review không xóa hoặc rewrite connection file.
- Artifact v5 cũ không có connection file vẫn đọc/inspect được; lần create mới hoặc explicit reconnect phù hợp sẽ tạo file.
- Uninstall phải giữ connection file cùng toàn bộ user artifact directory.

Không lưu connection history và không coi file này là quyền sở hữu. Bất kỳ AI nào có exact artifact handle và valid workspace/window evidence đều có thể rebind.

### 4.7. Internal helpers, không phải MCP tools

Thêm internal module/shared functions, ví dụ:

```ts
resolveArtifactConnectionTarget(...)
validateArtifactConnectionTarget(...)
commitArtifactConnectionRequest(...)
```

Các hàm này không xuất hiện trong MCP `tools/list`, client allowlist hoặc skill availability check.

`resolveArtifactConnectionTarget` chạy preflight:

- Nhận manifest workspace, tagged evidence, selection token, retained window hint hoặc existing connection tùy caller.
- Trả một fresh validated `windowInstanceId`, hoặc grouped selection-required result.
- Không mutate lifecycle hoặc connection state.

`commitArtifactConnectionRequest` chạy post-success:

- Revalidate safe artifact handle và manifest binding.
- Atomically create/update `artifact-connection.json`.
- Dưới connection lock, đọc revision hiện tại, tăng đúng một lần và sinh `openRequestId` mới cho successful commit.
- Không gọi VS Code API và không chờ UI acknowledgement.

## 5. Tích hợp vào các MCP tools hiện có

### 5.1. `resolve_artifact_workspace`

Mở rộng response, không thêm tool mới:

- Đọc tất cả fresh window snapshots.
- Giữ từng window group riêng; không chọn focused scope trước và không deduplicate xuyên window.
- Rank folders bên trong toàn bộ tuples bằng exact path/name/similar/single-folder/available.
- Issue selection token cho từng tuple.
- Trả `focused`, active-file và snapshot timestamp để AI có thêm bằng chứng.
- `not-found` chỉ khi không có fresh registered folder phù hợp để hiển thị.

Current `WORKSPACE_CONTEXT_AMBIGUOUS` không còn được dùng chỉ vì có nhiều window. Ambiguity trở thành quyết định ở skill layer sau khi so user input với grouped candidates.

### 5.2. `create_artifact`

Không đổi tên tool và không thêm tool:

Mở rộng create input bằng optional routing hint độc lập với workspace ownership evidence:

```ts
connection?: {
  windowInstanceId?: string;
  selectionToken?: string;
};
```

- Resolved-workspace creation thông thường không cần gửi thêm object này vì `workspaceEvidence.selectionToken` đã bind cả workspace và window.
- Tagged-file creation có thể bỏ qua object này khi internal preflight tìm được một target duy nhất.
- Nếu tagged-file preflight trả nhiều window candidates, AI/user chọn một candidate rồi retry cùng tagged-file ownership evidence và `connection.selectionToken` của candidate đó.
- Routing hint không thay thế tagged-file containment hoặc resolved-workspace ownership validation. Nếu hai nguồn evidence không cùng workspace/window tuple, fail trước mutation.

1. Parse/validate create input và workspace evidence như hiện tại.
2. Trước filesystem mutation, gọi `resolveArtifactConnectionTarget`:
   - Resolved-workspace evidence lấy window từ selection grant.
   - Tagged-file evidence map file/root vào fresh window groups; unique strongest tự chọn.
   - Nếu nhiều candidates ngang nhau, trả structured `WINDOW_SELECTION_REQUIRED` cùng grouped candidates và tokens; không tạo artifact directory.
3. Persist `artifact.json`, `artifact.md`, `comments.json` theo create transaction hiện tại.
4. Gọi `commitArtifactConnectionRequest` sau khi ba lifecycle files đã hoàn chỉnh; connection file là file cuối cùng được tạo.
5. Nếu connection-file creation thất bại, rollback exact newly allocated artifact directory như create failure hiện tại.
6. Extension watcher nhận connection create event và đúng target window gọi `openWith`.
7. Tool result trả `windowInstanceId` và connection metadata để AI có thể giữ làm optimization hint, nhưng connection file là source of truth.

Create từ tagged file vẫn được tự động khi candidate đủ rõ; không bắt buộc user chọn hoặc gọi resolver chỉ vì hệ thống có nhiều window.

### 5.3. `inspect_artifact_review`

Không đổi tên tool. Mở rộng optional input để AI có thể chuyển retained routing evidence khi có:

```ts
connection?: {
  windowInstanceId?: string;
  selectionToken?: string;
};
intent?: "reconnect" | "explicit-chat-update";
```

Flow:

1. Load và validate exact artifact handle/manifest trước; không scan global storage.
2. Gọi `resolveArtifactConnectionTarget` trước bất kỳ takeover side effect nào:
   - Nếu provided window ID trùng connection file, registry còn fresh và window vẫn chứa manifest workspace: reuse, không resolve lại.
   - Nếu có fresh selection token: validate và chọn target mới.
   - Nếu ID thiếu/khác/stale: resolve exact manifest workspace từ grouped registry.
   - Nếu có unique strongest target: tự chọn.
   - Nếu còn tie và `intent: "reconnect"`: trả `WINDOW_SELECTION_REQUIRED` trước takeover; AI/user chọn rồi retry inspect.
   - Với recovery/comment inspection không mang reconnect intent, routing ambiguity không được làm mất khả năng đọc lifecycle. Core inspection vẫn có thể thành công và trả `connection.status: "selection-required"`; không update/open cho đến khi có lựa chọn.
3. Chạy inspect/takeover lifecycle hiện tại.
4. Sau inspect thành công và có validated target, gọi `commitArtifactConnectionRequest` với `source: "inspect"`.
5. Trả inspect result hiện tại cộng connection status/target metadata.

Việc connection write thất bại không được làm hỏng lifecycle files. Trả typed `ARTIFACT_CONNECTION_WRITE_FAILED` kèm exact-handle recovery metadata; retry inspect trên cùng handle, không replay round mutation.

### 5.4. Reconnect skill flow

Thay pure reconnect flow hiện tại để UI routing đi qua inspect mà không thêm tool:

```text
exact artifact handle
  -> inspect_artifact_review(intent: "reconnect", connection hint nếu có)
  -> internal resolve/bind/open request
  -> xử lý current state
  -> wait same round hoặc inspect/advance theo lifecycle state hiện tại
```

Quy tắc:

- Nếu AI giữ `windowInstanceId`, connection file có cùng ID và registry xác nhận fresh: không cần resolve lại.
- AI mới, mất ID, ID khác hoặc stale: inspect internal preflight resolve manifest workspace; tự chọn unique strongest hoặc trả grouped choices.
- Explicit user/user+AI selection có thể rebind artifact sang window khác. Không quan tâm AI cũ; valid reconnect cuối cùng thắng.
- Reconnect không lặp lại Proceed/Just save, không advance round chỉ để mở UI và không tạo artifact mới.
- Structured recovery inspect không được ép user chọn window nếu routing không liên quan tới recovery; connection status được tách khỏi lifecycle state.

### 5.5. `wait_for_artifact_review` và `advance_and_wait_for_artifact`

Không thêm window-selection input và không tự rebind:

- Waiter ownership không phải window ownership.
- Các tool này tiếp tục dùng exact artifact handle/round/token.
- Chúng có thể trả current connection metadata để AI giữ hint, nhưng không ghi connection file và không phát open request.
- Một AI cũ gọi wait/advance không được giành lại window. Chỉ create hoặc inspect/reconnect mới update binding.

## 6. Extension watcher và `openWith`

### 6.1. Thay event nguồn

Sau cutover, auto-open watcher dùng:

```text
*/artifact-connection.json
```

Thay cho việc dùng `comments.json` creation làm proxy cho artifact readiness. Watch cả `onDidCreate` và `onDidChange` vì reconnect cập nhật cùng file nhiều lần.

### 6.2. Targeted handling

Mỗi extension window:

1. Đọc connection file bằng bounded retry để chịu atomic rename/event timing.
2. Resolve parent artifact directory, load validated `artifact.json`, rồi lấy artifact identity và `location.workspaceRoot` từ manifest; không lấy hai giá trị này từ connection payload.
3. Validate safe global artifact handle và connection schema.
4. So `connection.windowInstanceId` với local publisher `instanceId`.
5. Window không khớp: bỏ qua im lặng.
6. Window khớp nhưng ID không còn là local current instance: bỏ qua/report diagnostic.
7. Nếu setting `agentPlus.autoOpenArtifactReview` bật: gọi shared `ArtifactReviewOpenCoordinator`.
8. Deduplicate bằng `openRequestId`; giữ `connectionRevision` cho diagnostics/ordering metadata và vẫn giữ single-flight theo canonical artifact path.

Targeted request không kiểm tra `vscode.window.state.focused`. VS Code window có thể nằm dưới ứng dụng khác; tab phải được mở trong đúng extension host và sẽ thấy khi user quay lại VS Code.

Manual **AI Artifacts: Open Artifact Review** command vẫn giữ nguyên và tiếp tục dùng shared validation/open coordinator.

Không cần acknowledgement protocol trong scope đầu tiên. MCP chỉ xác nhận connection request đã được commit, không tuyên bố UI chắc chắn đã mở. Extension log lỗi `openWith`; manual host gate xác minh hành vi thực tế.

## 7. Error contract

Thêm typed connection errors mà không trộn với round-token errors:

- `WINDOW_SELECTION_REQUIRED`: còn nhiều tuple hợp lý; trả grouped candidates/tokens, không mutate create/reconnect lifecycle.
- `WINDOW_SELECTION_EXPIRED`: token hết hạn, replayed, window reload/close hoặc folder không còn trong snapshot.
- `WINDOW_CONNECTION_STALE`: stored/provided window ID không còn fresh; resolve/rebind lại.
- `WINDOW_CONNECTION_MISMATCH`: selection không thuộc manifest workspace.
- `ARTIFACT_CONNECTION_INVALID`: connection file malformed/unsupported, invalid window/revision/request ID, hoặc connection path/parent artifact handle không an toàn.
- `ARTIFACT_CONNECTION_WRITE_FAILED`: routing write thất bại; lifecycle files không bị sửa ngoài side effects đã được report rõ.

Mọi lỗi phải nói rõ:

- Có cần dùng cùng exact artifact handle hay không.
- Tool tiếp theo là resolver hay retry inspect.
- Có lifecycle mutation/takeover nào đã xảy ra hay chưa.
- Có thể reuse selection token hay không.

# Phần II — Implementation plan chi tiết

## Nguyên tắc thực hiện

- Bốn phase dưới đây là các implementation/release units. Các substep chỉ là checkpoint nội bộ để code và review; không được phát hành riêng.
- Phase 1 là một atomic MCP cutover: shared contracts, resolver, connection persistence, `create_artifact` và `inspect_artifact_review` phải hoàn thành cùng nhau trước khi chuyển sang extension consumer.
- Triển khai tuần tự. Không bắt đầu phase tiếp theo khi phase hiện tại chưa đạt đầy đủ điều kiện hoàn tất; trạng thái “code complete, manual/install pending” chưa phải là phase complete.
- Mỗi phase phải được đánh giá lại từ source và test hiện tại; không dùng nội dung plan làm bằng chứng rằng code đã hoàn thành.
- Automated verification được chạy trong từng phase. Full `check/test/build` vẫn phải chạy lại ở Phase 4.
- Chỉ các phase có hành vi VS Code thực tế mới cần Chú chạy manual gate. AI phải nói rõ thao tác ngắn gọn, kết quả mong đợi và chờ xác nhận trước khi đánh dấu pass.
- Có thể tạo commit/checkpoint giữa các substep để review hoặc rollback khi phát triển, nhưng release chỉ được thực hiện sau Phase 4.
- Không trộn thay đổi ngoài scope, không sửa generated `dist/` hoặc installed integration assets trực tiếp.
- Nếu implementation buộc phải đổi quyết định kiến trúc, cập nhật Phần I và contracts trong Substep 1A trước khi tiếp tục; không silently diverge khỏi plan.

## Phase 1 — Contracts và atomic MCP cutover

### Mục tiêu phase

Hoàn thành toàn bộ producer-side contract trong một cutover unit: resolver giữ quan hệ workspace/window, selection grants bind exact tuple, connection state được lưu an toàn, và cả create lẫn explicit inspect/reconnect đều phát sinh targeted open request mà không làm thay đổi review lifecycle.

Không merge/release trạng thái trung gian giữa 1A–1E. Một substep chỉ được coi là checkpoint phát triển; Phase 1 chỉ hoàn tất sau phase-wide gate ở 1F.

### Substep 1A — Khóa baseline và shared contracts

#### Mục tiêu

Khóa contract mới trước khi sửa producer/consumer: grouped resolver response, exact `window + workspace` identity, connection schema và invariant giữ đúng năm MCP tools.

#### Thay đổi

- Thêm grouped-window resolver types và schemas.
- Thêm connection schema/file constants/path helpers.
- Đổi candidate identity thành `windowInstanceId + canonical workspaceRoot`.
- Thêm selection-grant window binding rules.
- Ghi contract tests trước hoặc cùng lúc với schemas; chưa thay hành vi extension watcher trong phase này.

#### Automated verification

```powershell
npm.cmd test -- test/workspace-registry.test.ts test/skill-contract.test.ts
npm.cmd run check
```

Kiểm tra tự động tối thiểu:

- Same folder ở hai windows xuất hiện hai lần trong hai groups.
- Multi-root folders trong cùng window dùng cùng window ID.
- Focus được trả như metadata, không ảnh hưởng token sau khi selection đã explicit.
- Connection schema reject extra fields, invalid `windowInstanceId`, non-UUID `openRequestId`, non-positive/unsafe revision, invalid source và invalid timestamp.
- Connection schema không chứa `artifactId` hoặc `workspaceRoot`; tests chứng minh identity/context luôn được derive từ artifact directory và validated manifest.
- Existing schema-v5 fixture không có `artifact-connection.json` vẫn parse/load được.

#### AI review gate

- Kiểm tra không có public MCP tool thứ sáu.
- Kiểm tra artifact schema v5 không bị bump và old v5 connection-less artifact vẫn hợp lệ.
- Kiểm tra connection file không tham gia artifact/comments/submission hashes hoặc round-token schema.
- Kiểm tra candidate/window types có một source of truth dùng được bởi MCP và extension; không duplicate schema lệch nhau.

#### Điều kiện hoàn tất

- TypeScript check và focused tests pass.
- Contract mô tả được duplicate folder paths ở nhiều windows mà không deduplicate.
- Tool catalog, lifecycle schema và existing artifact compatibility chưa thay đổi.
- Không còn quyết định kiến trúc mở ảnh hưởng tới các Substep 1B–1E hoặc extension consumer ở Phase 2.

#### Rollback checkpoint

Có thể revert Substep 1A trước khi các substep phụ thuộc được tích hợp mà không cần migrate artifact hoặc registry data. Nếu 1B–1E đã dùng contract mới thì rollback toàn Phase 1. Commit gợi ý: `plan window-routed artifact connection contracts`.

### Substep 1B — Triển khai grouped workspace/window resolver

#### Mục tiêu

Mở rộng resolver hiện tại để trả toàn bộ fresh windows theo nhóm, giữ quyền tự chọn unique strongest candidate của AI và chỉ yêu cầu user khi kết quả thật sự hòa.

#### Thay đổi

- Refactor registry resolution để không gọi `uniqueRegisteredFolders` xuyên windows.
- Rank tuples từ user query nhưng giữ window grouping trong response.
- Issue/validate single-use tuple selection tokens.
- Cập nhật resolver MCP response, instructions và tests.
- Giữ `focused`, active file và snapshot timestamp làm metadata; không coi chúng là caller identity.
- Revalidate selected instance/root trực tiếp thay vì re-run policy phụ thuộc focus.

#### Automated verification

```powershell
npm.cmd test -- test/workspace-registry.test.ts test/review-wait-mcp.test.ts
npm.cmd run check
```

Test tối thiểu:

- AI có thể tự chọn unique exact path/name dù registry có nhiều windows.
- Tied duplicates được giữ riêng để AI/user chọn.
- Focus/active-file metadata chính xác theo snapshot.
- Window mất focus sau selection không làm grant invalid; reload/close làm invalid.
- Candidate ID khác nhau cho cùng workspace path ở hai window IDs.
- Token expiry, replay, folder removal và registry TTL fail trước mutation.
- `status: "not-found"` chỉ xuất hiện khi không có fresh folders để trả.

#### AI review gate

- So resolver result với raw registry fixtures để chứng minh không window nào bị merge.
- Kiểm tra exact user wording vẫn được ưu tiên hơn `focused`.
- Kiểm tra nhiều windows không tự động tạo error; ambiguity được giữ trong grouped result cho skill quyết định.
- Kiểm tra không dùng cwd, environment context, workspace order hoặc filesystem scan làm evidence.

#### Điều kiện hoàn tất

- Focused tests và TypeScript check pass.
- Resolver output đủ dữ liệu để skill phân biệt window/folder mà không cần raw process ID.
- Existing unique-candidate cases vẫn tự chọn được như trước hoặc tốt hơn.
- Selection grant bind chính xác tuple và không bị invalid chỉ vì focus đổi.

#### Rollback checkpoint

Trước 1C–1E, có thể revert riêng Substep 1B về flat resolver response. Sau khi dependent substeps đã tích hợp, rollback toàn Phase 1 để tránh contract mismatch. Commit gợi ý: `group workspace resolution by VS Code window`.

### Substep 1C — Xây internal artifact-connection module

#### Mục tiêu

Tạo routing persistence độc lập, an toàn và testable trước khi tích hợp vào create/inspect hoặc extension watcher.

#### Thay đổi

- Implement safe read/write/lock cho `artifact-connection.json`.
- Implement `resolveArtifactConnectionTarget` và `commitArtifactConnectionRequest`.
- Add POSIX permission, symlink/junction, rollback và concurrent-last-writer tests.
- Dùng shared path/validation helpers với injectable `userHome`; không tự ghép global paths ở nhiều nơi.
- Giữ connection schema optional đối với artifact v5 hiện có.

#### Automated verification

```powershell
npm.cmd test -- test/workspace-registry.test.ts test/review-wait-mcp.test.ts
npm.cmd run check
```

Test tối thiểu:

- Request ID mới ở mỗi commit.
- Revision bắt đầu từ `1`, tăng đúng một đơn vị trên mỗi successful commit và monotonic trong concurrent fixture.
- Ambiguous/failed preflight và failed atomic write không thay đổi persisted revision; malformed existing state không bị reset im lặng.
- Connection mutation không đổi lifecycle hashes/round.
- Existing artifact không có file vẫn load được.
- Invalid window ID/revision/request ID bị reject; connection không thể cung cấp hoặc override artifact ID/workspace root.
- Artifact identity và workspace root được derive từ safe parent directory cùng validated manifest; moved/linked/unsafe parent bị reject.
- Atomic transient read được retry có giới hạn; malformed persistent state fail rõ ràng.
- Linked connection/lock/staging targets bị reject.
- POSIX connection/lock files giữ owner-only modes; Windows không tuyên bố POSIX guarantee.

#### AI review gate

- Kiểm tra module không import hoặc gọi VS Code API.
- Kiểm tra connection lock không dùng chung sai cách với review-round transaction lock.
- Kiểm tra uninstall/cleanup không thêm logic xóa connection file hoặc artifact directory.
- Kiểm tra connection write không sửa `artifact.json`, `artifact.md`, `comments.json` hoặc submission.

#### Điều kiện hoàn tất

- Module có API nội bộ rõ ràng cho preflight và commit.
- Safe-path, atomicity, concurrency và compatibility tests pass.
- Không có public MCP surface hoặc extension behavior mới trong phase này.
- Existing artifact bytes/hashes giữ nguyên qua connection create/update fixture.

#### Rollback checkpoint

Module chưa có caller production nên có thể revert độc lập. Commit gợi ý: `add internal artifact connection persistence`.

### Substep 1D — Tích hợp connection vào `create_artifact`

#### Mục tiêu

Mọi artifact mới có validated target window và connection request được commit sau khi core lifecycle files hoàn chỉnh, không thêm public tool hoặc làm yếu tagged-file flow.

#### Thay đổi

- Preflight target trước create mutation.
- Bind resolved-workspace token hoặc derive tagged-file target.
- Write connection file last trong create transaction.
- Trả connection metadata trong create result.
- Hỗ trợ optional `connection.selectionToken` cho ambiguous tagged-file retry mà vẫn giữ tagged file làm ownership evidence.
- Giữ exact rollback boundary của newly allocated artifact directory.

#### Automated verification

```powershell
npm.cmd test -- test/review-wait-mcp.test.ts test/workspace-registry.test.ts
npm.cmd run check
```

Test tối thiểu:

- Unique tagged path tự chọn và tạo/open request không hỏi user.
- Ambiguous tagged path trả choices trước khi directory được tạo.
- Connection failure rollback exact newly allocated artifact directory.
- Artifact core files hoàn chỉnh trước connection event.
- Resolved-workspace selection token bind cùng workspace/window dùng để ghi connection.
- Tagged ownership evidence và connection selection khác tuple bị reject trước mutation.
- Create result trả exact connection window/revision/request metadata mà không đổi artifact handle contract hoặc duplicate artifact/workspace identity trong connection file.
- Existing collision, unsafe root, oversized Markdown và injected rollback tests vẫn pass.

#### AI review gate

- Trace write order trong source: manifest → Markdown → comments → connection.
- Kiểm tra không có artifact directory khi preflight trả `WINDOW_SELECTION_REQUIRED`.
- Kiểm tra create không gọi `openWith` và không chờ extension acknowledgement.
- Kiểm tra AI vẫn tự chọn unique strongest candidate; nhiều window không tự động buộc user chọn.

#### Điều kiện hoàn tất

- Create focused tests và TypeScript check pass.
- Hai evidence flows hiện tại vẫn được hỗ trợ.
- Mọi create thành công mới có valid connection file; mọi failure trước commit không để partial artifact.
- Tool catalog vẫn đúng năm tools.

#### Rollback checkpoint

Revert create integration và giữ internal module unused; artifacts đã tạo có connection file vẫn là valid v5 artifacts và code cũ có thể bỏ qua file phụ. Commit gợi ý: `bind artifact creation to resolved VS Code window`.

### Substep 1E — Tích hợp inspect/reconnect và rebind

#### Mục tiêu

Cho bất kỳ AI nào có exact artifact handle reconnect, resolve/reuse đúng window binding và phát connection request thông qua `inspect_artifact_review`, đồng thời giữ nguyên recovery authority hiện tại.

#### Thay đổi

- Extend inspect input/result với optional connection data và `intent: "reconnect"`.
- Chạy routing preflight trước takeover khi reconnect.
- Commit open request sau successful inspect.
- Giữ recovery/comment inspection hoạt động nếu routing ambiguous.
- Cập nhật skill decision table: explicit reconnect đi qua inspect rồi wait/advance đúng current state.
- Không cho wait/advance rebind window; chỉ create và inspect/reconnect có quyền update connection.

#### Automated verification

```powershell
npm.cmd test -- test/review-wait-mcp.test.ts test/workspace-registry.test.ts test/skill-contract.test.ts
npm.cmd run check
```

Test tối thiểu:

- Matching fresh connection ID không cần resolve lại.
- AI mới/stale ID tự resolve exact manifest workspace nếu unique.
- Tie trả grouped choices trước takeover.
- Rebind không repeat Proceed/Save và không advance round.
- AI cũ gọi wait/advance không đổi target window.
- Missing connection trên old v5 artifact được tạo khi reconnect thành công.
- Routing ambiguity trong recovery/comment inspection không làm mất lifecycle result.
- Explicit reconnect ambiguity không takeover hoặc detach waiter trước khi user chọn.
- Connection write failure trả typed recovery metadata và không sửa lifecycle files.
- Reconnect vẫn giữ exact artifact handle; không scan global storage hoặc chọn latest artifact.

#### AI review gate

- Phân biệt rõ explicit reconnect, feedback inspection, recovery inspection và explicit chat update.
- Kiểm tra inspect preflight diễn ra trước takeover trong branch reconnect có thể hỏi user.
- Kiểm tra Proceed/Just save không bị replay khi reconnect.
- Kiểm tra connection source of truth ở file; AI-retained ID chỉ là hint được revalidate.

#### Điều kiện hoàn tất

- Focused lifecycle, resolver và skill-contract tests pass.
- Explicit reconnect có deterministic resolve/reuse/rebind behavior.
- Recovery flow không yếu hơn hiện tại và không bị UI routing chặn.
- Wait/advance source và tests chứng minh không update connection.

#### Rollback checkpoint

Revert inspect/reconnect integration chỉ khi chưa chuyển sang Phase 2. Nếu Phase 1 phase-wide gate fail vì contract mismatch, rollback đồng bộ toàn Phase 1; connection files thử nghiệm còn lại được giữ và không ảnh hưởng lifecycle. Commit gợi ý: `route artifact reconnect through inspection`.

### Substep 1F — Phase-wide atomic integration gate

#### Mục tiêu

Chứng minh 1A–1E tạo thành một MCP cutover hoàn chỉnh, không để shared schema, resolver producer, connection persistence hoặc lifecycle consumer ở trạng thái lệch contract.

#### Automated verification

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Ngoài full suite, đối chiếu coverage tối thiểu cho grouped resolver, token expiry/replay, safe connection persistence, create rollback, reconnect/takeover, question-only inspection, Proceed, Just save, cancellation và round-token state binding.

#### AI review gate

- Review diff theo bốn component: shared contracts, resolver, connection module và MCP lifecycle integration.
- Xác nhận `tools/list` vẫn chỉ có năm public tools và không có internal helper lọt vào tool catalog/allowlist.
- Xác nhận mọi producer/consumer/fixture dùng cùng resolver và connection schema; không consumer nào đọc `artifactId`/`workspaceRoot` từ connection payload.
- Xác nhận create/inspect có thể update routing state nhưng wait/advance không thể rebind.
- Xác nhận existing connection-less v5 artifacts vẫn inspect/reconnect được và connection writes không đổi Markdown/SHA/comments/submission/review round.
- Không coi các commit 1A–1E là release candidates độc lập.

#### Điều kiện hoàn tất Phase 1

- Tất cả substep 1A–1E và full `check/test/build` pass.
- Không còn partial contract hoặc TODO bắt buộc giữa resolver, connection persistence, create và inspect/reconnect.
- Tool surface vẫn năm tools; artifact schema vẫn v5; connection schema độc lập và optional cho artifacts cũ.
- Lifecycle recovery, waiter, round-token và rollback invariants không regression.
- Phase 1 chỉ được merge cùng một feature branch/cutover và chưa được publish cho người dùng.

#### Rollback checkpoint

Nếu gate fail, rollback đồng bộ toàn Phase 1 về baseline trước feature. Không giữ riêng grouped resolver hoặc lifecycle consumer dùng contract mới. Không xóa artifact data; optional connection files đã sinh phải được bảo toàn vì nằm trong user artifact directory.

## Phase 2 — Cut over extension watcher sang targeted connection events

### Mục tiêu

Thay comments-created/focused-window heuristic bằng connection create/change events để chỉ selected window gọi `vscode.openWith`, kể cả khi target window không focus.

### Thay đổi

- Expose local publisher instance ID cho targeted handler.
- Watch connection create/change.
- Validate/dedupe request rồi mở chỉ trong matching window.
- Remove comments-create auto-open path sau khi connection path có coverage tương đương.

### Automated verification

```powershell
npm.cmd test -- test/artifact-review-open.test.ts test/workspace-registry.test.ts
npm.cmd run check
npm.cmd run build:extension
```

Test tối thiểu:

- Hai windows cùng thấy event nhưng chỉ target gọi `openWith`.
- Target không focus vẫn mở.
- Duplicate filesystem events chỉ tạo một open cho cùng request ID.
- Hai request IDs khác nhau có thể reopen/reveal cùng artifact.
- Auto-open setting và manual command tiếp tục đúng behavior.
- Handler retry transient atomic-read state và reject malformed/wrong-root/linked connection.
- Non-target event không hiện error hoặc gọi validation/open không cần thiết.
- Single-flight theo artifact path và dedupe theo request ID không chặn request mới hợp lệ.

### AI review gate

- Kiểm tra watcher đăng ký sau khi collection root đã được tạo/validated.
- Kiểm tra targeted branch không còn `isWindowFocused` gate.
- Kiểm tra comments-created watcher đã được xóa sau khi connection watcher coverage pass, tránh double open.
- Kiểm tra manual command vẫn dùng shared validation/open coordinator.
- Không tuyên bố multi-window pass chỉ từ mocks.

### Điều kiện hoàn tất implementation

- Focused automated tests, TypeScript check và extension build pass.
- Đúng window mở cho create/reconnect; non-target windows không mở.
- Window focus không còn là điều kiện của targeted open.
- Manual multi-window evidence được defer về installed-build gate ở cuối plan. Phase 2 chỉ được ghi `implementation complete`; chưa được coi là feature/release complete trước gate cuối.

### Rollback checkpoint

Có thể revert watcher về comments-created behavior trong khi giữ connection files/MCP logic; connection files vẫn được bảo toàn. Commit gợi ý: `open artifact review in the selected VS Code window`.

## Phase 3 — Đồng bộ skill, docs, runtime và integration contract

### Mục tiêu

Đưa toàn bộ producer, consumer, installed skill, packaged runtime và product documentation sang cùng contract mà không thêm tool công khai hoặc để mixed-version behavior không được hỗ trợ.

### Thay đổi

- Update `skills/create-review-artifact/SKILL.md` và artifact contract.
- Giữ exact five-tool availability check; không thay client allowlists bằng tool mới.
- Update MCP instructions, README, architecture, philosophy và changelog theo behavior mới.
- Ghi thay đổi kiến trúc vào `docs/CHANGE_LOGS.md` theo project rule.
- Rebuild managed runtime/package và chuẩn bị exact build cho gate cuối; Chú chỉ reinstall integrations và restart AI client một lần trong phần install/manual cuối plan.

### Automated verification

```powershell
npm.cmd test -- test/skill-contract.test.ts test/mcp-config.test.ts test/mcp-client-drivers.test.ts test/workspace-integration.test.ts
npm.cmd run build:integration
npm.cmd run build
```

Kiểm tra tự động tối thiểu:

- Skill hỏi user chỉ khi strongest candidate tied.
- Resolver/create/inspect source, runtime bundle, installed skill và docs đồng bộ.
- `tools/list` vẫn đúng năm tool.
- Không có `open_artifact` trong source tool surface, MCP config hoặc client tests.
- Client configs không thêm allowlist entry mới.
- Built runtime chứa grouped resolver, connection schema và inspect reconnect contract mới.
- Installed skill fixture chứa grouped selection/reconnect rules và không còn wording cross-window cũ.

### AI review gate

- Diff source skill, copied/installed skill fixture, MCP instructions và architecture docs để tìm contract drift.
- Kiểm tra README/settings wording không còn nói auto-open chỉ trong focused window.
- Kiểm tra package version/runtime version assumptions được khóa và changelog không claim release gates đã pass trước Phase 4.
- Kiểm tra không sửa generated `dist/` bằng tay; chỉ build từ source.

### Điều kiện hoàn tất implementation

- Skill/docs/runtime/client tests và builds pass.
- Source và packaged runtime dùng cùng contract/version; package sẵn sàng cho installed-build gate cuối.
- Tool count vẫn năm và không có public open/connect tool.
- Việc cài extension, reinstall integrations, restart AI client và manual smoke được thực hiện một lần ở cuối plan. Trước gate đó Phase 3 chỉ được ghi `implementation complete, install pending`.

### Rollback checkpoint

Rollback phải áp dụng đồng thời extension/runtime/skill/docs về checkpoint Phase 2-compatible. Không rollback một consumer riêng lẻ. Commit gợi ý: `document and package window-routed artifact connections`.

## Phase 4 — Full regression, packaged runtime và release gate

### Mục tiêu

Hoàn tất full regression và tạo exact packaged build sẵn sàng để Chú cài. Installed integration và VS Code host thực được chứng minh một lần tại manual gate cuối, sau khi toàn bộ implementation đã ổn định.

### Automated verification matrix

#### Workspace/window resolution

- Single window/single folder.
- Single window/multi-root exact, similar và no-match.
- Multiple windows với unique exact match.
- Multiple windows với duplicate folder paths.
- Multiple focused snapshots, no focused snapshot và focus thay đổi sau resolve.
- Active-file match cho tagged file.
- Token expiry, replay, window reload, folder removal và registry TTL.

#### Connection persistence

- Create/read/update schema.
- Invalid window ID/revision/request ID và unsafe parent artifact binding.
- Artifact ID/workspace root luôn được derive từ validated manifest, không được duplicate trong connection payload.
- Missing connection on old artifact.
- Atomic write transient-read retry.
- Symlink/junction attack rejection.
- POSIX `0600` and directory/lock safety.
- Concurrent reconnect last-valid-writer-wins.

#### Lifecycle integration

- Create via resolved token.
- Create via unique tagged file.
- Ambiguous tagged-file preflight has no artifact mutation.
- Inspect reconnect with matching hint, different hint, missing hint và stale hint.
- Inspect recovery/comment read survives routing ambiguity.
- Wait/advance never rebind.
- Proceed/Save reconnect does not repeat action.
- Connection updates do not change Markdown bytes, SHA, comments, submission hoặc round tokens.
- Create rollback and advance rollback behavior remain intact.

#### Extension behavior

- `onDidCreate` and `onDidChange` connection events.
- Non-target windows ignore event.
- Unfocused target opens.
- Request-ID dedupe and artifact-path single-flight.
- Invalid/malformed/linked connection target never reaches `openWith`.
- Auto-open disabled and manual command behavior.

#### Full automated gates

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Ngoài automated gates, packaged runtime phải được inspected để chứng minh MCP source mới đã được bundle. Multi-window/openWith claims chỉ được đánh dấu pass sau manual host test; unit mocks không đủ bằng chứng.

### AI review gate

- Đọc lại `git diff` theo component và đối chiếu từng quyết định trong Phần I.
- Xác nhận không có unrelated user changes bị sửa hoặc stage.
- Xác nhận artifact v5 fixtures trước thay đổi vẫn load/inspect/reconnect được.
- Xác nhận connection write/update không đổi artifact Markdown bytes/SHA, comments, submission hoặc review round.
- Xác nhận packaged runtime tool catalog và input/output schemas khớp source.
- Xác nhận chưa dùng development mocks để claim installed-runtime/manual pass; evidence đó chỉ được ghi sau gate cuối trên exact build đã bàn giao.
- Phân loại mọi failure là blocker, accepted limitation hoặc unrelated baseline failure; không đánh dấu pass mơ hồ.

### Điều kiện sẵn sàng cài đặt và manual gate cuối

- `npm.cmd run check`, `npm.cmd test` và `npm.cmd run build` đều pass.
- Packaged runtime inspection pass và package cài đặt chứa đúng runtime/skill mới.
- Không còn P0/P1 chưa giải quyết đối với wrong-window open, lifecycle corruption, unsafe path hoặc artifact data loss.
- Docs/changelog mô tả đúng behavior đã chứng minh; không claim unsupported remote topology.
- Worktree chỉ chứa intended implementation/docs/test changes cùng pre-existing user changes đã được bảo toàn.
- AI bàn giao exact build/version/hash hoặc package path cho Chú; chưa đánh dấu feature/release complete cho tới khi installed-build manual gate ở cuối plan pass.

### Rollback checkpoint

Nếu release gate fail, không publish. Rollback đồng bộ về checkpoint trước feature cho extension/runtime/skill; giữ nguyên toàn bộ `~/.ai-artifacts/artifacts/`, kể cả optional connection files. Commit cuối/PR chỉ được coi là releasable sau khi gate này pass.

## Phụ lục A — Component/file map dự kiến

### Shared contracts và safety

- `src/shared/workspace-registry.ts`
- `src/shared/contracts.ts`
- `src/shared/artifact-files.ts`
- `src/shared/artifact-validation.ts`
- New internal connection module dưới `src/shared/` hoặc `src/integration/` tùy ownership cuối cùng

### MCP runtime

- `src/integration/artifact-review-mcp-v4.ts`
- Runtime build/bundle inputs liên quan

### Extension host

- `src/extension/workspace-registry-publisher.ts`
- `src/extension/artifact-review-open.ts`
- `src/extension/extension.ts`

### Skill và docs

- `skills/create-review-artifact/SKILL.md`
- `skills/create-review-artifact/references/artifact-contract.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PHILOSOPHY.md`
- `docs/CHANGE_LOGS.md`
- `CHANGELOG.md`

### Tests

- `test/workspace-registry.test.ts`
- `test/review-wait-mcp.test.ts`
- `test/artifact-review-open.test.ts`
- `test/skill-contract.test.ts`
- Packaging/integration fixtures nếu contract response/input thay đổi

## Phụ lục B — Cutover và rollback toàn feature

- Đây là atomic MCP + extension + skill contract cutover. Không release grouped resolver mà skill cũ chưa hiểu, hoặc connection watcher mà MCP chưa ghi connection file.
- Tool count vẫn năm, nên client allowlist không thêm entry; tuy nhiên installed runtime và skill vẫn phải reinstall cùng release.
- Artifact schema v5 giữ nguyên. `artifact-connection.json` dùng schema riêng và optional, nên rollback code không cần sửa/xóa user artifacts.
- Nếu targeted watcher có lỗi sau release, rollback extension/runtime/skill về commit trước; connection files còn lại được code cũ bỏ qua và phải được giữ như user artifact data.
- Không xóa hoặc migrate connection files trong uninstall/rollback.
- Vì resolver response shape và reconnect semantics thay đổi, MCP runtime version nên tăng major; exact extension/release version được khóa trước implementation cutover.

## Phụ lục C — Điều kiện hoàn tất toàn feature

Plan hoàn tất khi tất cả điều sau được chứng minh:

- Resolver trả grouped windows và AI vẫn tự chọn unique strongest candidate.
- Selection token bind exact window + workspace tuple.
- Create và inspect sử dụng internal connection helpers; không có public open/connect tool mới.
- Connection file là source of truth cho current window routing request; validated artifact manifest vẫn là source of truth cho artifact ID/workspace root, còn AI-retained window ID chỉ là optimization hint.
- Create mở đúng selected window; reconnect có thể rebind và reopen đúng window mà không phụ thuộc focus.
- Wait/advance không thay đổi window binding.
- Existing v5 artifacts không connection vẫn usable.
- Review lifecycle, hashes, round tokens, rollback và user artifact retention invariants vẫn pass.
- Full automated gates, packaged-runtime verification và manual multi-window gates đều pass.

# Phần III — Install và manual verification cuối cùng

Toàn bộ manual test được defer tới đây để Chú chỉ cần cài và kiểm tra **một build cuối cùng** sau khi implementation, docs, packaging, AI review và automated gates đã hoàn tất.

## 1. Entry gate trước khi bàn giao bản cài

Chỉ bắt đầu phần này khi:

- Phase 1–3 đã đạt trạng thái `implementation complete`; Phase 4 automated/release-preparation gate đã pass.
- `npm.cmd run check`, `npm.cmd test` và `npm.cmd run build` pass trên source snapshot cuối cùng.
- Packaged runtime đã được inspect và khớp source contract, tool catalog, schema và skill của cùng snapshot.
- Không còn P0/P1 mở liên quan đến wrong-window routing, lifecycle corruption, unsafe path hoặc artifact data loss.
- AI ghi lại exact package path, package/extension version và source commit hoặc build identifier dùng cho manual test.
- Sau khi tạo package bàn giao, không có source/runtime/skill change nào được đưa vào mà chưa rebuild và chạy lại automated gates.

## 2. Install handoff — Chú thực hiện một lần

1. Chú cài extension/package từ exact build đã được bàn giao.
2. Chú reload/restart VS Code để extension host dùng code mới.
3. Chú chạy **AI Artifacts: Install All Detected Integrations** để đồng bộ managed runtime và installed skill.
4. Chú restart AI client và mở chat mới để loại bỏ process/tool schema cũ còn cache.
5. AI và Chú xác nhận version/build identifier đang chạy đúng với build đã qua automated gates trước khi bắt đầu case 1.

Nếu không xác nhận được installed build hoặc integration vẫn dùng runtime cũ, dừng tại đây; không ghi kết quả manual cho source snapshot mới.

## 3. Manual Verification Matrix — Chú cần chạy

| # | Kịch bản | Thao tác | Kết quả bắt buộc | Trạng thái |
| -: | --- | --- | --- | :---: |
| **1** | Hai windows khác folder | Mở Window A với folder A và Window B với folder B. Yêu cầu tạo artifact cho folder A bằng wording rõ ràng. | Chỉ Window A tự mở `Artifact Review`; Window B không mở và không hiện lỗi của A. | Chờ Chú xác nhận |
| **2** | Hai windows cùng repo, có focus hint | Mở cùng repo ở hai windows, focus Window 1 rồi yêu cầu tạo artifact ở `window đang focus`. | Chỉ Window 1 mở review; Window 2 im lặng. | Chờ Chú xác nhận |
| **3** | Hai windows cùng repo, không đủ evidence | Giữ hai windows cùng repo nhưng không nêu window và không cung cấp tín hiệu phân biệt. | AI hỏi Chú chọn window; không tự đoán và không tạo artifact trước khi lựa chọn được xác nhận. | Chờ Chú xác nhận |
| **4** | Target window không focus | Bắt đầu create cho target window rồi chuyển focus sang ứng dụng khác trước connection event. | Target window vẫn nhận request và tab review đã mở khi Chú quay lại; focus không phải điều kiện routing. | Chờ Chú xác nhận |
| **5** | Window reload và stale binding | Reload/đóng target window, mở lại workspace rồi reconnect exact artifact handle. | Stale instance ID không mở nhầm window; flow resolve/rebind tới instance đang sống và mở đúng artifact. | Chờ Chú xác nhận |
| **6** | Auto-open disabled/enabled | Tắt `agentPlus.autoOpenArtifactReview`, tạo/reconnect artifact; sau đó bật lại và reconnect lần nữa. | Khi tắt, connection vẫn update nhưng UI không tự mở. Khi bật, request mới mở đúng target window. | Chờ Chú xác nhận |
| **7** | Reconnect giữ nguyên lifecycle | Đóng tab review rồi yêu cầu reconnect exact artifact handle. | Inspect/reconnect mở lại cùng artifact; không đổi Markdown, review round hoặc lặp Review/Proceed/Save cũ. | Chờ Chú xác nhận |
| **8** | Rebind sang window khác | Từ một registered window khác, reconnect exact artifact và chọn/rebind target mới. | Target mới mở; window cũ không tự mở. Connection target đổi mà artifact ownership/lifecycle không đổi. | Chờ Chú xác nhận |
| **9** | Lifecycle smoke đại diện | Trên installed build, hoàn thành một path đại diện trong `Review`, `Proceed` hoặc `Just save` theo trạng thái artifact. | Action chỉ thực hiện một lần; waiter, round token và review state không bị connection feature làm lặp hoặc hỏng. | Chờ Chú xác nhận |

## 4. Optional diagnostics khi cần điều tra

Các kiểm tra này không phải completion gate riêng nếu toàn bộ cases bắt buộc đã pass, nhưng được dùng để định vị lỗi:

- Inspect structured `resolve_artifact_workspace` response để xác nhận folders được group theo từng window và duplicate workspace path không bị merge xuyên windows.
- Sau create thành công, kiểm tra artifact directory có đủ core files và `artifact-connection.json`; connection payload không duplicate `artifactId`/`workspaceRoot`.
- Trước và sau reconnect, kiểm tra `connectionRevision` tăng đúng một và `openRequestId` đổi; Markdown bytes, review round, comments và submission không đổi ngoài action Chú chủ động thực hiện.
- Nếu nghi ngờ cài nhầm runtime, đối chiếu installed managed runtime/skill version với package/source identifier đã ghi ở entry gate.

## 5. Cách chạy và điều kiện kết thúc

- AI đưa từng case một bằng thao tác ngắn, chờ Chú xác nhận rồi ghi `PASS`, `FAIL` hoặc `N/A` có lý do; không yêu cầu Chú chạy cả matrix trong một lần không có checkpoint.
- Nếu một case fail, dừng matrix và chẩn đoán trên đúng installed build. Không chuyển sang case sau và không đánh dấu feature complete hoặc release.
- Nếu source, extension package, managed runtime hoặc installed skill thay đổi sau khi đã test, rebuild/reinstall và chạy lại mọi case bị ảnh hưởng; evidence của build cũ không được tái sử dụng ngầm.
- Chỉ sau khi tất cả cases bắt buộc pass hoặc được Chú phê duyệt `N/A`, AI mới cập nhật kết quả trong plan và đánh dấu toàn feature complete/releasable.
