# PRODUCT DECISIONS

- Artifact là dữ liệu review tạm thời, tương tự ngữ cảnh chat, không phải dữ liệu lâu dài mà sản phẩm cam kết giữ vô thời hạn.
- Nếu muốn giữ nội dung lâu dài, người dùng phải:
  - hoàn tất **Just save** flow để AI copy Markdown tới destination bên ngoài artifact lifecycle;
  - dùng **Copy Markdown**; hoặc
  - chủ động lưu nội dung vào repository/vị trí khác.
- Chỉ nhấn **Just save** nhưng chưa hoàn tất bước copy ra destination không biến artifact thành dữ liệu được giữ vĩnh viễn.
- Exact `artifactDirectory` chỉ hợp lệ trong thời gian artifact còn tồn tại. Reconnect không được bảo đảm sau khi cleanup đã xóa artifact.
- Có setting machine-scoped `agentPlus.artifactRetentionDays`; mặc định là **30 ngày**.
- Setting chỉ chấp nhận số nguyên dương. Giá trị `0` không có nghĩa là disable cleanup và không được hỗ trợ.
- Giá trị retention phải chuyển đổi sang milliseconds trong giới hạn safe integer; invalid value phải bị reject/fallback rõ ràng, không silently clamp.
- Cleanup áp dụng cho artifact ở mọi lifecycle state. Pending waiter, revise, approve, save, comments hay submission không thay đổi eligibility.
- Eligibility chỉ dựa trên `artifact.json.updatedAt`:

  ```text
  expiresAt = updatedAt + retentionDays
  eligible  = now >= expiresAt
  ```

- `artifact.json.updatedAt` tiếp tục có nghĩa là thời điểm Markdown thực sự thay đổi:
  - khi tạo artifact, `updatedAt` bằng thời điểm tạo;
  - Markdown SHA thay đổi thì cập nhật `updatedAt`;
  - Markdown SHA không đổi thì giữ nguyên `updatedAt`;
  - inspect, search/open, reload editor, reconnect, wait, comment, submit decision và unchanged-Markdown advance không gia hạn retention.
- `artifact-connection.json.updatedAt` là timestamp của UI-routing state và tuyệt đối không được dùng để tính artifact retention.
- Artifact cũ dùng trực tiếp `artifact.json.updatedAt` hiện có. Không có upgrade grace period.
- Automatic cleanup chỉ xét validated schema-v6 artifacts trong canonical global collection.
- Legacy v3/v4/v5, malformed, linked, escaped hoặc otherwise unsafe entries không được automatic cleanup xóa. Chúng bị skip và chỉ đóng góp vào bounded diagnostics/count.
- Cleanup chạy khi extension host activate. Không có background timer hoặc lịch chạy mỗi 24 giờ.
- Mỗi activation có thể thử cleanup; global cleanup lock chỉ bảo đảm **at most one cleanup chạy đồng thời** giữa nhiều VS Code windows. Window activate sau khi lần trước đã kết thúc có thể chạy cleanup lại.
- Artifact hết hạn được xóa vĩnh viễn. Không có user-facing trash, restore hoặc recovery layer.
- Safe deletion được phép dùng owner-only transient deletion staging để tạo transaction boundary. Đây là implementation detail, không phải trash; staging còn sót do crash phải được cleanup tiếp ở activation sau.
- Search command đã hoàn thành và độc lập với cleanup. Search không gia hạn `updatedAt` và không chặn artifact đủ điều kiện bị xóa.
- Uninstall behavior vẫn tách biệt: uninstall integration/extension không tự động xóa user artifacts; automatic retention chỉ chạy theo policy cleanup này.

# ANALYZED

## 1. Current-state baseline

Current và duy nhất supported lifecycle là schema v6 trong:

```text
~/.ai-artifacts/artifacts/<artifact-id>/
  artifact.json
  artifact.md
  comments.json
  optional review-submission.json
  optional artifact-connection.json
```

Artifact thuộc review session, không thuộc workspace/repository. `artifact.json` không có `location.workspaceRoot`.

Source hiện tại vẫn coi artifact là durable data và giữ invariant:

```text
artifact lifetime > waiter lifetime > chat-turn lifetime
```

Retention feature sẽ thay phần “artifact tồn tại cho đến khi user tự xóa” bằng lifetime hữu hạn. Quan hệ waiter/chat-turn vẫn đúng trong thời gian artifact tồn tại, nhưng không còn là cam kết lưu vô hạn.

Search command `agentPlus.searchArtifact` đã được implement trong extension host:

- enumerate direct-child collection bằng bounded concurrency;
- validate schema-v6 candidates;
- filter in-memory chỉ theo normalized title;
- cap Quick Pick ở 1.000 items;
- revalidate selected item qua `ArtifactReviewOpenCoordinator`;
- không gọi MCP hoặc mutate `artifact-connection.json`.

Cleanup chưa được implement.

## 2. Philosophy và public contract phải đổi

Các tài liệu/contract hiện tại vẫn nói artifact là persistent global data và uninstall giữ user artifacts để tránh data loss. Retention cần diễn đạt chính xác hơn:

- artifact là persistent qua waiter/chat-turn/restart nhưng chỉ trong retention window;
- cancellation, takeover hoặc MCP restart không xóa artifact;
- automatic retention có thể xóa artifact độc lập với lifecycle state;
- exact handle có thể trở thành permanently missing;
- uninstall retention và automatic retention là hai behavior khác nhau;
- reconnect/search không làm mới retention timestamp;
- user phải export/copy nội dung nếu cần lưu dài hạn.

Không nên bỏ invariant hoàn toàn; nên giới hạn nó:

```text
while artifact exists:
  artifact lifetime > waiter lifetime > chat-turn lifetime

artifact lifetime is bounded by configured retention
```

## 3. `updatedAt` implementation gap

Schema v6 đã có `createdAt` và `updatedAt`, nên không cần thêm `lastAccessedAt`, `lastInteractionAt` hoặc retention-specific timestamp.

Implementation hiện tại tạo `nextManifest` bằng:

```ts
updatedAt: new Date().toISOString()
```

trong mọi `commitReviewRound()`. Vì `advance_and_wait_for_artifact` có thể advance bằng Markdown hiện tại, question-only hoặc unchanged-Markdown advance vẫn đang refresh `updatedAt` sai semantics đã chốt.

Target behavior:

```text
nextArtifactSha256 !== context.artifactSha256
  -> updatedAt = now

nextArtifactSha256 === context.artifactSha256
  -> updatedAt = context.manifest.updatedAt
```

Không cần migration để sửa các timestamp đã bị refresh trước đây. Sai lệch cũ chỉ khiến một số artifact được giữ lâu hơn dự kiến; không tạo early deletion.

`artifact-connection.json.updatedAt` có cùng tên field nhưng nghĩa khác hoàn toàn. Cleanup phải đọc timestamp từ parsed schema-v6 `artifact.json` duy nhất.

## 4. Eligibility boundary

Eligibility sử dụng UTC timestamp đã được schema validate và integer milliseconds:

```text
retentionMs = retentionDays * 24 * 60 * 60 * 1000
expiresAt   = Date.parse(manifest.updatedAt) + retentionMs
eligible    = now >= expiresAt
```

Boundary `now === expiresAt` là eligible.

Không dùng:

- filesystem birthtime/mtime/ctime;
- directory order;
- `createdAt` khi `updatedAt` có mặt;
- connection timestamp;
- review round;
- comments/submission state;
- open editor hoặc active waiter;
- search recency.

Nếu clock tạo ra `updatedAt` trong tương lai, artifact chưa eligible. Cleanup không tự sửa timestamp.

Setting thay đổi chỉ ảnh hưởng lần cleanup tiếp theo. Giảm retention có thể khiến nhiều artifact trở nên eligible ngay ở activation kế tiếp.

## 5. Schema, corrupt và unsafe-entry policy

Automatic permanent deletion phải dùng validation boundary nghiêm hơn hoặc bằng safe-open/search, không yếu hơn.

Một directory chỉ trở thành deletion candidate sau khi xác nhận:

- là real direct-child directory của canonical collection;
- directory basename là valid artifact ID;
- `artifact.md` và `artifact.json` là managed regular files;
- manifest parse thành exact schema v6;
- `manifest.artifactId` khớp directory basename;
- path không chứa symlink/junction hoặc escape user collection;
- `manifest.updatedAt` hợp lệ và đã expired.

Cleanup phải skip, không xóa:

- schema v3/v4/v5;
- malformed JSON hoặc invalid schema-v6 manifest;
- missing lifecycle identity files;
- artifact-ID mismatch;
- linked/junction directory hoặc linked managed files;
- unknown direct-child files/directories không chứng minh được ownership.

Không dùng legacy parser hoặc filesystem mtime để cố suy ra eligibility. Destructive cleanup không phải migration mechanism.

Diagnostics chỉ nên expose counts theo bounded categories, ví dụ `deleted`, `notExpired`, `busy`, `invalidOrUnsupported`, `failed`. Không log Markdown, comments, submissions hoặc full sensitive paths trong normal output.

## 6. Global cleanup coordination

Nhiều extension hosts cùng nhìn một global collection. Cần một global inter-process cleanup lock dưới owner-only managed state, không đặt lock ngoài product root hoặc trong workspace.

Lock semantics đã chốt ở mức behavior:

- atomic acquire;
- tối đa một cleanup worker tại một thời điểm;
- window không acquire được lock thì skip run đó, không busy-wait làm chậm activation;
- lock chứa bounded owner/start metadata để diagnostics;
- stale lock từ crashed host phải có reclaim policy an toàn;
- release trong `finally` khi worker kết thúc.

Global lock chỉ ngăn cleanup-cleanup overlap. Nó không tự bảo vệ khỏi MCP advance, connection commit, comment/submission writes hoặc search/open reads. Safe deletion transaction vẫn bắt buộc.

Không có khái niệm global “một lần cho toàn bộ VS Code launch” đáng tin cậy giữa các extension hosts. Vì vậy semantics là mỗi activation được phép thử, nhưng chỉ một cleanup chạy đồng thời. Không cần `lastCompletedAt` hoặc 24-hour schedule trong scope hiện tại.

## 7. Safe deletion transaction

Direct `fs.rm(artifactDirectory, { recursive: true })` ngay sau eligibility check chưa đủ an toàn vì có TOCTOU với MCP/extension operations và có thể tạo partial deletion trên Windows.

Deletion direction được chốt ở mức analysis:

```text
validate exact candidate
  -> re-read manifest immediately before deletion
  -> re-check expiry using same captured now/retention policy
  -> inspect fresh artifact-local operation locks
  -> atomic rename exact directory into owner-only deletion staging
  -> recursively delete staged directory
```

Rules:

- Fresh `.artifact-update.lock` hoặc `.artifact-connection.lock` làm candidate `busy`; skip và thử lại ở activation sau.
- Stale-lock policy phải dựa trên validated lock metadata/age và được thiết kế cụ thể ở implementation plan; không blind-delete một fresh lock.
- Atomic rename là deletion commit point: sau rename, original exact handle không còn tồn tại và new lifecycle operations phải fail closed.
- Writer thua race có thể nhận artifact-not-found, nhưng không được ghi vào artifact khác hoặc path ngoài collection.
- Rename/delete bị `EPERM`, `EBUSY`, `EACCES` hoặc editor lock trên Windows phải skip/fail candidate riêng, không abort các candidate khác.
- Không fallback sang copy-then-delete vì sẽ tạo hai lifecycle copies và không có atomic handle invalidation.
- Staging phải nằm cùng local product filesystem để rename giữ atomic semantics; phải owner-only và không nằm trong searchable artifact collection.
- Crash sau rename nhưng trước recursive delete có thể để lại staged data. Activation sau phải drain validated staging entries trước hoặc cùng cleanup run.
- Staged entries không được user-visible như recoverable Trash và không được search trả về.

Comment/submission writes hiện không dùng chung một deletion lock. Atomic directory rename là boundary khiến deletion thắng một cách fail-closed; implementation plan vẫn phải phân tích exact race order và rollback behavior trước khi code.

## 8. Active waiter, editor và lifecycle consequences

Retention áp dụng cho mọi state nên artifact có thể expired khi:

- MCP waiter vẫn đang attach;
- Artifact Review đang mở hoặc được VS Code restore;
- user vừa search thấy item nhưng chưa chọn;
- comments/submission tồn tại;
- connection state trỏ tới một live window.

Open/reload/search/wait không refresh `updatedAt`, nên các trạng thái này không phải keep-alive signal.

Expected behavior sau deletion:

- webview refresh/load chuyển sang unavailable/error state;
- active waiter kết thúc bằng non-retryable missing-artifact recovery, không treo vô hạn;
- reconnect không tạo lại artifact cùng ID;
- watcher/open request không được recreate lifecycle files;
- cached AI `artifactDictionary` entry trở thành stale và phải bị bỏ sau missing-artifact result;
- user được hướng dẫn dùng exported/copy version hoặc tạo artifact mới.

Plan/manual validation sau này phải cover artifact đang mở và waiter đang active, không chỉ approved/saved artifacts.

## 9. Missing-handle recovery contract

Sau permanent deletion không còn đủ state để phân biệt:

- expired artifact;
- user/manual deletion;
- missing filesystem entry.

Không thêm tombstone registry chỉ để phân biệt nguyên nhân trong scope hiện tại. MCP nên normalize trường hợp exact global handle không còn tồn tại thành một structured error chung, direction:

```text
code: ARTIFACT_NOT_FOUND
retryable: false
useSameArtifactHandle: false
```

Skill/agent recovery phải:

- không retry inspect/wait/reconnect trên cùng handle;
- không scan hoặc chọn newest artifact thay thế;
- xóa mapping stale của exact handle khỏi conversation state;
- báo artifact không còn tồn tại;
- đề nghị user search một artifact khác, dùng bản đã export, hoặc tạo lifecycle mới theo explicit request.

Search command không phải recovery fallback tự động. Search luôn do user chủ động mở từ VS Code UI.

## 10. Search integration đã hoàn thành

Search implementation hiện có thể cung cấp safe read-only enumeration pattern, nhưng không phải deletion authority.

Cleanup có thể reuse hoặc extract các phần sau nếu implementation plan xác nhận dependency direction:

- canonical root resolution;
- direct-child enumeration;
- bounded concurrency;
- `validateArtifactReviewTarget`/schema-v6 validation;
- deterministic aggregate skip handling.

Cleanup không được dùng một `SearchableArtifact` cũ rồi xóa trực tiếp. Mỗi selected deletion target phải revalidate manifest, binding, current `updatedAt`, locks và canonical path ngay trước rename.

Expected races:

### Cleanup xóa trong lúc search discovery

- Candidate biến mất trước validation: search skip candidate.
- Candidate đã validate rồi bị xóa: Quick Pick có thể tạm hiển thị stale item.

### Cleanup xóa sau khi Quick Pick render

- Selection đi qua `ArtifactReviewOpenCoordinator` và revalidation fail closed.
- Search không recreate, reconnect hoặc gia hạn artifact.

### Search/open trước cleanup commit

- Việc mở editor không thay `artifact.json.updatedAt`.
- Nếu candidate vẫn expired, cleanup được phép xóa theo policy.

Không cần lock search với cleanup; read path phải chịu được disappearing candidates và open boundary đã revalidate.

## 11. Setting contract

Setting direction:

```json
{
  "agentPlus.artifactRetentionDays": {
    "type": "integer",
    "default": 30,
    "minimum": 1,
    "scope": "machine"
  }
}
```

Machine scope phù hợp vì collection nằm trong local user home của một máy. Workspace/window-scoped override có thể khiến hai extension hosts áp policy khác nhau lên cùng global collection và không được hỗ trợ.

Runtime phải validate lại:

- integer;
- lớn hơn `0`;
- `retentionDays * DAY_MS` không vượt `Number.MAX_SAFE_INTEGER`.

Nếu setting invalid do external/manual config, fallback về default 30 ngày và ghi bounded diagnostic; không chạy với `0`, negative, fractional, `NaN` hoặc overflow.

Thay đổi setting không trigger cleanup ngay. Policy mới được dùng ở activation cleanup tiếp theo.

## 12. Just save và long-term preservation

Current skill xử lý decision `save` bằng cách yêu cầu destination rồi copy current Markdown ra ngoài lifecycle. Vì vậy docs phải phân biệt:

```text
Just save button
  -> submit save decision
  -> AI receives decision
  -> user supplies destination
  -> AI copies Markdown externally
  -> external copy is durable independently of artifact retention
```

Nếu waiter/AI không hoàn tất flow sau button click, artifact vẫn chỉ là retained lifecycle data và có thể bị cleanup.

`Copy Markdown` cho phép user tự lưu mà không phụ thuộc waiter. Search và Connect chỉ tìm/inspect artifact hiện hữu; chúng không export hoặc pin artifact.

## 13. Performance interpretation

Existing Windows microbenchmark cho thấy exact-path create/update chưa bị ảnh hưởng đáng kể ở quy mô đã đo, trong khi root enumeration tăng theo collection size:

| Số artifact directories | Create p95 | Update p95 | Enumerate root p95 |
| ---: | ---: | ---: | ---: |
| 0 | 5,72 ms | 6,66 ms | 0,03 ms |
| 1.000 | 3,33 ms | 6,21 ms | 0,59 ms |
| 10.000 | 5,36 ms | 8,44 ms | 9,09 ms |
| 25.000 | 3,51 ms | 4,72 ms | 11,81 ms |
| 50.000 | 5,32 ms | 8,32 ms | 26,49 ms |

Đây là isolated filesystem microbenchmark, không phải installed-host E2E evidence.

Retention vẫn được justify chủ yếu bởi:

- temporary-data product semantics;
- disk/privacy footprint;
- bounded collection growth;
- predictable search/enumeration size.

Không claim cleanup là fix cho create/update bottleneck chưa được chứng minh. Cleanup itself phải dùng bounded concurrency và không block extension activation UI lâu hơn cần thiết.

## 14. Failure và observability policy

Cleanup là best-effort theo từng candidate:

- root validation/enumeration failure: abort toàn run, không delete gì;
- invalid/unsafe candidate: skip;
- not expired: keep;
- busy/locked candidate: skip;
- candidate biến mất giữa các bước: coi là already absent, không retry broad path;
- rename/delete failure: ghi bounded error category và tiếp tục candidate khác;
- global lock unavailable: skip run bình thường;
- stale staged deletion: validate staging ownership rồi retry delete.

Không hiện success notification ở mỗi activation. Error reporting phải tránh notification storm trong multi-window. Detailed diagnostics có thể đi vào extension log/output; user-facing error chỉ dành cho collection-level failure hoặc repeated material cleanup failure theo policy sẽ chốt trong implementation plan.

Cleanup summary tối thiểu:

```ts
type CleanupSummary = {
  scanned: number;
  deleted: number;
  notExpired: number;
  busy: number;
  invalidOrUnsupported: number;
  failed: number;
  stagedDeleted: number;
};
```

Không expose Markdown, comments, review decisions hoặc full artifact paths trong normal summary.

## 15. Components bị ảnh hưởng ở bước implementation

### Shared filesystem/contracts

- retention constants/setting validation helpers;
- cleanup lock/staging path ownership;
- exact safe deletion validation;
- structured `ARTIFACT_NOT_FOUND` recovery metadata;
- `artifact.json.updatedAt` semantic tests.

### MCP lifecycle

- preserve `updatedAt` on unchanged Markdown SHA;
- normalize deleted/missing exact handles thành non-retryable recovery;
- ensure wait/inspect/advance/reconnect terminate safely when cleanup wins race.

### Extension host

- machine-scoped setting;
- activation-triggered best-effort cleanup;
- global inter-process cleanup lock;
- bounded candidate enumeration;
- transactional rename/delete and staged-deletion draining;
- aggregate logging/error policy.

### Search/open/webview

- search core đã hoàn thành và không cần đổi matching contract;
- verify disappearing-candidate races;
- Artifact Review phải hiển thị missing/deleted state rõ ràng nếu open artifact bị cleanup.

### Skill/agent contract

- bounded artifact lifetime;
- `ARTIFACT_NOT_FOUND` recovery;
- drop stale exact-handle mapping;
- precise Just save/export wording;
- không retry hoặc tự scan replacement artifact.

### Product/docs/release

- README, philosophy, architecture, components, instruction source-of-truth;
- skill contract;
- `docs/CHANGE_LOGS.md` và `CHANGELOG.md`;
- retention setting documentation và permanent-deletion warning.

### Tests

- timestamp semantics;
- eligibility boundary và setting validation;
- schema-v6-only deletion;
- malformed/legacy/linked/mismatched candidates;
- global cleanup lock và stale lock;
- fresh artifact-local locks;
- atomic rename/delete and crash-staging recovery;
- Windows lock failures;
- active waiter/editor deletion;
- structured missing-handle recovery;
- search-discovery/open races;
- multi-window activation behavior;
- uninstall continues retaining artifacts independently of automatic retention.

## 16. Current risk assessment

- Product policy complexity: thấp.
- Eligibility calculation: thấp.
- `updatedAt` correction: thấp-trung bình.
- Safe permanent deletion: cao.
- Multi-process/window coordination: trung bình-cao.
- Missing-handle lifecycle recovery: trung bình.
- Search integration: thấp vì search đã có revalidation boundary.
- Overall implementation difficulty: khoảng **6/10**.

Rủi ro chính không phải xác định artifact hết hạn mà là bảo đảm permanent deletion không xóa sai path, không corrupt in-flight transaction và tạo recovery behavior nhất quán cho MCP, webview và AI skill.

# IMPLEMENTATION PLAN

Chưa lập implementation plan theo yêu cầu hiện tại. Phần này sẽ được thực hiện riêng sau khi Chú yêu cầu.
