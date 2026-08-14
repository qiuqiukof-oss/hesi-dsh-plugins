# Hesi DSH Plugins

> **Hesi 出品 · 同源实现** —— 把 Hesi（浏览器里的终端 + AI 智能体中枢）的两大原创工作流
> **圆桌讨论（Roundtable）** 与 **一键执行流（Plan）** 做成 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 插件。
> 面向 DSH 生态公开，与 Hesi 个人版（开源）、企业版为同源实现（非「企业版插件的精简版」）。

两个插件均以 **service + tool** 形态工作（不替换 DSH 的 `ctx.agentLoop`，复用原生多智能体 `ctx.agents.create` 与内置 `ctx.planMode`），
所有 DSH 运行时调用收口在薄适配层（`src/seats.js` / `src/plan-adapter.js`），DSH 接口有变只需改适配层。

| 插件 | 包名 | 注册能力 |
|---|---|---|
| 圆桌讨论 | `hesi-dsh-roundtable` | `ctx.hesiRoundtable` 服务 + `roundtable` 工具 |
| 一键执行流 | `hesi-dsh-plan` | `ctx.hesiPlan` 服务 + `run_plan` 工具 |

> 两个插件**可单独使用，也可组合使用**：`hesi-dsh-plan` 独立使用时，计划步骤须机器可验证（`gatePlan` 默认要求）；
> 组合使用时，plan 的 **checkpoint 软断点**会调用 roundtable 的 `deriveVerify` 为不可验证的步骤推导验收标准（Hesi 原创联动）。

---

## 能力对比：本插件 vs Hesi 企业版

| 能力 | 本仓库（开源插件） | Hesi 企业版 |
|---|---|---|
| 圆桌讨论（多席位 / 五阶段 / 主持人裁决） | ✅ 完整 | ✅ 同源实现 + 深度集成 |
| 一键执行流（生成 / 闸门 / 执行 / 机器验证 / 回滚 / 盲审） | ✅ 完整 | ✅ 同源实现 + 更多护栏 |
| checkpoint 软断点（圆桌推导验收标准，两插件咬合） | ✅ | ✅ |
| 专家市场（447 位行业专家 persona） | ❌ 不包含 | ✅ |
| 企业连接器（60+ 第三方服务） | ❌ 不包含 | ✅ |
| 知识库 / 文件 / 讨论 / 多用户协作 | ❌ 不包含 | ✅ |
| RBAC / 审计 / 审批流 / 企业部署 | ❌ 不包含 | ✅ |
| 浏览器终端 + AI 智能体中枢 | ❌ 不包含 | ✅ |

> 需要完整工作台与生态 → 访问 [Hesi](https://github.com/qiuqiukof-oss/Hesi-Q)（开源个人版）。

---

## 快速开始（DSH profile 挂载）

前提：DSH 0.1.0-rc.5+（monorepo 构建或 CLI），任一 OpenAI 兼容 LLM（DeepSeek 官方 / AGNES / LM Studio 等）。

### 1) 安装插件到 profile

把两个插件放进 DSH profile 的依赖（`file:` 或发布后的 npm 包）：

```jsonc
// $DSH_HOME/profiles/<name>/package.json
{
  "dependencies": {
    "hesi-dsh-roundtable": "file:./hesi-dsh-roundtable",
    "hesi-dsh-plan": "file:./hesi-dsh-plan"
  },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } }
}
```

### 2) 挂载组合（patch 层新增 entry 必须用 `- insert:`）

把 `examples/hesi-profile.patch.yml` 的内容合并进 `$DSH_HOME/profiles/<name>/cordis.patch.yml`。
要点：

- 用 `- insert:` 新增 `hesi-roundtable` / `hesi-plan` 两个 entry（DSH 的 patch 只允许覆盖已存在 id）；
- `llm-pi-ai` 休眠挂载，激活需补 `providers.<name>` 手写路由；
- `agent-default-model` 指向你的 provider/model。

### 3) 运行

```sh
DSH_HOME=$DSH_HOME dsh --profile <name> "用 roundtable 工具组织一场 3 人圆桌讨论：是否应该为项目引入自动化测试？"
```

```sh
DSH_HOME=$DSH_HOME dsh --profile <name> "用 run_plan 工具制定并执行一个计划：列出当前目录下的文件和目录"
```

（已实测：本地 LM Studio 与 AGNES 云端 `agnes-2.5-flash` 均跑通圆桌与一键执行流。）

---

## 插件细节

### hesi-dsh-roundtable — 圆桌工作流

多智能体围桌讨论 → 综合 → 裁决（Hesi 原创核心）：

- **五阶段状态机**：讨论 → 方案 → 实施 → 审核 → 报告（`src/phases.js`，纯函数）；
- 主持人角色以 `[VERDICT:...]` 裁决推进、阶段汇总（`src/moderator.js`，纯函数）；
- 席位用 DSH 原生 `ctx.agents.create` 拉起（不替换 agent-loop），运行时调用收口 `src/seats.js`；
- 导出 `ctx.hesiRoundtable.deriveVerify(question, rounds)`，供 plan 插件的 checkpoint 软断点调用。

### hesi-dsh-plan — 一键执行流

在 DSH 内置 `plan-mode`（规划 + 审批）之上叠加 Hesi 独有的**自主执行层**：

- 生成（一次性 planner 席位 / 预置 JSON）→ 闸门（必须有机器可验证验收）→ 逐步执行 → 机器验证 → 关键失败快照回滚 → 盲审/复核；
- **checkpoint 软断点**：步骤无机器可验证验收时，调用圆桌 `deriveVerify` 推导（两插件咬合）；
- **生产护栏**（`plan-adapter.js` 内置）：forbidden 命令名单（`rm -rf 盘根`、`git push --force`、`format` 等）+ scope 收敛（`workdir` 固定到工作区、拦截盘根切换/越界绝对路径）+ 审批 fail-closed（`ctx.userQuestions`，无通道即拒绝）；
- Windows 平台自动使用 `tool-pwsh`（DSH 在 win32 禁用 `tool-bash`）。

---

## 安全与凭据

- **凭据不落盘**：LLM key 一律走环境变量（`apiKeyEnv`），本仓库与插件不含任何密钥；
- **命令护栏**：一键执行流内置 forbidden 名单 + scope 收敛；`requireApproval: true` 时逐步人工审批（依赖 UI 场景的 user-questions provider）；
- DSH 工具自身另带文件沙箱 + 升级审批（`sandbox_permissions`），两层叠加。

---

## 验证

`verify/` 提供适配层端口校验：用符合已核实签名的 mock ctx 实际执行真实适配器代码。

```sh
cd verify
node --import ./loader.mjs run-dsh-mock.mjs     # 运行期校验（离线、零依赖）
npx -y typescript@latest tsc --noEmit -p tsconfig.verify.json   # 类型契约校验（可选）
```

---

## License

MIT © 2026 Hesi（qiuqiukof）。详见 [LICENSE](./LICENSE)。

---

## 相关项目

| 项目 | 说明 |
|---|---|
| [Hesi-Q](https://github.com/qiuqiukof-oss/Hesi-Q) | Hesi 开源个人版（MIT）：浏览器终端 + AI 智能体中枢，即本插件的同源母体 |
| [Hesi 企业版](https://github.com/qiuqiukof-oss/Hesi) | 完整工作台：专家市场 / 企业连接器 / 知识库 / RBAC·审计 / 企业部署 |
