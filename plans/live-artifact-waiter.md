# Implementation plan: giữ waiter qua các lần non-waiting advance

- Ngày: 2026-11-09.
- Trạng thái: đã triển khai source, regression tests, skill/contract và docs; automated gates đã qua. Manual acceptance trong IDE với agent thật chưa thực hiện.
- Mục tiêu: waiter đang pending tiếp tục chờ submission của cùng artifact sau khi `advance_and_wait_for_artifact({ noWait: true })` tăng round. Kết quả và token dùng dữ liệu hiện tại khi nhận submission.
- Chú đã đồng ý đưa phần đồng bộ docs liên quan vào phạm vi plan.

## 1. Contract triển khai

| Tình huống | Hành vi sau thay đổi |
| --- | --- |
| Đã attach waiter, chưa có submission | Giữ request pending; watcher và timer dự phòng tiếp tục hoạt động. |
| Có waiter, advance với `noWait: true` | Cho commit nếu token/state/input hợp lệ; trả commit result như hiện tại; không hủy waiter cũ và không tạo waiter mới. |
| Có waiter trong cùng MCP process, advance với `noWait: false` hoặc không truyền | Vẫn trả `ARTIFACT_ALREADY_WAITING` trước commit. |
| Không có waiter, advance ở chế độ chờ | Commit rồi attach waiter như hiện tại. Không cần takeover khi không có waiter cũ. |
| Submission xuất hiện sau một hoặc nhiều lần advance | Waiter cũ nhận decision, comments, round/hash và next action từ trạng thái hiện tại đã validate. |
| Submission đã tồn tại khi attach | Trả submission hợp lệ hiện tại ngay như luồng đang có. Không thêm cơ chế chỉ nhận event tương lai. |
| Người dùng chủ động takeover/cancel | Hủy waiter tương ứng như hiện tại; không sửa lifecycle files. |
| Thư mục artifact bị xóa | Kết thúc waiter bằng `ARTIFACT_NOT_FOUND`, giữ recovery flags hiện tại. |
| Artifact đang được updater thay file | Tiếp tục chờ; không kết luận artifact đã bị xóa chỉ vì manifest tạm thời vắng mặt. |

Round vẫn là contract của dữ liệu và thao tác ghi: manifest, comments, submission, hashes và round token phải khớp nhau. Chỉ bỏ việc waiter đã attach bắt buộc kết quả phải thuộc round ban đầu.

Để giới hạn thay đổi API, giữ `expectedReviewRound` hiện có của tool wait làm precondition tại thời điểm attach. Sau khi attach thành công, tham số này không ghim các round waiter có thể nhận. Giữ nguyên kiểm tra expected round và token/state của inspect/advance. Không thêm tham số hoặc kiểu result mới.

Ràng buộc đã chốt: advance hoàn tất trước khi người dùng submit. Không đưa xử lý advance và submit đồng thời vào phạm vi này.

## 2. Luồng đích

Tái sử dụng luồng direct Session update và lựa chọn `noWait` đã có trong skill. Inspect vẫn là bước lấy token hiện có; plan không thêm luồng inspect mới hoặc sửa cơ chế takeover. Thay đổi MCP là cho non-waiting advance đi qua chốt waiter và để waiter cũ nhận dữ liệu của round mới.

```text
wait_for_artifact_review hoặc waiting advance
  -> attach một waiter vào exact artifact handle
  -> kiểm tra submission có sẵn, hoặc chờ watcher/timer

inspect(explicit-chat-update, không takeover)
  -> lấy token hợp lệ của round hiện tại đang trống
advance(noWait: true)
  -> kiểm tra input/token/state như hiện tại
  -> commit round mới
  -> trả waited: false; waiter ban đầu vẫn pending
  -> có thể lặp lại update với token mới

người dùng submit sau khi update hoàn tất
  -> đọc submission + manifest + Markdown + comments hiện tại
  -> validate đúng artifact/session và binding giữa các file
  -> trả kết quả từ dữ liệu vừa validate
  -> nếu Review: cấp token của chính kết quả này
  -> đóng watcher/timer và giải phóng waiter như hiện tại
```

## 3. Component MCP: waiter, submission và token

File chính: `src/integration/artifact-review-mcp.ts`.

### 3.1. Bỏ binding round khỏi waiter

- Bỏ trường round dùng để ghim ownership trong `ActiveArtifactWaiter` và điều kiện so sánh round trong `waitForSubmission()`.
- Giữ registry theo exact artifact directory, request key, `AbortController`, settled promise và kiểm tra waiter ownership theo object/request.
- Giữ chốt chống attach waiter thứ hai trong cùng process. Không biến waiter thành một subscription vô hạn: một submission hợp lệ vẫn kết thúc request.
- Không cần updater đẩy context/round vào RAM của waiter.

### 3.2. Tận dụng dữ liệu đã đọc khi có submission

- Dùng `readValidatedSubmissionOnce()` hiện có làm đường đọc chính. Khi chưa có submission, không đọc toàn bộ Markdown/comments hay tính lại hash mỗi giây.
- Khi có submission, tái sử dụng `currentManifest`, `currentMarkdown`, `currentCommentsRaw` và `submissionRaw` đã đọc; không gọi nối tiếp `loadArtifactContext()`/`readArtifactInspection()` để đọc lại cùng dữ liệu.
- Tiếp tục đối chiếu artifact ID và review session ID với identity của waiter. Round hiện tại khác round ban đầu không còn là lỗi.
- Dùng round trong manifest hiện tại để validate comments/submission và tạo result. Giữ kiểm tra hash, schema, binding, và yêu cầu Review phải có comment.
- Dữ liệu thay đổi do advance đã có đủ ở lần đọc này: manifest cung cấp round/updatedAt; Markdown cung cấp hash mới; comments và submission cung cấp feedback/decision mới.
- Không bắt buộc tạo nhánh cache riêng khi round trùng: đường đọc hiện tại vốn đã đọc các file này. Không thêm lượt load chỉ để refresh context RAM.

### 3.3. Kết quả và token dùng cùng nguồn dữ liệu

- Sửa `grantSubmittedRound()` để token lấy artifact/session/round và hashes từ `ReviewWaitResult` đã validate; context ban đầu chỉ còn cung cấp exact directory/path nếu cần.
- Cả `handleWaitTool()` và `handleAdvanceAndWaitTool()` phải đi qua cùng logic này. Không trả result round mới nhưng cấp token theo context cũ.
- Title/kind/link và next action phải phản ánh kết quả hiện tại; không quay về metadata cũ trong RAM.
- Giữ đầy đủ comments ở cả text JSON và `structuredContent`; giữ semantics Review, Proceed theo kind và Just save.
- Giữ expiry, one-time consumption, state binding/replay protection, rollback và post-commit recovery hiện có.

### 3.4. Chỉ mở ngoại lệ cho non-waiting advance

- Đổi chốt trong `handleAdvanceAndWaitTool()` thành chỉ chặn khi có waiter và `noWait` không bật.
- `noWait: true` vẫn yêu cầu UUID `artifactConversationId`; không thay đổi thành kiểm tra Join state hoặc registry membership.
- Giữ commit result `waited: false` hiện có, không thêm decision/comments/token hay field waiter mới vào response.
- Giữ các điều kiện của chat-update token: round trống, Markdown đầy đủ và khác hash hiện tại. Không mở thêm quyền update feedback đã tồn tại.

### 3.5. Artifact bị xóa và updater đang thay file

- Dùng sự tồn tại của thư mục artifact để phân biệt mất exact handle với file con tạm vắng trong transaction. Giữ các path/symlink safety checks hiện có.
- Tận dụng `.artifact-update.lock` hiện có: khi thư mục còn và update lock tồn tại, giữ pending rồi kiểm tra lại ở lượt sau; không đọc snapshot đầy đủ hoặc báo manifest missing.
- Áp dụng cùng nguyên tắc cho kiểm tra submission lúc attach và các lượt watcher/timer. Watcher error/`ENOENT` không được tự biến mọi lần thiếu file con thành artifact đã bị xóa.
- Artifact directory bị xóa vẫn phải kết thúc waiter, kể cả khi trước đó có lock. Missing/malformed lifecycle files ngoài transaction vẫn giữ lỗi validation phù hợp; không sửa dữ liệu hoặc coi mọi lỗi là pending.
- Giữ timer dự phòng một giây và cơ chế không chạy chồng các lượt check. Không thêm notification protocol hay lockfile mới.

## 4. Component skill và tool contract

Giữ luồng chọn `noWait: true` hiện có của Work Session skill. Hướng dẫn inspect chung hiện chỉ cho takeover khi cần detach waiter, không bắt buộc mọi update phải takeover. Không coi tổ hợp inspect takeover rồi advance noWait là một luồng thực tế đã được xác minh hoặc một luồng phải thiết kế lại.

Phạm vi đồng bộ wording:

- Tool descriptions/server instructions trong `src/integration/artifact-review-mcp.ts`.
- `skills/create-review-artifact/SKILL.md` và `references/artifact-contract.md`.
- `skills/work-session/SKILL.md` và `references/session-contract.md` chỉ ở các đoạn cần làm rõ hệ quả giữ waiter; không viết lại luồng direct update/wait-mode selection đã có.

Nội dung:

- Mô tả waiter theo artifact; expected round chỉ là precondition attach, kết quả có thể thuộc round mới hơn.
- Làm rõ đường direct Session update `noWait` hiện có: inspect lấy chat-update token không cần detach/takeover waiter để vượt chốt advance; advance giữ waiter có sẵn và trả commit acknowledgement.
- Giữ nguyên cơ chế takeover và các luồng đọc feedback, reconnect hoặc thay waiter có chủ đích. Không thêm tham số, nhánh inspect hoặc thay đổi implementation của inspect chỉ cho task này.
- Recovery `ARTIFACT_ALREADY_WAITING` phân biệt duplicate wait/waiting advance với non-waiting update được phép.
- Không thay policy creation, standalone, feedback processing, active Session hoặc Proceed authorization.

## 5. Component docs

Chỉ đồng bộ các đoạn chịu ảnh hưởng trong:

- `docs/INSTRUCTION.md`: waiter invariant và non-waiting update.
- `docs/ARCHITECTURE.md`: lifetime, waiter ownership, tool semantics và missing-handle behavior.
- `docs/PHILOSOPHY.md`: waiter chờ artifact qua các lần non-waiting advance.
- `README.md`: hướng dẫn direct update và takeover/wait nếu có mô tả liên quan.
- `docs/CHANGE_LOGS.md`: ghi thay đổi hành vi, rationale và validation thực tế sau triển khai.
- `CHANGELOG.md`: ghi ở phần unreleased, không gán thay đổi cho bản đã phát hành.

Không bump package/MCP/skill versions trong task triển khai này; tuân thủ quy tắc giữ version của cùng chu kỳ unreleased và chỉ bump khi chuẩn bị release. Không sửa installed integrations hay global user artifacts.

## 6. Regression tests và tiêu chí đạt

File chính: `test/review-wait-mcp.test.ts`; điều chỉnh assertions của `test/skill-contract.test.ts`, `test/work-session-skill.test.ts` và test caller liên quan nếu contract wording thay đổi.

| Kiểm tra | Kết quả cần chứng minh |
| --- | --- |
| Wait thường -> inspect không takeover -> hai lần advance noWait -> submit | Chính request wait ban đầu còn pending qua các commit và nhận round/hash/comments cuối cùng. |
| Waiting advance -> non-waiting update -> submit | Waiter được tạo bởi tool advance cũng nhận dữ liệu mới; không chỉ sửa tool wait. |
| Review sau update | Trả token của round mới; dùng token đó advance tiếp thành công; replay vẫn bị chặn. |
| Proceed và Just save sau update | Đúng decision/comments và next action theo kind hiện tại; terminal behavior không đổi. Tái dùng coverage hiện có thay vì nhân toàn bộ ma trận. |
| noWait false/omitted khi có waiter | Vẫn `ARTIFACT_ALREADY_WAITING`, chưa commit; duplicate wait vẫn bị chặn. Tách test cũ đang kỳ vọng cả noWait true đều bị chặn. |
| Validation của dữ liệu hiện tại | Round mới hợp lệ được nhận; sai artifact/session/hash/binding giữa files vẫn bị từ chối. |
| Timer chạy khi updater đã tạo lock và tạm thay manifest | Waiter không kết thúc nhầm; sau commit hoặc rollback vẫn nhận submission hợp lệ. Dùng fixture/test coordination xác định, không dựa vào đua timing ngẫu nhiên. |
| Xóa artifact khi đang wait | Giữ `ARTIFACT_NOT_FOUND`, `retryable: false`, `useSameArtifactHandle: false`. |
| Cancel và intentional takeover sau non-waiting update | Hủy đúng request, dọn watcher/timer, không sửa lifecycle và có thể attach lại. |
| Wait ở process A, update ở process B, sau đó submit | A nhận đúng trạng thái mới và token dùng được ở A. Chỉ một waiter và một updater; không mở rộng sang nhiều writer hoặc cross-process ownership. |

Tái chạy coverage hiện có cho question-only advancement, missing Session ID, stale token/state, rollback, Windows copy fallback, reconnect/routing preservation và unsupported schema. Không viết lại các test đã chứng minh cùng hành vi.

Chạy focused suite trong quá trình triển khai:

```powershell
npm.cmd test -- test/review-wait-mcp.test.ts test/mcp-join-session.test.ts test/artifact-store.test.ts test/skill-contract.test.ts test/work-session-skill.test.ts
```

Sau khi hoàn tất thay đổi, chạy các gate của repo:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
git diff --check
```

Manual acceptance với artifact thử riêng: attach waiter -> direct update noWait không takeover -> đợi qua timer -> Review -> xử lý feedback và advance tiếp; kiểm tra riêng Proceed/Just save nếu có thay đổi ảnh hưởng. Không dùng artifact thật đang mở để làm fixture. Báo tách bạch automated subprocess/Store evidence và Extension Host/agent runtime evidence.

Baseline đã chạy trong cuộc trao đổi trước khi sửa: 5 nhóm focused test, 177 pass và 2 skip. Đây là evidence của code cũ, không phải validation cho hành vi mới.

### Kết quả triển khai 2026-11-09

- Đã sửa cả hai nguồn waiter, ngoại lệ `noWait: true`, validation theo round hiện tại và token tương ứng; giữ nguyên schema, tool arguments/results và version counters.
- Đã thêm 16 regression cases cho update liên tiếp, process updater khác waiter, Review token dùng được/replay, terminal decisions, submission sai binding, rollback, update lock, deletion và cancel/takeover.
- Test có readiness barrier trên stderr chỉ khi bật cờ test, bảo đảm thao tác xóa xảy ra sau khi waiter thực sự attach, không chỉ sau khi gửi request. Test xóa artifact đã qua 20 lượt liên tiếp.
- `npm.cmd run check`: pass. `npm.cmd test`: 54 files pass, 773 tests pass, 3 skip. `npm.cmd run build`: pass.
- Đã đồng bộ wording, product docs và changelog; giữ nguyên nội dung `1.2.0 - Unreleased` được cập nhật đồng thời từ ngoài task này.
- Theo yêu cầu thu gọn sau triển khai, phần skill chỉ còn sửa `create-review-artifact` và contract của nó; bỏ giải thích lặp và chi tiết lockfile, giữ nguyên hai file Work Session. Không đổi implementation.
- Chưa thực hiện manual acceptance Extension Host/agent trong IDE, chưa reinstall integration hoặc restart MCP đang chạy. Automated evidence là rebuilt MCP subprocess và Extension Store trên fixture riêng; không tác động artifact thật đang mở.

## 7. Thứ tự thực hiện và giới hạn

1. Thêm/chỉnh regression tests cho hai nguồn waiter và ngoại lệ noWait.
2. Sửa waiter/submission/token cùng chốt noWait và kiểm tra artifact deletion/update; chạy focused suite.
3. Đồng bộ tool descriptions, wording skills/contracts và docs đã được Chú đồng ý; giữ luồng noWait có sẵn, chỉ chỉnh assertions contract bị ảnh hưởng.
4. Chạy gate đầy đủ, manual acceptance khi runtime sẵn sàng; báo kết quả và giới hạn thực tế.

Độ khó dự kiến: thấp–trung bình. Điểm chính là dùng nhất quán dữ liệu vừa validate ở cả hai caller và không nhầm khoảng thay file của transaction với artifact đã bị xóa. Không có migration schema hoặc thay đổi Extension Store/Webview trong phạm vi hiện tại.

Lợi ích: tận dụng lần đọc hiện có, giữ request đang chờ và giữ toàn bộ contract round/token cho dữ liệu. Đánh đổi chủ đích: waiter có thể trả kết quả round mới hơn round lúc attach; nó không bảo đảm chờ riêng phiên bản ban đầu.

### Optional hardening / Out of scope

- Advance và submit đồng thời, nhiều writer đồng thời, merge/remap comments hoặc UI draft preservation.
- Persistent owner/epoch, cross-process takeover exclusivity, chống phát Proceed trùng giữa nhiều waiter.
- Lịch sử submission, event queue/ID, bỏ hoặc làm optional `expectedReviewRound`, thay đổi schema/API result.
- Recovery stale update lock hoặc process chết giữa transaction; không tự dọn/steal lock trong task này.
- Refactor snapshot reader toàn hệ thống, tối ưu/benchmark ngoài đường đọc đang sửa, phát hành hoặc tự reinstall integration.
