# Phase 1 — Driver và installer Antigravity

Trạng thái: kế hoạch để review, chưa triển khai. Đối chiếu source ngày 2026-11-10.

Plan tổng: [plan.md](./plan.md). Tài liệu này là hướng dẫn bàn giao cho coder của **Phase 1**, không phải yêu cầu thực hiện Phase 2.

## 1. Kết quả cần bàn giao và giới hạn

Sau phase này, người dùng có thể cài/gỡ Antigravity bằng command riêng hoặc các command All hiện có. Installer cài MCP runtime dùng chung, hai skill đầy đủ, kiểm tra trạng thái và ghi receipt riêng cho skill target Antigravity.

Tận dụng driver interface, JSON I/O, skill deployment, verifier và receipt writer hiện có. Độ khó nhỏ–vừa; điểm cần kiểm tra kỹ là nhánh skill riêng hiện chỉ dành cho Claude và các producer/consumer của receipt. Hồi quy chủ yếu ở install/check/uninstall All, JSON config và cleanup dùng chung.

**Không làm trong phase này:**

- Không nối Antigravity vào activation upgrade notification, stale-target selection hoặc auto-upgrade. Phase 2 mới làm notification.
- Không thêm saved-client list, `upgrade()` vào driver hoặc framework migration/driver mới.
- Không sửa nội dung hai skill, MCP tools, artifact lifecycle hoặc Work Session UI.
- Không sửa global rules của người dùng; không thêm rule vào skill được cài.
- Chưa sửa README và tài liệu sản phẩm. Phase 2 phải ghi note riêng: muốn tạo review artifact từ prompt thông thường **không tag skill**, người dùng cần global rule ưu tiên `create-review-artifact` thay workflow artifact mặc định của Antigravity.
- Không bump package, MCP, skill hoặc integration-receipt schema version.

Chú đã xác nhận workflow chạy được khi copy MCP config và hai thư mục skill thủ công. Đây là bằng chứng tương thích nền; chưa chứng minh installer mới đã hoạt động.

## 2. Hiện trạng code đã xác minh

Các đường dẫn dưới đây tính từ root repository `D:/workspace/my-projects/ai-artifacts`.

| Component | Hiện trạng và điểm nối |
| --- | --- |
| `src/extension/mcp-clients/index.ts` | `McpClientDriver` có `id`, `name`, `configPath`, `isDetected`, `check`, `install`, `uninstall`; factory trả sáu driver, chưa có Antigravity. |
| `src/extension/mcp-clients/claude-client.ts` | Mẫu gần nhất cho client có hai skill riêng; dùng bốn helper deploy/verify review skill và official Session skill. |
| `src/extension/mcp-clients/json-mcp-helper.ts` | Có `readJsonConfig`, `writeJsonConfig`, atomic writer và path normalization. `upsertJsonMcpServer` thay nguyên server entry, chưa hỗ trợ timeout và có thể ưu tiên root `servers`; không gọi nguyên trạng cho Antigravity. |
| `src/extension/workspace-integration.ts` | Base setup cài runtime + hai skill `.agents`; All gọi factory. Nhánh ghi receipt sau verify hiện chỉ dành cho `driver.id === "claude"`. Các command riêng gọi wrapper install/uninstall. |
| `src/shared/contracts.ts` | `installedSkillVersionsSchema` là strict object với optional `agents`, `claude`; dùng chung cho `skills` và `sessionSkills`. Writer merge patch, giữ receipt của target khác. |
| `src/extension/upgrade-notification.ts` | `IntegrationSkillTarget` lấy từ `keyof InstalledSkillVersions`, còn `StaleIntegrationAsset` liệt kê literal. Thêm key receipt sẽ cần cập nhật union để typecheck dù chưa bật notification cho client mới. |
| `src/extension/extension.ts`, `package.json` | Command được khai báo cả activation events, contributions và runtime registration; handler install hiện refresh views, báo thành công hoặc lỗi. |
| `src/extension/mcp-clients/base-cleanup.ts`, `src/extension/uninstall-entry.ts` | Base cleanup có danh sách skill path cụ thể; extension-uninstall tự dùng factory và sau đó cleanup base. |

Source version hiện tại là MCP 12, review skill 4, Work Session skill 1. Coder dùng các constant hiện có, không hardcode chúng vào thuật toán hoặc bump version.

## 3. Contract triển khai đã chốt

### 3.1. Driver và vị trí asset

Thêm `src/extension/mcp-clients/antigravity-client.ts`:

- Class `AntigravityClientDriver implements McpClientDriver`, `id = "antigravity"`, `name = "Antigravity"`.
- Export constant `ANTIGRAVITY_MCP_TIMEOUT_SECONDS = 3600` và class qua index.
- Constructor nhận một options object optional gồm `userHome`, `sourceSkillDirectory`, `sourceSessionSkillDirectory`. `userHome` mặc định `os.homedir()`; cho phép test toàn bộ driver trong temporary home.
- Expose getters `configPath`, `skillDirectory`, `sessionSkillDirectory` để kiểm tra và dùng trong test.
- Factory truyền source skill từ các argument hiện có. Khi không inject source, resolve official packaged source theo các ứng viên package/source tương tự Claude. Không lấy bản `.agents` đã được người dùng customize làm source cho Antigravity. Thiếu source thì install báo lỗi rõ ràng, không bỏ qua skill rồi báo thành công.

| Asset | Đường dẫn theo `userHome` |
| --- | --- |
| MCP config | `.gemini/config/mcp_config.json` |
| Review skill | `.gemini/config/skills/create-review-artifact/` |
| Session skill | `.gemini/config/skills/work-session/` |
| Runtime | Dùng `mcpScriptPath` được coordinator truyền vào; không copy runtime riêng cho Antigravity. |

Detector trả true khi có **config file** nói trên hoặc **thư mục** `.gemini/antigravity`. Chỉ có `.gemini` hoặc `.gemini/config` chưa đủ. Command install riêng không bị chặn bởi detector: người dùng chủ động cài thì vẫn được tạo config và skill paths.

Các vị trí global và `timeoutSeconds` đã đối chiếu [Antigravity MCP docs](https://antigravity.google/docs/mcp) và [skill locations](https://antigravity.google/docs/skills). Phase này chỉ ghi vào vị trí global đã chốt, không thêm workspace config hoặc migration từ legacy paths.

### 3.2. MCP definition

Config sau cài có server entry sau, với script path được normalize như JSON helper hiện có:

```json
{
  "mcpServers": {
    "ai_artifacts": {
      "command": "node",
      "args": ["<shared-managed-runtime-path>"],
      "timeoutSeconds": 3600
    }
  }
}
```

- Dùng `readJsonConfig` / `writeJsonConfig` trong driver, giữ atomic writer hiện có. Không đổi signature hoặc output của helper upsert dùng bởi các client khác.
- Chỉ sửa `mcpServers.ai_artifacts`: merge các field đã có của entry, rồi đặt `command`, `args`, `timeoutSeconds` theo giá trị installer quản lý. Giữ root keys, server khác và các field khác của entry.
- Antigravity luôn dùng container `mcpServers`; không chuyển sang `servers` do có một root key trùng tên.
- Không tự sinh `enabledTools`, `disabledTools`, `tools` hoặc per-tool declarations. Không đổi các tool preference đã có của người dùng.
- Config JSON sai cú pháp phải báo lỗi từ helper, không thay bằng config rỗng.

### 3.3. Hai skill, verification và uninstall

`install(mcpScriptPath)` thực hiện theo thứ tự: kiểm tra source hai skill tồn tại → ghi MCP config → deploy review skill bằng `replaceSkillDirectory` → deploy Session skill bằng `replaceOfficialSkillDirectory`.

- Copy nguyên thư mục bằng helpers hiện có; không chỉ copy `SKILL.md`. Bảo toàn `description` và `USER CUSTOM RULES` từ chính target Antigravity; không kế thừa customization từ `.agents` hoặc Claude.
- Nếu deploy lỗi thì propagate lỗi. Không thêm rollback chung cho config + hai skill; retry sử dụng lại installer hiện tại. Coordinator không ghi receipt Antigravity cho attempt lỗi.
- `check()` đọc đúng `mcpServers.ai_artifacts`, kiểm tra `command: node`, runtime path bằng `normalizePathForComparison` và timeout đúng constant. Thiếu/sai command hoặc script trả `missing`; timeout thiếu/sai trả `outdated` với detail cần reinstall.
- Thiếu `SKILL.md` của một trong hai skill trả `missing`; skill không current theo helper tương ứng trả `outdated`. Chỉ trả `ready` sau khi cả config và hai skill đạt. Không dựa vào receipt để kết luận bytes/config current.
- Nếu thiếu packaged source để verify, không trả `ready` dựa trên sự tồn tại của target; báo lỗi source không sẵn sàng.
- `uninstall()` chỉ xóa entry `mcpServers.ai_artifacts` và hai thư mục skill thuộc mình; trả true nếu có phần bị xóa, false nếu đều vắng. Giữ server khác, global rules, skill khác và thư mục cha. Không xóa runtime dùng chung trong uninstall riêng.

Không đưa global-rule presence vào `check()`/`ready`: đó là tùy chọn để dùng prompt không tag, không phải điều kiện cài asset.

### 3.4. Receipt và tương thích phase

- Bổ sung `antigravity: z.number().int().positive().optional()` vào `installedSkillVersionsSchema`; hai map `skills`/`sessionSkills` tự dùng schema này. Giữ `schemaVersion: 1` và strict validation hiện có.
- Receipt cũ không có field mới vẫn valid. Receipt sau cài thêm `skills.antigravity = CREATE_REVIEW_ARTIFACT_SKILL_VERSION`, `sessionSkills.antigravity = WORK_SESSION_SKILL_VERSION`.
- Tái sử dụng `writeInstalledIntegrationVersion`; không thêm file receipt hoặc version counter khác.
- Extend `StaleIntegrationAsset` với `skill:antigravity` và `session-skill:antigravity` để template literals trong `computeStaleIntegrationAssets` typecheck. Đây chỉ là cập nhật type phụ thuộc schema.
- **Chưa sửa** `getDetectedSkillTargets`, `requiredSkillTargets`, `assetLabel`, fingerprint hoặc activation trong phase này. Do đó notification tự động chưa xét Antigravity cho tới Phase 2.
- Uninstall riêng giữ semantics receipt hiện tại của các client: không bổ sung cơ chế xóa key receipt. Uninstall All có cleanup base thì receipt bị xóa cùng managed assets như hiện tại.

## 4. Thứ tự thực hiện cho coder

### Bước 1 — Driver và factory

1. Viết driver theo mục 3; thêm test driver trong `test/mcp-client-drivers.test.ts`.
2. Export/import driver trong `mcp-clients/index.ts`; thêm cuối danh sách factory để giữ thứ tự sáu client hiện tại.
3. Giữ nguyên signature `McpClientDriver` và bốn argument của `getAllClientDrivers`; truyền hai source directory hiện có vào options driver mới. Không refactor các driver khác.

### Bước 2 — Schema và install coordinator

1. Sửa schema và type phụ thuộc như mục 3.4.
2. Thêm `installAntigravityIntegration(context): Promise<void>` trong `workspace-integration.ts`: gọi `setupBaseMcpServer` → tạo driver với official source paths → install → check → nếu khác `ready` thì throw → ghi hai receipt Antigravity.
3. Trong `installAllDetectedIntegrations`, bổ sung nhánh Antigravity sau `driver.install`, verify và ghi receipt tương tự Claude. Dùng chung một helper nội bộ cho verify + ghi receipt của Antigravity giữa wrapper riêng và All; không nhân đôi hai flow hoặc chuyển toàn bộ installer sang framework mới.
4. Giữ base setup ghi runtime/Agents receipts trước như hiện tại. Antigravity lỗi có thể để lại base receipts hợp lệ; không xóa chúng, không ghi version đích cho phần Antigravity chưa verify. Receipt Antigravity đã tồn tại trước attempt lỗi được giữ nguyên.
5. All giữ thứ tự sequential và fail-fast hiện tại. Nhánh verification sau cùng và `checkAllIntegrations` tự nhận driver qua factory; không thêm một report schema riêng. `Antigravity` chỉ được `ready` khi cả hai skill riêng current.

### Bước 3 — Uninstall và cleanup

1. Thêm `uninstallAntigravityIntegration(): Promise<boolean>` làm wrapper gọi driver.
2. All và `runUninstall` nhận driver mới qua factory; không cần thêm vòng uninstall riêng trong entrypoint.
3. Bổ sung hai skill path Antigravity vào `cleanupBaseMcpServer` bằng `safeRemoveTarget` hiện có. Mục đích là dọn managed skill còn sót ngay cả khi detector không còn nhận ra client. Không xóa `.gemini`, `config`, toàn bộ `skills`, config file, global rules hoặc artifact/session.
4. Giữ hành vi `cleanupBase: false` và xử lý lỗi của các entrypoint hiện tại.

### Bước 4 — Command surface

Thêm đầy đủ ở `package.json` (`activationEvents`, `contributes.commands`) và `extension.ts` (import, registration trong subscriptions):

| Command ID | Title |
| --- | --- |
| `agentPlus.installAntigravityIntegration` | `AI Artifacts: Install Integration for Antigravity` |
| `agentPlus.uninstallAntigravityIntegration` | `AI Artifacts: Uninstall Integration for Antigravity` |

- Install handler: await wrapper → `refreshViewsAndService()` → báo MCP và hai skill đã cài, yêu cầu restart Antigravity và mở chat mới. Exception hiển thị qua `showErrorMessage` như các handler hiện tại.
- Uninstall handler: theo mẫu client hiện tại, phân biệt có xóa và không tìm thấy integration; yêu cầu restart khi có xóa.
- Không thêm verify command riêng; Verify All đã hiển thị row Antigravity qua factory.
- Không sửa package description/keywords, thêm settings mới hoặc thay success UI của client khác trong phase này.

## 5. Kiểm chứng bắt buộc

### Fixture và an toàn chạy test

Toàn bộ test install/uninstall phải dùng temporary home. Với test coordinator/entrypoint dùng factory, mock `os.homedir()` trước khi tạo driver và cô lập `CODEX_HOME`, Copilot/Cline config paths theo fixture hiện có; restore mocks/env sau test.

**Điểm cần sửa ngay trong test liên quan:** case hiện có `runUninstall executes cleanups and returns uninstalled clients` trong `test/mcp-client-drivers.test.ts` chỉ set `CODEX_HOME` và truyền `userHome` cho cleanup. `runUninstall` vẫn tạo các driver khác từ `os.homedir()` thật. Trước khi chạy cả file/suite với driver Antigravity mới, cô lập homedir và các config path của case đó để không gỡ integration thật. Không mở rộng thành refactor test harness toàn repo.

### Test theo component

| Component/test file | Kịch bản phải có |
| --- | --- |
| Driver — `test/mcp-client-drivers.test.ts` | Detector false với chỉ `.gemini`, true với config hoặc thư mục Antigravity; install riêng tạo được từ home chưa có dấu hiệu client. |
| Driver — cùng file | Ghi đúng root/server/runtime/timeout, giữ server/root keys khác; reinstall giữ field khác của server; JSON sai cú pháp không bị overwrite. |
| Driver — cùng file | Cài đủ reference assets; check thiếu/mismatch config, timeout, review/Session skill; customization hợp lệ vẫn ready sau reinstall và không bị lây từ `.agents`. |
| Driver — cùng file | Uninstall xóa đúng entry + hai skill, giữ global rules và unrelated skill/server; gọi lại trả false. |
| Receipt/coordinator — `test/workspace-integration.test.ts` | Receipt cũ valid; patch Antigravity giữ `agents`, `claude`, MCP và timestamp hợp lệ; dùng version constants hiện hành. |
| Receipt/coordinator — cùng file | Install riêng thành công mới ghi đủ hai receipt; lỗi skill hoặc check không ready không ghi version đích Antigravity, giữ các entry đã có. Dùng malformed custom markers/fault injection hiện có để tái hiện lỗi. |
| All/verification — cùng file | Extend fixture All với config và unrelated skill/server Antigravity; All cài và ghi receipt, Verify All báo đúng row; làm stale một skill riêng khiến row không ready; uninstall All giữ dữ liệu artifact/session. |
| Cleanup/entrypoint — `test/mcp-client-drivers.test.ts` | Base cleanup xóa hai thư mục skill ngay cả khi không có config; giữ `.gemini/GEMINI.md`, unrelated skill và artifact/session. `runUninstall` fixture có Antigravity trả đúng tên client. |
| Commands | Bổ sung một case manifest contract trong `test/release-contract.test.ts` xác nhận hai ID/title/activation events; kiểm tra runtime registration trong diff và smoke test Extension Host. Không dựng harness extension mới chỉ cho hai handler. |

Không viết lại test helper/skill deployment đã có; test mới tập trung chứng minh wiring Antigravity và các khác biệt của nó.

### Lệnh kiểm tra

Từ root repository, chạy focused checks khi đang triển khai:

```powershell
npm.cmd run build:integration
npx.cmd vitest run test/mcp-client-drivers.test.ts test/workspace-integration.test.ts test/release-contract.test.ts test/upgrade-notification.test.ts test/integration-verification.test.ts
```

Sau khi hoàn tất thay đổi:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
git diff --check
```

Không chạy `vscode:uninstall`, không tự cài/gỡ lên home thật để thay unit test. Smoke test command bằng Extension Development Host và temporary profile/home khi thực hiện được; nếu cần dùng integration thật, bàn giao bước đó cho Chú. Test agent workflow thật và prompt không tag nằm ở Phase 2.

## 6. Điều kiện bàn giao cho người review

- Diff có driver thứ bảy, hai command, install/check/uninstall All, receipt và cleanup theo các contract trên; không có implementation Phase 2 lẫn vào.
- Báo cáo test ghi rõ lệnh, kết quả, phần chưa chạy và có hay không kiểm chứng Extension Host. Không gọi unit tests là bằng chứng Antigravity runtime.
- Handoff nêu rõ giới hạn tạm thời: Phase 1 chưa theo dõi stale assets Antigravity qua activation notification; README/global-rule guidance và nghiệm thu workflow do Phase 2 hoàn thiện.
- Giữ nguyên thay đổi khác trong worktree, đặc biệt việc người dùng chuyển `plans/antigravity-support.md` sang thư mục `plans/antigravity-support/`.
- Dừng ở ranh giới Phase 1 để Chú review; không tự làm tiếp auto-upgrade hoặc Phase 2. Nếu coder làm qua Work Session có plan artifact, dùng đúng handoff **Review** theo Instructions của Session; tài liệu Markdown này không tự cung cấp artifact handle để submit.
