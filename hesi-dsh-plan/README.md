# dsh-plan — Hesi 一键执行流 (DeepSeek Harness 插件)

把 Hesi 的**原创核心「一键执行流 (plan)」**作为 DSH 插件。

## 设计（已校准，对照草稿 v1 的根本修正）
- **不**整体替换 `ctx.agentLoop`，也**不**另造 plan mode。
- DSH 已内置 `ctx.planMode`（规划+审批：`/plan` 命令 + `exit_plan_mode` 工具）。
  本插件在其之上**叠加 Hesi 独有的自主执行层**：生成 → 闸门 → 逐步执行 →
  机器验证 → 失败快照回滚 → 盲审/复核。
- 所有 DSH 运行时调用收口在 `src/plan-adapter.js`（薄适配层）。

## 与圆桌的咬合（保留 Hesi 原创）
- 步骤若无机器可验证验收，`resolveCheckpoint` 会调用 `ctx.hesiRoundtable.deriveVerify`
  推导验收标准（与 Hesi 的 plan-contract checkpoint 逻辑同源）。

## 文件
- `src/plan-schema.js` — plan 数据模型 + `validatePlan` / `isMachineVerifiable`（纯函数，移植 Hesi）
- `src/plan-contract.js` — `gatePlan`（闸门①）/ `resolveCheckpoint`（checkpoint②，需 `runtime.deriveVerify`）
- `src/plan-core.js` — `runPlan` 编排（零 DSH 依赖）
- `src/plan-adapter.js` — **DSH 适配层**（`tools.execute` / `hesiRoundtable.deriveVerify` / `planMode`）
- `src/index.js` — Service + `run_plan` 工具入口
- `cordis.yml` — 组合示例（含对 `dsh-roundtable` 的依赖）

## 闸门与回滚
- `gatePlan`：plan 必须至少含一个机器可验证验收（acceptance 中 command/script/http），否则拒收（除非走人工审批）。
- 关键步骤验证失败 → `snapshot` 回滚（硬快照：`tar` 打包 scope 至 `.hesi-snapshots/`，排除 `node_modules`/`.git`，不依赖 git stash）。

## 生产护栏
- forbidden 命令名单（`rm -rf 盘根`、`git push --force`、`format` 等）+ scope 收敛（`workdir` 固定、拦盘根切换/越界绝对路径）+ 审批 fail-closed（`ctx.userQuestions`，无通道即拒绝）。
- Windows 自动使用 `tool-pwsh`（DSH 在 win32 禁用 `tool-bash`）。

## 测试
- 运行时 mock 验证通过（含 checkpoint 推导与失败回滚用例，见仓库根 `verify/`）。
