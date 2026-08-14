# @hesi/dsh-roundtable — Hesi 圆桌工作流 (DeepSeek Harness 插件)

把 Hesi 的**原创核心「圆桌工作流」**（多智能体围桌讨论 → 综合 → 裁决）作为 DSH 插件。

## 落点（DSH 形态，已校准）
- **不是**替换 `ctx.agentLoop`（DSH 官方不推荐）。而是 **service + tool 插件**：
  - 注册 `ctx.hesiRoundtable` 服务；
  - 注册 `roundtable` 工具（任意智能体/用户可调用）。
- 席位用 DSH 原生多智能体机制 `ctx.agents.create()` 拉起，由 `src/roundtable-core.js`
  驱动五阶段轮转。所有 DSH 运行时调用收口在 `src/seats.js`（薄适配层）。

## 文件
- `src/moderator.js` — 主持人/席位提示词、`[VERDICT:xxx]` 解析、验证 JSON 解析（纯函数，可移植内核）
- `src/phases.js` — 五阶段状态机（讨论→方案→实施→审核→报告）+ 议程构造（纯函数）
- `src/roundtable-core.js` — `runRoundtable` / `deriveVerify` 编排（零 DSH 依赖）
- `src/seats.js` — **DSH 适配层**（唯一 `import @deepseek-ai/*` 处）
- `src/index.js` — Service + tool 入口（`apply(ctx, config)`）
- `cordis.yml` — 组合示例

## 关键 API（已核实，基于 DSH 0.1.0-rc.5 源码）
- `ctx.agents.create({sessionId, agentOptions?, setup})` → `AgentHandle{agent,dispose}`
- `agent.followup(createUserMessage(...))` / `agent.whenIdle()` / `agent.session.events`
- 组合：`cordis.yml` 列表（profile 的 patch 层用 `- insert:` 新增 entry）

## 耦合
- 导出 `ctx.hesiRoundtable.deriveVerify(question, rounds)`，供 plan 插件的 checkpoint 软断点调用。

## 测试
- 运行时 mock 验证 18/18 通过（见仓库根 `verify/`）。
