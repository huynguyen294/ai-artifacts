# Workspace naming và ownership model

## Trạng thái

- **Deferred:** lưu để triển khai sau.
- Tài liệu này ghi lại vấn đề naming và phạm vi kiến trúc cần sửa; chưa phải source of truth cho runtime hiện tại.
- Không thay đổi code, protocol, schema hoặc tài liệu chính thức chỉ dựa trên note này.

## Kết luận đã thống nhất

Dự án hiện đang dùng từ **workspace** cho cả container của VS Code và từng folder nằm trong container đó. Đây là naming không chính xác.

Mô hình đúng cần được diễn đạt là:

```text
Một VS Code workspace/window
├── workspace folder A
├── workspace folder B
└── workspace folder C
```

Product hỗ trợ **một workspace có nhiều folder**, còn gọi theo thuật ngữ VS Code là **multi-root workspace**. Không nên mô tả đây là “multi-workspace”.

Artifact hiện được lưu và bind vào một folder được chọn trong workspace, không bind vào toàn bộ workspace container. Vì vậy đối tượng mà resolver đang tìm thực chất là một **workspace folder**, không phải một workspace.

## Vocabulary chuẩn

| Khái niệm | Ý nghĩa | Tên nên dùng |
|---|---|---|
| VS Code workspace | Container/session hoặc cửa sổ VS Code đang mở; có thể chứa một hoặc nhiều folder | `workspace`, `workspace context` hoặc `workspace window` |
| Workspace folder | Một entry trong `vscode.workspace.workspaceFolders` | `workspaceFolder` |
| Root của folder đích | Đường dẫn tuyệt đối nơi artifact thuộc về và nơi đặt `.codex-artifacts` | `workspaceFolderRoot` hoặc `targetFolderRoot` |
| Candidate từ resolver | Một workspace folder có thể chứa artifact | `WorkspaceFolderCandidate` |
| Nhiều folder trong một workspace | Khả năng VS Code chính thức gọi là multi-root | `multi-root workspace` hoặc “workspace có nhiều folder” |
| Repository/project | Đơn vị source code; có thể trùng với workspace folder hoặc nằm sâu bên trong | `repositoryRoot` / `projectRoot`, không tự động đồng nhất với workspace folder |

## Những tên hiện tại đang gây nhầm lẫn

| Tên hiện tại | Thực tế đại diện cho | Hướng đổi tên đề xuất |
|---|---|---|
| `resolve_artifact_workspace` | Chọn một folder trong workspace để chứa artifact | `resolve_artifact_workspace_folder` hoặc `resolve_artifact_target_folder` |
| `WorkspaceCandidate` | Candidate của workspace folder | `WorkspaceFolderCandidate` |
| `WorkspaceCandidateResolution` | Kết quả resolve folder | `WorkspaceFolderCandidateResolution` |
| `workspaceRoot` | Root của folder đích | `workspaceFolderRoot` hoặc `targetFolderRoot` |
| `resolved-workspace` | Resolver grant cho một folder | `resolved-workspace-folder` |
| “multi-workspace” | Một workspace có nhiều folder | `multi-root workspace` |
| “workspace registry” | Registry gồm snapshot của VS Code window/workspace và các folder của từng snapshot | Có thể giữ tên, nhưng contract phải tách rõ `workspace snapshot` và `workspace folders` |

## Kiến trúc hiện tại

### Extension host

`src/extension/workspace-registry-publisher.ts` đọc `vscode.workspace.workspaceFolders` và publish một snapshot cho extension host/window hiện tại. Mỗi snapshot đã có cấu trúc `folders[]`, nên data model gốc thực tế đã gần đúng: một workspace/window có nhiều workspace folders.

### Shared registry

`src/shared/workspace-registry.ts` gom các entry trong `folders[]`, tạo `WorkspaceCandidate`, rồi match query với basename/path của từng folder. Đây là bằng chứng rõ nhất rằng resolver đang resolve folder.

### Artifact ownership

Manifest và MCP hiện dùng `location.workspaceRoot`/`workspaceRoot`. Giá trị này là root của folder được đăng ký và là parent của `.codex-artifacts`, không phải định danh của toàn bộ VS Code workspace.

### Cross-window fallback cần xem lại

Resolver hiện dùng:

```ts
const relevantSnapshots = focusedSnapshots.length > 0 ? focusedSnapshots : snapshots;
```

Khi có focused snapshot, candidate được giới hạn trong focused workspace/window. Nhưng khi không có snapshot nào focused, code gộp folder từ tất cả snapshot còn fresh. Trường hợp này có thể lấy candidate từ nhiều VS Code workspace/window khác nhau.

Nếu product invariant là **một workspace có nhiều folder**, fallback trên không chỉ là naming sai mà còn là hành vi lệch scope. Khi triển khai cần quyết định một trong hai hướng:

1. **Khuyến nghị:** nếu không xác định được đúng một workspace/window scope thì trả trạng thái ambiguous/not-focused và yêu cầu người dùng focus hoặc chọn workspace context; không gộp folder từ nhiều window.
2. Cho phép cross-window discovery nhưng phải gọi đúng là multi-workspace registry và thêm bước chọn workspace trước khi chọn folder. Hướng này phức tạp hơn và không phù hợp với product intent đã thống nhất.

## Repository nằm trong workspace folder

Việc đổi naming không tự động tạo khả năng resolve repository nằm sâu bên trong workspace folder.

Hiện registry chỉ biết các folder được VS Code mở trực tiếp. Nếu cấu trúc là:

```text
workspace folder
├── repo-a
└── repo-b
```

thì resolver hiện chỉ biết `workspace folder`, không biết `repo-a` và `repo-b` là target độc lập. Muốn artifact thuộc từng repository cần một feature riêng để discover/verify `repositoryRoot` hoặc yêu cầu người dùng mở/tag file trong repository. Không nên âm thầm dùng project-marker scan làm ownership evidence.

## Phạm vi triển khai sau này

### 1. Public MCP contract

- Quyết định có đổi tên tool `resolve_artifact_workspace` hay giữ alias tương thích.
- Đổi input/output descriptions từ workspace sang workspace folder.
- Đổi evidence `resolved-workspace` thành `resolved-workspace-folder` nếu chấp nhận breaking contract.
- Cân nhắc đổi `workspaceRoot` thành `workspaceFolderRoot`; nếu giữ để tương thích, phải ghi rõ đây là legacy protocol name.
- Cập nhật error names/messages như `WORKSPACE_NOT_REGISTERED` nếu cần, hoặc giữ error code cũ và chỉ sửa mô tả để giảm breaking surface.

### 2. Shared types và registry

- `WorkspaceCandidate` → `WorkspaceFolderCandidate`.
- `WorkspaceCandidateResolution` → `WorkspaceFolderCandidateResolution`.
- Các hàm `resolveWorkspace*` nên nói rõ chúng resolve registered workspace folder.
- Tách rõ snapshot/window identity khỏi danh sách folder.
- Bỏ hoặc thay cross-window fallback khi không có focused snapshot.

### 3. Extension host

- Giữ publisher dựa trên `vscode.workspace.workspaceFolders`.
- Đặt tên biến và docs theo `workspaceFolder`/`workspaceFolderRoot`.
- Xác định rõ một snapshot tương ứng với một VS Code window/workspace context.

### 4. Artifact schema và validation

- Đánh giá migration của `artifact.json.location.workspaceRoot`.
- Nếu đổi field, cần schema version mới hoặc compatibility reader; không sửa âm thầm schema v4 đang tồn tại.
- `assertArtifactDirectory`, containment và canonical-path validation phải tiếp tục bind artifact vào đúng selected folder root.

### 5. Skill và agent flow

- Skill phải nói “resolve target workspace folder”, không nói “resolve workspace”.
- Khi user gọi tên repo/folder, query được match với candidate workspace folders trong một workspace context.
- AI tự chọn folder duy nhất có độ tin cậy cao; nếu mơ hồ thì hỏi user.
- Không dùng cwd, folder order, filesystem search hoặc project markers để tự xác lập ownership.

### 6. Documentation và tests

- Đồng bộ `README.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`, skill contract và changelog.
- Sửa wording hiện tại từ “multi-workspace” sang “multi-root workspace” khi đó là mô tả trạng thái hiện hành; không nhất thiết viết lại changelog lịch sử nếu cần bảo toàn lịch sử phát hành.
- Đổi fixtures/test titles để phân biệt workspace window, workspace folder và repository.
- Bổ sung test cho một workspace có nhiều folders, nhiều window cùng publish snapshot, không có focused window và nested repository không được tự suy ra.

## Migration strategy đề xuất

1. Chốt vocabulary và target ownership: artifact thuộc workspace folder hay repository root.
2. Chốt strict single-workspace behavior khi không có focused snapshot.
3. Đổi internal type/function names trước, giữ adapter cho public protocol nếu cần.
4. Nếu đổi tool/evidence/schema field, phát hành protocol version mới và hỗ trợ lỗi migration rõ ràng.
5. Đồng bộ skill, MCP metadata, installer approvals, docs và tests trong cùng một thay đổi.
6. Rebuild integration, đóng gói lại VSIX, cài lại global integration, restart Codex và kiểm thử bằng chat mới.

## Các quyết định cần chốt trước khi triển khai

1. Public tool nên đổi thành `resolve_artifact_workspace_folder` hay dùng tên ngắn hơn `resolve_artifact_target_folder`?
2. Có đổi public field `workspaceRoot` sang `workspaceFolderRoot` hay chỉ đổi internal naming và giữ field cũ để tương thích?
3. Khi không có focused snapshot, resolver sẽ trả lỗi/ambiguous hay cho phép người dùng chọn workspace window trước?
4. Artifact chỉ thuộc top-level workspace folder hay cần hỗ trợ repository/project nằm sâu bên trong folder?
5. Đây sẽ là breaking protocol version mới hay migration tương thích theo giai đoạn?

## Recommendation hiện tại

- Dùng product phrase **“one VS Code workspace with multiple workspace folders”** hoặc **“multi-root workspace support”**.
- Xem workspace folder là target ownership hiện tại; nested repository là feature riêng.
- Đổi internal naming sang `workspaceFolder*`.
- Không gộp các window khi không xác định được focused workspace; fail closed và yêu cầu người dùng focus/chọn context.
- Giữ compatibility alias cho public MCP/tool fields nếu chi phí breaking migration cao; nếu project vẫn đang ở giai đoạn chưa release contract mới thì đổi dứt điểm trước release.
