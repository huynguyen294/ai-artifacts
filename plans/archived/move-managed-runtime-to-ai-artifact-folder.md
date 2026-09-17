# Consolidate Installer Assets under `~/.ai-artifacts`

## 1. Mục tiêu

Chuyển các tài sản do AI Artifacts quản lý ra khỏi `~/.vscode/ai-artifacts/` và đặt chúng dưới một subtree có ownership rõ ràng trong `~/.ai-artifacts/`.

Layout đích:

```text
~/.ai-artifacts/
├─ artifacts/                                  # dữ liệu review của user; luôn giữ lại
└─ managed/                                    # extension sở hữu; được phép xóa
   ├─ runtime/
   │  └─ ai-artifacts-review-mcp.mjs
   └─ workspaces/                              # workspace heartbeat registry tạm thời

~/.agents/skills/create-review-artifact/       # skill do extension cài; giữ convention của AI clients
```

Khi uninstall integration hoặc extension:

- Xóa chính xác `~/.ai-artifacts/managed/`.
- Xóa skill do extension cài tại `~/.agents/skills/create-review-artifact/`.
- Xóa MCP configuration do extension quản lý trong từng supported client.
- Xóa legacy assets tại `~/.vscode/ai-artifacts/`.
- Không xóa, đổi tên, migrate hay sửa bất kỳ nội dung nào trong `~/.ai-artifacts/artifacts/`.
- Không xóa toàn bộ `~/.ai-artifacts/`, kể cả khi `managed/` đã trống.

## 2. Phạm vi

### Trong scope

- Shared canonical path helpers cho root, artifact collection và managed assets.
- MCP runtime install/reinstall/check tại path mới.
- Workspace registry publish/read tại path mới.
- Cấu hình của Codex, Cursor, Claude Code, Windsurf và GitHub Copilot trỏ tới runtime mới.
- Uninstall/cleanup chỉ xóa extension-owned assets và giữ nguyên artifact data.
- Legacy cleanup cho `~/.vscode/ai-artifacts/`.
- POSIX permission, path-safety, rollback, tests, docs và release validation liên quan.

### Ngoài scope

- Không đổi schema artifact v5 hoặc lifecycle semantics.
- Không di chuyển artifact hiện có khỏi `~/.ai-artifacts/artifacts/`.
- Không chuyển skill khỏi `~/.agents/skills/`; đây là discovery convention của AI clients.
- Không triển khai khả năng AI yêu cầu VS Code mở lại artifact. Tính năng đó cần MCP-to-extension request channel riêng và sẽ dùng một plan khác.
- Không thêm compatibility cho schema v3/v4 hoặc workspace-local artifacts.
- Không mở rộng support sang Remote SSH, WSL, container, Codespaces hoặc split-host filesystem.

## 3. Hiện trạng đã xác minh

- Artifact user data hiện ở `~/.ai-artifacts/artifacts/`.
- MCP runtime hiện được cài vào `~/.vscode/ai-artifacts/ai-artifacts-review-mcp.mjs`.
- Workspace registry hiện ở `~/.vscode/ai-artifacts/workspaces/`.
- Skill hiện ở `~/.agents/skills/create-review-artifact/`.
- `cleanupBaseMcpServer` hiện xóa toàn bộ `~/.vscode/ai-artifacts/` và managed skill.
- Client verification so sánh exact configured runtime path, nên client còn trỏ path cũ có thể được phân loại `outdated` sau cutover.
- Product hiện yêu cầu reinstall integrations và restart AI client sau extension upgrade; plan không duy trì mixed-version runtime compatibility.

`plans/installer.md` chỉ là implementation plan. Không được xem nội dung plan là bằng chứng rằng code đã thay đổi hoặc release gate đã pass.

## 4. Architecture decisions

### 4.1. Một root, hai ownership boundary

`~/.ai-artifacts` là product root nhưng không phải một đơn vị có thể xóa nguyên khối:

- `artifacts/` là persistent user data.
- `managed/` là extension-owned runtime/transient data.

Mọi cleanup phải nhắm tới exact managed subtree. Không API nào được nhận `~/.ai-artifacts` làm recursive delete target.

### 4.2. Shared path source of truth

Không tiếp tục tự ghép path riêng trong installer và registry. Shared layer phải cung cấp các helper có injectable `userHome` cho test:

```text
aiArtifactsRoot({ userHome? })
artifactCollectionRoot({ userHome? })
managedAssetsRoot({ userHome? })
managedRuntimeDirectory({ userHome? })
managedMcpScriptPath({ userHome? })
managedWorkspaceRegistryDirectory({ userHome? })
```

`globalArtifactsRoot` có thể được giữ làm compatibility alias nội bộ trong một release nếu đổi tên tạo diff không cần thiết, nhưng phải resolve từ cùng `aiArtifactsRoot` thay vì tự ghép path lần nữa.

`CODEX_ARTIFACTS_REGISTRY_DIRECTORY` vẫn là test/diagnostic override. Production mặc định luôn dùng managed workspace registry path.

### 4.3. Permission boundary

Trên POSIX:

- `~/.ai-artifacts`, `artifacts`, `managed`, `runtime`, `workspaces` dùng `0700`.
- MCP runtime, registry snapshots và atomic staging files dùng `0600`.
- Existing managed paths có group/other bits phải được siết permission hoặc fail trước khi thay đổi managed state.

Trên Windows tiếp tục dựa vào inherited ACL; không giả lập hoặc tuyên bố POSIX mode guarantee.

### 4.4. Cutover policy

- Đây là hard path cutover, không phải live migration của một MCP process đang chạy.
- Sau update, user phải chạy **AI Artifacts: Install All Detected Integrations**, restart AI client và mở chat mới.
- Runtime mới được ghi atomically trước khi bất kỳ client config nào trỏ tới nó.
- Legacy runtime không được xóa trước khi các detected clients đã được cập nhật và verify thành công.
- Individual-client install không được xóa legacy base directory vì client khác có thể vẫn trỏ path cũ.
- Install-all có thể xóa legacy base directory sau khi toàn bộ detected clients verify path mới. Nếu không chứng minh được điều này, giữ legacy residue và để uninstall dọn sau; residue an toàn hơn làm hỏng client.
- Uninstall luôn thử xóa cả new managed subtree và legacy base directory nhưng không được chạm artifact collection.

### 4.5. Release/version assumption

Plan giả định thay đổi được đưa vào trước khi `1.0.0` được publish. Nếu `1.0.0` đã publish trước lúc triển khai, phải chọn version release mới và cập nhật changelog thay vì thay đổi artifact đã phát hành.

## 5. Components sẽ sửa

### Shared paths và permissions

- `src/shared/artifact-files.ts`
- `src/shared/artifact-validation.ts` nếu cần tái sử dụng owner-only directory/file helpers
- `src/shared/workspace-registry.ts`

### Installer, verification và uninstall

- `src/extension/workspace-integration-v4.ts`
- `src/extension/mcp-clients/base-cleanup.ts`
- `src/extension/extension.ts` cho user-facing path/status message
- `src/extension/mcp-clients/*` chỉ nơi exact runtime path hoặc verification contract cần cập nhật
- `src/extension/uninstall-entry.ts` nếu cleanup result/reporting cần chi tiết hơn

### Tests

- `test/global-artifact-path.test.ts`
- `test/workspace-registry.test.ts`
- `test/workspace-integration.test.ts`
- `test/mcp-client-drivers.test.ts`
- `test/mcp-config.test.ts`
- `test/release-contract.test.ts`
- Focused test mới chỉ khi ownership/delete boundary không phù hợp với các file hiện có

### Docs và release notes

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/COMPONENTS.md`
- `docs/INSTRUCTION.md`
- `docs/PHILOSOPHY.md` chỉ nếu ownership/lifetime wording cần đồng bộ
- `docs/CHANGE_LOGS.md`
- `CHANGELOG.md`

Skill và artifact contract không cần sửa nếu không nhắc tới physical runtime/registry path.

## 6. Kế hoạch triển khai

### Phase 0 — Baseline và delete-boundary freeze

#### Mục tiêu

Khóa hiện trạng và acceptance criteria trước khi đổi path.

#### Thực hiện

1. Ghi nhận checkpoint commit, `git status --short` và mọi dirty file có sẵn.
2. Xác nhận `~/.ai-artifacts/artifacts/` là canonical artifact collection duy nhất.
3. Liệt kê mọi active source/docs/test còn chứa `~/.vscode/ai-artifacts`.
4. Xác nhận các lệnh install, verify và uninstall của năm clients đang dùng `getBaseIntegrationPaths` hoặc exact runtime path được truyền từ installer.
5. Tạo isolated-home fixture chứa:
   - artifact data với nội dung/hash đã biết;
   - new managed assets;
   - legacy runtime assets;
   - unrelated sibling file dưới `~/.ai-artifacts`;
   - managed skill và unrelated skill.
6. Không đọc, sửa hoặc xóa real `~/.ai-artifacts` trong automated test.

#### Verification

- Baseline `npm.cmd run check` và focused integration tests pass.
- Static inventory không bỏ sót active `.vscode/ai-artifacts` producer/consumer.
- Fixture ghi lại SHA-256 của artifact files trước cleanup.

#### AI evaluation

- Ghi `PASS` chỉ khi baseline xanh và exact delete targets đã được liệt kê.
- Dừng nếu path ownership còn mơ hồ hoặc có code recursive-delete product root.
- Không sửa code production trong Phase 0.

### Phase 1 — Shared canonical path contract

#### Mục tiêu

Tạo một source of truth cho product root, persistent data và managed assets.

#### Substep 1A — Path helpers

1. Thêm canonical root/path helpers với optional absolute `userHome`.
2. Cho artifact collection và workspace registry derive từ cùng root.
3. Giữ registry environment override cho isolated MCP tests.
4. Xóa hoặc deprecate alias `aiArtifactsDataDirectory`/`codexArtifactsDataDirectory` đang trả về `.vscode`; không để tên mới che giấu legacy path.
5. Không đổi artifact handle hoặc schema.

Focused verification:

```powershell
npm.cmd exec vitest run test/global-artifact-path.test.ts test/workspace-registry.test.ts
npm.cmd run check
```

Acceptance:

- Với cùng `userHome`, mọi helper trả về exact subtree dưới `~/.ai-artifacts`.
- Relative home bị reject.
- Artifact collection và managed root là siblings, không lồng vào nhau.
- Registry override không làm thay đổi artifact collection.

#### Substep 1B — Permission helpers

1. Dùng chung owner-only directory/file helpers thay vì duplicate mode logic.
2. Registry atomic write tạo temp/final file `0600` trên POSIX.
3. Managed directory creation siết `0700` trên POSIX.
4. Windows tests đánh dấu permission assertions là not-applicable.

Focused verification:

```powershell
npm.cmd exec vitest run test/global-artifact-path.test.ts test/workspace-registry.test.ts
```

Acceptance:

- POSIX tests kiểm tra cả initial create và tightening existing broad modes.
- Failure siết permission xảy ra trước managed write.
- Không có test nào dùng Windows mode bits làm POSIX evidence.

#### Phase 1 evaluation

- Chưa merge/release Phase 1 độc lập nếu installer, MCP bundle và extension vẫn dùng path cũ.
- Phase 1 chỉ là nền tảng của cùng atomic cutover unit với Phase 2.
- Stability target: `3/5`; shared contract đúng nhưng end-to-end chưa cutover.

### Phase 2 — Atomic installer/registry/uninstall cutover

Phase 2 cùng Phase 1 là một release/commit unit. Không để production branch ở trạng thái extension publish registry tại path mới trong khi installed MCP/config vẫn chỉ biết path cũ.

#### Substep 2A — Provision runtime tại managed path

1. `getBaseIntegrationPaths` derive runtime và workspaces từ shared helpers.
2. Target runtime trở thành:

   ```text
   ~/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs
   ```

3. Validate packaged MCP và skill assets trước mutation.
4. Tạo managed directories bằng owner-only helpers.
5. Ghi runtime atomically; final runtime là `0600` trên POSIX.
6. Giữ exact skill replacement/rollback hiện có tại `~/.agents/skills/create-review-artifact`.
7. `baseScriptIsCurrent`, `baseAssetsAreCurrent` và integration status dùng path mới.

Focused verification:

```powershell
npm.cmd exec vitest run test/workspace-integration.test.ts test/mcp-client-drivers.test.ts
npm.cmd run check
```

Acceptance:

- Fresh install tạo đúng managed layout.
- Reinstall idempotent khi bytes không đổi.
- Stale runtime/skill trả về `outdated`; reinstall đưa về `ready`.
- Injected runtime-write failure không sửa client config và không chạm artifacts.

#### Substep 2B — Cut over five client configs

1. Codex, Cursor, Claude Code, Windsurf và Copilot nhận exact new runtime path.
2. Preserve unrelated MCP servers, properties, hooks và user config.
3. Codex tool allowlist/lifecycle contract không đổi trong plan này.
4. Verify config sau mỗi atomic client write.
5. `Install All Detected Integrations` chỉ cleanup legacy base directory sau khi mọi detected client đã verify `ready` với runtime mới.
6. Nếu một client install/verify fail:
   - báo rõ client lỗi;
   - không xóa legacy runtime;
   - không rollback client đã thành công về path cũ nếu rollback không được chứng minh an toàn;
   - lần chạy lại phải hội tụ idempotently về toàn bộ clients `ready`.
7. Individual-client install luôn giữ legacy directory; cleanup deferred tới successful install-all hoặc uninstall.

Focused verification:

```powershell
npm.cmd exec vitest run test/mcp-config.test.ts test/mcp-client-drivers.test.ts test/workspace-integration.test.ts
```

Acceptance:

- Cả năm client fixtures trỏ path mới.
- Partial multi-client failure giữ legacy runtime và artifacts.
- Rerun sau failure hoàn tất mà không tạo duplicate config.
- Static search không còn active config expectation trỏ `.vscode/ai-artifacts`; path cũ chỉ còn trong explicit legacy cleanup/migration tests và release notes.

#### Substep 2C — Workspace registry cutover

1. Extension publisher ghi snapshots vào:

   ```text
   ~/.ai-artifacts/managed/workspaces/
   ```

2. Bundled MCP reader dùng cùng shared helper/path.
3. Heartbeat TTL, focused-window scoping và evidence semantics không đổi.
4. Snapshot disposal chỉ xóa exact instance file, không xóa registry directory hoặc sibling managed assets.
5. Không dual-publish registry sang `.vscode`; upgrade contract vẫn yêu cầu reinstall/restart.

Focused verification:

```powershell
npm.cmd exec vitest run test/workspace-registry.test.ts test/review-wait-mcp.test.ts test/workspace-integration.test.ts
```

Acceptance:

- Publisher và bundled MCP đọc/ghi cùng path trong isolated home.
- Resolver/create round trip hoạt động sau install.
- Stale/ambiguous/cross-window rules giữ nguyên.
- Artifact create vẫn lưu dưới `artifacts/`, không dưới `managed/`.

#### Substep 2D — Safe uninstall và legacy cleanup

1. `cleanupBaseMcpServer` chỉ derive và xóa các exact targets:
   - `~/.ai-artifacts/managed/`;
   - `~/.vscode/ai-artifacts/` legacy directory;
   - current/legacy managed skill directories.
2. Cleanup không nhận product root hoặc artifact collection làm target.
3. Dùng `lstat`/equivalent để xử lý symlink/junction fail-closed; recursive cleanup không được follow một managed link vào `artifacts/` hoặc outside path.
4. Uninstall client configs trước, sau đó cleanup managed assets.
5. Một target cleanup fail không ngăn best-effort cleanup targets còn lại; kết quả/log phải nêu partial failure.
6. Không xóa empty `~/.ai-artifacts` root sau cleanup.
7. Không xóa unrelated sibling files hoặc unrelated skills.

Focused verification:

```powershell
npm.cmd exec vitest run test/mcp-client-drivers.test.ts test/workspace-integration.test.ts
```

Acceptance:

- Artifact tree SHA-256 trước/sau uninstall giống hệt.
- New managed subtree và legacy base directory biến mất.
- Product root, artifact collection, unrelated sibling file và unrelated skill còn nguyên.
- Uninstall lần hai không throw và không thay đổi user data.
- Linked/junction managed target không dẫn tới deletion bên ngoài exact managed path.

#### Substep 2E — Atomic integration gate

Chạy một isolated full lifecycle fixture:

1. Fresh home có pre-existing artifact data.
2. Cài toàn bộ năm clients.
3. Verify runtime/skill/client status `ready`.
4. Publish workspace registry tại path mới.
5. MCP resolve workspace và create artifact mới.
6. Store load/comment/submit; MCP wait/inspect/advance theo regression coverage hiện có.
7. Reinstall và verify idempotency.
8. Uninstall toàn bộ integrations.
9. Xác nhận managed/legacy/skill assets bị xóa và mọi artifact trước/sau test còn nguyên.

Full phase gate:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
git diff --check
```

Phase 2 evaluation:

- `PASS` chỉ khi producer, consumer, client config, registry, cleanup và contract tests cùng xanh.
- Không cho phép “runtime path mới nhưng registry path cũ” hoặc ngược lại tồn tại trong active source.
- Không dùng real user home làm fixture.
- Stability target: `4/5`; code cutover hoàn tất, còn docs/package/manual validation.

### Phase 3 — Docs, package và release validation

#### Substep 3A — Documentation synchronization

Update:

- README install layout, verify labels, upgrade và uninstall behavior.
- Architecture ownership boundary và deployment filesystem paths.
- Components installer/registry responsibilities.
- Instruction invariant từ “preserve toàn bộ `~/.ai-artifacts/`” thành:
  - preserve `~/.ai-artifacts/artifacts/`;
  - only exact `~/.ai-artifacts/managed/` is removable managed state.
- Architecture decision trong `docs/CHANGE_LOGS.md`.
- Release note trong `CHANGELOG.md`.

Docs không được tuyên bố artifact data bị xóa cùng extension. Không còn gọi managed runtime là “Base (.vscode)”.

#### Substep 3B — Package/static gate

1. Build/package VSIX từ source.
2. Xác nhận bundled MCP và skill khớp source.
3. Static search:
   - new managed runtime/workspace paths có trong expected source/docs/tests;
   - `.vscode/ai-artifacts` chỉ còn trong legacy cleanup, migration regression và lịch sử có chủ đích;
   - không recursive-delete `~/.ai-artifacts` root;
   - không package artifact fixture hoặc user data.
4. Dependency audit giữ policy release hiện tại.

Commands:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd run package
npm.cmd audit --omit=dev
git diff --check
```

#### Substep 3C — Manual gate

Manual gate dùng packaged VSIX và không yêu cầu Chú viết lệnh:

1. Cài/reinstall all detected integrations.
2. Mở status và xác nhận Base/Runtime cùng Skill là `Ready`.
3. Kiểm tra một client config đang dùng path dưới `.ai-artifacts/managed/runtime/`.
4. Restart AI client, tạo một artifact và xác nhận lifecycle hoạt động.
5. Uninstall integrations hoặc extension.
6. Xác nhận artifact vừa tạo vẫn còn và mở được sau khi cài lại extension.
7. Xác nhận managed runtime/workspace registry đã bị xóa.

Nếu manual uninstall trên real profile có rủi ro, AI phải chuẩn bị disposable VS Code profile/home. Không được đổi tên hoặc xóa real artifact root để mô phỏng fresh home.

#### Phase 3 evaluation

- Automated gate: PASS.
- Package/static gate: PASS.
- Owner-confirmed manual install/create/uninstall/data-retention: PASS.
- Docs phản ánh đúng current code và cleanup boundary.
- Stability target: `5/5`.

## 7. Test matrix bắt buộc

| Case | Automated | Manual | Acceptance |
| --- | --- | --- | --- |
| Fresh install | Yes | Yes | Runtime/registry ở managed path; clients ready |
| Reinstall unchanged | Yes | Optional | Idempotent, không rewrite ngoài managed assets |
| Stale runtime/skill | Yes | No | Detect outdated và converge về ready |
| Five-client config | Yes | One real client minimum | Exact new runtime path, unrelated config preserved |
| Partial client install failure | Yes | No | Legacy runtime giữ lại; artifacts untouched |
| Registry resolve/create | Yes | Covered by E2E | Publisher và MCP dùng cùng new path |
| Uninstall | Yes | Yes | Managed + legacy assets removed |
| Artifact retention | Yes, byte/hash exact | Yes | `artifacts/` tồn tại và nội dung không đổi |
| Unrelated sibling/skill | Yes | No | Không bị xóa |
| Double uninstall | Yes | No | Idempotent, no throw |
| Symlink/junction cleanup | Platform-specific | No | Không follow vào artifacts/outside |
| POSIX modes | Ubuntu CI/POSIX host | No on Windows | Dirs `0700`, files `0600` |
| Windows ACL/locked file | Yes where applicable | Optional | Fail/report safely, no artifact deletion |

## 8. AI verification protocol

Sau mỗi substep, AI phải báo theo format:

```text
Substep:
Components changed:
Automated commands actually run:
PASS/FAIL counts:
Static/path-safety checks:
Real user data touched: yes/no
Regressions or residual risks:
Manual action required from Chú:
Decision: PASS / FAIL / MANUAL_REQUIRED
Ready for next substep: YES / NO
```

Quy tắc:

- Đọc lại `AGENTS.md`, `docs/INSTRUCTION.md`, scope substep và `git status --short` trước khi sửa.
- Không ghi PASS cho command chưa chạy.
- Không dùng source inspection thay cho VS Code/manual behavior.
- Không sửa generated `dist/`, installed runtime hoặc real client config trực tiếp; sửa source rồi build/install qua product flow.
- Mọi test mutation dùng isolated home/config.
- Nếu artifact retention assertion fail, dừng ngay; đây là P0 data-loss blocker.
- Nếu client/config failure có thể làm legacy runtime bị xóa sớm, dừng Phase 2.
- Sau code change ảnh hưởng installer/uninstall, manual case liên quan phải chạy lại trước release.

## 9. Rollback và recovery

### Trước publish

- Revert atomic cutover commit.
- Rebuild VSIX.
- Reinstall integrations bằng version trước để client configs trỏ lại runtime cũ.
- Artifact schema/location không đổi nên không rollback hoặc migrate `artifacts/`.

### Install failure

- New managed runtime có thể được giữ như harmless staged/current asset.
- Legacy runtime phải còn nếu chưa verify toàn bộ detected clients ở path mới.
- Rerun install phải idempotently hoàn tất remaining clients.
- Không cleanup artifacts trong bất kỳ recovery branch nào.

### Uninstall partial failure

- Báo exact target chưa xóa.
- Cho phép chạy uninstall lại.
- Không mở rộng delete target lên parent để “dọn sạch”.
- Artifact root luôn là recovery-safe boundary và được giữ lại.

### Sau publish

- Rollback extension yêu cầu reinstall matching integrations và restart client.
- Vì artifact schema vẫn là v5 và artifact location không đổi, rollback không được xóa hoặc chuyển user artifacts.

## 10. Rủi ro chính

| Rủi ro | Mức | Mitigation |
| --- | --- | --- |
| Recursive cleanup xóa artifact data | P0 | Exact managed target, no product-root delete API, hash retention tests, symlink tests |
| Extension publisher và MCP reader lệch registry path | P0 | Shared helper, one atomic cutover unit, installed-bundle E2E |
| Client config trỏ runtime mới trước khi file tồn tại | P1 | Validate/package preflight, atomic runtime write before config mutation |
| Partial install xóa runtime cũ quá sớm | P1 | Retain legacy until all detected clients verify ready |
| Individual install làm hỏng client khác | P1 | Never cleanup legacy from individual-client flow |
| POSIX managed files quá rộng quyền | P1 | `0700`/`0600` helpers and Ubuntu CI |
| Docs tiếp tục nói uninstall giữ toàn bộ product root | P1 | Update ownership invariant and release contract tests |
| Old/manual client config còn trỏ `.vscode` | P2 | Outdated status, reinstall guidance, legacy residue until safe cleanup |

## 11. Definition of done

- Active runtime path là `~/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs`.
- Active registry path là `~/.ai-artifacts/managed/workspaces/`.
- Cả năm supported client installers/verifiers dùng runtime path mới.
- Reinstall và partial-failure recovery không xóa legacy runtime sớm.
- Uninstall xóa new managed assets, legacy `.vscode/ai-artifacts`, managed skill và owned client config.
- Uninstall không xóa `~/.ai-artifacts`, `~/.ai-artifacts/artifacts`, unrelated sibling data hoặc unrelated skills.
- Artifact contents/hash không đổi qua install, reinstall và uninstall fixtures.
- POSIX owner-only permissions pass trên Ubuntu CI; Windows boundary được ghi rõ theo inherited ACL.
- README/docs/changelog đồng bộ với code.
- Check, full tests, build, package, static audit và manual critical gate đều pass.
- Không còn P0/P1 mở cho declared local same-filesystem topology.
- Final stability: `5/5`.
