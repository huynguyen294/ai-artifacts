# IDEAS:

- Hiện tại AI chưa có product-level mechanism để tìm lại một artifact khi không còn exact `artifactDirectory`.
- Thêm public MCP tool `search_artifacts`; tool chỉ chạy khi user chủ động yêu cầu tìm artifact.
- Query chính là title hoặc một title fragment đủ dùng do AI trích xuất từ yêu cầu; nếu không có search term hữu ích thì AI hỏi lại user.
- MCP tìm trong canonical global artifact collection, validate candidates và trả metadata cùng bounded Markdown để AI semantic-disambiguate.
- AI tự chọn khi có một unique high-confidence candidate; nếu vẫn mơ hồ thì trình bày candidates và hỏi user.
- Search chỉ trả exact artifact handle và artifact metadata/content cần thiết; không trả hoặc thiết lập window affinity.
- Nếu user chỉ muốn tìm/đọc, AI dùng plain `inspect_artifact_review`. Nếu user muốn mở trong VS Code, lần reconnect đầu sau search mặc định omit `connection`, nên MCP chọn sole/focused window.
- Reconnect thành công trả committed `windowInstanceId`; lúc đó AI mới cache ID theo `artifactDirectory` cho các generic reconnect tiếp theo.
- Nếu user chỉ rõ một window, AI dùng `resolve_artifact_window` và `explicit-window` selection token; không suy luận target từ persisted connection của search candidate.

# ANALYZED:

## 1. Bối cảnh hiện tại

- Artifact schema hiện tại và duy nhất được hỗ trợ là schema v6, lưu tại `~/.ai-artifacts/artifacts/<artifact-id>/`.
- Artifacts thuộc review sessions, không thuộc workspace/repository. `artifact.json` không còn `location.workspaceRoot`.
- Lifecycle hiện tại yêu cầu AI giữ exact `artifactDirectory` do `create_artifact` trả về. Nếu mất handle hoặc bắt đầu chat mới, AI chưa có public tool chính thức để tìm lại artifact.
- `artifactDirectory` là absolute path tới direct-child lifecycle directory trong canonical global collection, không phải workspace root và không phải path trực tiếp tới `artifact.md`.
- Một artifact directory gồm:
  - `artifact.json`: schema-v6 source of truth cho identity, title, kind, timestamps, review round và review session;
  - `artifact.md`: nội dung Markdown hiện tại;
  - `comments.json`: comments của current round và artifact-hash binding;
  - `review-submission.json`: optional, xuất hiện sau Review, Proceed hoặc Just save;
  - `artifact-connection.json`: optional UI-routing state gồm `windowInstanceId`, `connectionRevision`, `openRequestId`, `source` và `updatedAt`.
- Search chưa được implement trong source hiện tại. Public catalog vẫn có năm tools và hard-code tool list ở MCP runtime, skill, installer/config và release tests.
- Window-affinity reconnect trong `plans/change-resolve-workspace-contract/improve.md` là dependency đi trước search. Search analysis này giả định contract đó đã được implement/cut over.

## 2. Quyết định sản phẩm đã chốt

- Thêm một public MCP search tool; không dùng shell/filesystem access của AI làm product contract.
- Search chỉ được kích hoạt khi user chủ động yêu cầu tìm artifact. Đây là ngoại lệ có chủ ý cho invariant “không scan global storage để đoán handle”.
- MCP chịu trách nhiệm enumerate canonical collection, validate dữ liệu và trả candidates. AI chịu trách nhiệm hiểu yêu cầu, semantic-disambiguate và chọn candidate.
- MCP được phép trả bounded `artifact.md` content để AI phân biệt candidates có title giống hoặc gần nhau.
- AI được tự chọn candidate khi có một lựa chọn duy nhất đủ rõ ràng từ title, metadata và nội dung; không chọn chỉ vì candidate mới nhất.
- Nếu các lựa chọn mạnh nhất vẫn mơ hồ, AI giải thích ngắn gọn và hỏi user chọn.
- Candidate được chọn phải cung cấp exact `artifactDirectory`. Mọi downstream inspect/reconnect vẫn revalidate artifact context.
- Search không tự mở editor, không reconnect, không takeover waiter, không tạo round token và không mutate lifecycle files.
- Search không đọc/trả window routing state để tạo affinity. Chỉ create hoặc reconnect thành công mới được refresh AI window-ID cache.
- Search result không phải authorization để mutate artifact hoặc execute một action cũ.

## 3. Phân chia trách nhiệm

### AI

- Nhận biết explicit search intent từ user.
- Trích xuất title/title fragment hoặc hỏi lại nếu không có search term hữu ích.
- Gọi `search_artifacts` thay vì tự scan `~/.ai-artifacts/artifacts/`.
- So sánh title, metadata và bounded Markdown với toàn bộ yêu cầu của user.
- Tự chọn unique high-confidence candidate; không dùng recency làm tie-breaker duy nhất.
- Nếu ambiguous, trình bày candidates bằng title và metadata dễ hiểu rồi hỏi user.
- Sau selection, giữ exact `artifactDirectory` và dùng lifecycle tool theo user intent.
- Không lấy `windowInstanceId`, `connectionRevision` hoặc `openRequestId` từ search result để tạo affinity.
- Chỉ cache/refresh per-artifact `windowInstanceId` từ successful create/reconnect result.

### MCP

- Chỉ enumerate direct-child artifact directories trong canonical global collection.
- Validate canonical containment, artifact-directory/ID binding, exact schema v6 và linked-path safety trước khi trả candidate.
- Search/rank theo title và trả deterministic results.
- Chỉ đọc Markdown của title-matched shortlist, áp dụng per-candidate và total response budget.
- Không đọc/trả comments, review submission hoặc `artifact-connection.json` trong search result.
- Trả exact `artifactDirectory` để inspect/reconnect tiếp tục làm final validation boundary.
- Không ghi lifecycle files hoặc workspace registry trong search.

## 4. Search, inspect và open flow

### 4.1. Search và chọn candidate

```text
User yêu cầu tìm artifact
  -> AI trích xuất title/title fragment hoặc hỏi lại
  -> search_artifacts({ query })
  -> MCP enumerate + validate schema-v6 candidates
  -> MCP trả metadata + bounded Markdown
  -> AI semantic-disambiguate
       unique high-confidence -> chọn
       ambiguous -> hỏi user
  -> AI giữ candidate.artifactDirectory
```

`artifactDirectory` từ search là exact handle nhưng không bỏ qua revalidation. Nếu artifact bị xóa, bị thay thế hoặc thay đổi unsafe giữa search và downstream call thì inspect/reconnect phải fail closed.

### 4.2. User chỉ muốn tìm hoặc đọc

```ts
inspect_artifact_review({
  artifactDirectory,
})
```

- Plain inspect đọc current validated state.
- Không emit open request.
- Không validate live window.
- Không refresh AI window affinity cache.

### 4.3. User muốn tìm và mở trong VS Code

Khi artifact vừa được tìm lại và AI không có pre-existing cache hợp lệ cho exact handle:

```ts
inspect_artifact_review({
  artifactDirectory,
  intent: "reconnect",
})
```

AI omit `connection`. Routing mục tiêu:

```text
0 fresh windows
  -> WINDOW_NOT_FOUND

1 fresh window
  -> chọn sole window

multiple fresh windows
  -> đúng 1 focused window: chọn focused window
  -> 0 hoặc nhiều focused windows: WINDOW_SELECTION_REQUIRED
```

Reconnect thành công:

- commit connection request mới;
- trả committed `windowInstanceId`, `connectionRevision`, `openRequestId`, `source` và `updatedAt`;
- AI lưu returned `windowInstanceId` theo exact `artifactDirectory`;
- những generic reconnect tiếp theo có thể gửi `targetMode: "artifact-window"` theo window-affinity contract.

“Fresh window ID” ở đây là ID của một window có fresh registry snapshot và vừa được MCP chọn/commit; MCP không mint một window UUID mới trong reconnect.

Nếu cached ID sau đó stale hoặc mismatch, reconnect tự fallback sang sole/focused target, trả committed ID mới và AI thay cache. AI không gửi hoặc so sánh `connectionRevision` để quyết định affinity.

### 4.4. User chỉ rõ window

| User intent | AI behavior |
|---|---|
| “Tìm artifact X” | Search; không tự mở |
| “Tìm và đọc artifact X” | Search -> plain inspect |
| “Tìm và mở artifact X” | Search -> reconnect omit affinity -> sole/focused |
| “Tìm và mở trong window hiện tại” | Search -> reconnect omit affinity -> sole/focused |
| “Tìm và mở trong window X” | Search -> `resolve_artifact_window` -> reconnect bằng `explicit-window` token |

Explicit-window target không fallback. Token stale/invalid hoặc target đã đóng phải fail để AI/user chọn lại.

Search result tự nó không tạo hoặc overwrite một existing per-artifact mapping. Nếu AI thật sự đã giữ mapping từ một successful create/reconnect cho cùng exact handle, mapping đó vẫn tuân theo generic reconnect contract; tuy nhiên normal search-recovery/new-chat flow không có mapping và vì vậy mặc định đi sole/focused.

## 5. Search input và matching direction

Input tối thiểu ở mức ý tưởng:

```ts
search_artifacts({
  query: string;
})
```

Matching direction:

1. `exact-title`: title giống query sau khi trim.
2. `normalized-title`: không phân biệt hoa/thường và normalize Unicode/separator/khoảng trắng theo rule được chốt trong implementation analysis.
3. `partial-title`: normalized title chứa normalized query hoặc chiều ngược lại nếu rule không tạo match quá rộng.

Không dùng `updatedAt`, `createdAt` hoặc directory order làm lý do duy nhất để tự chọn artifact. Fuzzy matching sâu hơn, minimum query length, stable ordering và pagination sẽ được chốt trong implementation analysis.

## 6. Candidate và result data

Candidate cần đủ dữ liệu để semantic-disambiguate và tiếp tục lifecycle, nhưng không chứa workspace/window routing state:

```ts
type ArtifactSearchCandidate = {
  artifactDirectory: string;
  artifactId: string;
  title: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  reviewRound: number;
  match: "exact-title" | "normalized-title" | "partial-title";
  markdownPreview?: string;
  markdownSha256: string;
  markdownBytes: number;
  markdownTruncated: boolean;
};
```

Không đưa vào candidate:

- `workspaceRoot` hoặc bất kỳ repository ownership field nào;
- `windowInstanceId`;
- `connectionRevision`;
- `openRequestId`;
- comments hoặc review submission.

Result direction:

```ts
type ArtifactSearchResult = {
  status: "matched" | "candidates" | "not-found";
  query: string;
  candidates: ArtifactSearchCandidate[];
  hasMore?: boolean;
  nextCursor?: string;
};
```

`matched` chỉ nên phản ánh một deterministic title-match outcome, không thay AI semantic judgement khi nhiều plausible candidates còn tồn tại.

Artifact selection token riêng chưa cần thiết: search trả validated exact handle, còn downstream inspect/reconnect revalidates handle và current state. Pagination cursor, nếu có, chỉ điều khiển search result page; nó không authorize lifecycle mutation.

## 7. Markdown và response-size boundary

- Cho phép bounded Markdown để AI phân biệt candidates là yêu cầu đã chốt.
- Không trả toàn bộ Markdown của mọi candidate không giới hạn. Artifact có thể lớn tới 2 MB và runtime có thể biểu diễn data qua cả text `content` lẫn `structuredContent`.
- Direction:
  - giới hạn số candidates mỗi response;
  - chỉ đọc Markdown cho title-matched shortlist;
  - áp dụng per-candidate và total UTF-8 byte budget;
  - báo `markdownBytes` và `markdownTruncated`;
  - truncate theo UTF-8/code-point-safe boundary;
  - dùng metadata + preview cho selection, sau đó plain inspect exact candidate để lấy full current state;
  - refine query hoặc pagination khi kết quả quá rộng.
- Các con số như tối đa 5 candidates, preview 16–32 KB/candidate và khoảng 128 KB tổng Markdown vẫn là recommendation sơ bộ, chưa phải contract đã chốt.
- Implementation analysis phải quyết định chỉ dùng `markdownPreview` hay một field khác để tránh vừa `markdown` vừa `markdownPreview` gây ambiguous semantics.

## 8. Safety, privacy và failure policy

- Không dựa vào việc AI client có shell access hoặc quyền đọc user home.
- AI không trực tiếp parse lifecycle files; MCP dùng chung validation boundary cho mọi client.
- Search chỉ đọc manifest và bounded Markdown cần cho explicit user request.
- Search không đọc comments/submissions/connection state vì không cần cho candidate selection và có thể chứa state nhạy cảm hoặc stale.
- Unsupported schemas v3/v4/v5 không được trả như live candidates và không được migrate trong search.
- Symlink/junction, escaped path và artifact-directory/ID mismatch phải bị loại theo existing safety invariants.
- Malformed, locked, partially written hoặc unreadable artifact policy cần chốt giữa:
  - skip candidate và trả bounded diagnostics/count;
  - fail toàn bộ request khi collection integrity không thể tin cậy.
- Search result không authorize update/advance/reconnect; downstream lifecycle tool luôn revalidates exact handle.
- Không log full Markdown, comments, submissions hoặc sensitive paths ngoài diagnostics tối thiểu cần thiết.

## 9. Window routing integration

Search không phụ thuộc live window registry và không gọi resolver. Window chỉ được xét khi user yêu cầu open/reconnect sau candidate selection.

Default post-search open dùng focused window trong đa số multi-window cases vì search recovery thường không có cached affinity:

```text
search selected handle
  -> reconnect without connection
  -> sole window, otherwise unique focused window
  -> reconnect result returns committed ID
  -> AI caches ID for later reconnects
```

Các boundaries phải giữ:

- search result không được coi persisted `artifact-connection.json` là live target evidence;
- plain inspect result không refresh affinity;
- reconnect result mới là source cho fresh per-artifact window ID;
- explicit named-window intent dùng resolver token và có priority cao hơn default routing;
- no/multiple focused windows vẫn yêu cầu candidate selection thay vì MCP đoán.

## 10. Ảnh hưởng theo component

### MCP runtime

- Thêm public tool `search_artifacts`.
- Thêm canonical collection enumeration, title matching/ranking, bounded Markdown loading và candidate serialization.
- Tool chỉ read; không dùng waiter registry, window registry hoặc connection commit path.

### Shared safety/contracts

- Cân nhắc reusable read-only collection enumeration và search input/result schemas.
- Reuse schema-v6/path/link validation hiện tại; không tạo validation path yếu hơn chỉ dành cho search.

### Skill và artifact contract

- Thêm explicit search intent, title extraction, candidate selection và ambiguity policy.
- Thêm intent split: search-only, search-and-read, search-and-open, explicit-window open.
- Sau search-open, cache returned reconnect `windowInstanceId`; search/plain inspect không refresh cache.
- Giữ exact handle và không chọn theo recency.

### Installer và client configuration

- Public MCP catalog tăng từ 5 lên 6 tools.
- `src/extension/mcp-config.ts` phải thêm Codex approval block và `requiredTools` entry cho `search_artifacts`.
- Đồng bộ client drivers, installed runtime/skill verification và tool-availability checks.
- Runtime, skill và installer/config phải cut over cùng release; AI client cần restart/new chat để tránh cached catalog/schema.

### Tests

- Tool catalog và six-tool availability.
- Exact/normalized/partial matching, stable ordering, duplicate titles và ambiguous selection.
- Schema-v6-only, corrupt/legacy/linked/unreadable artifacts và race search-to-inspect.
- Pagination/limits, UTF-8 truncation và response budget.
- Search-only không mutate lifecycle/window connection.
- Search-to-plain-inspect không mở editor hoặc refresh affinity.
- Search-to-reconnect không affinity chọn sole/focused và trả committed ID.
- AI/skill cache ID từ reconnect result; later reconnect gửi artifact-window hint.
- Explicit named-window flow dùng selection token.

### Docs và versioning

- Cập nhật README, philosophy, architecture, skill contract, `docs/CHANGE_LOGS.md` và `CHANGELOG.md`.
- Thay mọi “exactly five tools” current-state claim thành six sau search cutover.
- Chốt MCP/server/package version theo release status tại thời điểm implementation.

## 11. Compatibility, dependency và rollout direction

Thứ tự feature đề xuất:

```text
window-affinity reconnect
  -> search_artifacts
  -> cleanup/retention
```

Lý do:

- search-to-open cần window reconnect contract đã ổn định;
- search candidate không nên mang workaround window/workspace fields tạm thời;
- cleanup sau search giúp search semantics và deletion-race handling được thiết kế trên canonical enumeration path rõ ràng.

Compatibility:

- old skill + new six-tool MCP có thể không dùng search nhưng existing lifecycle vẫn hoạt động nếu input schemas của năm lifecycle tools hiện có không bị đổi bởi search release;
- new skill + old five-tool MCP không thể thực hiện search và phải yêu cầu reinstall/restart;
- installer verification phải phát hiện catalog/runtime/skill mismatch;
- không hỗ trợ mixed-version behavior bằng cách cho skill tự scan filesystem.

## 12. Đánh giá độ khó sơ bộ

- Thuật toán title search tự thân không khó.
- Độ khó tổng thể ở mức trung bình-khá, khoảng 6/10, vì thay đổi public tool catalog và mở một explicit enumeration path qua global artifact collection.
- Window integration sau khi có affinity contract mới là đơn giản: search không giữ window state; post-search open mặc định sole/focused rồi cache reconnect result.
- Phần cần thiết kế kỹ nhất vẫn là response-size boundary, canonical enumeration safety, partial-failure policy, stable pagination và atomic runtime/skill/installer cutover.

## 13. Các điểm dành cho implementation analysis sau

- Tên public tool cuối cùng và MCP/server/package version mới.
- Input schema đầy đủ, query validation và minimum usable query length.
- Unicode normalization, matching/ranking và stable ordering chính xác.
- Maximum candidates, pagination/cursor contract và behavior khi collection thay đổi giữa pages.
- Preview field, per-candidate/total byte budgets và duplicate `content`/`structuredContent` handling.
- Policy cho malformed, locked, partially written, legacy-schema và linked artifacts.
- Search candidate/result schemas nên đặt ở MCP-local hay `src/shared`.
- Bounded diagnostics có được expose hay chỉ trả skipped count.
- Search có cần pagination cursor ký/bound state hay stateless cursor là đủ.
- Skill trigger, six-tool availability contract và atomic cutover strategy.
- Test matrix, release units, performance threshold, installed-host validation và rollback boundary.

# IMPLEMENTATION PLAN:

Chưa phân tích hoặc lập implementation plan ở bước này. Phần này sẽ được thực hiện riêng sau khi Chú yêu cầu.
