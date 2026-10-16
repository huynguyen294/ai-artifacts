# Artifacts in Conversations — Phân tích và quyết định đã chốt

## Trạng thái tài liệu

- Đây là source of truth cho implementation plan của tính năng **Artifacts in Conversations**.
- Tài liệu ghi lại các quyết định sản phẩm và kiến trúc đã được chốt; chưa phải implementation plan và chưa mô tả tính năng đã được triển khai.
- Implementation plan sau này phải tham chiếu tài liệu này và không tự thay đổi các quyết định bên dưới.
- Kiến trúc hiện tại vẫn là schema v6, MCP server 9.0.0 và đúng năm tool. Mọi thay đổi contract/schema/version phải được xử lý rõ trong implementation plan.

## 1. Mục tiêu

Biến Artifact Viewer thành một ứng dụng review có thể điều hướng giữa nhiều artifact do AI đăng ký, được nhóm theo logical conversation.

Người dùng có thể:

- Mở sidebar **Conversation Artifacts** ở bên trái, đối diện với Comments sidebar ở bên phải.
- Xem nhiều conversation dưới dạng accordion.
- Mở từng conversation để xem các artifact đã đăng ký trong conversation đó.
- Nhận biết artifact đang mở.
- Mở/reveal một artifact khác bằng Artifact Review custom editor hiện tại.
- Xem một artifact xuất hiện trong nhiều conversation khi artifact đó đã được đăng ký vào nhiều conversation.
- Truy cập một mục tổng hợp **All registered artifacts** mà không phụ thuộc conversation đang mở.

Tính năng không biến Artifact Viewer thành chat UI, không lưu message history của AI client và không phụ thuộc ID nội bộ của Codex, Cursor, Claude Code, Windsurf hoặc Copilot.

## 2. Thuật ngữ đã chốt

### `artifactConversationId`

`artifactConversationId` là ID logic do AI Artifacts MCP sở hữu và sinh ra. Nó không phải chat ID thật của AI client.

Tên này phải được dùng trong contract và implementation để tránh ngụ ý rằng extension có thể đọc hoặc suy ra ID conversation nội bộ của AI client.

### `conversationName`

`conversationName` là tên hiển thị cho một logical artifact conversation.

- Đây là metadata tùy chọn.
- AI có thể gửi tên khi tạo artifact đầu tiên.
- Nếu không có tên, MCP dùng title của artifact đầu tiên làm tên mặc định.
- Việc đổi tên thủ công có thể được bổ sung sau; không phải điều kiện để triển khai phiên bản đầu tiên.

### Quan hệ nhiều-nhiều

Quan hệ giữa conversation và artifact là many-to-many:

```text
Một conversation  → nhiều artifact
Một artifact      → nhiều conversation
```

Việc một artifact được đăng ký vào conversation mới không làm thay đổi identity, review session, review round hoặc nội dung Markdown của artifact đó.

## 3. Quyết định về AI/MCP contract

### Không yêu cầu AI cung cấp chat ID

AI client không được giả định là có hoặc expose một chat/conversation ID ổn định. MCP không được suy ra conversation từ cwd, workspace, artifact mới nhất, VS Code window hoặc process hiện tại.

### Không thêm tool tạo conversation riêng

Không thêm `create_conversation` hoặc tool tương đương. Một tool call riêng sẽ tăng round-trip và làm chậm đường tạo artifact đầu tiên mà không mang lại giá trị cần thiết.

Conversation được tạo cùng artifact đầu tiên:

```text
Artifact đầu tiên
AI -> create_artifact không có artifactConversationId
MCP -> sinh artifactConversationId, tạo conversation và đăng ký artifact
MCP -> trả artifactConversationId cùng kết quả create

Artifact tiếp theo trong cùng logical conversation
AI -> create_artifact có artifactConversationId đã nhận
MCP -> đăng ký artifact mới vào conversation đã có
MCP -> trả lại artifactConversationId trong kết quả
```

### Input dự kiến của `create_artifact`

```ts
type CreateArtifactConversationInput = {
  artifactConversationId?: string;
  conversationName?: string;
};
```

Quy tắc:

- Không có `artifactConversationId`: MCP sinh ID mới và tạo conversation mới.
- Có `artifactConversationId`: MCP validate conversation tồn tại rồi đăng ký artifact mới vào conversation đó.
- `conversationName` chỉ là metadata tùy chọn, không phải điều kiện tạo artifact.
- ID không hợp lệ hoặc không tồn tại phải fail closed; không tự tạo conversation với ID do AI gửi và không chọn conversation gần nhất.

### Đăng ký artifact đã tồn tại

Khi một artifact đã tồn tại được mở/reconnect trong một logical conversation khác, request có thể mang `artifactConversationId` hiện hành để đăng ký thêm membership.

Đăng ký này:

- Không tạo artifact mới.
- Không đổi `artifactId` hoặc `reviewSessionId`.
- Không advance review round.
- Không cập nhật `artifact.json.updatedAt` vì không có thay đổi nội dung review.
- Không ghi conversation data vào `artifact-connection.json`; file đó tiếp tục chỉ sở hữu UI-routing state.

## 4. Ba lớp bảo vệ `artifactConversationId`

Ba lớp sau là yêu cầu bắt buộc:

1. **Skill cache:** skill giữ `artifactConversationId` của logical conversation hiện tại, tương tự mapping exact `artifactDirectory -> reviewRound/windowInstanceId` đang có.
2. **Tool-result echo:** các lifecycle result liên quan phải trả lại `artifactConversationId` hoặc conversation associations phù hợp để AI liên tục nhận lại context thay vì chỉ thấy ID một lần.
3. **Exact-handle recovery:** nếu AI còn exact `artifactDirectory` nhưng mất ID sau context compaction/restart, `inspect_artifact_review` phải có thể trả conversation associations của đúng artifact đó.

Nếu AI mất cả `artifactConversationId` lẫn mọi exact artifact handle thì không được đoán. Người dùng phải chọn conversation/artifact từ UI hoặc cung cấp lại exact handle.

Không được dùng tìm kiếm theo title, thời gian mới nhất hoặc cwd để phục hồi tự động một conversation.

## 5. Conversation registry

### Trách nhiệm

Thêm một component riêng, tên khuyến nghị là `ConversationArtifactRegistry`.

Nó không thay thế `ArtifactStore`:

```text
ArtifactStore
  - Sở hữu việc đọc/ghi lifecycle của một artifact cụ thể.
  - Markdown, manifest, comments và submission.

ConversationArtifactRegistry
  - Sở hữu quan hệ conversation-artifact.
  - Đăng ký membership.
  - Liệt kê conversations và artifacts theo conversation.
  - Cung cấp associations của một exact artifact để phục hồi.
```

### Index chính

Registry phải hỗ trợ trực tiếp:

```text
artifactConversationId -> artifactIds
```

Không yêu cầu AI gửi toàn bộ artifact dictionary. Không scan toàn bộ artifact collection mỗi lần mở sidebar.

Registry chỉ lưu identity/reference cần thiết. `title`, `kind`, `reviewRound` và timestamps phải được đọc từ manifest đã validate, không được sao chép thành nguồn dữ liệu thứ hai dễ stale.

### Lưu trữ filesystem đề xuất

Một layout filesystem-native phù hợp với kiến trúc hiện tại:

```text
~/.ai-artifacts/
  artifacts/
    <artifact-id>/
      artifact.json
      artifact.md
      comments.json
      review-submission.json
      artifact-connection.json

  conversations/
    <safe-conversation-key>/
      conversation.json
      artifacts/
        <artifact-id>.json
```

Mỗi membership là một file riêng thay vì một global JSON array lớn. Mục tiêu là:

- Registration idempotent.
- Tránh lost update từ read-modify-write khi nhiều MCP process hoạt động.
- Chỉ enumerate artifacts của conversation cần đọc.
- Không làm hỏng toàn bộ index nếu một membership file bị lỗi.

Raw `artifactConversationId` không được dùng trực tiếp làm path nếu chưa validate. Directory key phải là UUID hợp lệ hoặc một safe derived key theo contract.

### Source of truth và validation

- Registry là source of truth cho membership conversation-artifact.
- `artifact.json` tiếp tục là source of truth cho artifact identity và lifecycle.
- `artifact-connection.json` tiếp tục chỉ là source of truth cho UI routing.
- Khi liệt kê hoặc mở một artifact từ registry, Extension Host phải revalidate directory containment, artifact ID binding, schema và managed paths.
- Registry không trao quyền mở một arbitrary path do AI cung cấp.

### Retention và stale membership

- Conversation registration không refresh artifact retention timestamp.
- Artifact đã bị retention cleanup hoặc người dùng xóa có thể để lại membership stale trong một khoảng ngắn.
- Reader phải bỏ qua missing/invalid artifact thay vì làm hỏng toàn bộ conversation.
- Implementation plan phải chọn chiến lược cleanup membership rõ ràng, nhưng cleanup không được làm yếu validation boundary của artifact.

## 6. Sidebar Conversation Artifacts

### Vị trí

Conversation Artifacts là sidebar bên trái trong cùng Artifact Review Webview app. Comments tiếp tục là sidebar bên phải.

```text
+----------------------+---------------------------+------------------+
| Conversation         | Artifact document         | Comments         |
| Artifacts sidebar    |                           | sidebar          |
| (left)               |                           | (right)          |
+----------------------+---------------------------+------------------+
```

Sidebar không phải VS Code View hoặc một app/webview riêng.

### Accordion nhiều conversation

Sidebar phải render danh sách conversation bằng accordion:

```text
Conversation Artifacts

[-] Improve Artifact Viewer (3)
      UI analysis
    > Artifacts in conversations   [current]
      Implementation plan

[+] Script Runner research (4)

[-] Release preparation (2)
      Release checklist
      Verification report
```

Yêu cầu:

- Mỗi accordion header hiển thị `conversationName` và số artifact hợp lệ.
- Có thể mở nhiều accordion cùng lúc; đây không phải single-select accordion.
- Conversation active/current được mở mặc định khi có context rõ ràng.
- Artifact đang mở được highlight.
- Một artifact thuộc nhiều conversation được phép xuất hiện trong nhiều accordion.
- Không deduplicate artifact xuyên các conversation vì mỗi lần xuất hiện thể hiện một membership có ý nghĩa.
- Một aggregate entry **All registered artifacts** cho phép xem toàn bộ artifact hợp lệ đã được AI đăng ký.

### Mở artifact từ sidebar

Khi click một artifact:

1. Webview gửi typed message chứa identity đã được registry cung cấp, không gửi arbitrary filesystem path chưa validate.
2. Extension Host resolve và revalidate target.
3. Dùng `ArtifactReviewOpenCoordinator`/`vscode.openWith` hiện tại để reveal hoặc mở Artifact Review custom editor.
4. Sidebar vẫn là component của cùng Artifact Viewer app; artifact đích có thể được VS Code reveal trong tab hiện có hoặc tab editor phù hợp theo editor contract.

Phiên bản đầu tiên không thay thế document ở giữa bằng một virtual document khác bên trong cùng Webview instance.

### Loading và hiệu năng

- Artifact hiện tại phải render trước; conversation list được tải bất đồng bộ và không chặn open.
- Sidebar có loading/error/empty state riêng.
- Registry lookup theo conversation, không chạy global artifact discovery trên mỗi tab.
- Extension Host có thể cache artifact summaries đã validate và cập nhật bằng watcher; Webview không được truy cập filesystem trực tiếp.
- Việc thêm một UUID nhỏ vào các tool call sau không được xem là lý do để gửi lại toàn bộ dictionary.

### Responsive behavior

- Màn hình rộng: Conversation Artifacts và Comments có thể cùng mở nếu layout đủ chỗ.
- Màn hình hẹp: chỉ một sidebar overlay được mở tại một thời điểm.
- Focus trapping, keyboard navigation và ARIA semantics phải được xác định trong implementation plan.

## 7. Current-state constraints phải được giữ

- Existing exact-handle lifecycle vẫn là boundary cho wait, inspect, advance và reconnect.
- Conversation membership không thay thế `artifactDirectory` làm lifecycle handle.
- Artifact Viewer Webview không được đọc filesystem hoặc gọi process API trực tiếp.
- Existing title search có thể được tái sử dụng ở mức validation/summary nhưng không trở thành source of truth cho conversation membership.
- Một independent user request vẫn sở hữu một artifact ID/directory; conversation chỉ nhóm nhiều artifact, không gộp lifecycle.
- Comments/submission state vẫn thuộc từng artifact và từng review round.
- Không suy ra conversation từ title, repository, workspace hoặc VS Code window.

## 8. Failure behavior bắt buộc

- Unknown/malformed `artifactConversationId`: fail closed với structured error; không đoán hoặc tạo lại bằng ID do AI chọn.
- Duplicate registration: thành công idempotent, không tạo duplicate sidebar item trong cùng conversation.
- Missing artifact referenced by registry: skip item và cung cấp diagnostics phù hợp; không mở path không hợp lệ.
- Registry write failure: không được báo registration thành công. Implementation plan phải xác định transaction/rollback boundary giữa artifact creation, membership registration và connection open request.
- Partial/corrupt conversation entry: cô lập entry lỗi, không làm mất khả năng đọc các conversation hợp lệ khác.
- Multiple VS Code windows/MCP processes: không được dựa vào in-memory cache làm persistent source of truth.

## 9. Phạm vi không làm ở phiên bản đầu tiên

- Đồng bộ conversation với cloud hoặc giữa nhiều máy.
- Đọc chat history hoặc chat metadata nội bộ từ AI client.
- Một tool `create_conversation` riêng.
- Gửi full artifact dictionary từ AI ở mỗi create/reconnect.
- Biến Artifact Viewer thành task manager hoặc chat client.
- Suy luận semantic relationship giữa artifacts.
- Drag-and-drop để đổi membership, merge conversation hoặc conversation history/versioning.

## 10. Components dự kiến bị ảnh hưởng khi triển khai

### Shared contracts và filesystem safety

- Schema/version cho conversation registry và membership.
- Safe path derivation và validation cho conversation root.
- Typed Webview messages cho list/open/error/loading.

### MCP runtime và skill

- `create_artifact` sinh hoặc nhận `artifactConversationId`.
- Reconnect/inspect hỗ trợ đăng ký và phục hồi associations khi có intent rõ ràng.
- Lifecycle results echo conversation context.
- Skill giữ active `artifactConversationId` và exact artifact mappings.

### Extension Host

- `ConversationArtifactRegistry`.
- Provider query/list/watch và gửi summaries sang Webview.
- Open action đi qua existing validation/open coordinator.
- Retention integration cho stale memberships.

### Webview

- Nút mở Conversation Artifacts.
- Sidebar trái mới.
- Multi-open accordion conversations.
- Current-artifact highlight, loading/error/empty states và responsive coordination với Comments drawer.

### Tests và docs

- Contract, registry safety, multi-process/idempotency, many-to-many membership, recovery, retention và Webview message tests.
- Khi implementation được phê duyệt, cập nhật các canonical docs/contract/changelog bị ảnh hưởng theo repository instructions.

## 11. Acceptance criteria ở cấp thiết kế

Implementation plan chỉ được xem là bám đúng phân tích này khi:

1. Artifact đầu tiên tạo logical conversation mà không cần tool call riêng.
2. MCP sinh và trả `artifactConversationId`; AI client chat ID không được yêu cầu.
3. Artifact tiếp theo chỉ gửi lại ID nhỏ, không gửi dictionary.
4. Ba lớp bảo vệ ID đều có đường triển khai và test.
5. Registry hỗ trợ trực tiếp `artifactConversationId -> artifactIds`.
6. Một artifact có thể thuộc nhiều conversation.
7. Sidebar là multi-open accordion chứa nhiều conversation và current-artifact highlight.
8. Current artifact render không bị chặn bởi registry/sidebar loading.
9. Artifact opening tiếp tục đi qua fail-closed validation và existing custom editor coordinator.
10. Conversation registration không thay đổi review lifecycle hoặc retention timestamp.
