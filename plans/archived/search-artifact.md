# IDEAS

- Thêm VS Code command `AI Artifacts: Search Artifact` (`agentPlus.searchArtifact`).
- Search là tính năng UI của extension, không phải MCP tool và không thay đổi public catalog năm lifecycle tools.
- Command quét các schema-v6 artifact hợp lệ trong canonical global collection `~/.ai-artifacts/artifacts/` và hiển thị bằng native VS Code Quick Pick.
- Matching chỉ chạy trên `artifact.json.title`.
- Cả query và title được lowercase, bỏ dấu Unicode, chuyển `đ` thành `d`, chuẩn hóa khoảng trắng; kết quả khớp khi normalized title `includes` normalized query.
- Không tokenize, fuzzy search, semantic search, đọc Markdown, tìm theo artifact ID, kind, ngày tháng, workspace hoặc path.
- Metadata từ `artifact.json` chỉ dùng để hiển thị và phân biệt các kết quả trong Quick Pick.
- Quick Pick hiển thị tối đa 1.000 items. Nếu có nhiều hơn, hiển thị tổng số match và yêu cầu user nhập cụ thể hơn.
- Khi user chọn một item, extension revalidate exact artifact rồi mở `artifact.md` bằng Artifact Review trong chính VS Code window đang chạy command.
- Search/open không gọi MCP, không reconnect, không đọc hoặc ghi `artifact-connection.json`, không thay đổi waiter, review round hay lifecycle state.
- Khi cần đưa artifact đã mở vào AI conversation, user dùng nút Connect trong Artifact Review để copy exact `artifactDirectory`, sau đó AI inspect artifact đó.

# ANALYZED

## 1. Bối cảnh và quyết định cuối

Thiết kế MCP `search_artifacts` trước đây không còn phù hợp. Product flow đã được rút gọn thành hai trách nhiệm độc lập:

```text
User tìm và mở artifact
  -> VS Code command + Quick Pick
  -> Artifact Review

User muốn AI nhận artifact đang mở
  -> Connect button
  -> copy exact artifactDirectory
  -> AI inspect
```

Việc tách hai flow giúp search không tham gia lifecycle protocol hoặc window-routing protocol. Search chỉ là một local UI operation trong extension host hiện tại.

## 2. Nguồn dữ liệu

Mỗi candidate chỉ cần đọc và validate `artifact.json` schema v6:

```ts
type ArtifactManifest = {
  schemaVersion: 6;
  kind: string;
  artifactId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  reviewRound: number;
  reviewSessionId: string;
};
```

Search dùng các field như sau:

| Field | Search matching | Quick Pick display | Internal validation |
|---|---:|---:|---:|
| `title` | Có | Có | Có |
| `kind` | Không | Có | Có |
| `artifactId` | Không | Có | Có |
| `createdAt` | Không | Có | Có |
| `updatedAt` | Không | Có | Có |
| `reviewRound` | Không | Có | Có |
| `schemaVersion` | Không | Không | Có |
| `reviewSessionId` | Không | Không | Có |

`artifactDirectory` và `artifactPath` được suy ra từ validated direct-child directory; chúng không phải searchable metadata.

Search không đọc:

- `artifact.md`;
- `comments.json`;
- `review-submission.json`;
- `artifact-connection.json`.

## 3. Matching contract

Normalization áp dụng giống nhau cho query và title:

1. `normalize("NFD")`;
2. bỏ Unicode combining marks;
3. chuyển `đ`/`Đ` thành `d`;
4. lowercase;
5. collapse nhiều whitespace thành một space;
6. trim hai đầu.

Predicate duy nhất:

```ts
normalizeTitle(candidate.title).includes(normalizeTitle(query))
```

Ví dụ:

| Query | Title | Match |
|---|---|---:|
| `lap ke hoach` | `Lập kế hoạch` | Có |
| `ke hoach` | `Lập kế hoạch triển khai` | Có |
| `hoach lap` | `Lập kế hoạch` | Không |
| `artifact-001` | title không chứa `artifact-001` | Không |
| `implementation-plan` | title không chứa chuỗi này | Không |

Query rỗng match toàn bộ valid candidates, nhưng Quick Pick vẫn chỉ nhận tối đa 1.000 items.

Không có tokenizer, word reordering, prefix index, fuzzy score, reverse-includes hoặc semantic fallback. Metadata ngoài title không được dùng để tạo match.

## 4. Ordering và result limit

Matching và ordering phải deterministic nhưng không dùng recency để ưu tiên một artifact:

1. normalized title tăng dần;
2. raw title tăng dần;
3. `artifactId` tăng dần làm tie-breaker.

Sau khi sort:

- đưa tối đa `MAX_QUICK_PICK_ITEMS = 1000` items vào Quick Pick;
- giữ `totalMatches` trước khi slice;
- title của Quick Pick hiển thị `Showing 1,000 of N` khi bị giới hạn;
- placeholder yêu cầu user nhập thêm để narrow results.

Giới hạn 1.000 chỉ giới hạn UI items, không làm thay đổi matching contract.

## 5. Quick Pick UX

Command dùng `vscode.window.createQuickPick()` thay vì `showQuickPick()` để hỗ trợ:

- trạng thái `busy` trong lúc enumerate/validate;
- cập nhật items theo `onDidChangeValue`;
- cập nhật tổng số match;
- clean cancellation/disposal;
- giữ controller mở nếu chưa có kết quả.

Mỗi item dự kiến:

```text
label:       <title>
description: <kind> · Round <reviewRound>
detail:      Updated <updatedAt> · Created <createdAt> · <artifactId>
```

Mỗi custom-filtered item phải đặt `alwaysShow: true`. Nếu không, VS Code có thể tiếp tục áp native fuzzy filtering trên title gốc và ẩn sai một kết quả accent-insensitive, ví dụ query `lap` với title `Lập kế hoạch`.

Duplicate titles vẫn là các items riêng và được phân biệt bằng metadata. Command không tự chọn artifact chỉ vì title trùng hoàn toàn.

## 6. Discovery và validation boundary

Discovery flow:

```text
ensure canonical global artifacts root
  -> enumerate direct-child entries
  -> chỉ xét real directories
  -> build expected artifact.md path
  -> validateArtifactReviewTarget(...)
  -> collect validated manifest + canonical paths
```

Phải reuse `validateArtifactReviewTarget` và shared schema/path validation hiện tại. Không tạo một search-only validation path yếu hơn.

Candidate bị skip nếu:

- không phải direct-child directory;
- thiếu `artifact.md` hoặc `artifact.json`;
- manifest malformed hoặc không phải schema v6;
- `artifactId` không khớp directory basename;
- directory/file là symlink hoặc junction;
- path escape canonical global collection;
- file bị xóa hoặc thay thế trong lúc scan.

Chỉ expose aggregate `skippedCount`, không hiển thị sensitive paths của invalid entries. Nếu không đọc được collection root thì command fail và hiển thị một error message; không giả vờ trả empty result.

Khi user accept item, `ArtifactReviewOpenCoordinator.open(...)` revalidate candidate lần nữa. Nếu artifact đã bị xóa hoặc thay đổi sau scan, open fail closed và không mở editor sai.

## 7. Window và lifecycle behavior

Command được thực thi trong extension host của window hiện tại. Sau selection, coordinator gọi `vscode.openWith` trong window đó với `agentPlus.artifactReview`.

Search/open không:

- đọc live-window registry;
- resolve window candidates;
- emit open request qua `artifact-connection.json`;
- tăng `connectionRevision`;
- thay đổi `windowInstanceId`;
- takeover hoặc tạo waiter;
- inspect, advance hay mutate review round.

Do đó search hoạt động độc lập với MCP availability và AI client state. Artifact Review sau khi mở có nút Connect riêng để đưa exact handle vào AI conversation.

## 8. Performance direction

UI cap là 1.000 items, nhưng discovery vẫn cần nhìn toàn collection để không bỏ lỡ title match.

Implementation nên:

- dùng một lần `readdir(..., { withFileTypes: true })`;
- validate manifests với bounded concurrency, không `Promise.all` không giới hạn;
- không đọc Markdown/comments/submission/connection;
- normalize title một lần khi tạo in-memory record;
- filter in-memory ngay khi query thay đổi;
- ngừng schedule thêm filesystem work khi Quick Pick đã bị đóng;
- không thêm persistent index hoặc cache ở release đầu tiên.

`DISCOVERY_CONCURRENCY` nên là hằng số nội bộ có testable default, đề xuất `16`. Đây là giới hạn I/O, không phải public contract.

Manual performance gate tối thiểu là collection 1.000 valid artifacts phải load và filter mượt trong installed VS Code host. Tập 10.000/50.000 artifacts dùng làm stress observation; nếu scan manifest trở thành bottleneck mới cân nhắc cache/index ở feature riêng.

## 9. Ảnh hưởng theo component

### Extension search service

- Thêm discovery, normalization, filtering, deterministic ordering và 1.000-item cap.
- Không import `vscode` trong phần pure/search-core để unit test trực tiếp.

### Extension command/UI

- Thêm Quick Pick controller.
- Đăng ký command và nối selection vào existing `ArtifactReviewOpenCoordinator`.

### Package contribution

- Thêm activation event và command contribution cho `agentPlus.searchArtifact`.

### Shared validation/open path

- Reuse nguyên trạng `validateArtifactReviewTarget` và `ArtifactReviewOpenCoordinator`.
- Không thay schema hoặc lifecycle contracts.

### MCP/skill/installer

- Không thay đổi.
- Public MCP catalog vẫn đúng năm tools.
- Không cần reinstall MCP integrations hoặc restart AI client cho search command.

### Tests

- Thêm search-core/discovery tests, command contract tests và manual installed-host matrix.

### Docs

- Feature này cần cập nhật command-facing docs và changelog nếu Chú phê duyệt docs scope.
- Không cập nhật skill contract vì AI không trực tiếp gọi search command.

## 10. Độ khó và độ ổn định dự kiến

- Độ khó: thấp, khoảng 3/10.
- Matching algorithm: thấp.
- Filesystem validation/enumeration: thấp-trung bình vì phải giữ fail-closed safety.
- Quick Pick controller: thấp-trung bình do cần custom accent-insensitive filtering và cancellation sạch.
- Rủi ro lifecycle/window routing: thấp vì feature không tham gia hai protocol này.
- Độ ổn định dự kiến: cao sau khi pass automated safety tests và installed-host Quick Pick validation.

# IMPLEMENTATION PLAN

## Release unit 1 — Search core và safe discovery

### Mục tiêu

Tạo module thuần, testable để enumerate valid schema-v6 artifacts và filter duy nhất theo normalized title.

### File dự kiến

- Thêm `src/extension/artifact-search.ts`.
- Thêm `test/artifact-search.test.ts`.
- Có thể bổ sung một fixture helper dùng chung nếu test setup bị lặp, nhưng không refactor unrelated open tests trong release unit này.

### Thiết kế API nội bộ

```ts
type SearchableArtifact = {
  artifactDirectory: string;
  artifactPath: string;
  artifactId: string;
  title: string;
  normalizedTitle: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  reviewRound: number;
};

type ArtifactDiscoveryResult = {
  artifacts: SearchableArtifact[];
  skippedCount: number;
};

type ArtifactFilterResult = {
  items: SearchableArtifact[];
  totalMatches: number;
  limited: boolean;
};
```

Functions dự kiến:

- `normalizeArtifactTitleSearch(value: string): string`;
- `discoverSearchableArtifacts(options?): Promise<ArtifactDiscoveryResult>`;
- `filterSearchableArtifacts(artifacts, query, limit?): ArtifactFilterResult`.

### Các bước thực hiện

1. Resolve/create canonical collection root bằng existing global-root helper.
2. Enumerate một level bằng `readdir` với `Dirent`.
3. Loại non-directory và link entries trước khi đọc file.
4. Với mỗi directory, build expected `artifact.md` bằng existing path helper.
5. Validate bằng `validateArtifactReviewTarget` với bounded concurrency.
6. Chuyển validated manifest thành `SearchableArtifact`; không giữ `reviewSessionId` trong UI model.
7. Precompute `normalizedTitle` đúng contract.
8. Sort deterministic theo title/title/artifactId.
9. Filter bằng một predicate `includes` trên title duy nhất.
10. Slice sau khi đếm đầy đủ match.

### Automated tests

- Lowercase và accent-insensitive matching.
- `đ`/`Đ` normalization.
- Whitespace collapse và trim.
- Ordered phrase matches; reversed tokens không match.
- Query không match `artifactId`, `kind`, dates hoặc directory khi title không chứa query.
- Empty query match all.
- Deterministic duplicate-title ordering.
- `totalMatches`, `limited` và cap đúng 1.000.
- Chỉ enumerate direct children.
- Skip malformed, missing, legacy schema, ID-mismatch và linked candidates.
- Root read failure được throw, không biến thành empty result.
- Discovery không đọc hoặc mutate `artifact-connection.json`.

### Completion gate

- Search-core tests pass.
- Existing safe-open tests vẫn pass.
- Không có thay đổi public contract hoặc persistent files.

## Release unit 2 — Quick Pick controller

### Mục tiêu

Hiển thị native searchable UI, custom-filter đúng contract và trả selected canonical artifact path.

### File dự kiến

- Thêm `src/extension/artifact-search-command.ts`.
- Thêm `test/artifact-search-command.test.ts` cho các pure view-model/controller seams có thể dependency-inject.

### Các bước thực hiện

1. Tạo Quick Pick bằng `vscode.window.createQuickPick()`.
2. Set command title và placeholder trước khi `show()`.
3. Set `busy = true` trong lúc discovery.
4. Giữ current input value; sau discovery filter bằng value mới nhất.
5. Map records thành Quick Pick items chứa label/description/detail và reference nội bộ tới artifact.
6. Set `alwaysShow: true` để VS Code không áp thêm accent-sensitive filtering.
7. Trong `onDidChangeValue`, filter lại in-memory records ngay lập tức; không đọc disk lại.
8. Cập nhật title/count cho zero, bounded và unbounded results.
9. Trong `onDidAccept`, chỉ xử lý selected item hiện tại; set busy/disable interaction, hide rồi gọi injected open callback.
10. Trong `onDidHide`, dispose listeners và đánh dấu cancellation để discovery chưa hoàn thành không update disposed UI.
11. Nếu discovery/open lỗi, dispose Quick Pick và dùng `showErrorMessage` với message an toàn.

### UX states

| State | Behavior |
|---|---|
| Loading | Quick Pick mở ngay, `busy = true` |
| Empty collection | Không items, thông báo không có artifact |
| No match | Không items, yêu cầu đổi title query |
| 1–1.000 matches | Hiển thị toàn bộ matches |
| >1.000 matches | Hiển thị 1.000 và `Showing 1,000 of N` |
| Invalid candidates | Bỏ qua; chỉ hiển thị aggregate skipped count nếu cần |
| Cancel | Không open và không hiện error |
| Selected artifact disappeared | Open revalidation fail; hiện error, không mở editor |

### Automated tests

- Item mapping chỉ dùng manifest metadata đã chốt.
- Mọi custom-filtered item có `alwaysShow: true`.
- Count/title state đúng ở 0, dưới cap và trên cap.
- Duplicate titles vẫn chọn được từng exact record.
- Query change không gọi discovery lại.
- Cancel trước/sau discovery không gọi open callback.
- Accept gọi open đúng một lần với selected `artifactPath`.

### Completion gate

- Controller logic có deterministic tests.
- Không có filesystem access trong webview.
- Không có MCP/window-registry dependency.

## Release unit 3 — Command registration và open integration

### Mục tiêu

Expose command chính thức và reuse validated Artifact Review open flow trong current extension window.

### File dự kiến

- Sửa `src/extension/extension.ts`.
- Sửa `package.json`.
- Sửa `test/release-contract.test.ts` hoặc thêm package-command contract test phù hợp.

### Các bước thực hiện

1. Thêm activation event `onCommand:agentPlus.searchArtifact`.
2. Thêm command contribution:

   ```json
   {
     "command": "agentPlus.searchArtifact",
     "title": "AI Artifacts: Search Artifact"
   }
   ```

3. Register command trong `activate()` và đưa disposable vào `context.subscriptions`.
4. Inject callback mở item qua instance `artifactReviewOpenCoordinator` hiện có.
5. Callback dùng canonical `artifactPath` và `vscode.Uri.file(...)`.
6. Coordinator revalidate rồi gọi `vscode.openWith` bằng `ArtifactReviewProvider.viewType`.
7. Không gọi connection watcher handler và không ghi connection state.

### Automated tests

- Package chứa đúng command ID/title và activation event.
- Extension source/register seam nối command vào search controller.
- Selected result đi qua coordinator thay vì gọi `openWith` từ search core.
- Search/open không thay đổi bytes hoặc mtime của `artifact-connection.json` trong fixture integration test.
- Race delete/replace giữa discovery và selection fail closed.

### Completion gate

- Command xuất hiện trong Command Palette.
- Chọn item mở Artifact Review, không mở plain Markdown editor.
- Existing manual Open Artifact Review command và watcher flows không đổi.

## Release unit 4 — Full validation và installed-host gate

### Automated validation

Chạy từ repository root:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Không đóng release unit nếu lifecycle, safe-open hoặc release-contract regressions xuất hiện.

### Manual installed-host matrix

1. Collection rỗng.
2. Một artifact.
3. Nhiều artifact với title khác nhau.
4. Vietnamese title/query có và không dấu.
5. Query có uppercase và nhiều whitespace.
6. Query đảo thứ tự từ phải không match.
7. Duplicate titles hiển thị metadata phân biệt được.
8. Hơn 1.000 matches hiển thị cap/count và refine được.
9. Một corrupt/legacy/linked candidate không làm mất valid results.
10. Artifact bị xóa sau khi list nhưng trước khi accept phải fail closed.
11. Selection mở bằng Artifact Review trong window gọi command.
12. Trong multi-window, command ở window A không mở artifact ở window B.
13. Search và open không thay đổi `artifact-connection.json`.
14. Nút Connect trên artifact vừa search/open vẫn copy đúng exact handle và AI inspect được.

### Performance evidence

- Ghi lại thời gian discovery và cảm nhận typing/filter với 1.000 valid manifests trong Extension Development Host hoặc installed VSIX.
- Quan sát thêm 10.000/50.000 fixtures nếu có; không tuyên bố scale support nếu chưa đo.
- Nếu 1.000 artifacts có visible stall sau khi busy kết thúc, profile manifest I/O trước khi thêm cache/index.

### Completion gate

- Automated validation pass.
- Manual cases 1–14 pass hoặc mọi failure được ghi lại thành blocker rõ ràng.
- Không claim installed-host/multi-window stability chỉ từ unit tests.

## Release unit 5 — Documentation và release note, cần Chú phê duyệt

Chỉ thực hiện sau khi Chú đồng ý docs scope.

File dự kiến:

- `README.md`: thêm command và flow Search -> Artifact Review -> Connect.
- `docs/ARCHITECTURE.md`: thêm extension-local search/open flow; xác nhận không liên quan MCP routing.
- `docs/COMPONENTS.md`: thêm search service/controller ownership.
- `docs/INSTRUCTION.md`: thêm current product behavior nếu cần cho source-of-truth.
- `docs/CHANGE_LOGS.md` và `CHANGELOG.md`: ghi feature và validation evidence đúng trạng thái.

Không sửa `skills/create-review-artifact/` vì search không phải agent/MCP capability.

## Dependency order

```text
Search core + tests
  -> Quick Pick controller + tests
  -> command/package registration
  -> full automated validation
  -> installed-host/manual validation
  -> docs/release note after approval
```

Không phụ thuộc cleanup/retention. Cleanup sau này có thể reuse safe direct-child enumeration nhưng không nên được ghép vào release này.

## Rollback

Rollback chỉ cần:

1. bỏ command registration/contribution;
2. bỏ Quick Pick controller;
3. bỏ search core và tests liên quan.

Không cần data migration hoặc artifact repair vì feature hoàn toàn read-only đối với collection và không thay đổi schema/lifecycle/connection state.

## Definition of done

- Matching duy nhất là accent-insensitive normalized `title.includes(query)`.
- Metadata chỉ dùng để hiển thị và phân biệt Quick Pick items.
- Quick Pick không render quá 1.000 items và báo đúng tổng matches.
- Selected artifact được revalidate và mở bằng Artifact Review trong current window.
- Search không đọc Markdown/comments/submission/connection và không mutate bất kỳ lifecycle file nào.
- MCP catalog, skill và installer không thay đổi.
- Automated validation pass.
- Installed-host cases bắt buộc pass trước khi claim feature ổn định/releasable.
