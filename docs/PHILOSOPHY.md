# Triết lý Codex Artifacts

## Artifact là dữ liệu bền vững, waiter chỉ là kết nối

Nguyên tắc vòng đời cốt lõi là:

```text
artifact lifetime > waiter lifetime > chat-turn lifetime
```

Artifact đại diện cho một yêu cầu cần review và tồn tại trong workspace cho đến khi người dùng chủ động xử lý nó. Waiter chỉ là kết nối tạm thời giữa một MCP request và một review round. Chat turn còn ngắn hơn nữa.

Vì vậy, cancellation, takeover, kết thúc chat turn hoặc MCP restart không được xóa hay kết thúc artifact. Chúng chỉ làm mất waiter hoặc token đang nằm trong memory. AI có thể inspect đúng artifact đã biết, lấy token mới từ trạng thái đã validate và reconnect về sau.

## Hai cách đối thoại cùng một artifact

Luồng mặc định vẫn giữ trải nghiệm quen thuộc:

```mermaid
flowchart LR
    A[AI tạo artifact] --> B[AI attach waiter]
    B --> C[Người dùng review]
    C --> D{Decision}
    D -->|Review| E[AI cập nhật và mở round mới]
    E --> B
    D -->|Proceed| F[Thực hiện hành động đã duyệt]
    D -->|Just save| G[Lưu Markdown]
```

Luồng chat escape cho phép người dùng lưu comment rồi nhắn “hãy xem review” mà không cần bấm Review. Waiter cũ được hủy an toàn; AI inspect đúng artifact handle, đọc comment và:

- Trả lời câu hỏi trực tiếp trong chat.
- Sửa artifact nếu comment yêu cầu thay đổi.
- Vừa trả lời vừa sửa nếu feedback là hỗn hợp.
- Hỏi lại và chưa consume round nếu feedback chưa rõ.

Sau khi xử lý xong, AI mở round mới và tự chờ lại. Nếu chỉ có câu hỏi, round vẫn tăng nhưng bytes và SHA của `artifact.md` được giữ nguyên. Nếu không có comment hoặc submission đã lưu, AI attach lại waiter cho cùng round và không tăng round, trừ khi người dùng yêu cầu sửa trực tiếp qua chat (explicit chat update với `intent: "explicit-chat-update"`), khi đó AI cập nhật Markdown mới và mở round tiếp theo.

## Ý nghĩa của các quyết định

1. **Review:** gửi submission `revise`. AI xử lý batch comment bằng cùng policy với chat escape: trả lời câu hỏi trực tiếp trong chat, chỉ cập nhật `artifact.md` khi có yêu cầu sửa, reset trạng thái và bắt đầu round mới. Question-only giữ nguyên Markdown/SHA. Không giữ revision history hoặc chèn câu trả lời hội thoại vào artifact.
2. **Proceed:** kết thúc round hiện tại. Với `plan` và `implementation-plan`, đây là quyền thực thi toàn bộ plan đã duyệt ngay trong cùng turn; MCP trả runtime directive `execute-approved-plan`, và AI không được dừng ở bước xác nhận, mô tả việc sẽ làm hoặc hỏi lại quyền triển khai. Không tự mở round mới.
3. **Just save:** kết thúc round hiện tại, lưu Markdown theo yêu cầu và không thực hiện công việc được đề xuất. Không tự mở round mới.
4. **Copy Markdown:** chỉ sao chép nội dung, không gửi decision và không thay đổi lifecycle.

Proceed và Just save kết thúc round, không “kill” artifact. Người dùng có thể yêu cầu reconnect rõ ràng về sau. Reconnect chỉ mở round mới; nó không được thực thi lại hành động Proceed/Just save trước đó.

## Exact handle, không suy đoán artifact

AI phải dùng chính xác `artifactDirectory` được trả về khi tạo artifact hoặc được giữ từ waiter vừa bị ngắt trong cùng conversation. Không được chọn “artifact mới nhất”, quét workspace để đoán, hoặc suy luận từ cwd. Nếu context không còn một handle duy nhất, AI phải hỏi người dùng artifact path.

Quy tắc này quan trọng hơn sự tiện lợi: kết nối nhầm artifact có thể khiến comment, nội dung và quyền thực hiện hành động bị gắn sai cuộc đối thoại.

## Mục tiêu sản phẩm

Codex Artifacts là lớp review cho Markdown do AI tạo ra. Nó giúp người dùng đọc, comment và điều khiển vòng phản hồi mà không biến ứng dụng thành task manager hoặc một chat UI thứ hai. Câu trả lời hội thoại vẫn thuộc Codex chat; webview tập trung vào tài liệu và annotation.

Skill chỉ kích hoạt khi người dùng yêu cầu rõ ràng việc tạo/cập nhật artifact, đọc feedback đã lưu, hoặc reconnect lifecycle đã biết. Loại tài liệu tự nó không phải điều kiện auto-trigger.

## Trạng thái triển khai 0.9.0

Phiên bản 0.9.0 dùng MCP server 6.0.0 và giữ schema v4. Trước create chỉ còn hai nguồn bằng chứng: file do người dùng tag, hoặc candidate có token từ `resolve_artifact_workspace`. Workspace folder phải được resolve trước khi skill đọc project hoặc soạn artifact. Resolver chuẩn hóa separator trong tên và chỉ hoạt động trong một VS Code workspace context được xác định duy nhất. Nếu context chỉ có một folder, MCP trả folder đó là `matched`/`single-folder` dù query không khớp; trong multi-root workspace, query không khớp mới trả toàn bộ folder fresh của cùng context. Resolver không gộp folder từ nhiều cửa sổ; khi registry không xác định được một context duy nhất, nó fail với `WORKSPACE_CONTEXT_AMBIGUOUS` để người dùng focus đúng cửa sổ. Skill tự chọn khi có đúng một candidate có độ tin cậy cao dựa trên name/path/match và chỉ hỏi người dùng khi kết quả còn mơ hồ. MCP vẫn xác minh token, registry, root và containment trước mutation.

Skill luôn tạo `kind: "implementation-plan"`, kiểm tra bộ năm tool một lần khi bắt đầu lifecycle trong chat, và giữ mapping request/workspace → exact handle/round nếu có nhiều artifact. Sau create, resolver không còn tham gia. Reconnect, đọc feedback và explicit chat update đi qua decision table; intent hoặc handle chưa rõ thì hỏi, không takeover suy đoán.

Lifecycle errors có structured recovery metadata để agent giữ cùng exact handle, chọn đúng bước inspect/wait/advance và không replay mù khi chưa chắc transaction đã commit. Việc tối ưu payload sửa Markdown và state-generation protocol không thuộc phiên bản này; Case F/H giữ nguyên hành vi, còn Artifact Store, provider, webview và renderer không thay đổi.

Round token vẫn là capability in-memory, single-use và hết hạn sau một giờ, nhưng được bind vào toàn bộ trạng thái đã inspect: artifact, session, round, artifact hash, comments hash và submission presence/hash. Token chỉ bị consume sau commit thành công. Schema-v3 tiếp tục chỉ đọc.
