# PRODUCT DECISIONS

- Artifact là dữ liệu review tạm thời, không phải dữ liệu lâu dài mà sản phẩm cam kết giữ vô thời hạn.
- Nếu muốn giữ nội dung lâu dài, người dùng phải hoàn tất **Just save** flow để copy Markdown ra ngoài artifact lifecycle, dùng **Copy Markdown**, hoặc chủ động lưu nội dung ở vị trí khác.
- Exact `artifactDirectory` chỉ hợp lệ trong thời gian artifact còn tồn tại. Sau khi retention cleanup xóa artifact, reconnect vào handle cũ không được bảo đảm.
- Có một setting machine-scoped `agentPlus.artifactRetentionDays`; mặc định là **30 ngày**.
- Setting chỉ chấp nhận số nguyên dương. Giá trị `0` không có nghĩa là disable cleanup và không được hỗ trợ.
- Eligibility chỉ dựa trên `artifact.json.updatedAt` hiện có:

  ```text
  expiresAt = Date.parse(artifact.json.updatedAt) + retentionDays * DAY_MS
  eligible  = now >= expiresAt
  ```

- Feature retention không thay đổi semantics hiện tại của `artifact.json.updatedAt`:
  - khi tạo artifact, `updatedAt` bằng thời điểm tạo;
  - mỗi lần review round được advance thành công, `updatedAt` được cập nhật, kể cả khi Markdown không đổi;
  - inspect, search/open, reload editor, reconnect, wait, comment và submit decision không cập nhật `artifact.json.updatedAt`.
- `artifact-connection.json.updatedAt` chỉ là timestamp của UI-routing state và không được dùng để tính retention.
- Artifact cũ dùng trực tiếp `artifact.json.updatedAt` đang có. Không có migration hoặc upgrade grace period.
- Cleanup áp dụng cho mọi lifecycle state nếu artifact đã hết hạn. Pending waiter, comments, revise, approve, save hoặc open editor không phải keep-alive signal.
- Automatic cleanup chỉ xét validated schema-v6 artifacts trong canonical global collection. Legacy, malformed, linked, escaped hoặc otherwise unsafe entries phải được skip.
- Cleanup được khởi động best-effort một lần khi mỗi extension host chạy `activate()`. Không có background timer, daily schedule hoặc cleanup ngay khi setting thay đổi.
- Không dùng global cleanup lock. Mỗi deletion dùng atomic rename của đúng artifact đã revalidate sang extension-owned cleanup staging; trong race nhiều window, chỉ một rename thắng và các window còn lại coi missing source là đã được xử lý.
- Artifact hết hạn được xóa vĩnh viễn. Cleanup staging chỉ là transaction boundary nội bộ, không phải user-facing Trash hoặc recovery layer.
- Search command độc lập với cleanup. Search/open không gia hạn retention và không ngăn một artifact hết hạn bị xóa.
- Uninstall integration hoặc uninstall extension không chạy retention cleanup và không trực tiếp xóa `~/.ai-artifacts/artifacts/`. Nếu extension được cài lại, lần activation tiếp theo có thể xóa các artifact đã hết hạn.
- Thay đổi artifact contract phải được đồng bộ vào các docs liên quan; không chỉ sửa riêng một contract file.

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

Artifact thuộc review session, không thuộc workspace/repository. `artifact.json` là identity source of truth và hiện có đủ `createdAt`/`updatedAt` để triển khai retention mà không cần thêm schema field.

Current implementation:

- chưa có setting retention;
- chưa có activation cleanup;
- `activate()` đã là extension-host composition root phù hợp để khởi động cleanup;
- search đã có bounded enumeration và schema-v6 validation cho global collection;
- uninstall chỉ xóa managed runtime/config/skill assets và đang có regression test bảo đảm artifacts được giữ nguyên;
- docs và skill contract vẫn mô tả artifact là durable cho đến khi user chủ động xóa.

Retention thay đổi duration contract của artifact nhưng không thay đổi schema v6, artifact layout, review states, tool catalog hoặc window-routing contract.

## 2. Scope đã thu gọn

Feature chỉ gồm bốn behavior:

1. Một setting chọn retention theo ngày.
2. Một cleanup run khi extension host activate.
3. Xóa permanent những validated artifact đã hết hạn theo `artifact.json.updatedAt`.
4. Cập nhật artifact contract và các docs liên quan để phản ánh lifetime hữu hạn và uninstall boundary.

Không nằm trong scope:

- timer hoặc scheduler chạy định kỳ;
- setting để disable cleanup;
- pin/keep/trash/restore;
- last-accessed hoặc last-interaction timestamp;
- sửa semantics của `artifact.json.updatedAt`;
- migration timestamp cũ;
- global cleanup lock và stale-lock reclaim protocol;
- tombstone registry;
- tự search hoặc chọn artifact thay thế khi exact handle đã mất;
- thay đổi search matching, window routing hoặc webview UX riêng cho retention;
- performance benchmark mới.

## 3. `artifact.json.updatedAt` được dùng nguyên trạng

Current MCP behavior trong `commitReviewRound()` luôn tạo manifest kế tiếp với:

```ts
updatedAt: new Date().toISOString();
```

Do đó timestamp hiện có nghĩa thực tế là:

```text
thời điểm artifact được tạo
hoặc
thời điểm review round được advance thành công gần nhất
```

Question-only hoặc unchanged-Markdown advance vẫn gia hạn retention. Đây là current contract được feature mới sử dụng, không phải implementation gap cần sửa.

Các thao tác không advance manifest như open, search, reconnect, wait, save comment hoặc submit decision không gia hạn retention. Cleanup phải đọc đúng field trong parsed schema-v6 `artifact.json`; field cùng tên trong `artifact-connection.json` không liên quan.

Việc giữ semantics hiện tại giúp scope không chạm vào transactional round commit, token rules, question-only flow hoặc existing lifecycle tests ngoài các regression cần thiết cho missing artifact.

## 4. Setting và activation behavior

Setting direction:

```json
{
  "agentPlus.artifactRetentionDays": {
    "type": "integer",
    "default": 30,
    "minimum": 1,
    "scope": "machine",
    "description": "Permanently delete AI Artifacts whose artifact.json updatedAt is older than this many days when the extension activates."
  }
}
```

Machine scope phù hợp vì collection là per-user trên một machine. Workspace/window override không nên áp dụng lên cùng một global collection.

Runtime vẫn phải kiểm tra setting là positive safe integer và phép đổi sang milliseconds không overflow. Nếu external/manual configuration tạo giá trị invalid, dùng default 30 ngày và ghi bounded diagnostic; không silently diễn giải `0` thành disabled.

`activate()` chỉ schedule một asynchronous best-effort cleanup và không chờ toàn bộ root enumeration/deletion trước khi đăng ký commands, custom editor hoặc connection watcher. Điều này giữ extension startup responsive.

Mỗi extension host chỉ gọi cleanup một lần trong lifetime activation của host đó. Nhiều VS Code windows có thể activate gần nhau; concurrency được giải quyết ở deletion boundary thay vì bằng một global process lock.

## 5. Eligibility và candidate validation

Một candidate chỉ được delete khi tất cả điều kiện sau đúng:

- entry là real direct-child directory của canonical `~/.ai-artifacts/artifacts/`;
- basename là valid artifact ID;
- `artifact.md` và `artifact.json` là managed regular files;
- manifest parse thành exact schema v6;
- `manifest.artifactId` khớp directory basename;
- candidate không phải symlink/junction và không escape collection;
- `manifest.updatedAt` parse hợp lệ;
- captured `now` thỏa `now >= updatedAt + retentionDays`.

Cleanup phải skip, không suy đoán ownership hoặc sửa chữa:

- schema v3/v4/v5;
- malformed/unsupported manifest;
- missing identity files;
- artifact-ID mismatch;
- linked hoặc escaped path;
- unknown file/directory trong collection.

Search discovery có thể cung cấp pattern tham khảo cho bounded enumeration và validation, nhưng cleanup không được dùng một `SearchableArtifact` snapshot cũ làm deletion authority. Candidate phải được revalidate và re-read `updatedAt` ngay trước rename.

## 6. Safe deletion và multi-window race

Direct recursive delete tại original handle có thể để lại partial artifact nếu Windows lock hoặc process crash xảy ra giữa chừng. Boundary tối thiểu nên là:

```text
enumerate candidate
  -> validate
  -> check expiry
  -> revalidate + re-read manifest
  -> atomic rename exact artifact directory to managed cleanup staging
  -> recursively delete staged directory
```

Cleanup staging nằm dưới extension-owned managed state trên cùng local product filesystem, ví dụ:

```text
~/.ai-artifacts/managed/cleanup/<artifact-id>-<unique-id>/
```

Rename là deletion commit point: sau rename, exact artifact handle không còn tồn tại. Recursive deletion chỉ chạy trên staged path, không chạy lại từ một broad collection path.

Không cần global cleanup lock:

- hai windows có thể cùng validate một candidate;
- chỉ một window rename original directory thành công;
- window thua race nhận `ENOENT` và coi candidate đã được xử lý;
- hai artifacts khác nhau có thể được cleanup độc lập;
- staging entries còn lại do crash được retry ở activation sau bằng validation giới hạn trong cleanup staging.

Nếu rename/delete gặp `EPERM`, `EBUSY` hoặc `EACCES`, cleanup ghi bounded diagnostic cho candidate đó và tiếp tục candidate khác. Không fallback sang copy-then-delete và không abort toàn run chỉ vì một artifact thất bại.

Atomic rename cũng là coordination boundary với lifecycle writers: cleanup không tạo lại original directory; writer thua race phải fail closed. Không cần thêm global cleanup lock hoặc stale artifact-lock protocol trong scope này.

## 7. Missing exact handle và active waiter

Permanent cleanup làm exact handle có thể biến mất trong khi MCP waiter hoặc editor còn giữ path cũ.

Current waiter vừa dùng filesystem watcher vừa poll submission. Nếu directory đã bị xóa nhưng missing submission tiếp tục được hiểu là “chưa submit”, waiter có thể không kết thúc rõ ràng. Đây là runtime correction nhỏ cần đi cùng cleanup, không phải một recovery subsystem mới.

Minimum behavior:

- load/inspect/wait/advance/reconnect trên một exact global handle đã mất trả structured `ARTIFACT_NOT_FOUND`;
- error là non-retryable và `useSameArtifactHandle: false`;
- active waiter phát hiện artifact directory/manifest không còn tồn tại và kết thúc thay vì chờ vô hạn;
- agent bỏ stale mapping cho handle đó và báo artifact không còn tồn tại;
- không scan newest artifact, không tự search replacement và không recreate cùng artifact ID.

Không thêm tombstone nên runtime không cần phân biệt artifact bị retention cleanup, user xóa thủ công hay filesystem entry bị mất. Tất cả dùng cùng missing-handle contract.

Không yêu cầu webview state mới trong scope đầu tiên. Existing load/open failure có thể hiển thị lỗi thông thường; chỉ cần bảo đảm không recreate hoặc mutate path đã mất.

## 8. Search interaction

Search production behavior không cần thay đổi:

- discovery có thể skip candidate biến mất trong lúc enumerate;
- Quick Pick có thể tạm chứa stale item;
- selection hiện đã revalidate qua open coordinator và phải fail closed nếu cleanup đã thắng;
- search/open không cập nhật `artifact.json.updatedAt`;
- cleanup không cần lock search reads.

Chỉ cần regression coverage cho disappearing candidate nếu existing tests chưa chứng minh boundary này. Không mở rộng search thành MCP tool và không dùng search làm automatic recovery.

## 9. Uninstall boundary

Retention cleanup và uninstall là hai lifecycle khác nhau:

```text
extension activate
  -> có thể cleanup expired artifacts

integration/extension uninstall
  -> remove managed runtime/config/skills
  -> giữ nguyên artifact collection
```

Không thay đổi `cleanupBaseMcpServer()` hoặc các uninstall client drivers. Existing uninstall regression phải tiếp tục chứng minh artifact bytes/hash không đổi sau uninstall.

Nếu extension bị uninstall lâu hơn retention window, artifacts vẫn nằm trên disk vì không có activation cleanup. Khi extension được cài lại và activate, policy hiện tại được áp dụng và các artifact đã expired có thể bị xóa.

Cleanup staging nằm trong managed state có thể bị uninstall xóa. Điều này không vi phạm retention boundary vì artifact chỉ được chuyển vào staging sau khi đã validate, expired và vượt qua deletion commit point.

## 10. Artifact contract và docs liên quan

Retention thay đổi public lifetime contract. Vì vậy “cập nhật artifact contract” bao gồm đồng bộ các source-of-truth và user-facing docs liên quan, không chỉ sửa `artifact-contract.md`.

Contract phải diễn đạt:

```text
while an artifact exists:
  artifact lifetime > waiter lifetime > chat-turn lifetime

artifact lifetime is bounded by configured retention
```

Các điểm cần đồng bộ:

- artifact tồn tại qua cancellation, takeover, chat-turn completion và MCP restart nhưng có thể bị automatic retention xóa;
- eligibility dựa trên current `artifact.json.updatedAt` semantics;
- open/search/reconnect/comment/submission không tự gia hạn retention;
- exact handle có thể trở thành permanently missing;
- `ARTIFACT_NOT_FOUND` không được retry trên cùng handle;
- nội dung cần lưu dài hạn phải được copy/export ra ngoài artifact lifecycle;
- uninstall vẫn giữ artifacts và không phải retention trigger;
- reinstall/activation sau đó có thể áp retention lên dữ liệu còn lại.

Docs/contracts cần cập nhật khi implementation được thực hiện:

- `docs/INSTRUCTION.md`: critical invariants về bounded lifetime và automatic deletion exception;
- `docs/PHILOSOPHY.md`: temporary artifact semantics và lifetime model;
- `docs/ARCHITECTURE.md`: activation cleanup, deletion boundary, missing-handle behavior và uninstall separation;
- `skills/create-review-artifact/SKILL.md`: agent behavior khi exact handle expired/missing;
- `skills/create-review-artifact/references/artifact-contract.md`: normative lifecycle/retention contract;
- `README.md`: setting, permanent-deletion warning, long-term preservation và uninstall wording;
- `docs/CHANGE_LOGS.md` và `CHANGELOG.md`: behavior/release record theo repository rules.

Không cần thay đổi window-routing contract, search matching contract hoặc artifact schema version. Schema v6 giữ nguyên vì retention chỉ dùng field hiện có.

## 11. Components bị ảnh hưởng ở bước implementation

### Extension configuration và activation

- `package.json`: khai báo `agentPlus.artifactRetentionDays`.
- `src/extension/extension.ts`: đọc setting và schedule cleanup một lần khi activate.
- new focused retention module dưới `src/extension/`: setting validation, enumeration, expiry check, staging rename/delete và bounded result logging.

### Shared filesystem safety

- reuse canonical global-root và artifact validation hiện có;
- thêm constants/helpers cho managed cleanup staging nếu cần;
- không đổi artifact schema hoặc lifecycle file layout.

### MCP lifecycle

- không đổi `commitReviewRound()` hoặc timestamp semantics;
- normalize missing exact handles thành `ARTIFACT_NOT_FOUND`;
- bảo đảm active waiter kết thúc khi artifact biến mất;
- không thêm MCP tool mới.

### Search/open/webview

- không có planned production behavior change;
- chỉ thêm regression nếu cần cho disappearing-candidate/open race;
- không thêm retention UI hoặc recovery UI riêng.

### Uninstall

- không đổi production code;
- giữ regression chứng minh artifact collection không bị uninstall xóa.

### Artifact contract/docs

- cập nhật đồng bộ toàn bộ docs/contracts liệt kê ở mục 10;
- giữ wording rõ ràng giữa automatic retention và uninstall preservation.

## 12. Verification scope

Focused automated coverage:

- default/valid/invalid retention setting;
- expiry boundary `now === expiresAt`;
- recent artifact được giữ, expired schema-v6 artifact bị xóa;
- cleanup dùng `artifact.json.updatedAt`, không dùng connection timestamp hoặc filesystem mtime;
- unchanged-Markdown advance vẫn refresh `updatedAt` theo current behavior;
- legacy/malformed/mismatched/linked/escaped candidates bị skip;
- candidate được revalidate trước rename;
- concurrent cleanup chỉ commit deletion một lần;
- rename/delete failure không làm abort toàn run;
- staged deletion được drain ở activation sau;
- active waiter kết thúc với `ARTIFACT_NOT_FOUND` khi cleanup thắng;
- search selection fail closed nếu candidate biến mất;
- uninstall tiếp tục giữ artifact bytes/hash nguyên vẹn;
- skill và docs contract tests phản ánh bounded lifetime.

Full repository validation trước handoff implementation:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Installed-host/manual validation tối thiểu:

- activate với expired và non-expired artifacts;
- hai VS Code windows activate gần nhau trên cùng collection;
- expired artifact đang mở hoặc có waiter;
- uninstall giữ artifacts;
- reinstall rồi activate áp retention bình thường.

Automated tests không tự chứng minh filesystem watcher và Windows editor-lock behavior trong installed extension host; các case đó vẫn là manual evidence, không được suy ra từ unit tests.

## 13. Current risk assessment

- Setting và eligibility: thấp.
- Schema/path validation: thấp-trung bình vì reuse existing safety boundary.
- Atomic staging deletion: trung bình.
- Multi-window behavior: thấp-trung bình vì không có global lock; correctness dựa trên per-artifact atomic rename.
- Missing active waiter behavior: trung bình.
- Uninstall separation: thấp vì current production behavior và regression đã có.
- Overall implementation difficulty: khoảng **4/10**.

Rủi ro chính còn lại là destructive filesystem boundary và waiter đang giữ exact handle khi cleanup thắng race. Không cần biến feature thành một global retention/recovery subsystem để xử lý hai rủi ro này.

# IMPLEMENTATION PLAN

Chưa lập implementation plan. Phần này sẽ được thực hiện riêng sau khi Chú duyệt analysis đã thu gọn và yêu cầu lập plan.
