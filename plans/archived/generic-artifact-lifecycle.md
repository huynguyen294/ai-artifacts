# Markdown Viewer and Contextual Review UX Upgrade

## Mục tiêu

Nâng Codex Artifacts từ renderer Markdown tự viết thành viewer CommonMark/GFM chuẩn, đồng thời chuyển trải nghiệm comment sang mô hình contextual popover kết hợp comments drawer có thể ẩn.

Thay đổi phải giữ nguyên lifecycle hiện tại: một request sở hữu một artifact, Review cập nhật trực tiếp cùng `artifact.md`, comment chỉ thuộc round hiện tại và không tạo revision history.

Đây là thay đổi kiến trúc đủ lớn để phát hành dưới phiên bản `0.5.0`, không gộp vào patch `0.4.x`.

## Quyết định thiết kế

- Dùng `react-markdown` và `remark-gfm` làm renderer nền tảng.
- Dùng một remark AST cùng source positions làm nguồn chung cho block identity, visible text và DOM rendering.
- Không bật raw HTML, MDX hoặc JavaScript thực thi từ Markdown.
- Dùng `@floating-ui/react` cho popover thay vì tự viết thuật toán positioning.
- Dùng popover cho comment tại selection; giữ comments drawer do dự án tự xây dựng để duyệt và điều hướng toàn bộ comment.
- Chọn giao diện “Antigravity-inspired, VS Code-native”: document-first, ít chrome, comment theo ngữ cảnh, nhưng màu và contrast lấy từ theme hiện tại của VS Code.
- Dùng Shiki cho syntax highlighting và Mermaid cho diagram, lazy-load để kiểm soát bundle khởi tạo.
- Giữ `comments.json`, submission contract, review-round transaction và same-turn behavior hiện tại.

## Vì sao AST và source positions là nền tảng chung?

AST là cây cấu trúc sinh ra khi parser đọc Markdown. Ví dụ đoạn:

```markdown
Kế hoạch **quan trọng** có [tài liệu](https://example.com).
```

được hiểu thành paragraph chứa text, strong text và link. Source position ghi chính xác node bắt đầu/kết thúc ở đâu trong `artifact.md`; visible text tương ứng là “Kế hoạch quan trọng có tài liệu.”, không chứa ký hiệu `**` hoặc URL của link.

Hiện tại parser regex tạo block metadata trong extension host, còn renderer tự tạo DOM theo logic khác. Hai cách hiểu Markdown có thể lệch nhau khi gặp nested list, inline formatting, table hoặc code fence. Khi đó block ID, text người dùng nhìn thấy và offset của selection không còn cùng hệ quy chiếu, khiến comment highlight sai vị trí.

Thiết kế mới parse Markdown bằng cùng họ remark AST ở cả model và renderer:

1. Extension host duyệt AST để tạo atomic review blocks, source range, visible text và deterministic block ID.
2. Webview nhận Markdown cùng block metadata.
3. `react-markdown` cung cấp `node.position` cho custom components; vị trí này được đối chiếu với block metadata để gắn `data-block-id` đúng vào DOM.
4. Selection offset được tính trên visible text; source range chỉ dùng để nhận diện cấu trúc và đối chiếu node.

Nhờ đó parser, DOM và comment anchoring dựa trên cùng một cấu trúc thay vì ba quy tắc riêng. Parity tests sẽ xác nhận `visibleText === rendered textContent` cho mọi selectable block.

## Phạm vi UX

### Action bar

Nút Review luôn hiển thị số comment đã lưu dưới dạng `Review (N)`.

- Chưa có comment: Proceed là primary, `Review (0)` disabled.
- Có ít nhất một comment đã lưu và không có blocker: `Review (N)` là primary; Proceed chuyển thành secondary nhưng vẫn dùng được.
- Có draft chưa lưu, hoặc round đang submit/đã submit: lifecycle actions giữ đúng trạng thái disabled hiện tại.
- Khi submit, chỉ action vừa bấm hiển thị `Sending…` thông qua state `submittingDecision`.

Comment count riêng trên topbar được thay bằng nút/badge `Comments (N)` để mở drawer, tránh lặp thông tin mà vẫn cho thấy nơi quản lý comment.

### Comment popover và drawer

Sau khi người dùng chọn text hợp lệ trong một atomic Markdown block, comment composer mở cạnh selection.

Phần popover dùng thư viện chuẩn `@floating-ui/react`, cụ thể:

- Range selection được bọc thành virtual element từ `Range.getBoundingClientRect()` và `Range.getClientRects()`.
- `useFloating`, `autoUpdate`, `inline`, `offset`, `flip` và `shift` xử lý vị trí, scroll, resize và selection trải qua nhiều visual line.
- `useDismiss`, `useRole` và `FloatingFocusManager` xử lý Escape, outside click, focus và accessibility.
- Dự án không tự viết thuật toán đo viewport hoặc lật vị trí popover.

Drawer là component React do dự án sở hữu vì layout, lifecycle state, scroll-to-comment và quan hệ với artifact là logic riêng của sản phẩm. Không thêm một UI framework lớn chỉ để làm drawer; component dùng VS Code design tokens, focus trap/ARIA phù hợp và responsive overlay.

Sau khi lưu comment, selection được highlight. Click highlight mở popover đọc comment liên quan và cho phép xóa khi round chưa submit.

Comments drawer thay sidebar cố định 340px:

- Mặc định đóng để ưu tiên vùng đọc tài liệu.
- Mở từ `Comments (N)`.
- Click một comment sẽ scroll/focus highlight tương ứng.
- Ở viewport hẹp, drawer là overlay; ở viewport rộng có thể là overlay hoặc dock tạm thời nhưng không ép hẹp tài liệu mặc định.

Không chọn pure-popover vì artifact có nhiều comment vẫn cần nơi tổng hợp, rà soát và điều hướng.

## Theme và hướng thiết kế học từ Antigravity

Tài liệu công khai của Antigravity nhấn mạnh artifact như một deliverable để review, comment trực tiếp theo vị trí và điều hướng trong detail viewer. Kế hoạch học mô hình tương tác đó, không sao chép pixel hoặc giả định palette nội bộ không được công bố.

Ba phương án:

1. **VS Code-native tuyệt đối**: mọi surface dùng trực tiếp theme tokens. Hòa nhập tốt nhất nhưng cảm giác artifact ít khác biệt với editor thông thường.
2. **Antigravity-inspired hybrid — chọn triển khai**: document-first canvas, header/action bar gọn, popover nằm sát selection, drawer ẩn mặc định; màu, focus, border và contrast vẫn lấy từ VS Code tokens. Có thể dùng surface “paper” rất nhẹ bằng `editor.background`/`sideBar.background` và border/shadow tokens, không hard-code palette.
3. **Artifact theme độc lập**: tự đặt light/dark palette riêng. Không chọn vì dễ xung đột theme tùy chỉnh, high contrast và kỳ vọng UI của VS Code.

Theme implementation:

- Dùng các class `vscode-light`, `vscode-dark`, `vscode-high-contrast` do VS Code gắn trên `body`.
- Dùng CSS variables như `--vscode-editor-background`, `--vscode-editor-foreground`, `--vscode-sideBar-background`, `--vscode-widget-border`, `--vscode-widget-shadow`, `--vscode-focusBorder`, `--vscode-button-background`, `--vscode-button-foreground`, `--vscode-button-secondaryBackground`, `--vscode-badge-background` và selection tokens.
- Typography và code font kế thừa `--vscode-font-family` và `--vscode-editor-font-family`.
- Không cần nút dark mode riêng: viewer tự đổi theo VS Code theme, kể cả khi người dùng đổi theme trong lúc panel đang mở.
- High contrast có border/focus rõ ràng và không chỉ dựa vào màu để biểu đạt primary, selected hoặc commented state.
- Shiki chọn cặp theme phù hợp theo nhóm light/dark; high contrast có plain-code fallback hoặc theme đã kiểm chứng contrast.
- Mermaid nhận theme variables tương ứng và render lại khi nhóm theme thay đổi.

## Kiến trúc Markdown và comment anchoring

Luồng mới:

```text
artifact.md
  -> remark parse + remark-gfm
  -> review block model with source positions and visible text
  -> react-markdown custom components
  -> review annotation transform
  -> VS Code-themed, selectable DOM
```

`parseMarkdownBlocks` được thay bằng parser dựa trên AST nhưng vẫn là nguồn canonical trong extension host.

Mỗi selectable block lưu source start/end offsets, type, source slice, visible text, heading context và deterministic block ID.

Webview nhận Markdown cùng block metadata. Custom components hoặc một rehype plugin đối chiếu `node.position` với block metadata để gắn đúng `data-block-id` vào DOM.

Highlight không thay toàn bộ block bằng plain string. Một annotation transform đi qua descendant text nodes, chia text node theo comment ranges và chèn `<mark>` mà vẫn giữ emphasis, link, inline code và cấu trúc Markdown.

Atomic selectable blocks ban đầu gồm heading, paragraph, list item, blockquote, fenced code và table cell. Không cho selection đi qua hai atomic blocks.

Block IDs của cấu trúc cũ phải được giữ tương thích khi source/type/index không đổi. Fixture schema v3 hiện tại phải chứng minh comment đang mở không biến mất sau nâng cấp.

Với inline markup làm thay đổi visible offsets, resolver thử exact offset trước rồi re-anchor bằng quote/prefix/suffix. Không âm thầm gắn comment vào vị trí không chắc chắn; trường hợp mơ hồ hiển thị lỗi rõ và yêu cầu tạo lại comment.

## Renderer và mô hình bảo mật

Tạo component `MarkdownRenderer` dùng chung, nhận Markdown, review blocks, comments và callbacks cho selection/link/code actions.

Custom components bao phủ heading, paragraph, unordered/ordered list, task list, link, blockquote, table, inline code, fenced code và horizontal rule.

Raw HTML, MDX và executable JavaScript bị khóa vì artifact là nội dung do AI hoặc người dùng tạo, phải xem như untrusted content:

- Raw HTML có thể chèn element, style, form, iframe hoặc URL ngoài ngoài ý định của renderer.
- MDX cho phép nhúng component/expression và biến tài liệu review thành bề mặt thực thi.
- JavaScript trong fenced code chỉ là nội dung để đọc/copy, tuyệt đối không chạy.
- Webview có message bridge về extension host; CSP là lớp phòng thủ bổ sung, không phải lý do để cho phép nội dung tùy ý.

Implementation không dùng `rehype-raw`. Raw HTML được hiển thị như text hoặc bỏ qua theo fixture đã chốt. URL qua safe-protocol policy; external link gửi về extension host để mở bằng VS Code API. Remote image không tự tải trong milestone đầu; hiển thị alt text/placeholder cho đến khi có policy riêng về CSP, local resources và privacy.

CSP tiếp tục không cho inline script. Package mới phải chạy trong bundle không cần `eval` hoặc runtime code execution. Không dùng `dangerouslySetInnerHTML` cho nội dung chưa được kiểm soát; ngoại lệ duy nhất là SVG Mermaid sau pipeline strict và bước kiểm tra/sanitize được xác nhận bằng security tests.

## Code block và Mermaid

Shiki dùng fine-grained bundle, cache highlighter theo vòng đời webview và lazy-load language cần thiết.

Code block có language label, copy button, horizontal scroll và fallback plain code khi language không được hỗ trợ, highlighter lỗi hoặc high-contrast theme chưa đạt tiêu chí.

Mermaid chỉ lazy-load khi tài liệu có fenced block `mermaid`. Mermaid chạy với `startOnLoad: false`, `securityLevel: "strict"`, không bật click callbacks hoặc raw HTML.

Diagram lỗi hiển thị thông báo ngắn và cho phép xem/copy source; một diagram lỗi không làm hỏng toàn artifact. Khi VS Code đổi giữa light/dark/high-contrast, diagram đang hiện được render lại bằng theme variables tương ứng.

## Các phase triển khai

### Phase 1 — Baseline và action-state model

- Thêm fixture Markdown cho CommonMark, GFM, nested list, inline formatting, table, task list, link, code và Mermaid.
- Ghi nhận bundle, render behavior và comment selection behavior hiện tại làm baseline.
- Tách action-state derivation khỏi `App.tsx` thành pure helper có unit tests.
- Triển khai `Review (N)`, dynamic primary và `submittingDecision`.
- Giữ sidebar hiện tại trong phase này để giới hạn rủi ro.

### Phase 2 — AST block foundation

- Thêm unified/remark parser cần dùng trực tiếp trong extension host và `remark-gfm`.
- Thay parser regex bằng AST traversal có source positions.
- Mở rộng `MarkdownBlock` cho source offsets và atomic block type.
- Giữ deterministic ID tương thích cho block cũ khi có thể.
- Thêm parity tests giữa source slice, visible text và rendered `textContent`.
- Thêm re-anchoring resolver và test trường hợp quote mơ hồ.

### Phase 3 — Standard MarkdownRenderer và theme foundation

- Thêm `react-markdown` và `remark-gfm` vào webview.
- Tạo `MarkdownRenderer` với custom components.
- Ánh xạ AST positions sang `data-block-id`.
- Triển khai annotation transform giữ nguyên inline markup.
- Tạo theme token layer cho light, dark và high contrast; không hard-code palette sản phẩm.
- Hoàn thiện typography, nested lists, tables, task lists, links, quotes, inline code và code blocks.
- Thêm security tests cho raw HTML, script, MDX-like input và unsafe URLs.

### Phase 4 — Contextual comment UX

- Thêm `@floating-ui/react` và `SelectionCommentPopover` dùng Range virtual element.
- Dùng interaction/focus primitives của Floating UI; không tự triển khai positioning.
- Di chuyển comment composer khỏi sidebar sang popover.
- Mở popover đọc/xóa comment khi click highlight.
- Chuyển review panel thành project-owned `CommentsDrawer` có toggle, scroll-to-comment và responsive overlay.
- Bảo vệ unsaved draft khi Escape, outside click, round refresh hoặc drawer transition.
- Thêm keyboard/focus/ARIA behavior và interaction tests có flush positioning microtasks.

### Phase 5 — Shiki, Mermaid và theme parity

- Tích hợp Shiki theo fine-grained/lazy bundle và theme mapping light/dark/high contrast.
- Thêm language label, copy code và plain fallback.
- Lazy-load Mermaid, cấu hình strict, render SVG an toàn và error/source fallback.
- Render lại enhanced blocks khi theme category thay đổi mà không mất selection/comment state.
- Đo initial bundle và tách chunks để tài liệu không dùng Shiki/Mermaid không chịu chi phí khởi tạo.

### Phase 6 — Verification, documentation và release

- Chạy typecheck, unit/integration tests và production build.
- Smoke test trong VS Code Extension Host với light, dark, high contrast; viewport rộng/hẹp; artifact ngắn/dài.
- Đổi theme khi panel đang mở và xác nhận viewer, popover, drawer, Shiki, Mermaid cập nhật đúng.
- Review ít nhất hai round trên cùng artifact để xác nhận refresh, comment reset và contextual UI không giữ state cũ.
- Test nhiều comments cùng block, overlapping ranges, multi-line selection, nested formatting và deletion.
- Test đầy đủ keyboard-only navigation, focus return, ARIA role/name và contrast boundaries.
- Cập nhật README, architecture, philosophy/TODO nếu hành vi user-facing thay đổi.
- Ghi changelog `0.5.0`, package VSIX và kiểm tra contents/bundle sizes.

## Thay đổi file dự kiến

- `src/shared/markdown-blocks.ts`: AST parser, source positions và visible-text model.
- `src/shared/contracts.ts`: block metadata/type additions.
- `src/extension/artifact-store.ts`: comment validation/re-anchoring tương thích parser mới.
- `src/extension/artifact-review-provider.ts`: safe link-opening và message bridge bổ sung.
- `src/webview/App.tsx`: orchestration, action state và drawer/popover state.
- `src/webview/MarkdownRenderer.tsx`: standard renderer và component mapping.
- `src/webview/SelectionCommentPopover.tsx`: selection-anchored composer dùng Floating UI.
- `src/webview/CommentsDrawer.tsx`: comment overview/navigation do dự án sở hữu.
- `src/webview/review-annotations.ts`: annotation transform.
- `src/webview/theme.ts`: theme category/tokens cho Shiki và Mermaid nếu cần logic ngoài CSS.
- `src/webview/CodeBlock.tsx` và `src/webview/MermaidBlock.tsx`: lazy enhanced blocks.
- `src/webview/styles.css`: typography, tokenized theme, drawer, popover và responsive styles.
- `test/`: parser parity, annotation, action state, security, theme và interaction fixtures.
- `package.json`, lockfile, README, architecture và changelog.

Tên file/component có thể điều chỉnh sau khi kiểm tra dependency APIs, nhưng ownership boundaries nêu trên phải được giữ.

## Rủi ro và kiểm soát

Rủi ro lớn nhất là AST parser và rendered DOM không đồng ý về block boundaries hoặc visible offsets. Kiểm soát bằng source positions dùng chung, deterministic IDs và parity tests trên cùng fixtures.

Popover có thể mất anchor khi focus textarea làm selection collapse. Capture `SelectionDraft` và clone Range/rects trước khi chuyển focus; Floating UI dùng virtual reference đã lưu.

Async Shiki/Mermaid có thể render kết quả của round cũ sau khi artifact update. Mọi async result phải bind vào artifact ID, review round và content hash trước khi commit UI state.

Bundle có thể tăng mạnh. Giữ renderer core synchronous, lazy-load highlighter/diagram engine và ghi nhận kích thước từng chunk.

Theme tùy chỉnh có thể thiếu một số token. Mỗi token chuyên biệt phải có fallback về token nền tảng; high contrast dùng border/focus rõ thay vì shadow hoặc khác biệt màu tinh tế.

Raw Markdown và Mermaid là nội dung không tin cậy. Giữ raw HTML off, safe URL policy, Mermaid strict, CSP và security fixtures.

## Tiêu chí hoàn thành

- `Review (N)` là primary chính xác khi có comment hợp lệ; Proceed là primary khi không có comment.
- CommonMark/GFM quan trọng hiển thị đúng, gồm nested list, emphasis, link, table và task list.
- AST block model và DOM có parity về block identity và visible text trên fixture.
- Comment selection, highlight và deletion giữ đúng quote/offset qua inline formatting.
- Popover dùng Floating UI, bám selection khi scroll/resize và có keyboard/focus behavior hợp lệ.
- Drawer có thể ẩn, mở lại và điều hướng tới từng comment; màn hình hẹp không bị ép bởi sidebar cố định.
- Viewer tự theo VS Code light/dark/high-contrast theme, kể cả đổi theme khi panel đang mở.
- Màu primary, selection, commented state và focus vẫn phân biệt được trong high contrast.
- Code highlighting và Mermaid không ảnh hưởng initial load của tài liệu không dùng chúng.
- Raw HTML/script, unsafe URL và Mermaid callback không thể thực thi trong webview.
- Review nhiều round vẫn cập nhật cùng artifact, reset comment/submission và không tạo revision directory.
- Existing tests, new renderer/interaction/theme tests, typecheck, production build và VSIX packaging đều pass.

## Tài liệu kỹ thuật tham chiếu

- [Antigravity — Reviewing artifacts](https://www.antigravity.google/docs/cli/artifacts/)
- [VS Code — Webview API: theming](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content)
- [VS Code — Theme Color Reference](https://code.visualstudio.com/api/references/theme-color)
- [Floating UI — Popover](https://floating-ui.com/docs/popover)
- [Floating UI — Virtual Elements](https://floating-ui.com/docs/virtual-elements)
- [react-markdown](https://github.com/remarkjs/react-markdown)
