# Review tổng quát Work Session — 2026-11-08

## Review lại sau bản fix — 2026-11-08

**Kết luận reviewer sau khi kiểm chứng lại: đóng WS-F1, WS-F2 và WS-F3 theo các kịch bản đã báo. Không phát hiện finding High/Medium mới hoặc hồi quy trong phạm vi ba bản sửa và các callers liên quan.** Các mục thứ yếu (Low) được giữ lại để tham khảo. Đây là lượt tái kiểm tra bản fix, không phải bằng chứng đã kiểm chứng toàn bộ hành vi Extension Host.

| Finding | Kết quả đối chiếu bản fix |
| --- | --- |
| WS-F1 — Cleanup chung bảo vệ Session v2 khi đọc metadata lỗi | Đã sửa: `cleanupStaleConversations` đọc và parse schema chặt chẽ. Chỉ chạy nhánh cleanup v1 khi metadata parse thành công đúng `ARTIFACT_CONVERSATION_SCHEMA_VERSION = 1` và `parseConversationMetadata` hợp lệ. Mọi lỗi đọc/JSON/schema đều được skip + diagnostic, tuyệt đối không suy đoán thành v1 để xoá. Đã có regression test trong `test/conversation-artifact-registry.test.ts` kiểm tra Session v2 rỗng được bảo toàn 100% khi đọc metadata trả `EACCES` hoặc JSON hỏng. |
| WS-F2 — Atomic rollback cho membership khi readSession hậu commit lỗi | Đã sửa: primitive `registerArtifactInSession` bọc bước `readSession` trong `try/catch`. Nếu `readSession` lỗi, tự động rollback (xoá membership mới nếu thêm mới, hoặc khôi phục `previousRegisteredAt` nếu là update) trước khi rethrow. Phía MCP `create_artifact`, `registeredInExistingConversationId` được gán trước lời gọi để bao phủ rollback. Đã có regression test trong `test/conversation-artifact-registry.test.ts` kiểm tra cả 2 trường hợp thêm mới và update. |
| WS-F3 — Catalog & Manager xác minh canonical directory & manifest ID | Đã sửa: `resolveWorkSessionContext` và `conversation-artifact-service.ts` tái sử dụng `ensureSafeGlobalArtifactDirectory`, `ensureSafeManagedArtifactFile` và so khớp `manifest.artifactId === id`. Nếu artifact nằm ngoài ranh giới (junction/symlink) hoặc manifest ID bị lệch, hệ thống trả `unavailable: true` thay vì để lộ tài liệu ra ngoài. Đã có regression tests trong `test/work-session-context.test.ts` và `test/conversation-artifact-service.test.ts`. |

**Validation reviewer đã chạy lại trên working tree hiện tại:**

- `npm.cmd run check`: **PASS** — `tsc --noEmit`.
- `npm.cmd test`: **PASS — 54 test files, 741 passed, 3 skipped (744)**.
- `npm.cmd run build`: **PASS** — cả 5 bundle targets.
- `git -c core.safecrlf=false diff --check`: **PASS**.

**Fixture độc lập ngoài suite, chạy trên temp root riêng:**

| Finding | Kết quả kiểm chứng lại |
| --- | --- |
| WS-F1 | Inject đúng một lần `EACCES` khi đọc metadata Session v2 rỗng/chưa Archive. Metadata, thư mục membership và Instructions vẫn nguyên; không xoá Session, có diagnostic. Regression trong suite còn kiểm tra JSON hỏng. |
| WS-F2 | Inject `EIO` khi đọc Instructions sau commit membership. Membership mới được xoá; membership có sẵn được khôi phục đúng `registeredAt` ban đầu. Trace MCP xác nhận create đã đặt rollback bookkeeping trước lời gọi; inspect nhận bảo vệ từ primitive khi register throw. |
| WS-F3 | Tạo junction ngay tại collection root `artifacts` tới collection ngoài, với manifest/Markdown hợp lệ. Catalog và Manager đều trả member `unavailable:true`, không trả title/path bên ngoài. Tests mới trong suite kiểm tra junction ở thư mục artifact con; service còn kiểm tra manifest ID mismatch. |

**Thông tin tham khảo:** nhánh lỗi metadata trong cleanup hiện ghi diagnostic nhưng chưa tăng `skippedCount` (`conversation-artifact-registry.ts:1830–1835`); fixture ghi nhận `skippedCount:0`. Đây là sai lệch thống kê, không còn gây xoá Session như WS-F1. Tests tự động mới chưa chứa case junction tại collection root; case này đã được reviewer chạy độc lập ở trên.

**Giới hạn:** chưa chạy Extension Host/AI client thật, và chưa inject lỗi rollback lần hai. Kết quả fixture WS-F2 là ở primitive; bảo vệ callers MCP được đối chiếu source, không phải bằng chứng fault qua transport. Các kết quả và giới hạn bên dưới thuộc lượt review đầu, giữ làm lịch sử; không diễn giải thành finding còn mở.

---

## Lượt review tổng quát đầu — lịch sử

## Phạm vi và kết luận ban đầu

- Baseline trước implementation Work Session: **`f3a772b`**. Review các thay đổi Phase 1–5 đã commit đến **`73b8a4b`** và working tree hiện tại, gồm cả source/tests mới chưa tracked; không chỉ xem diff Chặng 3.
- Đối chiếu plan hiện tại, `AGENTS.md`, `docs/INSTRUCTION.md`, product/lifecycle contracts và source liên quan: registry/migration/types, MCP create/inspect/join/wait, installer/receipts, sidebar/native commands, Session Manager/scoped refresh, metadata, retention/deletion và Export.
- **Chưa đề nghị đóng toàn bộ Work Session:** phát hiện **1 High, 2 Medium** bên dưới. Đây là findings của lượt review tổng quát; không mở lại các lỗi Export trước đã được sửa hoặc các quyết định version/wording/UI Chú đã chốt.
- Không chỉnh code sản phẩm. Reviewer chỉ ghi báo cáo này; kiểm chứng lỗi bằng fixture tạm riêng, không dùng collection thật.

## Findings

### WS-F1 — [High] Cleanup chung có thể phá Session v2 chưa Archive khi đọc metadata lỗi

- **Component/vị trí:** `src/shared/conversation-artifact-registry.ts:1801–1811,1840–1854`; được gọi bởi artifact-retention cleanup trong activation pipeline trước cleanup Archive Session.
- **Trigger:** một Session v2 hợp lệ, rỗng và chưa Archive; `fs.readFile(conversation.json)` gặp lỗi tạm thời. `catch` đặt `isWorkSessionV2 = false`, đồng nghĩa coi target là v1. Với `remainingValidMemberships === 0`, code `rmdir(registered-artifacts)` rồi `unlink(conversation.json)` mà chưa chứng minh target là conversation v1 hợp lệ.
- **Tác động:** Session v2 bị mất metadata và thư mục membership dù chưa đủ bất kỳ điều kiện Delete/Archive nào. `rmdir` cuối có thể lỗi vì còn Instructions/layout, nhưng các bước destructive trước đó đã chạy; kết quả trả về cũng không phản ánh hỏng dữ liệu đó. Fix trước ở `deleteSession`/archive cleanup không bảo vệ đường cleanup chung này.
- **Đã tái hiện trên source hiện tại:** tạo Session v2 rỗng với Instructions, không Archive; fault injection đúng **một lần** đọc metadata trả `EACCES`, rồi chạy `cleanupStaleConversations`. Kết quả: **`metadataExists:false`, `membershipDirectoryExists:false`, `instructionsExists:true`**; counters vẫn `removedConversations:0`, `skippedCount:0`. Không cần concurrency hoặc đổi schema.
- **Khuyến nghị:** đọc và xác minh schema/ID metadata trước khi chọn nhánh cleanup. Chỉ chạy destructive cleanup v1 khi đã parse thành v1 hợp lệ; mọi lỗi đọc/JSON/schema phải skip + diagnostic, không suy thành v1. Giữ Session v2 rỗng/unarchived. Thêm regression một lần metadata read failure và metadata hỏng, kiểm tra metadata/membership directory còn nguyên.

### WS-F2 — [Medium] Đăng ký membership có thể throw sau commit, vượt khỏi rollback của MCP

- **Component/vị trí:** `src/shared/conversation-artifact-registry.ts:1135–1138`; `src/integration/artifact-review-mcp-v4.ts:724–728,1807–1813`.
- **Trigger:** `registerArtifactInSession` đã atomic-write membership nhưng bước `readSession` ngay sau đó lỗi, ví dụ không đọc được `instructions.md`. Hàm chưa trả về nên caller chưa nhận `previousRegisteredAt`/`added`.
- **Tác động:** thao tác MCP báo lỗi nhưng membership mới hoặc mốc `registeredAt` đã persist. Trong create, `registeredInExistingConversationId` chỉ được gán sau `await register...`, nên rollback xoá artifact mới mà không dọn membership; trong inspect/join-with-artifact, lời gọi register nằm trước khối rollback resolve context và caller chưa có trạng thái cũ để restore. Session có thể giữ tham chiếu artifact đã bị rollback hoặc tăng recency dù request thất bại.
- **Đã tái hiện primitive:** Session ban đầu hợp lệ; inject lỗi đọc Instructions trong lần read sau write. `registerArtifactInSession` throw `EACCES`, nhưng **`registered-artifacts/test-member.json` vẫn tồn tại**. Việc bỏ sót rollback ở hai MCP callers được xác minh bằng trace source; chưa chạy fault này qua transport của AI client thật.
- **Khuyến nghị:** primitive phải có kết quả commit nhất quán: đưa các bước đọc có thể lỗi trước commit, hoặc tự rollback membership mới/khôi phục timestamp cũ nếu bước hậu commit lỗi. MCP phải giữ rollback bookkeeping bao phủ cả lời gọi register, không chỉ phần code sau khi register đã return. Không cần lock/CAS hay ownership-hardening mới. Regression cần cả membership mới và refresh membership đã có.

### WS-F3 — [Medium] Catalog và Manager chưa giữ boundary canonical artifact như Open/Export

- **Component/vị trí:** `src/shared/work-session-context.ts:48–80`; `src/extension/conversation-artifact-service.ts:304–319`.
- **Trigger:** collection root `~/.ai-artifacts/artifacts` là junction tới thư mục khác. Context resolver chỉ assert đường dẫn cấu hình, `lstat` child rồi lấy `realpath`; không xác minh root/canonical child bằng helper đầy đủ. Manager đọc manifest/Markdown trực tiếp và còn thiếu kiểm tra `manifest.artifactId === membership ID`.
- **Tác động:** `join_session` có thể trả catalog path ngoài canonical collection như một artifact available; Manager có thể hiển thị tài liệu ngoài boundary hoặc metadata sai identity trong khi Open/Export sẽ từ chối. Đây là inconsistency ở đường context của Phase 4 và card enrichment Phase 5, không phải lỗi Export đã đóng.
- **Đã tái hiện bằng Windows fixture:** tạo valid Session + member `catalog-member`, đặt collection root dạng junction tới `outside/catalog-member`. Context trả `artifactDirectory`/`artifactPath` dưới **`outside`**, `unavailable` không được đặt; Manager trả title/description đó. Sau khi đổi manifest ID thành `wrong-id`, Manager vẫn trả row available với title/kind từ manifest sai.
- **Khuyến nghị:** reuse validation canonical root/directory/regular managed files và exact manifest ID như Open/Export. Member lỗi trả `unavailable:true`; không đọc tiếp metadata/snippet hoặc trả path ngoài collection. Thêm regression linked collection root, linked member/file và manifest-ID mismatch cho resolver/service, không chỉ Export.

## Thông tin tham khảo / Khả năng có thể

| Mức | Vị trí | Nhận xét ngắn |
| --- | --- | --- |
| Low | `src/extension/work-session-provider.ts:456–490` | Hai metadata handlers chưa đối chiếu artifact ID với membership của bound Session như Open đã làm. UI hiện gửi ID của card đúng Session; cân nhắc cùng guard, chưa có bằng chứng thao tác thông thường chọn nhầm target. |
| Low | `SessionApp.tsx`, `ReviewApp.tsx`, các metadata/Export handlers | Pending/guard cho Export và native edit, disable edit khi submit vẫn là khoảng trống đã ghi ở lượt trước; không nâng thành coordination/conflict hardening. |
| Low | `artifact-review-provider.ts:479–505,556–561` | Service artifact event vẫn full-refresh sau metadata patch; classifier cũng chưa so sánh `updatedAt`. Selection/popover chưa được kiểm chứng runtime; không có bằng chứng mất Instructions draft. |
| Low | `conversation-artifact-service.ts:329–336`, `contracts.ts:570–579` | Row unavailable vẫn gán kind `spec` thay vì nhánh DTO không có kind như plan. UI có check unavailable nên chưa thấy lỗi filter ở luồng hiện tại. |

Không đưa refactor, khóa liên process, conflict detection, ZIP import hoặc future-proofing vào required scope. Các quyết định UI/wording/version mới nhất của Chú tiếp tục là authority; khác biệt với văn bản plan cũ không tự thành finding code.

## Validation và giới hạn

| Kiểm chứng trong lượt này | Kết quả |
| --- | --- |
| `npm.cmd run check` | **PASS** — TypeScript. |
| `npm.cmd test` | **PASS — 54 files, 737 passed, 3 skipped (740).** |
| `npm.cmd run build` | **PASS** — extension, uninstall, review webview, Shiki/Mermaid và MCP. |
| `git -c core.safecrlf=false diff --check` | **PASS** trước khi ghi báo cáo. |
| Fixture bổ sung | WS-F1: valid unarchived v2 + one-shot read failure → mất metadata/membership directory. WS-F2: lỗi read hậu commit → membership còn tồn tại. WS-F3: linked collection root + manifest mismatch → catalog/rows vẫn available. Tất cả trong temp roots có guard absolute path; đã dọn. |
| Manual runtime | **Chưa chạy Extension Host/AI client thật.** Chưa chứng nhận native picker/menus, clipboard, focus/grid, watcher multi-window hay continuation trên từng client. |

Các tests Export bảo toàn target/junction/ID mismatch và metadata timestamps hiện pass, nhưng không bao phủ ba đường lỗi mới nêu trên. Dynamic-kind tests hiện chờ `waiting.sent` thay vì xác nhận waiter đã load context cũ; chưa có case đổi kind trong wait sau advance. Các UI tests chủ yếu SSR/reducer, chưa chứng minh chuỗi click/message thực tế. Automated pass vì vậy không thay thế việc xử lý WS-F1–F3 hoặc runtime verification.
