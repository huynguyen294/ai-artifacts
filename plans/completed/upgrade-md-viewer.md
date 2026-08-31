# Kế hoạch cơ bản: Markdown renderer cho Agent Plus

## Mục tiêu

Nâng cấp phần hiển thị tài liệu Markdown để nội dung dễ đọc, code có giao diện gần IDE và các khối Mermaid được hiển thị thành sơ đồ. Giữ kiến trúc đủ đơn giản để có thể mở rộng thêm về sau.

## Phạm vi ban đầu

- Tiếp tục dùng `react-markdown` làm renderer và `remark-gfm` cho GitHub Flavored Markdown.
- Tạo component `MarkdownRenderer` dùng chung thay vì cấu hình trực tiếp tại từng màn hình.
- Tùy biến giao diện cho heading, đoạn văn, danh sách, link, blockquote, bảng, inline code và code block.
- Bổ sung syntax highlighting cho code, ưu tiên Shiki để có theme gần editor.
- Bổ sung Mermaid cho các fenced code block có ngôn ngữ `mermaid`.
- Hỗ trợ light mode và dark mode nhất quán với giao diện Agent Plus.

## Ngoài phạm vi ban đầu

- Không thực thi JavaScript nằm trong Markdown.
- Không hỗ trợ MDX hoặc component React tùy ý trong tài liệu.
- Chưa triển khai trình soạn thảo WYSIWYG.
- Chưa bật raw HTML từ Markdown.
- Chưa cần hỗ trợ công thức toán học nếu chưa có yêu cầu thực tế.

## Thiết kế đề xuất

Luồng render dự kiến:

```text
Markdown source
  -> react-markdown + remark-gfm
  -> custom React components
     -> normal code: Shiki code block
     -> language-mermaid: Mermaid diagram
     -> other elements: Agent Plus theme
  -> sanitized UI output
```

`MarkdownRenderer` nhận nội dung Markdown và các tùy chọn hiển thị. Code block thường được chuyển cho component tô màu cú pháp; khối Mermaid được lazy-load và render riêng để không làm nặng bundle khởi tạo.

## Các bước triển khai

### 1. Chuẩn hóa renderer

- Tách cấu hình hiện có trong `src/features/document/app.jsx` thành component dùng chung.
- Giữ `react-markdown` và `remark-gfm` làm nền tảng.
- Xác định style tokens cho typography, màu chữ, border, background và spacing.

### 2. Hoàn thiện code block

- Tích hợp Shiki hoặc giải pháp highlighting tương đương sau khi kiểm tra ảnh hưởng đến bundle.
- Thêm header hiển thị ngôn ngữ và nút copy.
- Hỗ trợ cuộn ngang, wrap tùy chọn và màu sắc tương thích dark mode.
- Chỉ hiển thị JavaScript; không tự động thực thi.

### 3. Hỗ trợ Mermaid

- Cài package `mermaid` và chỉ tải khi tài liệu có khối Mermaid.
- Nhận diện class `language-mermaid` từ fenced code block.
- Render SVG với theme tương ứng light/dark.
- Dùng cấu hình an toàn cho nội dung do AI hoặc người dùng tạo.
- Khi Mermaid sai cú pháp, hiển thị thông báo lỗi gọn và cho phép xem source thay vì làm hỏng toàn bộ tài liệu.

### 4. Làm đẹp các thành phần Markdown

- Tùy biến bảng với container cuộn ngang và header rõ ràng.
- Tạo phong cách riêng cho blockquote/callout.
- Thêm anchor cho heading nếu tài liệu cần liên kết nội bộ.
- Chuẩn hóa link ngoài, ảnh, danh sách và task list.

### 5. Kiểm thử và tối ưu

- Tạo fixture Markdown bao gồm GFM, code JavaScript, Mermaid hợp lệ và Mermaid lỗi.
- Kiểm tra light/dark mode, màn hình hẹp và tài liệu dài.
- Kiểm tra nội dung HTML/script không được thực thi.
- Đo bundle size và thời gian render; lazy-load Mermaid và highlighter nếu cần.

## Quyết định an toàn

- Không sử dụng `eval` hoặc chạy code từ fenced code block.
- Không bật raw HTML mặc định.
- Mermaid dùng chế độ bảo mật phù hợp với nội dung không tin cậy.
- Nếu sau này cần nút Run cho JavaScript, xây thành tính năng độc lập và chạy trong sandbox iframe hoặc Web Worker có giới hạn.

## Tiêu chí hoàn thành

- Markdown CommonMark/GFM hiện tại vẫn hiển thị đúng.
- Code JavaScript có syntax highlighting, tên ngôn ngữ và thao tác copy.
- Khối `mermaid` hợp lệ hiển thị thành sơ đồ ở cả light và dark mode.
- Khối Mermaid lỗi có fallback dễ hiểu.
- Markdown không thể tự chạy JavaScript hoặc chèn script vào ứng dụng.
- Renderer có thể được tái sử dụng ở các màn hình khác của Agent Plus.

## Thứ tự ưu tiên

Ưu tiên đầu tiên là component dùng chung và theme cơ bản. Tiếp theo là code highlighting, sau đó Mermaid. Các tính năng nâng cao như callout phong phú, mục lục, math và chế độ chạy code chỉ bổ sung khi có nhu cầu rõ ràng.
