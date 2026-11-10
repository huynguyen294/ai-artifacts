# Phase 2 — Notification, README và nghiệm thu Antigravity

Trạng thái: kế hoạch bàn giao cho coder, chưa triển khai Phase 2. Đối chiếu worktree ngày 2026-11-10.

Plan tổng: [plan.md](./plan.md). Tiền đề triển khai: [Phase 1](./phase-1.md). Coder đọc `AGENTS.md` và `docs/INSTRUCTION.md` trước khi làm, giữ nguyên các thay đổi Phase 1 đang có trong worktree.

## 1. Kết quả cần đạt và phạm vi

- Activation nhận diện hai skill Antigravity trong phép so sánh receipt; thông báo đúng asset cần reinstall, dùng nguyên cơ chế notification hiện tại.
- README mô tả installer Antigravity đã có, vị trí asset, verification và uninstall; có hướng dẫn **optional** bằng tiếng Anh để user copy global rule khi muốn tạo artifact từ prompt thông thường, không tag skill.
- README có mẹo optional cấp quyền cho MCP server nhằm giảm hỏi quyền lặp lại. Installer không thay global rules hoặc approval policy.
- Tài liệu kỹ thuật phản ánh client/skill target thứ ba; handoff phân biệt automated checks với kiểm chứng Extension Host/client thật.

Độ khó thấp; thay đổi code chính ở hai module notification/target selection. Hồi quy cần quan tâm là lựa chọn skill target, thứ tự stale assets và việc suppress cùng fingerprint sau `Later` đối với Agents/Claude hiện có.

**Không làm:** auto-upgrade, driver `upgrade()`, saved-client list, global-rule installer/checker, approval-policy writer, tool allowlist/eager declarations, version bump hoặc refactor installer/lifecycle. Không sửa lại Phase 1 chỉ để đổi style.

## 2. Hiện trạng đã xác minh

Các đường dẫn source dưới đây tính từ root repository `D:/workspace/my-projects/ai-artifacts`.

| Component | Hiện trạng và công việc còn lại |
| --- | --- |
| `src/extension/mcp-clients/antigravity-client.ts` | Đã có driver với config `.gemini/config/mcp_config.json`, hai skill `.gemini/config/skills/`, timeout 3600, detect/install/check/uninstall. Phase 2 tái sử dụng, không viết lại. |
| `src/extension/mcp-clients/index.ts`, `workspace-integration.ts`, `extension.ts`, `package.json` | Worktree đã có factory, command install/uninstall, install/check All và ghi receipt Antigravity sau verify. Đây là implementation hiện có, chưa phải kết luận review Phase 1 đã đạt. |
| `src/shared/contracts.ts` | Receipt đã có optional `antigravity` trong map dùng chung cho `skills` và `sessionSkills`; không cần đổi schema hoặc version nữa. |
| `src/extension/workspace-integration.ts:getDetectedSkillTargets` | Hiện chỉ trả `agents` và thêm `claude` khi detected; chưa xét Antigravity. |
| `src/extension/upgrade-notification.ts` | `StaleIntegrationAsset` đã có hai literal Antigravity, nhưng `requiredSkillTargets` vẫn bỏ Antigravity; `assetLabel` chưa có nhãn tương ứng. Fingerprint đã dùng bundled versions + exact stale-asset array. |
| `src/extension/extension.ts` | Activation đã gọi `maybeShowUpgradeNotification` với `getDetectedSkillTargets()`, receipt reader, globalState và install-and-verify wrapper. Không cần thêm activation entrypoint. |
| `test/upgrade-notification.test.ts` | Có test current/stale receipt, `Later`, partial install, session skill, action/error handling và source wiring. Chưa có behavior test Antigravity. |
| README và các docs kỹ thuật | Còn mô tả sáu client và hai skill targets `.agents`/`.claude`; cần cập nhật đúng phần bị ảnh hưởng. |

Trước khi sửa, coder xem lại diff hiện tại. Nếu Phase 1 đang được coder khác sửa tiếp, chỉ điều chỉnh patch theo source mới và báo khác biệt ảnh hưởng plan; không rollback hoặc ghi đè phần của người khác.

## 3. Thứ tự triển khai code

### Bước 1 — Chọn skill target từ detector

Trong `workspace-integration.ts`, mở rộng `getDetectedSkillTargets()`:

1. Luôn có `agents`, giữ hành vi hiện tại.
2. Nếu `new ClaudeClientDriver().isDetected()` thì thêm `claude`.
3. Nếu `new AntigravityClientDriver().isDetected()` thì thêm `antigravity`.
4. Trả thứ tự cố định `agents`, `claude`, `antigravity`; không đọc danh sách client đã lưu hoặc tự cài gì từ hàm này. Import Antigravity đã có từ Phase 1.

Detection dùng đúng driver hiện có, không tạo detector thứ hai dựa trên skill directory/global rule. Không đổi signature hàm hoặc shape receipt.

### Bước 2 — Tính stale assets và nhãn

Trong `upgrade-notification.ts`:

- Mở rộng `requiredSkillTargets()` để luôn trả `agents`, thêm `claude`/`antigravity` nếu input có target tương ứng, theo thứ tự cố định như trên. Input có thứ tự khác hoặc lặp target không được tạo fingerprint khác hay stale entry trùng. Dùng các nhánh `includes` đơn giản; không tạo registry hoặc migration layer.
- Giữ vòng so sánh `computeStaleIntegrationAssets`: với mỗi target, review skill trước, Session skill sau. `mcp` vẫn đứng đầu nếu stale.
- Review receipt Antigravity so với `bundledVersions.skillVersion`; Session receipt so với `sessionSkillVersion`. Nếu không truyền Session version thì giữ hành vi bỏ qua Session skill hiện tại.
- Thiếu/mismatch entry Antigravity là stale khi client được chọn. Receipt cũ không có key mới vẫn valid và chỉ tạo stale cho target cần thiết. Antigravity không detected thì không yêu cầu receipt Antigravity, dù file receipt còn key từ lần cài trước.
- Thêm hai nhãn rõ ràng trong `assetLabel`: `Antigravity review skill (.gemini/config)` và `Antigravity work session skill (.gemini/config)`. Giữ nguyên nhãn Agents/Claude hiện có; không để fallback Claude gán nhầm asset Antigravity.

### Bước 3 — Giữ nguyên notification lifecycle

Không đổi globalState key, state shape, thao tác persist, buttons hoặc action routing:

- State tiếp tục là bundled versions và exact stale-asset array. Không thêm package version, client list, timestamp hoặc global-rule state.
- Cùng fingerprint sau `Later` không hiện lại. Thay đổi stale set hoặc bundled asset version vẫn tạo trạng thái mới theo cơ chế hiện tại.
- All-current cập nhật state theo flow hiện có và không hiện popup.
- `Run Installer` vẫn gọi wrapper Install All + Verify All đang được activation truyền vào. Không tự chạy installer khi activation, không bỏ bước chọn action.
- `View Installation Guide`, dismiss và error containment giữ nguyên. Không cần sửa `extension.ts` nếu wiring hiện tại còn đúng.

## 4. Nội dung README và các docs liên quan

### 4.1. Cập nhật phần installer trong README

Sửa các đoạn liên quan, không viết lại toàn bộ README:

- Compatibility table: thêm Antigravity với MCP config và hai skill; không gọi là manual-only vì command đã có ở Phase 1.
- Getting started: thêm `AI Artifacts: Install Integration for Antigravity`; nêu Install All cũng cấu hình client khi detected.
- Installed locations: nêu config global `~/.gemini/config/mcp_config.json`, hai skill `~/.gemini/config/skills/create-review-artifact/` và `~/.gemini/config/skills/work-session/`, runtime dùng chung. Nếu đang liệt kê shared/Claude skill locations thì bổ sung các sibling Session skill còn thiếu để cách mô tả hai skill nhất quán.
- Customization/receipt: thêm Antigravity là target độc lập, dùng cùng version source; review customization giữ từ chính target, Session skill là official replacement.
- Compatibility and upgrades: mô tả cả hai skill Antigravity tham gia receipt/notification khi detected; extension-only update không tự buộc reinstall.
- Uninstall: thêm command Antigravity và hai managed skill paths. Giữ rõ dữ liệu artifact/session và global rules do user quản lý được bảo toàn.

Không claim `Ready` chứng minh global rule đã được load, approval policy đúng hoặc workflow client thật đã chạy. `Ready` là asset/config verification hiện có.

### 4.2. Hướng dẫn optional global rule — chỉ trong README

Thêm subsection riêng cho Antigravity, đặt cạnh hướng dẫn installer và có link nội bộ nếu cần từ troubleshooting. Viết phần hướng dẫn bằng tiếng Anh, thể hiện đủ:

1. MCP và hai skill được installer quản lý; global rule bên dưới do user tự chọn và tự quản lý.
2. Muốn tạo artifact từ prompt thông thường mà không tag/invoke skill, user có thể thêm rule ưu tiên AI Artifacts thay workflow artifact mặc định. Không có rule không phải lỗi installer và không ngăn dùng skill tường minh.
3. Cách ưu tiên: tạo `~/.gemini/config/rules/ai-artifacts.md`, copy nguyên block sau.

```markdown
---
trigger: always_on
---

# Artifact Creation Policy

- For every explicit request to create an artifact, use the
  `create-review-artifact` skill through the `ai_artifacts` MCP server.
- Do not use Antigravity's built-in artifact creation workflow
  for these requests.
```

4. Cách thay thế: thêm phần Markdown bắt đầu từ `# Artifact Creation Policy` vào `~/.gemini/GEMINI.md`, bỏ ba dòng YAML đầu và giữ nguyên rules đã có. Hai cách là lựa chọn thay thế, không yêu cầu làm cả hai.
5. Rule chỉ áp dụng khi có explicit artifact request; không biến mọi yêu cầu viết plan/document thành artifact. Giữ mẫu ngắn như trên, không copy skill instructions, các lệnh thực thi hoặc hardcoded `brain/` policy vào rule.
6. Không tự sửa file `artifact-review-policy.md` đang có trên máy Chú, không tạo rule thật để hoàn thành docs, không thêm rule vào packaged skills.

Link [Antigravity rules](https://antigravity.google/docs/rules) để giải thích modular rules cần `trigger` hợp lệ; `GEMINI.md` không cần frontmatter. Không đưa token-budget discussion vào hướng dẫn setup.

### 4.3. Mẹo quyền gọi MCP — chỉ trong README

Trong Verification/Troubleshooting, thêm đoạn ngắn optional:

- MCP calls có thể cần user approval theo permission policy của Antigravity. Nếu user tin cậy server và muốn giảm prompt lặp lại giữa các vòng review, có thể cấu hình Allow cho server `ai_artifacts`; pattern được tài liệu hóa là `mcp(ai_artifacts/*)`.
- Pattern trên là giá trị policy, không phải JSON server field hoặc shell command. Không hướng dẫn thêm nó vào `mcp_config.json` hoặc bật Turbo/global allow cho tất cả server.
- Link [MCP permissions](https://antigravity.google/docs/mcp#mcp-permissions-and-access-control). Không khẳng định nút luôn tên `Always Allow` nếu chưa kiểm chứng đúng phiên bản/surface client; dùng wording theo permission policy.
- Đây là lựa chọn của user. Installer không tự ghi policy; cấp quyền gọi tool không thay thế các thao tác Review/Proceed trong AI Artifacts.

Không thêm settings/command hoặc logic runtime để kiểm tra hay ép người dùng tạo rule/cấp quyền. Hướng dẫn thao tác global rule và approval chỉ xuất hiện trong README; không nhân bản snippet sang skill, UI hoặc các docs kỹ thuật khác.

### 4.4. Đồng bộ tài liệu kỹ thuật và changelog

Chỉ cập nhật các đoạn đang liệt kê client/targets hoặc mô tả luồng bị thay đổi:

| File | Nội dung cần đồng bộ |
| --- | --- |
| `docs/ARCHITECTURE.md` | Ba skill targets, receipt riêng sau verification, detection và notification cho Antigravity, customization độc lập. |
| `docs/INSTRUCTION.md` | Ownership map driver Antigravity và invariant receipt/skill targets đang ghi chỉ Agents/Claude. |
| `docs/COMPONENTS.md` | Integration Manager, client drivers, asset paths/receipt và dòng test coverage đang ghi six-client. |
| `docs/PHILOSOPHY.md` | Các đoạn compatibility/customization còn ghi hai targets; chỉ bổ sung target mới, không đổi product/lifecycle philosophy. |
| `CHANGELOG.md` | Ghi feature hỗ trợ installer Antigravity và notification vào phần unreleased hiện có. Không tạo release/version mới. |
| `docs/CHANGE_LOGS.md` | Ghi ngày, thay đổi notification/docs và kết quả validation thực tế; không ghi test chưa chạy là passed. |

Không sửa contract/skill assets vì feature này không thay MCP protocol hoặc lifecycle. Không phát sinh bump `MCP_VERSION`, `CREATE_REVIEW_ARTIFACT_SKILL_VERSION`, `WORK_SESSION_SKILL_VERSION`, package version hoặc schema version.

## 5. Kiểm chứng cho coder

### 5.1. Automated tests

Thêm test behavior vào các file hiện có, dùng temporary home/mocks, không gọi installer lên home thật:

| File | Kịch bản cần có |
| --- | --- |
| `test/workspace-integration.test.ts` | `getDetectedSkillTargets` trả Agents-only khi không có dấu hiệu client; thêm Antigravity khi có config hoặc thư mục detector; Claude + Antigravity cùng có mặt vẫn trả đúng thứ tự. Cô lập `os.homedir()` và restore mock sau test. |
| `test/upgrade-notification.test.ts` | Chỉ thiếu review receipt Antigravity, chỉ thiếu Session receipt, thiếu cả hai; assert exact stale array và hai nhãn đúng, không lẫn Claude. Các asset còn lại đặt current để test thực sự chứng minh selection mới. |
| Cùng file | Current ở cả ba targets thì không popup; Antigravity không selected thì bỏ qua receipt Antigravity thiếu/stale; không truyền Session version thì giữ semantics cũ. |
| Cùng file | Selected targets trùng/đảo thứ tự vẫn tạo canonical array `agents`, `claude`, `antigravity`, không entry trùng. |
| Cùng file | Với Antigravity stale, cùng fingerprint sau `Later` bị suppress; partial install làm stale set đổi thì hiện lại; sửa đủ receipt thì current và không popup. |
| Cùng file | `Run Installer` với Antigravity stale gọi dependency installer đúng một lần; không có action thì không gọi. Giữ các test wiring/error containment hiện có. |

Giữ regression Agents/Claude và các test Phase 1. Không thêm brittle test so nguyên câu prose README, test token budget hoặc mô phỏng approval engine bên ngoài. Nếu doc-contract test hiện có cần điều chỉnh, chỉ sửa assertion phản ánh contract thực sự thay đổi; không hạ các assertion version/lifecycle hiện hành.

Focused validation:

```powershell
npm.cmd run build:integration
npx.cmd vitest run test/upgrade-notification.test.ts test/workspace-integration.test.ts test/mcp-client-drivers.test.ts test/release-contract.test.ts test/integration-verification.test.ts
```

Trước bàn giao:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
git diff --check
```

Kiểm tra trực tiếp README render: code block tiếng Anh copy đủ frontmatter, đường dẫn/link đúng và cách dán GEMINI.md không yêu cầu frontmatter. Không cần framework test Markdown mới.

### 5.2. Smoke test Extension Host / Antigravity

Thực hiện trên môi trường thử nghiệm khi có thể; không tự sửa global rule hoặc approval policy thật của Chú. Khi cần thao tác user trong client, bàn giao checklist và ghi kết quả Chú xác nhận.

1. Cài qua command Antigravity mới, Verify All hiển thị đúng status, MCP kết nối và hai skill được discover sau restart/new chat.
2. Với receipt thử nghiệm thiếu phiên bản một skill Antigravity, reload extension: notification nêu đúng skill; `Run Installer` cài/verify được. Reload lại khi current không hiện popup. Chỉ thay receipt trong temporary test home.
3. Dùng skill tường minh để tạo một artifact thử nghiệm, gửi Review, xác nhận agent nhận feedback và tiếp tục cùng artifact; kết nối Work Session bằng skill còn lại.
4. Nếu user chọn dùng global rule, áp dụng đúng một trong hai cách README và thử prompt tiếng Anh không tag skill: `Create a review artifact for this API design.` Kết quả cần là artifact qua AI Artifacts MCP; không yêu cầu task không xin artifact phải tạo artifact.
5. Mẹo approval là optional: nếu user thử cấu hình Allow cho server, ghi lại surface/version và kết quả giảm prompt. Không coi việc user giữ Ask là lỗi hoặc tiêu chí chặn feature.

Kết quả test copy config/skills thủ công Chú đã báo là baseline, không thay thế kiểm chứng từ installer mới. Nếu không có điều kiện chạy client thật, ghi rõ `Not run` và checklist còn lại; không kết luận đã đạt runtime acceptance.

## 6. Handoff và điều kiện hoàn tất

- Code chọn và so sánh Antigravity đúng; notifications vẫn dùng receipt/fingerprint, `Run Installer`, `Later` và cơ chế lỗi hiện tại. Không lẫn implementation auto-upgrade.
- README có installer chính thức, global-rule snippet tiếng Anh optional ở file riêng hoặc GEMINI.md, cùng mẹo approval optional. Các hướng dẫn này không được biến thành installer behavior hoặc điều kiện `Ready`.
- Docs kỹ thuật và changelog nhất quán với ba skill targets, không bump version hoặc đổi protocol.
- Báo cáo gồm diff thuộc Phase 2, lệnh/kết quả automated checks, docs verification và smoke test đã làm/chưa làm. Phân biệt hoàn tất code/docs với nghiệm thu client thật còn pending.
- Giữ nguyên code/dirty changes Phase 1. Chỉ sửa thêm ngoài phạm vi nếu có yêu cầu riêng từ Chú; không tự làm auto-upgrade sau phase này.
- Nếu thực hiện trong Work Session với plan artifact đã được chỉ định, dùng handoff **Review** theo Instructions; không tự suy ra artifact handle từ file Markdown này và không takeover waiter của người khác.
