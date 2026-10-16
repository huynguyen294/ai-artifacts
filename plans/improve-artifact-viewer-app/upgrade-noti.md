# Upgrade Notification — Phân tích và quyết định đã chốt

## Trạng thái tài liệu

- Đây là source of truth cho thông báo yêu cầu làm mới integration sau khi AI Artifacts được cài hoặc nâng cấp sang một version mới.
- Tính năng chưa được triển khai.
- Thông báo chỉ nhắc người dùng chạy lại installer; nó không tự sửa MCP configuration hoặc skill trong background.

## Mục tiêu

Sau khi VS Code cài một version AI Artifacts mới và version đó được activate lần đầu, extension hiển thị một thông báo chung rằng MCP configuration hoặc skill cần thiết có thể đã thay đổi. Người dùng được hướng dẫn chạy lại installer để đồng bộ integration với extension hiện tại.

Không kiểm tra hoặc so sánh nội dung MCP runtime, client config hay skill trước khi hiện thông báo. Trigger chỉ dựa trên version nên nhẹ, không ảnh hưởng tốc độ mở artifact.

## Nội dung thông báo

Thông báo đề xuất:

> AI Artifacts v{version} is ready. MCP configuration or required skills may have changed. Run the installer again, then restart your AI client.

Actions:

- **Run Installer**: gọi command hiện có `agentPlus.installAllIntegrations`.
- **Later**: đóng thông báo; người dùng vẫn có thể chạy **AI Artifacts: Install All Detected Integrations** từ Command Palette.

Dùng câu **is ready** thay vì khẳng định **was updated** để cùng một nội dung vẫn chính xác trong lần đầu tính năng ghi nhận version, khi extension chưa thể phân biệt chắc chắn cài mới với nâng cấp từ một bản cũ không lưu state.

## Thời điểm và điều kiện hiển thị

VS Code không cung cấp cho code của version mới một callback đáng tin cậy ngay tại thời điểm background download hoàn tất. Version mới chỉ có thể chạy sau khi Extension Host được restart/reload và extension được activate.

Luồng đã chốt:

```text
VS Code cài version mới
  -> Restart Extensions / reload / restart VS Code
  -> AI Artifacts version mới activate
  -> so sánh currentVersion với lastNotifiedVersion
  -> khác nhau: lưu currentVersion và hiện notification một lần
  -> giống nhau: không hiện lại
```

- `currentVersion` lấy từ metadata của extension, với `package.json` là source of truth.
- `lastNotifiedVersion` lưu trong `ExtensionContext.globalState`, dùng chung giữa các workspace.
- Nếu chưa có `lastNotifiedVersion`, vẫn hiện thông báo một lần. Điều này bao phủ cả lần đầu phát hành tính năng và lần cài mới, khi người dùng cũng cần chạy installer.
- Ghi nhận version trước khi hiện notification để hạn chế nhiều cửa sổ VS Code cùng hiển thị một thông báo.
- Dismiss hoặc chọn **Later** không làm notification lặp lại trong cùng version.
- Một version mới tiếp theo sẽ tạo một notification mới.

Activation event `onStartupFinished` hiện có đủ để chạy kiểm tra sau khi Extension Host khởi động lại; không cần thêm polling, watcher hay activation event mới.

## Hành vi của installer

- **Run Installer** tái sử dụng hoàn toàn flow `agentPlus.installAllIntegrations`; không tạo installer thứ hai.
- Installer tiếp tục thay thế managed MCP runtime/skill và cập nhật các client được phát hiện theo logic hiện tại.
- Kết quả thành công hoặc lỗi tiếp tục do command installer hiện có thông báo.
- Sau khi cài thành công, người dùng vẫn phải restart AI client và bắt đầu chat mới theo compatibility contract hiện tại.
- Notification không tự đánh giá integration nào thực sự thay đổi; theo contract hiện tại, mọi extension upgrade đều yêu cầu reinstall integrations.

## Failure behavior và giới hạn

- Lỗi đọc/ghi notification state không được làm extension activation hoặc Artifact Review thất bại; chỉ ghi diagnostics phù hợp.
- Lỗi khi chạy installer được xử lý bởi flow installer hiện có và không được đánh dấu là cài thành công giả.
- Tính năng không bảo đảm notification xuất hiện trước thao tác **Restart Extensions**, vì code của version mới chưa chạy ở thời điểm đó.
- Không scan filesystem, không gọi `checkAllIntegrations()` và không kiểm tra asset mismatch để quyết định có hiện notification hay không.
- Không tự động chạy installer vì thao tác này thay đổi MCP configuration và skill của người dùng.

## Components dự kiến bị ảnh hưởng khi triển khai

### Extension activation

- Đọc current extension version.
- So sánh và lưu `lastNotifiedVersion` trong `globalState`.
- Hiện notification bất đồng bộ sau khi các command cần thiết đã được đăng ký.

### Integration command

- Tái sử dụng `agentPlus.installAllIntegrations` khi người dùng chọn **Run Installer**.
- Không thay đổi contract hoặc logic cài đặt hiện tại.

### Tests

- Version chưa từng ghi nhận: hiện đúng một notification và lưu current version.
- Version thay đổi: hiện notification mới.
- Version không đổi: không hiện lại.
- **Run Installer** gọi đúng command hiện có.
- **Later** hoặc dismiss không gọi installer.
- Lỗi notification state không chặn activation.

## Acceptance criteria

1. Notification xuất hiện ở lần activation đầu tiên của mỗi version được ghi nhận.
2. Notification không xuất hiện lại trong cùng version, kể cả khi đổi workspace hoặc reload cửa sổ.
3. Nội dung nói chung về khả năng MCP configuration/skill đã thay đổi, không khẳng định một asset cụ thể đang outdated.
4. **Run Installer** dùng lại `agentPlus.installAllIntegrations`.
5. Không có filesystem scan hoặc integration verification trên đường activation chỉ để quyết định hiển thị notification.
6. Artifact Review và các command khác vẫn hoạt động nếu việc lưu notification state gặp lỗi.
