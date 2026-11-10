# Phase 4.5 — README và branding đã chốt

Chốt ngày **2026-11-08**. Triển khai trong **Chặng 2**, sau UI/skills của Bước 3–4; Chặng 3 chỉ đối chiếu lại docs với assets/version đã hoàn tất. File này là specification, không phải toàn bộ README để copy đè.

Chép nguyên văn các đoạn tiếng Anh bên dưới vào đúng vị trí; không tự rút gọn, diễn đạt lại hoặc bỏ danh sách clients. Giữ nội dung README ngoài phạm vi và các hướng dẫn review hiện có. Wording skills/agent text vẫn theo manifest riêng, không thay đổi bởi tài liệu này.

## 1. Branding trong package.json và README

`package.json.displayName` và H1 README dùng cùng tên:

```text
AI Artifacts - Interactive Review & Multi-Agent Work Sessions
```

`package.json.description` — **274 ký tự**, giữ artifact số ít, artifacts số nhiều và danh sách clients:

```text
Interactive artifact review for AI-generated plans, Markdown specs, and proposals with inline feedback. Organize artifacts and shared instructions in Work Sessions across agents and chats. Connects via MCP to Cursor, Codex, Claude, GitHub Copilot, Cline, Windsurf, and more.
```

Chỉ đổi metadata hiển thị. Giữ `name: ai-artifacts`, `publisher: huynguyen294`, extension ID, command/view IDs, đường dẫn dữ liệu và package version. Không nâng MCP/skill chỉ vì branding; version skills vẫn theo các bước hiện có của Phase 4.5.

## 2. Giới thiệu ngay dưới tên và các liên kết Marketplace

Thay đoạn giới thiệu cũ bằng hai đoạn sau; giữ giá trị interactive review, planning/specs/write-ups, inline comments, revisions, approval và clients trước khi giới thiệu Session:

```markdown
**AI Artifacts** is an interactive artifact review editor that lets AI coding agents such as Cursor, Codex, Claude, GitHub Copilot, Cline, and Windsurf create planning artifacts, Markdown specs, and technical write-ups directly in your IDE. Add inline comments, request revisions, and approve plans for execution through MCP and agent skills.

**Multi-Agent Work Sessions** keep related artifacts and shared instructions together across agents and chats. Organize ongoing work, define rules and workflows, and connect another agent to continue with the session’s latest artifacts and instructions.
```

## 3. GIF ở cuối How It Works

Giữ các demo hiện có. Sau demo cuối hiện tại, trước Requirements & compatibility, thêm caption nguyên văn:

```markdown
**Continue the same work across agents and chats**

Keep related artifacts and shared instructions in one Work Session, then connect another agent to continue.
```

- Chú cung cấp GIF; dự kiến đặt ở `media/work-session.gif`. Chỉ thêm image Markdown khi asset thật tồn tại, không tạo link ảnh hỏng hoặc tự tạo GIF trong nhiệm vụ này.
- Khi có asset, dùng nguyên văn: `![Continue the same work across agents and chats with a shared Work Session](media/work-session.gif)`.
- Demo dự kiến: agent A tạo plan → Start a work session → thêm Instructions → Connect agent B/chat khác → đọc và tiếp tục từ artifacts/Instructions trong cùng Session.
- Chưa có GIF thì vẫn hoàn tất phần text/branding và ghi rõ asset chờ Chú; không ghi nhận demo runtime đã kiểm chứng.

## 4. Features & Usage và Contents

Đổi `## Usage` thành `## Features & Usage`. Thay entry Usage trong Contents bằng đúng cây liên kết sau; giữ các entry khác:

```markdown
- [Features & Usage](#features--usage)
  - [Create & Review Artifacts](#create--review-artifacts)
  - [Search & Reconnect Artifacts](#search--reconnect-artifacts)
  - [Multi-Agent Work Sessions](#multi-agent-work-sessions)
  - [Organize Session Artifacts](#organize-session-artifacts)
  - [Shared Instructions](#shared-instructions)
```

Các heading tương ứng và nội dung cần có:

| Heading nguyên văn | Nội dung triển khai |
| --- | --- |
| `### Create & Review Artifacts` | Gộp các mục create/open/review hiện có, dùng H4 khi cần; giữ yêu cầu explicit artifact, inline comments, feedback/question-only, Proceed theo kind, Just save, Copy Markdown và cách mở editor. Bỏ mô tả drawer Artifacts in Conversation đã bị thay thế. |
| `### Search & Reconnect Artifacts` | Giữ hướng dẫn Search Artifact; đổi hướng dẫn nút Connect cũ sang Inspect artifact copy trực tiếp theo UI 4.5, không còn popup New/Join. |
| `### Multi-Agent Work Sessions` | Giới thiệu lợi ích công việc dài qua nhiều agents/chats. Hướng dẫn artifact độc lập → Start a work session → nhập tên → manager mở và Connect prompt được copy → paste vào chat → Join thành công. Artifact đã có membership dùng Sessions để mở/chọn; giữ đường migration v1. Có thể mở Session từ sidebar và Connect agent/chat khác vào cùng phiên. |
| `### Organize Session Artifacts` | Hướng dẫn Recent Artifacts/Sessions, Add Session rỗng, Add Artifact có sẵn, rename/change type, search/filter; Working/References/Archived, Move Up/Down/Move To/Remove và panel preference hiện có. Không drag/drop; không đưa tính năng Phase 5 chưa triển khai vào hướng dẫn hiện tại. |
| `### Shared Instructions` | Rules/workflows/hướng dẫn cho agents trong phiên; textarea chứa Markdown, Save và Open Markdown File. Nguồn là `instructions.md`, không phải `conversation.json`; không save thì đóng/reload có thể mất phần đang nhập. Session skill đọc Instructions mới và dùng catalog để tìm/đọc artifacts cần thiết. |

Nội dung hướng dẫn thao tác viết theo các yêu cầu trên và UI thực tế; chỉ các đoạn/title/template đã chốt ở mục 1–4 yêu cầu giữ nguyên văn. Không nhân đôi toàn bộ hướng dẫn Session ở nhiều mục.

## 5. Contract cần giải thích chính xác

- Artifact standalone khi chat chưa có active Session; không bắt tạo Session để review một tài liệu.
- Sau Join thành công, create/inspect trong chat tự thêm/làm mới artifact trong Session đang active; user có thể yêu cầu standalone cho riêng request đó mà không bỏ active Session.
- Chat có tối đa một active Session; một Session dùng được qua nhiều agents/chats. Connect/copy prompt không tự thay context của chat trước tool success.
- Các agents dùng chung artifacts và Instructions; không hứa chuyển toàn bộ chat history, đồng bộ context nền hoặc tự điều phối/phân công agent. Không branding thành Task Manager trong đợt này.
- Known artifact đọc Markdown hiện tại; khi cần tìm artifact mới/tổng quan, Session skill refresh catalog bằng Join-only. Không mô tả chỉ đọc tài liệu tham khảo thành takeover.
- Phase 5 mới bổ sung Pin/Archive/Restore/Delete/cleanup/Export ZIP. Zone Archived hiện có khác Archive toàn cục; chưa đưa các tính năng tương lai này thành capability đã có.
- Bổ sung hai skill `create-review-artifact` và `work-session` vào phần install/locations/verify/uninstall liên quan khi source đã có; artifact customization giữ nguyên, Session skill chưa hỗ trợ customize. Chặng 3 hoàn tất số version, receipts và trạng thái install/verify theo implementation.

## 6. Đối chiếu khi hoàn thành Chặng 2

- `package.json` metadata và README H1/intro/caption khớp các đoạn nguyên văn; extension ID và version không đổi do branding.
- Contents/anchors trỏ đúng headings, nội dung review cũ được giữ và các mô tả drawer/inline Instructions/New–Join đã được thay đúng baseline 4.5.
- Không broken GIF link; ghi rõ nếu đang chờ asset. Kiểm tra Markdown diff/links và assertions metadata hiện có nếu bị ảnh hưởng; không thêm test chỉ để lặp lại prose.
- Không thay các file skill hoặc hash manifest hiện có khi bổ sung tài liệu README này.

## 7. Tiến độ áp dụng — 2026-11-08

- **README text đã áp dụng:** H1, hai đoạn giới thiệu, caption cuối How It Works, Features & Usage với submenu Contents; hướng dẫn review được giữ, thêm Session/organize/Instructions và sửa storage v2.
- **Package branding đã áp dụng:** sau lượt README, Chú cho phép hoàn tất branding; `package.json.displayName` và `description` đã chép đúng mục 1 ngày 2026-11-08. Tên khớp README H1; description 274 ký tự giữ clients. Extension ID/version và metadata khác giữ nguyên.
- **GIF đang chờ:** chưa có `media/work-session.gif`; không thêm image link cho đến khi asset thật có mặt.
- **Chặng 3 đối chiếu installer/version:** chỉ cập nhật thông tin hai installed skills khi assets/installer đã hoàn tất. Nội dung README chuẩn bị cho workflow 4.5 không phải bằng chứng UI/skills/AI client đã triển khai hay kiểm chứng.
