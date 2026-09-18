# PRODUCT DECISIONS

- Artifact là tài liệu tạm phục vụ vòng review, tương tự ngữ cảnh chat, không phải dữ liệu lâu dài mà sản phẩm cam kết giữ vô thời hạn.
- Nếu muốn giữ nội dung lâu dài, người dùng phải chủ động dùng **Just save**, **Copy Markdown**, hoặc lưu nội dung vào repository/vị trí khác.
- Philosophy và các contract hiện tại phải bỏ giả định artifact luôn tồn tại cho đến khi người dùng tự xóa. Reconnect chỉ còn được bảo đảm trong thời gian artifact chưa hết hạn.
- Có setting cấu hình số ngày giữ artifact; mặc định là **30 ngày**.
- Setting chưa hỗ trợ giá trị `0` để tắt cleanup. Giá trị retention phải lớn hơn `0`.
- Cleanup áp dụng cho artifact ở mọi trạng thái. Trạng thái pending, revise, approve hay save không tham gia quyết định giữ/xóa.
- Eligibility chỉ dựa trên `artifact.json.updatedAt`: artifact bị xóa khi `updatedAt` đã cũ hơn thời hạn retention được cấu hình.
- Giữ nguyên ý nghĩa của `updatedAt` là thời điểm nội dung artifact được cập nhật:
  - Khi tạo artifact, `updatedAt` bằng thời điểm tạo.
  - Chỉ đổi `updatedAt` khi Markdown thực sự thay đổi.
  - Inspect, mở/reload editor, reconnect, wait, comment, submit decision hoặc advance mà giữ nguyên Markdown không làm đổi `updatedAt`.
- Artifact cũ cũng dùng trực tiếp `updatedAt` hiện có. Nếu đã quá hạn tại thời điểm cleanup thì xóa, không có grace period khi nâng cấp.
- Cleanup chỉ chạy một lần khi extension activate lúc người dùng mở VS Code; chưa có background timer chạy lại mỗi 24 giờ.
- Nhiều VS Code window phải dùng một global cleanup lock để chỉ một window thực hiện cleanup.
- Artifact hết hạn bị xóa vĩnh viễn, không có trash/recovery layer.
- Không thêm policy phân loại theo schema, lifecycle state hoặc loại tương tác khác; retention chỉ quan tâm `updatedAt`.

# ANALYZED

## Thay đổi philosophy và contract

Philosophy hiện tại coi artifact là persistent user data với invariant `artifact lifetime > waiter lifetime > chat-turn lifetime`, giữ artifact cho đến khi người dùng chủ động xóa và cho phép reconnect về sau. Quyết định mới chủ động thay thế phần "persistent/unbounded lifetime" này bằng retention hữu hạn.

Các contract liên quan sẽ phải diễn đạt lại rằng:

- artifact là dữ liệu review tạm thời;
- exact handle chỉ hợp lệ khi artifact chưa bị cleanup;
- reconnect có thể thất bại bình thường vì artifact đã hết hạn;
- uninstall retention và automatic retention là hai hành vi khác nhau;
- người dùng chịu trách nhiệm lưu bản lâu dài ra ngoài lifecycle artifact.

## `updatedAt` hiện tại chưa hoàn toàn đúng với semantics đã chốt

Schema v5 đã có `createdAt` và `updatedAt`, nên không cần thêm một timestamp chỉ để xác định retention.

Tuy nhiên implementation hiện tại cập nhật `updatedAt` trong mọi lần `commitReviewRound()`. `advance_and_wait_for_artifact` luôn gọi hàm này bằng Markdown mới hoặc Markdown hiện tại, nên question-only advance và advance không thay Markdown vẫn làm đổi `updatedAt`.

Semantics mục tiêu phải là:

```text
markdown SHA thay đổi  -> cập nhật updatedAt
markdown SHA không đổi -> giữ nguyên updatedAt
```

Đây là chênh lệch cần xử lý khi phân tích implementation. Không mở rộng `updatedAt` thành last-access hoặc last-interaction timestamp.

## Eligibility cleanup

Quy tắc nghiệp vụ đã chốt có thể biểu diễn đơn giản:

```text
expiresAt = updatedAt + retentionDays
eligible  = now >= expiresAt
```

- Không cần xét review decision, review round, comment, submission, reconnect hoặc lần mở editor gần nhất.
- Không có pin/keep-forever state trong scope hiện tại.
- Không có grace period cho artifact được tạo trước phiên bản có cleanup.
- Cleanup run kế tiếp sau khi setting thay đổi sẽ dùng trực tiếp retention mới cho toàn bộ collection.

## Ảnh hưởng của số lượng artifact

Source hiện tại tạo và cập nhật artifact bằng exact path:

- Create tạo trực tiếp một child directory có ID ngẫu nhiên và ghi các lifecycle files; không enumerate toàn bộ artifact collection.
- Load/update dùng exact `artifactDirectory` và transaction trong chính directory đó; không scan các artifact khác.

Benchmark filesystem cô lập trên Windows cho thấy số direct-child directories chưa ảnh hưởng đáng kể đến exact-path create/update ở mức đã đo:

| Số artifact directories | Create p95 | Update p95 | Enumerate root p95 |
| ---: | ---: | ---: | ---: |
| 0 | 5,72 ms | 6,66 ms | 0,03 ms |
| 1.000 | 3,33 ms | 6,21 ms | 0,59 ms |
| 10.000 | 5,36 ms | 8,44 ms | 9,09 ms |
| 25.000 | 3,51 ms | 4,72 ms | 11,81 ms |
| 50.000 | 5,32 ms | 8,32 ms | 26,49 ms |

Đây là microbenchmark đo ảnh hưởng của directory cardinality, không phải E2E MCP/VS Code benchmark. Kết quả hiện tại cho thấy:

- cleanup không cần thiết chỉ để bảo vệ latency create/update ở quy mô thông thường;
- enumerate toàn collection tăng theo số artifact;
- extension dùng một global watcher, không tạo một watcher cho mỗi artifact;
- watcher dùng pattern đi xuống child directory nên vẫn cần E2E benchmark trong extension host nếu muốn công bố giới hạn hỗ trợ lớn;
- động lực chính của retention 30 ngày là philosophy dữ liệu tạm, kiểm soát dung lượng và tránh collection tăng không giới hạn, không phải một bottleneck create/update đã được chứng minh.

## Components chắc chắn bị ảnh hưởng ở bước implementation

- **Product/docs:** philosophy, architecture, README, changelog và hướng dẫn retention.
- **Shared contract:** semantics của `artifact.json.updatedAt` và setting retention.
- **MCP lifecycle:** chỉ cập nhật `updatedAt` khi Markdown SHA thay đổi.
- **Extension host:** setting, cleanup-on-activation, enumerate eligibility, permanent deletion và global cleanup lock giữa nhiều window.
- **Skill/agent contract:** exact-handle recovery và reconnect phải chấp nhận artifact có thể đã hết hạn.
- **Tests:** timestamp semantics, retention boundary, mọi lifecycle state, setting validation, artifact cũ, permanent deletion và multi-window cleanup lock.

# IMPLEMENTATION PLAN

Chưa phân tích. Sẽ lập implementation plan riêng sau khi hoàn tất phân tích theo các quyết định trên.
