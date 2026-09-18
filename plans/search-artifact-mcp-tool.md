# IDEAS:

- hiện tại vẫn chưa có cơ chế search artifact nào cho AI nếu user yêu cầu tìm 1 artifact nào đó.
- Bắt buộc tạo thêm một MCP tool search artifact. Tên làm việc trong tài liệu này là `search_artifacts`.
- Query của tool là title artifact. AI tự trích xuất title từ yêu cầu của user; nếu yêu cầu không cung cấp đủ title thì AI hỏi lại user trước khi search.
- MCP tìm các artifact có title phù hợp trong global artifact collection và trả candidates cho AI.
- Kết quả có thể kèm nội dung Markdown có giới hạn để AI đối chiếu nội dung với yêu cầu của user, thay vì bắt user chọn chỉ dựa trên title/path.
- AI tự chọn khi có một candidate rõ ràng phù hợp. Nếu sau khi đọc metadata và Markdown vẫn mơ hồ thì AI giải thích ngắn gọn các candidates và hỏi user chọn.
- Sau khi chọn được candidate, AI đã có exact `artifactDirectory` và tiếp tục dùng lifecycle hiện tại qua `inspect_artifact_review`; khi user muốn mở artifact trong VS Code thì inspect với `intent: "reconnect"`.

# ANALYZED:

## 1. Bối cảnh hiện tại

- Artifact schema v5 được lưu tại `~/.ai-artifacts/artifacts/<artifact-id>/`.
- Lifecycle hiện tại yêu cầu AI giữ exact `artifactDirectory` do `create_artifact` trả về. Nếu mất handle, AI chưa có cơ chế chính thức để tự tìm lại artifact.
- `artifactDirectory` là absolute path tới thư mục lifecycle, không phải workspace root và không phải path trực tiếp tới `artifact.md`.
- Một artifact directory ổn định gồm:
  - `artifact.json`: source of truth cho identity, title, kind, timestamps, current review round, review session và `location.workspaceRoot`.
  - `artifact.md`: nội dung Markdown hiện tại.
  - `comments.json`: comments của current round và binding tới artifact hash.
  - `review-submission.json`: optional, chỉ có sau Review, Proceed hoặc Just save.
  - `artifact-connection.json`: optional UI-routing state gồm `windowInstanceId`, `connectionRevision`, `openRequestId`, `source` và `updatedAt`.
- Để mở lại một artifact đã biết, input tối thiểu của AI là exact `artifactDirectory` và `intent: "reconnect"` cho `inspect_artifact_review`. MCP tự đọc `workspaceRoot` từ `artifact.json`, resolve VS Code window, commit connection state và phát open request.

## 2. Quyết định sản phẩm đã chốt

- Thêm một public MCP tool search artifact; không dùng shell/filesystem access của AI làm product contract.
- Search chỉ được kích hoạt khi user chủ động yêu cầu tìm một artifact. Đây là ngoại lệ có chủ ý cho invariant hiện tại là AI không tự scan global artifact storage để đoán handle.
- Query search là title do AI lấy từ lời user hoặc hỏi lại user.
- MCP chịu trách nhiệm truy cập global artifact collection, validate dữ liệu và trả candidates. AI chịu trách nhiệm hiểu yêu cầu, đọc kết quả và quyết định candidate.
- MCP được phép trả thêm nội dung `artifact.md` của các candidates để AI có thể đối chiếu semantic content với yêu cầu của user.
- AI được tự chọn candidate khi có một lựa chọn duy nhất đủ rõ ràng từ title, metadata và nội dung. AI chỉ hỏi user khi các lựa chọn mạnh nhất vẫn mơ hồ.
- Candidate được chọn phải cung cấp exact `artifactDirectory`. Lifecycle sau search không thay đổi: AI dùng handle đó với `inspect_artifact_review` và MCP revalidate toàn bộ artifact trước khi đọc/reconnect.
- Search không tự mở editor, không reconnect, không takeover waiter, không tạo round token và không mutate lifecycle.

## 3. Phân chia trách nhiệm

### AI

- Nhận biết explicit search intent từ user.
- Trích xuất title query hoặc hỏi lại nếu không có title đủ dùng.
- Gọi MCP search tool thay vì tự scan `~/.ai-artifacts/artifacts/`.
- So sánh title, metadata và Markdown của candidates với toàn bộ yêu cầu của user.
- Tự chọn unique high-confidence candidate; không tự chọn chỉ vì candidate mới nhất.
- Nếu vẫn ambiguous, trình bày candidates bằng nhãn dễ hiểu và hỏi user.
- Sau khi chọn, dùng exact `artifactDirectory` cho inspect hoặc reconnect.

### MCP

- Chỉ duyệt các direct-child artifact directories trong canonical global collection.
- Validate path containment, artifact-directory/ID binding, schema v5 và linked-path safety trước khi trả candidate.
- Search/rank theo title và trả deterministic results.
- Chỉ đọc Markdown của tập candidates phù hợp và áp dụng giới hạn response.
- Không trả comments hoặc review submission trong search.
- Trả exact `artifactDirectory` để các lifecycle tools hiện tại tiếp tục làm security boundary cuối cùng.

## 4. Flow đã thống nhất

```text
User yêu cầu tìm artifact
  -> AI trích xuất title hoặc hỏi lại title
  -> search_artifacts({ query: title })
  -> MCP tìm và validate title candidates
  -> MCP trả metadata + Markdown có giới hạn
  -> AI đối chiếu với yêu cầu đầy đủ của user
  -> unique match: AI chọn candidate
  -> ambiguous: AI giải thích candidates và hỏi user
  -> AI lấy candidate.artifactDirectory
  -> inspect_artifact_review({ artifactDirectory }) để đọc current state
  -> hoặc inspect_artifact_review({ artifactDirectory, intent: "reconnect" }) để mở trong VS Code
```

`artifactDirectory` từ search là exact handle, nhưng không bỏ qua validation: `inspect_artifact_review` vẫn phải load và revalidate artifact context. Nếu artifact bị xóa hoặc thay đổi giữa search và inspect thì inspect phải fail closed.

## 5. Search input và matching direction

Input tối thiểu ở mức ý tưởng:

```ts
search_artifacts({
  query: string;
})
```

Matching direction đã phân tích:

1. `exact-title`: title giống query sau khi trim.
2. `normalized-title`: không phân biệt hoa/thường và normalize separator/khoảng trắng.
3. `partial-title`: title chứa query hoặc query chứa title.

Không dùng `updatedAt` hoặc created order như lý do duy nhất để tự chọn artifact. Fuzzy matching sâu hơn, pagination và exact normalization rules sẽ được chốt trong bước phân tích implementation.

## 6. Candidate data

Candidate cần đủ dữ liệu để AI phân biệt và tiếp tục lifecycle:

```ts
type ArtifactSearchCandidate = {
  artifactDirectory: string;
  artifactId: string;
  title: string;
  kind: string;
  workspaceRoot: string;
  createdAt: string;
  updatedAt: string;
  reviewRound: number;
  match: "exact-title" | "normalized-title" | "partial-title";
  markdown?: string;
  markdownPreview?: string;
  markdownSha256: string;
  markdownBytes: number;
  markdownTruncated: boolean;
};
```

Đây mới là candidate shape ở mức phân tích. Bước implementation sau sẽ quyết định chỉ dùng `markdown`, chỉ dùng `markdownPreview`, hay kết hợp theo response budget.

Result direction:

```ts
{
  status: "matched" | "candidates" | "not-found";
  query: string;
  candidates: ArtifactSearchCandidate[];
  hasMore?: boolean;
  nextCursor?: string;
}
```

Artifact selection token riêng hiện chưa thấy bắt buộc: search trả handle do MCP đã validate, còn downstream inspect revalidates exact handle. Quyết định cuối cùng sẽ được kiểm tra lại trong implementation analysis.

## 7. Markdown và response-size boundary

- Cho phép MCP đọc Markdown để AI phân biệt candidates là yêu cầu đã chốt.
- Không trả toàn bộ Markdown của mọi candidate một cách không giới hạn. Artifact hiện có thể lớn tới 2 MB; nhiều candidates có thể tạo response rất lớn, làm chậm file I/O, JSON serialization, stdio transport, client parsing và tiêu thụ context của AI.
- Runtime hiện trả tool value qua cả text `content` và `structuredContent`; nếu giữ cùng cách đóng gói, payload Markdown lớn có thể bị biểu diễn lặp lại ở protocol/client boundary.
- Direction đã phân tích:
  - giới hạn số candidates trong một response;
  - chỉ đọc Markdown cho title-matched shortlist;
  - áp dụng per-candidate và total Markdown byte budget;
  - báo `markdownBytes` và `markdownTruncated` rõ ràng;
  - hỗ trợ pagination/cursor hoặc yêu cầu refine query khi kết quả quá rộng;
  - dùng metadata + bounded Markdown trước, sau đó inspect riêng exact candidate để lấy current full state.
- Các con số như tối đa 5 candidates, 16–32 KB preview mỗi candidate và khoảng 128 KB tổng Markdown mới là recommendation sơ bộ, chưa phải contract đã chốt. Chúng phải được kiểm tra trong implementation analysis.

## 8. Safety và privacy boundary

- Không dựa vào việc một AI client cụ thể có shell access hoặc quyền đọc user home. Codex, Cursor, Claude, Windsurf và các client khác có sandbox/capability khác nhau.
- AI không trực tiếp parse filesystem lifecycle files. MCP giữ chung một validation path cho mọi client.
- Search chỉ đọc artifact metadata và bounded Markdown cần cho explicit user request; không đọc comments/submissions vì không cần cho candidate selection và có thể chứa dữ liệu nhạy cảm hơn.
- Malformed manifest, unsupported schema, symlink/junction, partial transaction và unreadable artifact cần fail closed hoặc được bỏ qua theo rule có diagnostics; policy chi tiết sẽ được chốt ở implementation analysis.
- Search result không phải authorization để mutate artifact. Mọi inspect/reconnect/advance tiếp theo vẫn dùng lifecycle validation hiện tại.

## 9. Ảnh hưởng sơ bộ theo component

- **MCP runtime:** thêm public tool, collection scanning, title matching/ranking, candidate serialization và bounded Markdown loading.
- **Shared safety/contracts:** có thể cần reusable read-only collection enumeration và candidate/result schemas nhưng phải tái sử dụng path/schema validation hiện tại.
- **Skill và artifact contract:** thêm explicit search intent, title extraction, candidate selection policy và chuyển tiếp exact handle sang inspect/reconnect.
- **Installer/client integration:** public tool catalog hiện đang cố định đúng năm tools; thêm search sẽ thành tool thứ sáu và cần đồng bộ installed runtime/skill/tool allowlists.
- **Tests:** tool catalog, matching, deterministic ordering, duplicate titles, ambiguity, corrupt/legacy/linked artifacts, Unicode/case/separator normalization, pagination/limits, Markdown truncation và search-to-inspect flow.
- **Docs/versioning:** đây là thay đổi architecture/public MCP surface, nên khi triển khai phải cập nhật các docs/contract/changelog liên quan và quyết định MCP/version cutover.

## 10. Đánh giá độ khó sơ bộ

- Thuật toán title search tự thân không khó.
- Độ khó tổng thể ở mức trung bình-khá, khoảng 6/10, vì thay đổi public tool catalog và invariant exact-handle/no-scan hiện tại.
- Phần cần thiết kế kỹ nhất là response-size boundary, validation khi enumerate collection, skill behavior khi ambiguous và atomic compatibility cutover; không phải thao tác đọc directory đơn thuần.

## 11. Các điểm dành cho bước implementation analysis sau

- Tên public tool cuối cùng và MCP/server version mới.
- Input schema đầy đủ, query validation và minimum title length.
- Normalization/matching/ranking algorithm chính xác.
- Maximum candidates, pagination/cursor và stable ordering.
- Full Markdown so với preview, byte budgets và tránh duplicate transport payload.
- Behavior với malformed, locked, partially written, legacy-schema và linked artifacts.
- Candidate/result schemas nên đặt ở MCP-local hay `src/shared`.
- Search có cần selection grant/token hay exact validated handle là đủ.
- Skill trigger, tool-availability contract và backward compatibility/cutover strategy.
- Test matrix, release units, validation gates và rollback boundary.

# IMPLEMENTATION PLAN:

Chưa phân tích hoặc lập implementation plan ở bước này. Phần này sẽ được thực hiện riêng sau khi Chú yêu cầu.
