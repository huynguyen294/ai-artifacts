# Code Review — Phase 4.5 Chặng 1 (Bước 1–2: Contract & MCP Standalone)

**Phạm vi đối chiếu:** [plan-phase-4.5.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan-phase-4.5.md#L129-L188) (Chặng 1: Bước 1 — Shared contracts & baseline wording; Bước 2 — MCP standalone & đồng bộ agent-facing text) và bộ baseline đóng băng tại [agent-text.json](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/phase-4.5-wording/agent-text.json), [manifest.json](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/phase-4.5-wording/manifest.json).

---

## 1. Tổng hợp theo Component

### A. Shared Contracts & Integration Version Receipt
- **Files:** [contracts.ts](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L10-L37), [contracts.ts](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L654-L743), [workspace-integration.ts](file:///d:/workspace/my-projects/ai-artifacts/src/extension/workspace-integration.ts#L162-L199)
- **Đạt yêu cầu:**
  - Hằng số version đã chốt đúng kế hoạch: `MCP_VERSION = 12`, `CREATE_REVIEW_ARTIFACT_SKILL_VERSION = 7`, `WORK_SESSION_SKILL_VERSION = 1`.
  - [`integrationVersionManifestSchema`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L27-L35) mở rộng thêm `sessionSkills?: InstalledSkillVersions` (`.strict()`), tương thích ngược với receipt cũ chỉ có `skills`.
  - [`writeInstalledIntegrationVersion`](file:///d:/workspace/my-projects/ai-artifacts/src/extension/workspace-integration.ts#L162-L199) merge độc lập từng map (`skills`, `sessionSkills`) và giữ nguyên `mcpVersion`/target khác không nằm trong patch; vẫn ghi atomic với owner-only mode.
- **Vấn đề cần xử lý:** Có **1 lỗi Medium** ở nhóm type kết quả entry MCP (`StandaloneArtifactInspectionResult`, `SessionArtifactInspectionResult`, `CreateArtifactReviewResult`, `InspectArtifactReviewResult`, `JoinSessionResult`) bị lệch literal union runtime và chưa được nối vào MCP producer để enforce compile-time check (chi tiết ở Mục 2).

### B. MCP Server Standalone & Agent-Facing Text
- **File:** [artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts)
- **Đạt yêu cầu:**
  - **Standalone `create_artifact`** ([`persistArtifact`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L714-L761), [`createArtifact`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L763-L845), [`handleCreateTool`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1552-L1568)): Khi cả `artifactConversationId` và `conversationName` đều bị lược bỏ, luồng tạo artifact không đụng `conversation-registry` hay `session-types.json`, trả `session: null` và không gắn `artifactConversationId` / `conversationName` vào `structuredContent`. Khi truyền `conversationName` (kèm trim/non-blank validation qua [`conversationNameSchema`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L38-L44)) hoặc `artifactConversationId` (ưu tiên nếu truyền cả hai), preflight v1, tạo/gắn Session và rollback khi lỗi window/connection đều giữ nguyên tính toàn vẹn.
  - **Standalone `inspect_artifact_review`** ([`executeInspectCore`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1671-L1855), [`handleInspectTool`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1857-L1937)): Bỏ cả hai tham số Session sẽ chỉ đọc state artifact + cấp round token/reconnect window nếu có, trả `session: null`, không tạo hay ghi `conversation-registry`. Các nhánh có `artifactConversationId` hoặc `conversationName` bảo toàn rollback membership (`previousMembershipRegisteredAt` hoặc xoá file membership mới) và xoá Session mới tạo nếu lỗi ở `resolveWorkSessionContext` hoặc `commitArtifactConnectionRequest`.
  - **`join_session`, `wait_for_artifact_review`, `advance_and_wait_for_artifact`**: Giữ nguyên hành vi join/echo/lifecycle.
  - **Agent-facing text**: Đối chiếu tự động từng chuỗi cho thấy 24/24 dòng `initialize.instructions` ([artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L2293-L2318)) và toàn bộ 6 vị trí `createDescription`, `inspectDescription`, `artifactConversationIdDescription`, `conversationNameDescription` ([artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L2323-L2417)) khớp **100% verbatim** với [agent-text.json](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/phase-4.5-wording/agent-text.json).

### C. Test Suites
- **Files:** [artifact-contracts.test.ts](file:///d:/workspace/my-projects/ai-artifacts/test/artifact-contracts.test.ts#L200-L250), [workspace-integration.test.ts](file:///d:/workspace/my-projects/ai-artifacts/test/workspace-integration.test.ts#L368-L402), [review-wait-mcp.test.ts](file:///d:/workspace/my-projects/ai-artifacts/test/review-wait-mcp.test.ts#L2684-L3182), [mcp-join-session.test.ts](file:///d:/workspace/my-projects/ai-artifacts/test/mcp-join-session.test.ts#L455-L621)
- **Đạt yêu cầu:** Đã cập nhật các test hiện hữu từng giả định omit = tạo `"Untitled Conversation"` sang truyền `conversationName` tường minh, bổ sung test full vòng đời standalone (`create` -> `inspect` -> `wait` -> `approve` không chạm `conversation-registry`), test standalone `create_artifact` sống tốt khi `session-types.json` bị hỏng JSON, test `initialize.instructions` / `tools/list` phản ánh standalone default, và test merge `sessionSkills` độc lập trong version receipt.

---

## 2. Phát hiện cần xử lý (Actionable Findings)

### [Medium] `StandaloneArtifactInspectionResult` & `SessionArtifactInspectionResult` khai báo sai union `roundTokenSource`, lệch `exactOptionalPropertyTypes` và chưa được nối vào MCP producer

- **Vị trí:**
  - [contracts.ts](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L679-L743) (`SessionArtifactHandleResult`, `StandaloneArtifactInspectionResult`, `SessionArtifactInspectionResult`, `CreateArtifactReviewResult`, `InspectArtifactReviewResult`, `JoinSessionResult`)
  - [artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1367-L1385) (`grantInspectedRound`), [artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1479-L1508) (`artifactHandle`), [artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1554-L1555) (`handleCreateTool`), [artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1920-L1933) (`handleInspectTool`), [artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1968-L1974) & [artifact-review-mcp-v4.ts](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L2028-L2043) (`handleJoinSessionTool`)
- **Kịch bản kích hoạt & Hệ quả:**
  1. **Sai contract runtime ở `roundTokenSource`:** [`StandaloneArtifactInspectionResult`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L703) và [`SessionArtifactInspectionResult`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L727) khai báo:
     ```ts
     roundTokenSource?: "saved-feedback" | "explicit-chat-update";
     ```
     Trong khi MCP runtime tại [`grantInspectedRound`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1367-L1384) và [`InspectCoreResult`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1668) thực chất phát ra `"chat-update" | "chat-inspection"`. Bất kỳ caller/test nào ở các bước sau consume `InspectArtifactReviewResult` / `JoinSessionResult` và branch theo `"saved-feedback"` hoặc `"explicit-chat-update"` sẽ không bao giờ khớp dữ liệu thật từ MCP.
  2. **Chưa kích hoạt hàng rào type-check của Bước 1:** Cả `artifact-review-mcp-v4.ts` lẫn `test/artifact-contracts.test.ts` hiện chưa import hay gắn `satisfies` / return type cho `CreateArtifactReviewResult`, `InspectArtifactReviewResult`, `JoinSessionResult`. Do đó `npm.cmd run check` (`tsc --noEmit` với `"exactOptionalPropertyTypes": true` trong [tsconfig.json](file:///d:/workspace/my-projects/ai-artifacts/tsconfig.json#L13)) không phát hiện lỗi literal ở mục (1), đồng thời cũng chưa bắt được các field gán `undefined` trực tiếp (`submission: inspection.submission`, `submissionSha256: inspection.submissionSha256`, `roundToken`, `conversationName: convName`) vốn sẽ compile fail ngay khi nối type vào dưới `exactOptionalPropertyTypes: true`. Tiêu chí hoàn thành Bước 1 ([plan-phase-4.5.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan-phase-4.5.md#L167-L171)) yêu cầu hệ thống type này chặn lỗi nhầm `reviewSessionId` với Work Session ID và ép check null trên `result.session` ngay ở compile time.
- **Khuyến nghị sửa:**
  1. Sửa `roundTokenSource` trong [`StandaloneArtifactInspectionResult`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L703) và [`SessionArtifactInspectionResult`](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L727) thành `"chat-inspection" | "chat-update"` cho khớp đúng runtime `grantInspectedRound`.
  2. Đồng bộ optional fields với `exactOptionalPropertyTypes: true` (chỉ spread key khi `!== undefined` trong `artifact-review-mcp-v4.ts` tương tự cách `roundTokenSource` đang làm ở dòng 1930/2040, hoặc khai báo `| undefined` có chủ đích cho các field thực sự emit `undefined`).
  3. Import và gắn return type / `satisfies` cho payload của [`handleCreateTool`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1555) (`CreateArtifactReviewResult`), [`handleInspectTool`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1921) (`InspectArtifactReviewResult`), và [`handleJoinSessionTool`](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L1970) / [L2029](file:///d:/workspace/my-projects/ai-artifacts/src/integration/artifact-review-mcp-v4.ts#L2029) (`JoinSessionResult`), kèm 1 compile-time type test nhỏ (`@ts-expect-error` trên `result.session.sessionId` khi chưa narrow null) trong [artifact-contracts.test.ts](file:///d:/workspace/my-projects/ai-artifacts/test/artifact-contracts.test.ts).

---

## 3. Thông tin tham khảo / Khả năng có thể (Non-blocking)

- **Bổ sung assert standalone `inspect_artifact_review` khi `session-types.json` lỗi** ([mcp-join-session.test.ts](file:///d:/workspace/my-projects/ai-artifacts/test/mcp-join-session.test.ts#L588-L621)): Test hiện tại đã chứng minh standalone `create_artifact` miễn nhiễm với `session-types.json` hỏng; có thể gọi thêm 1 lệnh `inspect_artifact_review` standalone ngay trên `standaloneResult.structuredContent.artifactDirectory` trong cùng test để khoá trọn vẹn cả 2 entry standalone đối với Session files lỗi theo [plan-phase-4.5.md](file:///d:/workspace/my-projects/ai-artifacts/plans/work-session-artifact/plan-phase-4.5.md#L184).
- **Hằng số cầu nối `SKILL_VERSION = 6`** ([contracts.ts](file:///d:/workspace/my-projects/ai-artifacts/src/shared/contracts.ts#L14)): Đang được giữ tạm thời để code extension/UI chưa sang Chặng 2 vẫn compile xanh; khi triển khai Bước 3–5 của Chặng 2 nên dọn hoặc chuyển hết caller sang `CREATE_REVIEW_ARTIFACT_SKILL_VERSION` và `WORK_SESSION_SKILL_VERSION`.

---

## 4. Trạng thái Kiểm chứng (Validation Status)

| Hạng mục kiểm tra | Lệnh / Phương thức | Kết quả |
| --- | --- | --- |
| Typecheck toàn repo | `npm.cmd run check` (`tsc --noEmit`) | **PASS** (exit 0) |
| Kiểm tra whitespace / patch hygiene | `git -c core.safecrlf=false diff --check` | **PASS** (exit 0) |
| Toàn bộ Vitest suite | `npx vitest run` | **PASS** (47/47 files, 648 passed, 3 skipped) |
| Đối chiếu `agent-text.json` vs MCP | So khớp tự động 24 dòng `initialize.instructions` + 6 chuỗi tool/arg descriptions | **PASS** (100% exact match) |
| Đối chiếu baseline hash `manifest.json` | Kiểm tra SHA-256 `skills/create-review-artifact/*` trước Chặng 2 | **PASS** (100% match — chưa bị sửa ngoài phạm vi Chặng 1) |
| Build VSIX / Extension Host UI / Skill bundle | Thuộc phạm vi Chặng 2–3 (Bước 3–7) | **Chưa chạy ở Chặng 1** |
