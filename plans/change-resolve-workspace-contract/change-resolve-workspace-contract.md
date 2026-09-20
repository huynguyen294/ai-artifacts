# IDEAS

- Không resolve workspace để gắn vào artifact nữa mà nó sẽ là 1 tool riêng
- Resolve workspace contract mới sẽ phục vụ cho các yêu cầu sau đây
  - Đầu tiên là lấy window ID focused cho AI: có hiện tại có 2 tool dùng window id là create và reconnect
    => Nếu AI trong đoạn chat chưa có window ID sẽ gọi resolve workspaces và lấy focused làm window ID.
    => Mỗi khi dùng tool create và reconnect AI đều phải gửi window ID. Window ID được store ở artifact-connection của từng artifact. MCP kiểm tra nếu không có window nào có ID đó đang mở (stale) thì MCP refresh lấy focused trả về làm ID mới. Nếu window ID của AI khác với a-connection mặc định cũng refresh, trừ khi user hint là muốn mở trong 1 window khác. Quá trình refresh có nhiều focused do lỗi snapshot thì cần quay lại gửi hint cho user chọn window.
    => Tool chủ yếu dùng cho việc resolve window ID. Có thể giữ folders lại trong trường hợp user muốn chọn window cụ thể và yêu cầu mở trong 1 window nào đó thì list các windows và các folders và trạng thái focused như hiện tại cho user chọn. Sau đó vẫn lấy window ID đưa AI giữ.
    => resolve workspace chỉ gọi khi AI ko có window ID, window ID hết hạn, hoặc window ID của AI khác với a-connection. Không cần resolve mọi lúc.

# ANALYZED

## 1. Kết luận và quyết định mới

Hướng thay đổi khả thi với kiến trúc hiện tại. Extension host đã có `windowInstanceId`, heartbeat snapshot và trạng thái `focused`; MCP đã có connection commit, `connectionRevision`, `openRequestId`; extension watcher chỉ mở artifact khi `artifact-connection.json.windowInstanceId` trùng ID local.

Phần phân tích này supersede ý tưởng AI giữ một `targetWindowId` hoặc mapping `artifactDirectory -> windowInstanceId`. Contract mới là:

- default create/reconnect luôn chọn fresh focused window tại thời điểm tool chạy;
- connection cũ của artifact không tạo window affinity và không được ưu tiên khi chọn target mặc định;
- AI không cần giữ window ID theo chat hoặc theo artifact;
- search artifact không cần trả window ID;
- chỉ khi user yêu cầu rõ một window cụ thể thì dùng flow `explicit-window`, có thể chọn window không focused;
- `artifact-connection.json` vẫn được giữ làm open-request routing state giữa MCP process và extension hosts.

Phần cần thay đổi không nằm ở `openWith`, mà ở contract chọn target window, AI behavior và việc loại workspace ownership khỏi lifecycle artifact. Đây vẫn là thay đổi architecture/protocol trung bình-lớn, không phải chỉ đổi mô tả của một MCP tool.

## 2. Ý nghĩa của window ID

`windowInstanceId` là **địa chỉ nhận của một open request**, không phải:

- identity hoặc authorization của AI;
- owner của artifact;
- preferred window lâu dài của artifact;
- state mà AI phải cache để dùng cho lần reconnect tiếp theo.

Một `windowInstanceId` được extension host tạo khi activate, ổn định trong lifetime của extension-host session và thay đổi khi reload/restart window. MCP phải resolve hoặc validate target từ fresh window registry trước mỗi create/reconnect.

Một artifact có tối đa một connection record gần nhất, nhưng record đó chỉ nói request gần nhất đã được gửi tới window nào. Nó không ràng buộc request tiếp theo phải tiếp tục dùng window đó.

## 3. Default routing: focused-first

Khi request không có explicit window intent, MCP bỏ qua connection cũ trong bước chọn target và resolve fresh focused window:

```text
đúng 1 fresh focused window       -> chọn window đó
0 focused + đúng 1 fresh window   -> chọn sole live window
nhiều focused windows             -> trả candidates
0 focused + nhiều live windows    -> trả candidates
0 live windows                    -> not-found
```

Không chọn theo snapshot mới nhất. `focused` được extension publish theo event và heartbeat nhưng các window ghi snapshot độc lập, nên có thể tạm thời có nhiều focused hoặc không có focused do race, app switch, crash hay delayed write.

Khi không có unique target, MCP phải trả danh sách windows/folders/focus để AI trình user chọn. Không được âm thầm chọn một window tùy ý.

## 4. Ý nghĩa của việc ID trùng hoặc khác

So sánh connection cũ với focused target chỉ dùng để mô tả kết quả, không dùng để quyết định target:

| Connection cũ | Focused target | Hành vi |
|---|---|---|
| Cùng ID và ID đó đang focused | Cùng window | Commit open request mới tới cùng window |
| Cùng ID nhưng ID đó không còn focused | Window khác | Rebind sang fresh focused window |
| Khác ID | Window khác | Rebind sang fresh focused window |
| Missing hoặc stale | Fresh focused window | Commit tới fresh focused window |

Ngay cả khi target ID không đổi, reconnect vẫn phải commit đúng một revision mới và một `openRequestId` mới. Nếu không có filesystem event mới, extension watcher không có request mới để reopen/reveal editor.

Response có thể mô tả `retained` hoặc `focused-rebound` để diagnostic, nhưng không được hướng dẫn AI cache ID cho request tương lai.

## 5. Explicit-window flow

Chỉ dùng flow này khi user có intent rõ ràng như “mở trong window agent-plus kia”, chọn một candidate cụ thể, hoặc chỉ định một window khác với focused default.

Public input đã chốt cho cả `create_artifact` và `inspect_artifact_review(intent: "reconnect")`:

```ts
connection?: {
  targetMode: "explicit-window";
  selectionToken: string;
}
```

- Focused-default được biểu diễn bằng cách **omit toàn bộ `connection`**; không public enum `focused-default` và không yêu cầu caller gửi ID.
- `explicit-window` chỉ nhận opaque selection token do MCP vừa cấp; bỏ direct `windowInstanceId` khỏi create/reconnect input để AI không biến routing ID thành affinity lâu dài.
- MCP validate explicit target còn fresh rồi dùng đúng window đó, kể cả khi không focused và khác connection cũ.
- Nếu explicit target stale, MCP không fallback sang focused window khác vì như vậy trái user intent; trả `WINDOW_SELECTION_EXPIRED` kèm fresh candidates khi có để user chọn lại.
- Token sống tối đa 10 phút, bind một extension-host session qua `windowInstanceId`, được claim để chống concurrent reuse và chỉ bị consume sau connection commit thành công.
- Kết quả commit vẫn có thể trả `windowInstanceId` trong connection metadata cho diagnostic, nhưng skill không đưa ID đó trở lại input ở lần sau.

## 6. Vai trò mới của resolve workspace/window

Public tool được đổi atomically từ `resolve_artifact_workspace` thành `resolve_artifact_window`. Catalog sau cutover vẫn có đúng năm tools; đây là rename chứ không thêm tool thứ sáu.

Public resolver không còn:

- chứng minh workspace ownership;
- cấp quyền gắn artifact với repository;
- yêu cầu AI resolve trước khi đọc source hoặc draft artifact;
- tạo `workspaceEvidence` cho `create_artifact`;
- cấp một ID mà AI phải giữ cho default flow.

Default create/reconnect nên tự resolve focused target trong cùng tool call, nên AI không cần gọi resolver trước chỉ để lấy ID. Public resolver còn hữu ích khi:

- user yêu cầu xem hoặc chọn một window cụ thể;
- `explicit-window` cần selection token;
- user đưa query như tên folder/workspace để thu hẹp danh sách live windows trước khi chọn.

Folders có thể tiếp tục xuất hiện trong candidates để tạo nhãn dễ hiểu, ví dụ `Window 1 — focused — agent-plus`. Folder path/name chỉ là display and matching metadata, không phải ownership hoặc authorization.

Ambiguity flow đã chốt:

- default create/reconnect trực tiếp trả reusable window candidates và selection tokens;
- AI trình candidates cho user rồi retry **chính tool vừa gọi** bằng `connection.targetMode="explicit-window"` và token đã chọn;
- không bắt buộc gọi resolver thêm một vòng sau ambiguity;
- `resolve_artifact_window` được gọi chủ động chỉ khi user đã có explicit non-focused intent hoặc muốn xem/chọn window trước request.

Mỗi candidate đại diện một window, kể cả empty window không có workspace folders. Raw UUID là machine metadata; label/folders/workspace file mới là dữ liệu trình user.

## 7. Create và reconnect flow

Focused resolution phải chạy ở preflight:

- create: trước khi tạo artifact directory;
- reconnect: trước takeover, connection commit hoặc lifecycle mutation.

Default flow:

```text
create/reconnect
  -> resolve unique focused/sole live window
  -> nếu unique: tiếp tục trong cùng call
  -> commit đúng một connectionRevision và openRequestId
  -> trả committed connection metadata
```

Explicit flow:

```text
create/reconnect với explicit-window
  -> validate exact selected window
  -> nếu fresh: commit tới chính window đó
  -> nếu stale/invalid: fail trước mutation hoặc trả candidates
```

`wait_for_artifact_review` và `advance_and_wait_for_artifact` không resolve window, không rebind và không emit open request mới.

## 8. AI contract

AI chỉ cần giữ exact artifact handle và lifecycle round:

```ts
artifactDirectory -> reviewRound
```

AI không cần giữ:

```ts
artifactDirectory -> windowInstanceId
chat -> targetWindowId
```

Create/reconnect result vẫn có thể trả committed connection metadata để diagnostic và recovery. Tuy nhiên skill không dùng ID đó làm default target cho request tiếp theo.

AI chỉ truyền explicit window data khi user đã đưa ra explicit-window intent. Nếu user chỉ nói “mở/reopen artifact” thì omit connection target và để MCP chọn focused default.

## 9. Search artifact integration

Search là read-only và chỉ cần trả exact `artifactDirectory` cùng metadata/Markdown cần để chọn artifact. Search không cần trả `windowInstanceId` hoặc tạo affinity với connection cũ.

```text
search_artifacts
  -> AI chọn exact artifactDirectory
  -> inspect_artifact_review(intent: "reconnect")
  -> MCP resolve focused target
  -> commit connection và emit open request
```

Nếu user đồng thời yêu cầu mở search result trong một window cụ thể, AI dùng explicit-window flow riêng sau khi chọn artifact.

Không đưa connection ID cũ vào search candidate giúp tránh stale routing data và giữ search độc lập với live window registry.

## 10. Current implementation gaps

Implementation hiện tại khác contract mục tiêu ở các điểm chính:

- `resolveArtifactConnectionTarget` ưu tiên explicit hint rồi existing artifact connection trước fallback window selection;
- reconnect không có `targetMode`, nên một `windowInstanceId` hint đang được hiểu như target có precedence;
- existing connection còn được dùng làm preferred target mặc định;
- create vẫn chọn window thông qua workspace evidence/selection token;
- reconnect lọc target window theo `artifact.json.location.workspaceRoot`;
- load artifact context vẫn yêu cầu workspace root được đăng ký;
- current resolver query và selection grant vẫn bind `windowInstanceId + workspaceRoot`.

Contract mới phải đổi default selection thành focused-first và chỉ cho explicit selection token tạo target authority.

## 11. Window registry và snapshot lifecycle

Registry heartbeat vẫn cần được giữ vì MCP và extension là hai process khác nhau. MCP cần fresh registry để chọn focused target và validate explicit target.

Snapshot tối thiểu cần giữ:

- `windowInstanceId`;
- `focused`;
- `updatedAt` và `expiresAt`;
- metadata đủ để derive application/window label cho user phân biệt;
- optional folders/workspace file cho display and matching.

Vì snapshot schema v2 được giữ, `activeFile`, canonical folder path và workspace-file metadata vẫn tồn tại cho wire compatibility, label/query và diagnostic. Chúng không còn là ownership boundary hoặc routing priority.

Cleanup hiện chỉ loại expired/malformed snapshots khỏi kết quả đọc; crash residue không được xóa vật lý trong normal operation. Release này thêm bounded pruning cho expired direct-child snapshots với instance/filename validation, mtime + một TTL safety margin, không follow symlink và không tự xóa malformed/unknown files.

## 12. Artifact schema và compatibility boundary

Quyết định không gắn artifact với workspace xung đột trực tiếp với schema v5 hiện tại vì `artifact.json.location.workspaceRoot` đang bắt buộc và MCP revalidates registration trên mỗi load.

Contract đã chốt hard cutover sang artifact schema v6:

- xóa toàn bộ `location` khỏi `artifact.json`, không chỉ làm `workspaceRoot` optional;
- mọi lifecycle document mới dùng schema version 6;
- runtime v6 chỉ parse/load/reconnect/search artifact v6;
- artifact v5 vẫn nằm nguyên trên disk nhưng không được migrate, rewrite, load, reconnect hoặc đưa vào kết quả search;
- unsupported-schema error phải fail closed và chỉ rõ expected version; không được tạo artifact thay thế hay xóa dữ liệu cũ;
- rollback runtime về v5 sẽ thấy lại artifact v5, còn artifact v6 tiếp tục được giữ trên disk nhưng bị runtime cũ reject.

Boundary này phải hoàn tất trước `search_artifacts`, để search chỉ index candidate thuộc live schema v6 ngay từ đầu.

## 13. Connection state và open acknowledgement

Schema connection tối thiểu hiện tại vẫn phù hợp:

```ts
{
  schemaVersion,
  windowInstanceId,
  connectionRevision,
  openRequestId,
  source,
  updatedAt
}
```

Connection file vẫn nằm trong từng artifact directory vì:

- vị trí file event xác định artifact nào cần mở;
- `windowInstanceId` xác định extension host nhận request;
- `connectionRevision` cung cấp ordering/diagnostic;
- `openRequestId` giúp watcher deduplicate event.

Không thêm `workspaceRoot` hoặc artifact identity trùng lặp vào connection state. Connection record là latest open-request state, không phải artifact-to-window ownership.

Current success chỉ xác nhận MCP đã commit connection; nó chưa chứng minh target extension host đã `openWith` thành công. Acknowledgement bind exact `windowInstanceId + connectionRevision + openRequestId` được **defer khỏi release này**. Response, skill và docs không được diễn đạt connection commit thành editor-open confirmation.

## 14. Error và recovery contract

Machine-readable errors đã chốt:

- Không còn `WINDOW_ID_REQUIRED` trong default flow.
- `WINDOW_SELECTION_REQUIRED`: default focused resolution hoặc resolver không có unique candidate; trình user chọn.
- `WINDOW_SELECTION_EXPIRED`: explicit token hết hạn/đã dùng hoặc selected extension-host session không còn fresh; refresh candidates, không fallback.
- `WINDOW_NOT_FOUND`: không có fresh live window.
- Default flow không surface stale/mismatch của connection cũ; nó resolve focused target mới.
- Bỏ workspace-only/stale-ID errors khỏi public recovery contract.

Mọi failure trước target selection phải xảy ra trước create mutation, reconnect takeover và connection commit. Sau khi connection đã commit nhưng delivery/open result không chắc chắn, recovery phải giữ exact artifact handle và không tạo artifact thay thế.

## 15. Ảnh hưởng theo component

- **Shared artifact contracts:** hard cutover schema v6, xóa `location`; thêm explicit-window token input và routing result/error schemas dùng chung.
- **Window registry:** chuyển semantics từ workspace authority sang live-window presence, focus và display metadata; giữ snapshot schema v2/path hiện tại để giảm migration surface; thêm stale-file pruning an toàn.
- **MCP runtime:** focused-first preflight cho create/reconnect; existing connection không còn precedence; selection token chỉ có authority trong explicit-window mode; server lên 9.0.0.
- **Artifact connection:** giữ schema, revision và request-ID atomicity; luôn commit request mới kể cả target ID không đổi.
- **Extension watcher:** giữ matching bằng `windowInstanceId`, dedupe bằng `openRequestId` và `openWith`; release này không thêm acknowledgement.
- **Skill và artifact contract:** không cache window ID; default reconnect omit target; chỉ resolve/pass candidate khi user có explicit-window intent hoặc ambiguity cần lựa chọn.
- **Search artifact:** candidate không trả window ID; search-to-reconnect dùng focused default.
- **Installer/client integration:** rename approval/config entry sang `resolve_artifact_window`, xóa stale entry cũ và cutover runtime + skill + installer atomically. Catalog hiện tại vẫn năm tools; khi thêm `search_artifacts` sau này mới tăng lên sáu.
- **Tests:** unique focus, no focus/sole live, multiple focus, no focus/multiple live, same-ID reopen, focused rebind, stale connection ignored by default, explicit non-focused target, explicit stale target, no-window, no-mutation failures, installer catalog và manual multi-window host validation.
- **Docs/versioning:** philosophy, architecture, README, instruction, skill contract, changelog, MCP/server version và artifact schema compatibility.

## 16. Thứ tự so với search artifact và cleanup

Thứ tự dependency nên là:

```text
window-only artifact contract + focused-default routing
  -> search_artifacts + focused search-to-reconnect
  -> artifact retention/cleanup
```

Search không nên implement trước contract này vì nếu search trả connection/window ID theo model cũ thì sẽ tạo affinity phải bỏ lại ngay. Release này bắt buộc atomic MCP/tool-catalog/skill/installer cutover để tránh mixed contract và nhiều lần reinstall/restart AI client.

## 17. Contract đã chốt cho implementation

- Public resolver là `resolve_artifact_window`, chỉ phục vụ explicit non-focused selection; `query` optional.
- Catalog giữ đúng năm tools và phải cutover runtime + skill + installer trong cùng release candidate.
- Default create/reconnect omit `connection`, tự resolve focused/sole-live target và trực tiếp trả candidates nếu ambiguous.
- Explicit flow dùng `connection: { targetMode: "explicit-window", selectionToken }`; không nhận raw window ID từ AI.
- Artifact schema v6 hard cutoff, không migration hoặc compatibility read cho v5.
- Artifact connection schema giữ v1; window registry snapshot giữ v2 và registry directory hiện tại.
- MCP server lên 9.0.0; extension/package vẫn 1.0.0 vì chưa có public release cần semantic package bump.
- Tên source lịch sử `artifact-review-mcp-v4.ts` và build output hiện tại được giữ để tránh rename churn không liên quan.
- Acknowledgement/editor-open confirmation bị defer; success chỉ có nghĩa connection commit thành công.
- `search_artifacts` và artifact retention cleanup nằm ngoài implementation này; search được làm sau cutover.

# IMPLEMENTATION PLAN

## 1. Mục tiêu và boundary

Mục tiêu release là bỏ hoàn toàn workspace ownership khỏi artifact lifecycle, đổi routing create/reconnect sang focused-window mặc định và vẫn cho phép user chọn explicit non-focused window khi thật sự yêu cầu.

In scope:

- schema v6 và rejection rõ ràng cho v5;
- focused-default/explicit-window routing;
- rename `resolve_artifact_workspace` thành `resolve_artifact_window`;
- giữ connection request protocol v1;
- refactor registry từ workspace authority thành live-window registry;
- bounded pruning cho expired window snapshots;
- cutover source, MCP descriptions, skill, installers/config, tests và docs;
- package/manual validation trên multi-window hosts.

Out of scope:

- `search_artifacts`;
- artifact retention/cleanup;
- migrate, rewrite hoặc delete artifact v5;
- acknowledgement từ extension về MCP;
- guarantee editor đã mở sau khi MCP trả success;
- rename file lịch sử `artifact-review-mcp-v4.ts` hoặc registry directory trên disk.

## 2. Target protocol

### 2.1 Version matrix

| Surface | Target | Compatibility rule |
|---|---:|---|
| VS Code extension/package | `1.0.0` | Giữ version vì package chưa public release |
| MCP server | `9.0.0` | Breaking tool/input/behavior cutover |
| Artifact lifecycle schema | `6` | Chỉ read/write v6; v5 fail closed, không migration |
| Artifact connection schema | `1` | Giữ nguyên payload và atomic commit semantics |
| Window registry snapshot | `2` | Giữ wire format/path; đổi semantics consumer |

Không đổi một version chỉ để đồng bộ số. Mỗi version phản ánh compatibility boundary thực tế của surface đó.

### 2.2 Artifact schema v6

`artifact.json` v6 có exact shape:

```ts
{
  schemaVersion: 6;
  kind: string;
  artifactId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  reviewRound: number;
  reviewSessionId: string;
}
```

- Xóa `location` hoàn toàn.
- `comments.json` và submission tiếp tục dùng cùng artifact schema version, được nâng lên 6.
- Loader không strip field cũ để biến v5 thành v6; strict validation phải reject `location` nếu payload khai schema 6 nhưng còn shape cũ.
- Error unsupported schema phải nêu expected version 6, giữ exact handle và không gợi ý tạo artifact mới.

### 2.3 Public tool catalog

MCP 9.0.0 expose đúng năm tools:

1. `resolve_artifact_window`
2. `create_artifact`
3. `wait_for_artifact_review`
4. `inspect_artifact_review`
5. `advance_and_wait_for_artifact`

`resolve_artifact_workspace` không tồn tại dưới dạng alias. Alias sẽ che giấu partial rollout và khiến verifier không phát hiện skill/runtime lệch version.

### 2.4 Create/reconnect input

`create_artifact` bỏ `workspaceRoot` và `workspaceEvidence`:

```ts
{
  title: string;
  kind: string;
  markdown: string;
  connection?: {
    targetMode: "explicit-window";
    selectionToken: string;
  };
}
```

`inspect_artifact_review(intent: "reconnect")` giữ artifact handle, takeover/round fields hiện có nhưng thay `connection` bằng cùng exact explicit-window shape. Omit `connection` luôn có nghĩa focused-default. Các intent khác không nhận hoặc không dùng window target.

Không public các tổ hợp sau:

- `targetMode: "focused-default"`;
- `windowInstanceId` input;
- token không đi cùng `targetMode: "explicit-window"`;
- đồng thời ID và token.

### 2.5 Window candidate và resolver result

Một candidate đại diện một extension-host window, không đại diện một workspace folder:

```ts
type WindowCandidate = {
  candidateId: string;
  windowInstanceId: string; // machine diagnostic/routing metadata
  focused: boolean;
  snapshotUpdatedAt: string;
  workspaceFile?: string;
  folders: Array<{ name: string; path: string }>;
  label: string;
  selectionToken: string;
  expiresAt: string;
};
```

- Empty window vẫn có candidate với `folders: []` và label fallback ổn định.
- UI/chat trình `label`, focus, workspace file và folders; không bắt user đọc/chọn raw UUID.
- `resolve_artifact_window({ query? })` chỉ đọc fresh snapshots. Query được normalize để match label/workspace-file/folder name/path; nó không biến folder thành ownership evidence.
- Unique match trả `status: "matched"`; nhiều/không có unique match nhưng còn live windows trả `status: "selection-required"`; không có live window trả `status: "not-found"`.
- Với query không match nhưng còn live windows, trả toàn bộ candidates dưới `matchMode: "all-available"` để user chọn; không tự lấy newest snapshot.
- Default create/reconnect ambiguity dùng cùng `WindowCandidate` shape trong structured `WINDOW_SELECTION_REQUIRED` recovery metadata.

### 2.6 Selection-token lifecycle

- TTL giữ 10 phút.
- Grant bind `windowInstanceId`, candidate ID và thời điểm mint; khi dùng phải re-read registry và xác nhận đúng extension-host session vẫn fresh.
- Heartbeat làm đổi `updatedAt` không tự vô hiệu token; `windowInstanceId` mới sau reload/restart mới làm token stale.
- Claim token trước mutation để hai request concurrent không cùng consume token.
- Commit thành công thì consume token; preflight/commit failure thì release claim, chỉ giữ token nếu nó vẫn fresh và chưa hết TTL.
- Token từ resolver hoặc ambiguity response chỉ dùng cho một create/reconnect explicit retry; không cache cho artifact khác hoặc request tương lai.

### 2.7 Deterministic routing

Default preflight:

```text
read fresh snapshots
  -> 1 focused                    => target focused
  -> 0 focused + 1 live           => target sole live
  -> >1 focused                   => WINDOW_SELECTION_REQUIRED
  -> 0 focused + >1 live          => WINDOW_SELECTION_REQUIRED
  -> 0 live                       => WINDOW_NOT_FOUND
```

Explicit preflight:

```text
claim selection token
  -> selected window still fresh  => target exact window
  -> token expired/consumed        => WINDOW_SELECTION_EXPIRED
  -> selected window gone/reloaded => WINDOW_SELECTION_EXPIRED + fresh candidates when available
  -> never fallback to focused window
```

Target selection phải xong trước khi create tạo directory và trước reconnect takeover/grant/connection mutation. Existing `artifact-connection.json` chỉ dùng để tính next revision và diagnostic `retained`/`focused-rebound`; nó không tham gia chọn target mặc định.

Mỗi create/reconnect thành công commit một request mới, kể cả target ID không đổi:

- increment `connectionRevision`;
- generate `openRequestId` mới;
- giữ `source: "create" | "inspect"`;
- atomic replace và lock semantics hiện tại;
- malformed connection vẫn fail closed, không tự reset revision.

### 2.8 Error/recovery contract

| Code | Khi nào | Recovery |
|---|---|---|
| `WINDOW_SELECTION_REQUIRED` | Default không có unique target hoặc resolver có nhiều candidates | Trình candidates; retry same create/reconnect bằng explicit token đã chọn |
| `WINDOW_SELECTION_EXPIRED` | Token hết hạn, đang/đã được dùng hoặc extension-host session biến mất | Giữ handle/draft; refresh candidates rồi hỏi/chọn lại |
| `WINDOW_NOT_FOUND` | Không có fresh live snapshots | Mở/focus VS Code/Cursor window rồi retry exact request |
| `ARTIFACT_CONNECTION_INVALID` | Existing connection malformed/unsupported | Fail closed; không reset hoặc tạo artifact khác |
| `ARTIFACT_CONNECTION_WRITE_FAILED` | Lock/write/replace connection thất bại | Không replay mù; dùng recovery metadata và exact handle |
| Unsupported artifact schema | Artifact không phải v6 | Không load/reconnect/search/migrate; giữ nguyên dữ liệu |

Loại khỏi current recovery contract: `WINDOW_ID_REQUIRED`, `WINDOW_CONNECTION_STALE`, `WINDOW_CONNECTION_MISMATCH` và mọi `WORKSPACE_*` error chỉ phục vụ ownership/resolver cũ.

## 3. Dependency map và work packages

Các work package dưới đây thuộc **một atomic release candidate**. Có thể implement/test tuần tự, nhưng không được deploy riêng từng package.

### WP0 — Preflight và baseline

1. Ghi nhận `git status --short`, đặc biệt các plan/archive changes hiện có; không overwrite hoặc stage thay đổi ngoài scope.
2. Chụp baseline current version/catalog: extension 1.0.0, MCP 8.0.0, schema v5, five-tool list cũ.
3. Chạy baseline:
   - `npm.cmd run check`
   - `npm.cmd test`
   - `npm.cmd run build`
4. Nếu baseline fail, phân loại lỗi có sẵn và dừng việc dùng test đó làm regression gate cho đến khi Chú quyết định xử lý.
5. Không sửa `dist/`, installed global runtime/skill hoặc user client configs trong WP0.

### WP1 — Shared artifact schema v6

Files chính:

- `src/shared/contracts.ts`
- `src/shared/artifact-validation.ts`
- `src/shared/artifact-files.ts`
- các schema consumers trong `src/integration/review-wait-mcp.ts` và `src/integration/stamp-origin.ts`

Tasks:

1. Nâng `ARTIFACT_SCHEMA_VERSION` lên 6 và xóa `location` khỏi strict manifest schema/type.
2. Giữ connection schema/version 1 không đổi.
3. Xóa workspace-only hint schema/classes khỏi shared public contract; thay bằng explicit selection input/error types nếu thực sự shared.
4. Cập nhật validation messages và full artifact-state validation để v5 bị reject trước lifecycle mutation.
5. Audit helper/integration files import artifact schema; cập nhật hoặc xác nhận chúng không phải packaged runtime. Không để compile pass nhờ dead code chưa được kiểm tra.
6. Unit tests khóa exact v6 shape, reject v5, reject `location` dư trong declared-v6 manifest và giữ v1 connection compatibility.

Gate WP1:

- `test/artifact-contracts.test.ts`
- targeted schema tests trong `test/artifact-store.test.ts`, `test/artifact-review-open.test.ts`, `test/artifact-connection.test.ts`.

### WP2 — Window registry semantics và bounded pruning

Files chính:

- `src/shared/workspace-registry.ts`
- `src/extension/workspace-registry-publisher.ts`
- `src/extension/extension.ts`

Tasks:

1. Giữ snapshot schema v2, `managed/workspaces` directory và publisher heartbeat để tránh disk migration không cần thiết.
2. Đổi API/type naming nội bộ theo live-window semantics; folder/workspace file/active file chỉ còn label, query và diagnostic metadata.
3. Giữ UUID per extension-host activation, immediate publish trên workspace/editor/window-state event, heartbeat 15 giây và TTL 45 giây.
4. Resolver phải nhận cả window không có workspace folder.
5. Implement deterministic focused/sole-live selection, không sort-newest để phá ambiguity.
6. Thêm bounded prune ở publisher activation và rate-limited maintenance:
   - chỉ xét direct-child regular JSON file trong exact registry directory;
   - không follow/delete symlink;
   - parsed `instanceId` phải khớp filename;
   - chỉ xóa khi `expiresAt` đã qua thêm ít nhất một TTL safety margin và mtime cũng cũ;
   - không tự xóa malformed/unknown files;
   - prune failure non-fatal và không chặn heartbeat.
7. Dispose vẫn chỉ xóa snapshot do instance hiện tại sở hữu.

Gate WP2:

- `test/workspace-registry.test.ts` cover empty window, fresh/expired, multi-focused, no-focused, symlink/path safety, safety margin và prune race boundary.

### WP3 — Tách window routing khỏi connection persistence

Files chính:

- `src/shared/artifact-connection.ts`
- module window-routing mới hoặc API window-selection trong registry module

Tasks:

1. Giữ trong `artifact-connection.ts`: safe path validation, locking, read, revision calculation, atomic write/replace và staging cleanup.
2. Loại `workspaceRoot`, workspace containment, existing-connection precedence và direct-ID hint khỏi target resolution.
3. Đặt focused-default/explicit-token selection vào module có trách nhiệm window routing rõ ràng; tránh để connection persistence tiếp tục làm workspace resolver trá hình.
4. Tạo một shared candidate builder để resolver và create/reconnect ambiguity trả cùng exact shape.
5. Bảo toàn concurrency guarantees: revision monotonic, unique request ID, no lost update, invalid existing file fail closed.

Gate WP3:

- rewrite phần routing của `test/artifact-connection.test.ts` theo focused-first;
- giữ nguyên regression tests cho lock, atomic replace, staging ownership, symlink/path escape và malformed connection.

### WP4 — MCP 9 runtime và five-tool cutover

File chính: `src/integration/artifact-review-mcp-v4.ts` (giữ filename lịch sử).

Tasks:

1. Đặt `SERVER_VERSION = "9.0.0"`; rename tool constant/schema/handler thành `resolve_artifact_window`.
2. Rewrite initialize instructions và tool descriptions: không resolve workspace trước khi đọc source/draft; không cache window ID; default omit connection.
3. `create_artifact`:
   - remove parser/schema fields `workspaceRoot`, `workspaceEvidence`;
   - run window preflight trước filesystem mutation;
   - create strict v6 files;
   - commit connection request tới selected target;
   - return exact handle/link/round và committed connection metadata;
   - return structured candidates directly on ambiguity.
4. Artifact loader/reconnect:
   - remove manifest workspace registration validation;
   - reject v5 before takeover;
   - default reconnect ignores existing target and resolves focused/sole-live;
   - explicit reconnect validates token and never falls back;
   - preflight occurs before takeover, round grant hoặc connection commit.
5. Resolver:
   - optional query;
   - one candidate per fresh window;
   - mint explicit tokens;
   - return all available windows when query has no unique match;
   - never create/mutate artifact lifecycle files.
6. Wait/advance/normal inspect remain window-neutral and preserve connection file unchanged.
7. Centralize token grant/claim/consume logic so resolver, create ambiguity và reconnect ambiguity không có ba implementations lệch nhau.
8. Results gọi phần trả về là committed connection metadata và mô tả editor-open là unconfirmed; không thêm `opened: true` hoặc wording tương đương.

Gate WP4:

- targeted `test/review-wait-mcp.test.ts` cho tool list, schemas, create, reconnect, token, error metadata, pre-mutation failures và same-ID new request.

### WP5 — Extension consumers

Files chính:

- `src/extension/artifact-store.ts`
- `src/extension/artifact-review-open.ts`
- `src/extension/extension.ts`

Tasks:

1. Store/list/load chỉ accept strict v6; v5 bị skip/reject theo operation hiện có, không bị delete.
2. Update fixtures/types đã giả định `location.workspaceRoot`.
3. Giữ watcher protocol:
   - read schema-v1 connection;
   - chỉ matching local `windowInstanceId` mới mở;
   - dedupe `openRequestId`;
   - revision/order safeguards hiện có;
   - `vscode.openWith` flow hiện có.
4. Không thêm ack file/watcher/API trong release này.
5. Xác nhận `autoOpen=false` vẫn cho MCP commit connection nhưng không mở UI; đây là expected behavior, không phải false success regression mới.

Gate WP5:

- `test/artifact-store.test.ts`
- `test/artifact-review-open.test.ts`
- lifecycle/provider regressions liên quan trong full suite.

### WP6 — Skill và artifact contract

Files:

- `skills/create-review-artifact/SKILL.md`
- `skills/create-review-artifact/references/artifact-contract.md`
- `skills/create-review-artifact/agents/openai.yaml` nếu prompt cần đồng bộ

Tasks:

1. Required catalog đổi sang five-tool list mới; không chấp nhận old resolver alias.
2. Bỏ pre-create workspace resolution/evidence và rule giữ `workspaceRoot`.
3. AI chỉ giữ `artifactDirectory -> reviewRound`; connection metadata là diagnostic, không phải state cần replay.
4. Default create/reconnect omit `connection` hoàn toàn.
5. “Window này/current window” dùng focused-default. Chỉ dùng resolver khi user chỉ rõ một non-focused window hoặc muốn chọn từ danh sách.
6. Khi create/reconnect trả ambiguity, trình human-readable labels rồi retry exact same tool bằng selected explicit token.
7. Explicit token stale thì refresh candidates và hỏi/chọn lại; không âm thầm fallback focused.
8. Giữ exact-handle, takeover, round-token, comment handling và Proceed semantics hiện có.
9. Ghi rõ connection commit không bảo đảm custom editor đã mở.

Gate WP6:

- `test/skill-contract.test.ts`
- `test/artifact-link-contract.test.ts`
- grep active skill/reference không còn instruction cache ID, workspace evidence hoặc call old resolver.

### WP7 — Installer, client configs và deployed-asset verifier

Files chính:

- `src/extension/mcp-config.ts`
- `src/extension/mcp-clients/*.ts`
- integration status/install orchestration liên quan

Tasks:

1. Codex TOML per-tool approval table rename sang `resolve_artifact_window`.
2. Upsert phải remove stale managed table cho `resolve_artifact_workspace`; không để cả old và new approvals song song.
3. Managed-config verifier yêu cầu exact new five-tool catalog/version contract nơi có thể probe; old catalog phải hiện trạng thái cần reinstall/restart.
4. JSON-based clients không hard-code tool permissions vẫn phải được test vì chúng deploy cùng runtime/skill.
5. Install operation stage/copy runtime và skill cùng version; chỉ report Ready khi cả server asset, config và skill đều đúng. Partial copy phải report mismatch, không Ready.
6. Không sửa installed global assets trong source-test phase; chỉ cutover chúng ở Release Unit 2.

Gate WP7:

- `test/mcp-config.test.ts`
- `test/mcp-client-drivers.test.ts`
- `test/global-integration-status.test.ts`
- `test/workspace-integration.test.ts`.

### WP8 — Docs và version contract

Files:

- `README.md`
- `docs/PHILOSOPHY.md`
- `docs/ARCHITECTURE.md`
- `docs/COMPONENTS.md`
- `docs/INSTRUCTION.md`
- `docs/CHANGE_LOGS.md`
- `CHANGELOG.md`

Tasks:

1. Cập nhật source-of-truth docs theo window-only lifecycle, schema v6, MCP 9 và exact five-tool list.
2. Phân biệt rõ connection commit với confirmed editor open.
3. Ghi compatibility/rollback: v5 preserved nhưng unavailable dưới v6; no migration.
4. Ghi `search_artifacts` là follow-up và sẽ là tool thứ sáu, không mô tả như đã ship.
5. Giữ các changelog entry lịch sử nói về old resolver/schema; thêm entry mới thay vì rewrite history.
6. Ghi component/file impact và verification evidence vào `docs/CHANGE_LOGS.md` khi implementation thực sự hoàn tất.

Gate WP8:

- `test/release-contract.test.ts`
- current-doc consistency sweep có allowlist cho historical changelog/archived plans.

### WP9 — Automated regression consolidation

Tests bắt buộc audit/update:

- `test/artifact-contracts.test.ts`
- `test/workspace-registry.test.ts`
- `test/artifact-connection.test.ts`
- `test/review-wait-mcp.test.ts`
- `test/artifact-store.test.ts`
- `test/artifact-review-open.test.ts`
- `test/skill-contract.test.ts`
- `test/artifact-link-contract.test.ts`
- `test/mcp-config.test.ts`
- `test/mcp-client-drivers.test.ts`
- `test/global-integration-status.test.ts`
- `test/workspace-integration.test.ts`
- `test/release-contract.test.ts`
- `test/global-artifact-path.test.ts` nếu fixture manifest/schema đi qua helper chung.

Các test không được chỉ đổi literal 5 thành 6. Mỗi nhóm phải chứng minh behavior boundary mới: no workspace ownership, deterministic focus, explicit token, no mutation on ambiguity/stale target, atomic new request và old-schema preservation.

## 4. Release units và execution order

### Release Unit 1 — Atomic source contract cutover

Order:

```text
WP0 baseline
  -> WP1 schema
  -> WP2 registry + WP3 routing/persistence
  -> WP4 MCP + WP5 extension consumers
  -> WP6 skill + WP7 installer/config
  -> WP8 docs + WP9 regression consolidation
```

WP2 và WP3 có thể phát triển song song về mặt code, nhưng merge gate phải dùng shared candidate/input contracts thống nhất. Không deploy MCP 9 trước skill/config mới và không deploy skill mới trước MCP 9.

RU1 verification order:

1. Chạy targeted suites của từng WP.
2. `npm.cmd run check`.
3. `npm.cmd test`.
4. `npm.cmd run build`.
5. Inspect built MCP initialize response/tool list trong test harness: version 9.0.0, exact five tools, không old alias.
6. Consistency sweep:
   - active source/skill/current docs không còn `resolve_artifact_workspace`;
   - active create/reconnect schemas không còn `workspaceRoot`, `workspaceEvidence`, direct `windowInstanceId` input;
   - v5 literals chỉ còn rejection tests, historical docs hoặc archived plans;
   - connection schema remains 1 và registry schema remains 2.
7. Review diff theo component và xác nhận không kéo unrelated dirty-tree changes vào scope.

Exit gate RU1: check/test/build xanh, source + skill + installer + docs cùng contract, nhưng chưa claim host behavior hoặc release readiness chỉ từ unit tests.

### Release Unit 2 — Package, install và host evidence

1. Chạy package command sau khi xác nhận `releases/` chỉ chứa generated artifacts; lưu exact VSIX filename/hash.
2. Inspect VSIX contents:
   - bundled MCP reports 9.0.0;
   - exact five-tool catalog mới;
   - bundled skill/reference không còn old contract;
   - schema v6 code nằm trong extension và MCP bundles.
3. Cài exact VSIX candidate vào VS Code và Cursor test hosts.
4. Chạy **Install All Detected Integrations** hoặc từng client installer cần thiết; xác nhận old managed tool approval bị xóa và runtime + skill mới cùng được deploy.
5. Restart extension hosts/AI clients và mở chat mới để tránh MCP/tool cache cũ.
6. Chạy manual matrix ở mục 5, lưu evidence theo host/client; không suy luận Cursor từ VS Code hoặc config unit tests.
7. Uninstall/rollback rehearsal phải chứng minh không xóa artifact collection v5/v6 ngoài hành vi uninstall đã được product chủ ý; mọi destructive cleanup cần được kiểm tra exact target trước.

Exit gate RU2: package contents đúng, installer state Ready, manual multi-window cases pass trên các supported hosts được tuyên bố, rollback được diễn tập và không có data migration/deletion.

## 5. Manual multi-window validation matrix

| # | Setup/action | Expected |
|---:|---|---|
| 1 | Hai live windows, đúng một focused; default create | Commit/open request tới focused window |
| 2 | Existing connection trỏ non-focused; focus window khác; default reconnect | Rebind sang focused, revision/request ID mới |
| 3 | Existing connection đã trỏ focused; default reconnect | Vẫn commit revision/request ID mới và watcher reveal/reopen |
| 4 | Không snapshot nào focused, chỉ một live window | Chọn sole live window |
| 5 | Không focused, nhiều live windows | `WINDOW_SELECTION_REQUIRED`, không create/takeover/commit |
| 6 | Race tạo nhiều focused snapshots | Trả candidates, không chọn newest |
| 7 | User chỉ rõ non-focused window; resolver + explicit retry | Commit đúng selected window dù nó không focused |
| 8 | Token được mint rồi target reload/restart/hết TTL | `WINDOW_SELECTION_EXPIRED`, fresh candidates nếu có, không fallback |
| 9 | VS Code restart làm existing connection stale; default reconnect | Bỏ stale affinity và dùng current focused window |
| 10 | Target là empty window không có workspace folders | Window vẫn xuất hiện/chọn được |
| 11 | `autoOpen=false` | Connection commit thành công, không mở UI, response không claim opened |
| 12 | Exact v5 handle và exact v6 handle | v5 reject/skip sạch, v6 lifecycle hoạt động, v5 files không đổi |
| 13 | Wait và advance sau reconnect | Không resolve/rebind/emit open request mới |
| 14 | Full Review → revise/approve/save lifecycle | Không regression round token, takeover, Proceed và Save |
| 15 | Focus đổi ngay trước request | Immediate window-state publish được quan sát; request dùng snapshot fresh hoặc trả ambiguity an toàn |
| 16 | Explicit selection giữa hai windows mở cùng folder | Token phân biệt đúng extension-host window, không dựa vào folder ownership |

Mỗi case cần capture: host/client, snapshot IDs/focus state, tool input mode, structured result/error, connection revision/request ID trước-sau và editor observation. Editor observation là manual evidence riêng, không được gộp thành MCP acknowledgement.

## 6. Rollback strategy

1. Không migration nên rollback không cần reverse-transform artifact data.
2. Roll back atomically runtime + skill + managed client config về MCP 8/schema-v5 contract; không chỉ copy lại một server file.
3. Giữ nguyên toàn bộ artifact directories và connection files:
   - runtime v8 có thể đọc lại v5;
   - runtime v8 reject v6 nhưng không delete;
   - connection schema v1 không cần downgrade.
4. Nếu installer cutover partial, integration status phải báo mismatch; chọn hoàn tất reinstall hoặc restore toàn bộ previous asset set.
5. Không dùng rollback để xóa v6 hay stale registry thủ công. Registry cleanup chỉ dùng bounded prune policy đã test.

Rollback trigger:

- tool catalog/runtime/skill không đồng version sau reinstall;
- create/reconnect có mutation trước ambiguity/stale-target failure;
- routing mở sai live window;
- v5 bị rewrite/delete;
- connection revision/open-request atomicity regression;
- supported host E2E gate không đạt.

## 7. Risks và mitigations

| Risk | Mitigation/gate |
|---|---|
| Partial runtime/skill/config cutover | Exact catalog/version verifier; one install unit; fresh client restart |
| Focus snapshots race hoặc app switch | Unique-focused/sole-live only; otherwise candidates, never newest |
| AI tiếp tục cache/replay window ID | Remove ID input; skill mapping chỉ handle/round; explicit single-use token |
| Token mất hiệu lực vì heartbeat | Validate host session/freshness, không bind equality với changing `updatedAt` |
| Snapshot pruning xóa live window | Extra TTL + mtime margin, direct child, instance/filename check, no symlink |
| V5 data trở nên “mất” với user | Clear hard-cutoff error/docs, no delete/migration, tested rollback visibility |
| Same-window reconnect không phát event mới | Always increment revision và generate new `openRequestId` |
| MCP success bị hiểu là editor đã mở | Response chỉ gọi là committed connection; docs/skill disclaim ack; manual UI evidence riêng |
| Future search tái tạo window affinity | Search candidate không có window ID; reconnect vẫn focused-default |

## 8. Definition of done

Feature chỉ hoàn tất khi tất cả điều kiện sau cùng đúng:

- strict artifact schema v6 không có `location`; v5 preserved nhưng rejected;
- MCP 9 expose exact five-tool catalog với `resolve_artifact_window` và không alias cũ;
- create/reconnect default không nhận/cần window ID, luôn focused-first và deterministic;
- ambiguity/stale explicit target fail trước lifecycle mutation và trả recovery metadata dùng được;
- explicit non-focused token mở đúng selected extension-host window;
- connection schema v1 giữ atomic revision/request-ID behavior;
- wait/advance không rebind window;
- skill không giữ window ID và chỉ giữ exact handle/round;
- installer/config/verifier cutover runtime + skill + tool approvals atomically;
- current docs/changelog phản ánh đúng contract và không claim acknowledgement;
- targeted tests, full check/test/build, VSIX inspection và manual supported-host matrix đều pass;
- rollback rehearsal giữ nguyên v5/v6 artifact data;
- search/cleanup/ack vẫn được ghi rõ là follow-up, không bị lẫn vào shipped scope.
