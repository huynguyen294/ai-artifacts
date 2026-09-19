# Phase 2 — Cut over extension watcher sang targeted connection events

## 1. Mục tiêu

Thay thế cơ chế auto-open cũ (`comments.json` + `isWindowFocused: true`) bằng **targeted connection events** (`artifact-connection.json`) để chỉ đúng VS Code window được chọn trong Phase 1 gọi `vscode.openWith`, kể cả khi window đó đang unfocused/minimized.

## 2. Phạm vi Component

### Extension Runtime & Open Coordinator

- `src/extension/workspace-registry-publisher.ts`: expose `currentInstanceId`.
- `src/extension/artifact-review-open.ts`: triển khai targeted connection handler, request-ID deduplication, single-flight opening và multi-window isolation.
- `src/extension/extension.ts`: đăng ký watcher `artifact-connection.json`, dùng local publisher instance ID và loại bỏ runtime registration của watcher `comments.json`.

### Shared Connection Routing

- `src/shared/artifact-connection.ts`: cung cấp safe routing read nếu cần tách target identification khỏi full artifact-parent validation.
- Routing read không được làm yếu containment, direct-child hoặc linked-path rejection.

### Automated Tests & Regression Suite

- `test/artifact-review-open.test.ts`: targeted watcher, dedupe/retry, multi-window isolation, unsafe target rejection, auto-open setting và manual open coordinator.
- `test/artifact-connection.test.ts`: shared connection routing/safety contract nếu bổ sung routing-read helper.
- `test/workspace-registry.test.ts`: publisher instance identity và registry behavior không regression.

## 3. Trạng thái review hiện tại

Cả năm findings kỹ thuật (**P1.1**, **P2.1**, **P2.2**, **P1.2**, **P2.3**) đã được khắc phục hoàn toàn và kiểm chứng qua regression tests:
- **P1.1**: Đã tách dedupe thành `completedOpenRequestIds` và `inFlightOpenRequests`; request thất bại có thể retry và không bị dedupe vĩnh viễn; concurrent joiners không duplicate error report.
- **P2.1**: Đã triển khai two-stage routing với `readArtifactConnectionRoute`; non-target windows im lặng tuyệt đối trước full validation; unroutable/malformed route fail-closed im lặng không spam lỗi.
- **P2.2**: Đã xóa sạch toàn bộ legacy comments watcher helpers/types và `isWindowFocused` khỏi extension codebase; handler safety coverage đã khóa chặt wrong-root, linked paths và root initialization failure.
- **P1.2**: Đã đưa `ensureSafeGlobalArtifactDirectory`, `ensureSafeManagedArtifactFile` và `readFile` vào cùng một bounded retry loop; retry actual `ENOENT` (từ directory, path lẫn read); chỉ áp dụng `allowMissing` sau khi hết toàn bộ attempts.
- **P2.3**: Tái kiểm tra containment và non-linked invariants ở mỗi retry attempt; thay thế symlink/junction giữa các attempts fail-fast ngay lập tức và không đọc target bên ngoài.

Toàn bộ automated gates (typecheck, focused 97 tests, full regression 303 tests, full production build) đều pass 100%.

Phase 2 hiện chỉ còn sáu manual VS Code cases chờ Chú kiểm chứng trực tiếp trên môi trường thực tế. Automated mocks không được dùng để thay thế claim manual.

## 4. Findings và đề xuất remediation

### [RESOLVED] P1.1 — Failed open bị dedupe vĩnh viễn

#### Hiện trạng

`createTargetedArtifactConnectionHandler` thêm `openRequestId` vào `processedOpenRequestIds` trước khi gọi `openArtifactReview`. Nếu validation/open dependency hoặc `vscode.openWith` lỗi tạm thời, request vẫn nằm trong completed cache; mọi filesystem event sau với cùng request ID bị bỏ qua.

#### Tác động

- Artifact có thể không tự mở dù connection request hợp lệ.
- Duplicate create/change event không thể phục hồi một transient open failure.
- Reconnect chỉ khôi phục được khi MCP phát một `openRequestId` mới; request hiện tại đã bị mất.

#### Đề xuất fix

Thay một `processedOpenRequestIds` set bằng hai trạng thái riêng:

```ts
completedOpenRequestIds: Set<string>;
inFlightOpenRequests: Map<string, Promise<void>>;
```

Quy tắc:

1. Nếu request ID đã completed, ignore duplicate.
2. Nếu request ID đang in-flight, join cùng promise; không gọi open lần hai.
3. Chỉ thêm request ID vào completed cache sau khi `openArtifactReview` thành công.
4. Khi open thất bại, luôn xóa in-flight entry và không thêm completed entry, để event sau có thể retry.
5. Chỉ invocation sở hữu in-flight request gọi `reportError`, tránh duplicate error reports từ các listener cùng join.
6. Giữ bounded completed cache; không eviction một request đang in-flight.

#### Acceptance tests

- Hai concurrent events cùng request ID chỉ gọi `openArtifactReview` một lần.
- Lần open đầu fail, event sau với cùng request ID retry và thành công.
- Failed request không nằm trong completed cache.
- Successful request tiếp tục dedupe create/change events.
- Request ID mới cho cùng artifact vẫn reopen/reveal bình thường.

### [RESOLVED] P2.1 — Non-target windows chưa im lặng trước validation errors

#### Hiện trạng

Handler hiện gọi `readArtifactConnection`, bao gồm full artifact-parent/manifest validation, trước khi so sánh `connection.windowInstanceId` với local instance ID. Vì mỗi VS Code window đều watch cùng global collection, invalid manifest, wrong parent hoặc unsafe state có thể khiến mọi window gọi `reportError`, kể cả các non-target windows.

#### Tác động

- Vi phạm silent-isolation contract của targeted routing.
- Một invalid event có thể tạo duplicate error logs theo số window đang mở.
- Non-target window thực hiện filesystem validation không cần thiết và khó phân biệt lỗi thuộc window nào.

#### Đề xuất fix

Bổ sung two-stage read, không đọc raw file thiếu safety checks:

1. **Safe routing read**:
   - Validate canonical global collection containment, direct-child artifact directory và non-linked connection path.
   - Bounded retry cho transient missing/partial atomic-read state.
   - Parse đầy đủ connection schema để lấy trusted `windowInstanceId`, `openRequestId` và revision.
   - Chưa validate artifact manifest/Markdown ở bước này.
2. **Window match**:
   - Nếu route hợp lệ nhưng target ID khác local ID, return im lặng trước full artifact validation.
   - Nếu route không thể parse nên không xác định được target, fail closed: không mở và không phát user-facing/per-window error. Có thể dùng debug diagnostics không gây multi-window error spam.
3. **Target-only full validation**:
   - Chỉ matching window gọi existing full `readArtifactConnection`/artifact open coordinator.
   - Mọi parent, manifest, linked-file hoặc open error sau khi target đã được xác lập mới đi qua `reportError`.

Không được parse connection bằng một unsafely-read path chỉ để tối ưu isolation. Routing helper mới, nếu có, phải giữ nguyên root containment và linked-path invariants.

#### Acceptance tests

- Valid route target A nhưng manifest invalid: A report error; B không open và không report error.
- Valid route target A nhưng artifact target linked/unsafe: chỉ A report error.
- Valid route target A: B không gọi full artifact validation/open coordinator.
- Malformed/unroutable connection: mọi window fail closed, không `openWith`, không duplicate per-window error spam.
- Transient missing/partial connection read retry boundedly rồi target window mở đúng một lần.

### [RESOLVED] P2.2 — Cutover cleanup và handler safety coverage chưa đủ

#### Hiện trạng

- Runtime registration trong `extension.ts` đã bỏ comments watcher, nhưng `createArtifactReadyHandler`, `setupGlobalArtifactReadyWatcher`, `isWindowFocused` dependencies và related legacy types vẫn tồn tại dưới nhãn “backward-compatible test fixtures”, dù không còn production/test consumer hợp lệ.
- Targeted handler tests đã cover valid multi-window, dedupe và malformed JSON, nhưng chưa trực tiếp khóa toàn bộ gate: transient atomic-read recovery, wrong-root connection event, linked connection path, target-only error isolation và root-validation failure trước watcher registration.

#### Tác động

- Source vẫn chứa hai auto-open contracts, tạo nguy cơ legacy focused-window path bị tái sử dụng.
- Static source checks chỉ nhìn `extension.ts` có thể pass dù legacy path vẫn còn trong extension module.
- Shared safety tests giảm rủi ro nhưng chưa chứng minh extension handler wire đúng các boundaries bắt buộc.

#### Đề xuất fix

- Xóa legacy comments watcher types/functions và unused imports/tests; không giữ mixed-version compatibility chỉ cho fixtures.
- Nếu có consumer thực tế buộc phải giữ, cần một architecture decision riêng và sửa wording “loại bỏ hoàn toàn”; mặc định của Phase 2 là xóa.
- Bổ sung focused handler/watcher tests cho:
  - wrong-root event;
  - linked connection file/directory;
  - transient missing/partial connection read;
  - root validation fail thì không tạo watcher;
  - valid non-target event không gọi full validation/open;
  - malformed/unroutable event fail closed theo policy của P2.1.
- Source inspection phải kiểm tra cả `extension.ts` và `artifact-review-open.ts` không còn comments watcher hoặc `isWindowFocused` legacy branch.

#### Acceptance tests

- Không còn exported/runtime legacy comments watcher symbol.
- `rg` trên `src/extension` không còn `setupGlobalArtifactReadyWatcher`, `createArtifactReadyHandler`, `*/comments.json` hoặc targeted branch dùng `isWindowFocused`.
- Unsafe/wrong-root/linked connection event không bao giờ tới `openWith`.
- `ensureGlobalArtifactsRoot` fail trước khi `createWatcher` được gọi.
- Manual command vẫn dùng shared `ArtifactReviewOpenCoordinator` và behavior không regression.

### [RESOLVED] P1.2 — `ENOENT` bỏ qua bounded retry và có thể làm mất open event

#### Hiện trạng

`readArtifactConnectionRoute` khai báo `boundedRetry: true` và tạo tối đa năm attempts, nhưng hai nhánh `ENOENT` hiện return sớm:

- `ensureSafeGlobalArtifactDirectory(...)` gặp `ENOENT` và `allowMissing: true` thì trả `null` trước khi vào retry loop.
- `fs.readFile(...)` gặp `ENOENT` và `allowMissing: true` thì trả `null` ngay ở attempt đầu tiên.

Test mang tên “transient missing/partial connection read” hiện chỉ mock một empty string rồi trả nội dung hợp lệ; nó chứng minh partial/empty retry nhưng chưa mô phỏng missing file bằng lỗi `ENOENT`.

#### Tác động

- Watcher event có thể đến trong khoảng atomic replace mà connection file hoặc artifact directory tạm thời chưa nhìn thấy được.
- Handler nhận `null`, return im lặng và không mở artifact. Nếu filesystem không phát thêm event, request hợp lệ bị mất.
- Tên option và test hiện tại tạo cảm giác `boundedRetry` đã cover transient missing trong khi behavior thực tế chưa cover.

#### Đề xuất fix kỹ thuật

Refactor `readArtifactConnectionRoute` để **một attempt bao trọn cả path validation và file read**, thay vì chỉ retry phần đọc nội dung:

```ts
const maxAttempts = boundedRetry ? 5 : 1;

for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
  try {
    const safeDirectory = await ensureSafeGlobalArtifactDirectory(...);
    const safeFilePath = await ensureSafeManagedArtifactFile(..., {
      allowMissing: true,
    });
    const raw = await fs.readFile(safeFilePath, "utf8");
    // empty/malformed JSON retry policy hiện có
    return parseRoute(raw);
  } catch (error) {
    const canRetry = attempt < maxAttempts - 1;
    if (errorCode(error) === "ENOENT" && canRetry) {
      await waitForConnectionReadRetry();
      continue;
    }
    if (errorCode(error) === "ENOENT" && allowMissing) return null;
    throw normalizeRouteReadError(error);
  }
}
```

Yêu cầu semantics:

1. Với `boundedRetry: true`, `ENOENT` từ cả artifact directory validation, connection path validation hoặc `readFile` phải retry boundedly.
2. Chỉ sau attempt cuối mới trả `null` khi `allowMissing: true`; nếu `allowMissing: false` thì propagate lỗi `ENOENT` sau khi hết retry.
3. Với `boundedRetry: false`, giữ đúng one-attempt behavior: `allowMissing: true` trả `null`, `allowMissing: false` throw.
4. Mỗi failed attempt chỉ sleep một lần; không tạo nested retry hoặc nhân đôi delay.
5. Empty/malformed JSON có thể tiếp tục retry như hiện tại. Schema-invalid và safety violations phải fail ngay, không được biến thành transient missing hoặc bị suppress.
6. Có thể tách helper `waitForConnectionReadRetry` và `isTransientConnectionRouteReadError` để policy rõ ràng; không dùng catch-all retry cho lỗi validation/symlink.

#### Acceptance tests

- `readFile` attempt đầu throw `ENOENT`, attempt sau trả connection hợp lệ: route được trả về và số lần đọc đúng như mong đợi.
- Artifact directory hoặc connection path tạm thời `ENOENT`, sau đó xuất hiện trong retry window: route được đọc thành công.
- `ENOENT` kéo dài hết retry + `allowMissing: true`: trả `null` sau đúng bounded attempts, không throw.
- `ENOENT` kéo dài hết retry + `allowMissing: false`: throw sau đúng bounded attempts.
- `boundedRetry: false` không thực hiện attempt thứ hai.
- Handler-level test dùng actual `ENOENT` rồi valid content và chứng minh target window gọi open đúng một lần, không report error.

### [RESOLVED] P2.3 — Safety validation không được lặp lại trước mỗi retry read

#### Hiện trạng

`ensureSafeGlobalArtifactDirectory` và `ensureSafeManagedArtifactFile` hiện chạy một lần trước retry loop. Sau một empty/malformed/transient read, các attempt sau tiếp tục gọi `fs.readFile(safeFilePath, ...)` trên chuỗi path đã được xác nhận ở thời điểm cũ mà không tái kiểm tra directory/file có bị thay bằng symlink hoặc junction hay không.

#### Tác động

- Một local same-user process có thể thay directory hoặc connection file trong khoảng giữa hai attempts.
- Retry sau có thể follow linked path và đọc dữ liệu ngoài managed artifact directory, trái với fail-closed linked-path invariant.
- Đây là **P2 hardening** theo threat model hiện tại. Chỉ nâng thành P1 nếu Phase 2 tuyên bố bảo vệ đầy đủ trước adversarial same-user filesystem races.

#### Đề xuất fix kỹ thuật

Áp dụng cùng refactor của P1.2, với các ràng buộc bổ sung:

1. Chuyển cả `ensureSafeGlobalArtifactDirectory(...)` và `ensureSafeManagedArtifactFile(...)` vào bên trong retry loop.
2. Trước **mỗi** `fs.readFile`, resolve và validate lại canonical collection containment, direct-child artifact directory và non-linked managed file.
3. Không cache `safeDirectory`/`safeFilePath` qua các attempts. Giá trị của attempt trước không được tái sử dụng sau khi đã `await` retry delay.
4. Nếu revalidation phát hiện symlink/junction, wrong root hoặc unsafe managed path, throw/fail closed ngay; không retry tiếp và không đọc target bên ngoài.
5. Giữ lỗi routing ở handler theo policy P2.1: không `openWith`; unroutable pre-target failure không tạo per-window user-facing error spam.
6. Fix này khóa khoảng trống **giữa các retry attempts**. Nó không nên tuyên bố loại bỏ mọi TOCTOU race giữa lần `lstat` cuối và chính `readFile`; descriptor-based/no-follow I/O sẽ là một architecture hardening riêng nếu threat model yêu cầu mức đó.

#### Acceptance tests

- Attempt đầu trả empty/partial content; trước attempt hai, artifact directory được thay bằng symlink/junction tới outside directory: route read phải reject trước lần đọc thứ hai.
- Tương tự với connection file bị thay bằng symlink khi platform/test environment hỗ trợ file symlink.
- Outside target chứa một connection hợp lệ vẫn không được parse và không dẫn tới `openArtifactReview`/`openWith`.
- Sentinel bytes ngoài managed root giữ nguyên; test chứng minh không có write/delete ngoài exact owned paths.
- Normal empty/malformed retry vẫn thành công khi path không thay đổi, tránh hardening làm regression luồng atomic commit hợp lệ.

## 5. Checklist kỹ thuật

- [x] `WorkspaceRegistryPublisher` expose `currentInstanceId`.
- [x] `setupGlobalArtifactConnectionWatcher` watch `*/artifact-connection.json` cho `onDidCreate` và `onDidChange`.
- [x] Runtime registration trong `extension.ts` không còn comments-created watcher hoặc focused-window gate.
- [x] Target window có thể gọi shared open coordinator mà không kiểm tra `vscode.window.state.focused`.
- [x] Dedupe chỉ đánh dấu completed sau successful open; failed request có thể retry.
- [x] Non-target window được loại trước full artifact validation và không report lỗi của target khác.
- [x] Legacy comments watcher helpers/types được xóa hoặc có architecture decision được Chú phê duyệt.
- [x] `boundedRetry` retry actual `ENOENT` từ directory/path/read và chỉ áp dụng `allowMissing` sau attempt cuối.
- [x] Directory và connection path được safety-check lại trước mỗi retry read; unsafe replacement fail closed.
- [x] Shared và handler-level tests cover actual `ENOENT` recovery cùng retry-time symlink/junction replacement.
- [x] Typecheck `npm.cmd run check` pass tại lần kiểm chứng gần nhất.
- [x] Focused automated tests pass: 97 tests trong `artifact-review-open`, `artifact-connection` và `workspace-registry` suites.
- [x] Full regression suite pass: 303 passed, 3 skipped, 20 test files.
- [x] Full production build pass.
- [ ] Sáu manual VS Code cases được Chú xác nhận pass hoặc ghi rõ `N/A` theo support matrix.

## 6. Implementation sequence

1. Sửa P1.1 bằng in-flight/completed request state và tests failure-then-retry.
2. Thiết kế/triển khai safe routing read cho P2.1, giữ nguyên containment và symlink rejection.
3. Áp dụng target-first isolation trong extension handler và bổ sung multi-window error-isolation tests.
4. Xóa legacy comments watcher code và mở rộng handler safety coverage của P2.2.
5. Refactor retry boundary của `readArtifactConnectionRoute` để đóng P1.2 và P2.3 trong cùng một thay đổi: revalidate path ở từng attempt, retry `ENOENT` boundedly và giữ safety errors fail-fast.
6. Bổ sung shared tests cho retry semantics và retry-time path replacement; thay handler test “transient missing” hiện tại bằng actual `ENOENT` case hoặc tách rõ empty-read và missing-read thành hai tests.
7. Chạy focused tests, TypeScript check và extension build.
8. Chạy full test/build; thực hiện AI review gate và cập nhật lại test counts/evidence trong plan.
9. Chỉ sau automated gates mới chạy manual matrix cùng Chú.
10. Chỉ đánh dấu Phase 2 complete sau khi cả automated và manual gates pass.

## 7. Automated verification

```powershell
npm.cmd test -- --run test/artifact-review-open.test.ts test/artifact-connection.test.ts test/workspace-registry.test.ts
npm.cmd run check
npm.cmd run build:extension
npm.cmd test
npm.cmd run build
```

### AI review gate

- Dedupe state không consume request trước successful open.
- In-flight failure được cleanup; event sau có thể retry cùng request ID.
- Non-target branch xảy ra trước full artifact validation/open và không report target error.
- Routing read vẫn validate canonical root, direct child và linked path trước read.
- `boundedRetry: true` retry actual `ENOENT` từ directory/path/read; `allowMissing` chỉ quyết định kết quả sau attempt cuối.
- Mọi retry attempt đều tái validate directory và connection path ngay trước read; không reuse safety result từ attempt trước.
- Safety/schema errors fail ngay và không bị retry/suppress như transient missing.
- Không còn comments-created watcher code hoặc `isWindowFocused` gate trong targeted path.
- Manual command vẫn dùng shared validation/open coordinator.
- Không tuyên bố multi-window pass chỉ từ mocks.

## 8. Manual Verification Matrix — Chú cần chạy

| #     | Kịch bản                | Thao tác thực hiện                                                                                           | Kết quả mong đợi                                                                             |    Trạng thái    |
| ----- | ----------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | :--------------: |
| **1** | Hai windows khác folder | Mở 2 VS Code window: Window A (folder A) và Window B (folder B). Chạy prompt tạo artifact chỉ định folder A. | Chỉ Window A tự động mở tab `Artifact Review`. Window B không mở tab.                        | Chờ Chú xác nhận |
| **2** | Hai windows cùng repo   | Mở cùng 1 repo ở 2 windows. Focus vào Window 1, prompt tạo artifact với câu lệnh “ở window đang focus”.      | Chỉ Window 1 mở tab `Artifact Review`.                                                       | Chờ Chú xác nhận |
| **3** | Hai windows mơ hồ       | Mở cùng 1 repo ở 2 windows nhưng không chỉ định và không có focus context rõ ràng.                           | AI dừng lại hỏi Chú chọn window thay vì tự đoán.                                             | Chờ Chú xác nhận |
| **4** | Cửa sổ unfocused        | Chuyển focus sang ứng dụng khác trước khi artifact được tạo xong.                                            | Khi quay lại VS Code, tab `Artifact Review` đã được mở trong target window.                  | Chờ Chú xác nhận |
| **5** | Reload/Reconnect        | Đóng hoặc reload target window sau khi tạo artifact. Gọi reconnect trên exact artifact handle.               | Stale ID được reject/resolve lại và connection rebind sang window đang sống; đúng window mở. | Chờ Chú xác nhận |
| **6** | Tắt setting auto-open   | Tắt `agentPlus.autoOpenArtifactReview`, tạo artifact; sau đó bật lại và reconnect.                           | Khi tắt: connection vẫn update nhưng UI không tự mở. Khi bật và reconnect: tab tự mở.        | Chờ Chú xác nhận |

AI phải cung cấp từng thao tác ngắn, chờ Chú xác nhận kết quả và ghi pass/fail theo case. Nếu một case fail, dừng phase để chẩn đoán; không chuyển sang packaging/release.

## 9. Điều kiện hoàn tất Phase 2

- P1.1, P2.1, P2.2, P1.2 và P2.3 được đóng bằng source và regression evidence.
- Focused tests, TypeScript check, extension build, full test và full build pass sau remediation cuối cùng.
- Chú xác nhận toàn bộ manual cases bắt buộc pass; case không áp dụng được ghi `N/A`, case defer giữ Phase 2 ở trạng thái chưa hoàn tất.
- Đúng target window mở cho create/reconnect; non-target windows không mở và không report lỗi của window khác.
- Window focus không còn là điều kiện của targeted open.
- Comments-created auto-open contract không còn trong extension source.

## 10. Rollback checkpoint

- Nếu targeted watcher fail, có thể revert runtime registration về comments-created behavior trong khi giữ Phase 1 connection files/MCP logic; không xóa user artifact data.
- Rollback phải đồng bộ handler, extension wiring và related tests; không để producer/consumer contract ở trạng thái mixed.
- Nếu manual case fail, giữ Phase 2 chưa hoàn tất và chẩn đoán trên cùng source/build trước khi chuyển Phase 3.
