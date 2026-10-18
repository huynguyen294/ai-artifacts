- tham khảo luồng từ upgrade-noti.md, luồng sẽ sinh ra từ luồng này
- khi upgrade thì nếu chưa có global state thì auto install detected luôn, và message thông báo status, thêm 1 dòng in đậm. Nếu client của bạn chưa có vui lòng manual guide, có nút qua manual install guide. verifacation message thay đổi chung.
- tôi muốn đi theo hướng user mới thì nên auto install và README cũng đổi Get started thành Installation guide. Nó nằm ở đầu của docs, đầu tiên là sẽ automation install detected và thông báo, nếu không detect được thì dùng installation guide. Docs cũng nên có hướng dẫn reload window nếu không có gì được install.
- còn upgrade không phải version mới thì hiện thông báo như hiện tại.
- sẵn tiện upgrade installer và thêm installer cho cline

# ANALYZED

## Kết luận

- Khả thi về kỹ thuật, nhưng không auto-write config chỉ vì `globalState` chưa có: trạng thái đó không phân biệt được cài mới với upgrade từ bản cũ.
- Hướng khuyến nghị là **one-click automatic setup**: extension tự detect/preflight, nhưng chỉ cài sau khi user chọn **Set Up**.

## Flow đề xuất

```text
First activation
  -> detect + preflight read-only
  -> có client: "Detected: ..." [Set Up] [Installation Guide] [Later]
  -> Set Up: install detected clients -> verify -> báo Ready/warning
  -> không có client: chỉ hiện Installation Guide

Upgrade đã có state/version mới
  -> giữ notification nhắc reinstall như upgrade-noti.md
```

## Quy tắc cần chốt

- Detection chỉ là candidate, không chứng minh user muốn cấu hình client đó; không cài ngầm.
- Nếu có `Configuration conflict` hoặc install lỗi: không overwrite/đánh dấu thành công; nêu rõ client lỗi và dẫn tới manual guide.
- `setupBaseMcpServer` cũng ghi runtime và shared skill, nên chỉ gọi sau khi user chọn **Set Up**.
- Lưu onboarding state riêng sau khi user chọn Set Up/Later; không tái sử dụng `lastNotifiedVersion`.
- Sau install luôn verify; hướng dẫn reload window, restart AI client và mở chat mới. Nếu không detect client nào, README phải chỉ manual installation.

## Docs, tests và release

- Đổi mục README **Getting started** thành **Installation guide**, đưa automatic setup lên đầu và đồng bộ anchor/link của notification.
- Giữ wording compatibility: extension upgrade vẫn yêu cầu reinstall integrations, restart AI client và chat mới.
- Test: fresh onboarding, Later, no-client, conflict, partial failure, verify summary và upgrade không auto-install.
- Cần manual Extension Host test vì unit/source test không chứng minh config client đã được AI client nhận sau reload.
