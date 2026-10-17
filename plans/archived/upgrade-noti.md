# Upgrade Notification — Phân tích và quyết định đã chốt

- Follow-up ngoài scope hiện tại: action all-detected vẫn phụ thuộc vào client detection. Một UI chọn client rõ ràng hơn có thể cần sau này; không dùng Command Palette với query điền sẵn vì đó không phải public API ổn định và không cho extension nhận selection để tự verify.

## Trạng thái tài liệu

- Đây là source of truth cho thông báo yêu cầu làm mới integration sau khi AI Artifacts được cài hoặc nâng cấp sang một version mới.
- Tính năng đã được triển khai trong `src/extension/upgrade-notification.ts` và được nối vào `src/extension/extension.ts`.
- Thông báo chỉ nhắc người dùng chạy lại installer; nó không tự sửa MCP configuration hoặc skill trong background.

## Mục tiêu

Sau khi VS Code cài một version AI Artifacts mới và version đó được activate lần đầu, extension hiển thị một thông báo chung rằng MCP configuration hoặc skill cần thiết có thể đã thay đổi. Người dùng được hướng dẫn chạy lại installer để đồng bộ integration với extension hiện tại.

Không kiểm tra hoặc so sánh nội dung MCP runtime, client config hay skill trước khi hiện thông báo. Trigger chỉ dựa trên version nên nhẹ, không ảnh hưởng tốc độ mở artifact.

## Nội dung thông báo

Thông báo đã chốt:

> AI Artifacts v{version} is ready. The MCP integration and agent skill may have changed. Follow the installation guide and run the installer to sync them with this version and get the latest features and improvements. Restart your AI client afterward.

Actions:

- **Run Installer**: chạy flow `agentPlus.installAllIntegrations` cho các client được phát hiện, sau đó tự động gọi `checkAllIntegrations()` và hiện kết quả verify.
- **View Installation Guide**: mở README của repository tại mục **Getting started**.
- **Later**: đóng thông báo và không nhắc lại trong cùng version; người dùng vẫn có thể chạy **AI Artifacts: Install All Detected Integrations** từ Command Palette.

Dùng câu **is ready** thay vì khẳng định **was updated** để cùng một nội dung vẫn chính xác trong lần đầu tính năng ghi nhận version, khi extension chưa thể phân biệt chắc chắn cài mới với nâng cấp từ một bản cũ không lưu state. Cụm **may have changed** không khẳng định một component cụ thể chắc chắn đã thay đổi. Cụm **follow the installation guide** hướng người dùng về quy trình cài đặt đầy đủ, còn phần cuối giải thích rõ mục đích đồng bộ và lợi ích nhận được từ tính năng, cải tiến mới.

## Thời điểm và điều kiện hiển thị

VS Code không cung cấp cho code của version mới một callback đáng tin cậy ngay tại thời điểm background download hoàn tất. Version mới chỉ có thể chạy sau khi Extension Host được restart/reload và extension được activate.

Luồng đã chốt:

```text
VS Code cài version mới
  -> Restart Extensions / reload / restart VS Code
  -> AI Artifacts version mới activate
  -> so sánh currentVersion với lastNotifiedVersion
  -> lastNotifiedVersion chưa có hoặc khác currentVersion:
       lưu currentVersion và hiện notification một lần
  -> lastNotifiedVersion bằng currentVersion: không hiện lại
```

- `currentVersion` lấy từ metadata của extension, với `package.json` là source of truth.
- `lastNotifiedVersion` lưu trong `ExtensionContext.globalState`, dùng chung giữa các workspace.
- Nếu chưa có `lastNotifiedVersion` nhưng có `currentVersion`, xử lý giống nhánh version đã thay đổi: lưu version hiện tại và hiện thông báo một lần. Đây là trạng thái **chưa từng ghi nhận**, không phải bằng chứng chắc chắn rằng extension vừa được upgrade; nó bao phủ cả lần đầu phát hành tính năng, nâng cấp từ bản cũ chưa lưu state và lần cài mới, khi người dùng đều cần chạy installer.
- Ghi nhận version trước khi hiện notification. Không bổ sung lock hoặc cơ chế đồng bộ riêng giữa nhiều VS Code window; trường hợp nhiều window activate đồng thời nằm ngoài phạm vi tính năng này.
- Dismiss hoặc chọn **Later** không làm notification lặp lại trong cùng version.
- Một version mới tiếp theo sẽ tạo một notification mới.

Activation event `onStartupFinished` hiện có đủ để chạy kiểm tra sau khi Extension Host khởi động lại; không cần thêm polling, watcher hay activation event mới.

## Hành vi của installer

- **Run Installer** tái sử dụng hoàn toàn flow `agentPlus.installAllIntegrations`; không tạo installer thứ hai.
- Installer tiếp tục thay thế managed MCP runtime/skill và cập nhật các client được phát hiện theo logic hiện tại.
- Sau khi installer hoàn tất không lỗi, extension tự gọi `checkAllIntegrations()` và hiện một notification tổng hợp, gồm trạng thái agent skill, MCP runtime và từng client được phát hiện.
- Khi mọi phần liên quan đều `Ready`, notification xác nhận install đã được verify và nhắc restart AI client, bắt đầu chat mới. Khi có `Missing`, `Outdated` hoặc `Configuration conflict`, notification warning nêu rõ phần có vấn đề và hướng người dùng tới installation guide hoặc command cài theo client.
- Nếu không phát hiện client hỗ trợ nào, notification xác nhận base setup/skill đã verify và nói rõ người dùng có thể chạy command cài theo client khi cần.
- Sau khi cài thành công, người dùng vẫn phải restart AI client và bắt đầu chat mới theo compatibility contract hiện tại.
- Notification không tự đánh giá integration nào thực sự thay đổi; theo contract hiện tại, mọi extension upgrade đều yêu cầu reinstall integrations.

## Failure behavior và giới hạn

- Lỗi đọc notification state chỉ ghi diagnostic và bỏ qua notification trong activation đó.
- Nếu ghi `lastNotifiedVersion` thất bại, chỉ ghi diagnostic và không hiện notification, tránh lặp lại thông báo ở mỗi lần activation. Artifact Review, watcher và các command khác vẫn tiếp tục hoạt động.
- Lỗi khi hiển thị notification hoặc thực hiện action chỉ ghi diagnostic và không được làm extension activation thất bại.
- Lỗi khi chạy installer hoặc verify được báo bằng error notification; không được đánh dấu là cài thành công giả.
- Tính năng không bảo đảm notification xuất hiện trước thao tác **Restart Extensions**, vì code của version mới chưa chạy ở thời điểm đó.
- Không scan filesystem, không gọi `checkAllIntegrations()` và không kiểm tra asset mismatch để quyết định có hiện notification hay không.
- Không tự động chạy installer vì thao tác này thay đổi MCP configuration và skill của người dùng.

## Components đã triển khai

### Extension activation

- Đọc current extension version.
- So sánh và lưu `lastNotifiedVersion` trong `globalState` với key `upgradeNotification.lastNotifiedVersion`.
- Hiện notification bất đồng bộ sau khi các command cần thiết đã được đăng ký.
- Mở installation guide tại `https://github.com/huynguyen294/ai-artifacts#getting-started` khi người dùng chọn action tương ứng.

### Integration command

- Tái sử dụng `agentPlus.installAllIntegrations` khi người dùng chọn **Run Installer**.
- Chạy `checkAllIntegrations()` ngay sau cài đặt thành công và dùng cùng summary cho command **AI Artifacts: Verify All Integrations**.
- Không thay đổi contract hoặc logic cài đặt hiện tại.

### Tests

- `lastNotifiedVersion` chưa tồn tại nhưng `currentVersion` hợp lệ: hiện đúng một notification và lưu current version.
- Version thay đổi: hiện notification mới.
- Version không đổi: không hiện lại.
- **Run Installer** chạy installer rồi verify tự động.
- Summary thể hiện đầy đủ trạng thái Ready, Missing, Outdated hoặc Configuration conflict của client được phát hiện.
- **View Installation Guide** mở đúng mục **Getting started** trong README.
- **Later** hoặc dismiss không gọi installer và không nhắc lại trong cùng version.
- Lỗi ghi notification state được log, không hiện notification và không chặn activation.
- Lỗi hiển thị notification hoặc action được giữ trong phạm vi feature và không reject activation work.

## Acceptance criteria

1. Notification xuất hiện ở lần activation đầu tiên của mỗi version được ghi nhận.
2. Notification không xuất hiện lại trong cùng version, kể cả khi đổi workspace hoặc reload cửa sổ.
3. Nội dung nói chung về khả năng MCP configuration/skill đã thay đổi, không khẳng định một asset cụ thể đang outdated.
4. **Run Installer** dùng lại `agentPlus.installAllIntegrations`, sau đó tự động gọi `checkAllIntegrations()`.
5. **View Installation Guide** mở README tại mục **Getting started**.
6. **Later** hoặc dismiss không tạo lời nhắc lại trong cùng version.
7. Không có filesystem scan hoặc integration verification trên đường activation chỉ để quyết định hiển thị notification.
8. Nếu việc lưu notification state gặp lỗi, notification không xuất hiện nhưng Artifact Review và các command khác vẫn hoạt động.
9. Không yêu cầu xử lý cạnh tranh giữa nhiều VS Code window cùng activate.
