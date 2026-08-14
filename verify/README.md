# 适配层端口校验（verify）

把《圆桌 / 一键执行流》两个 DSH 插件的「适配层端口」坐实：证明 `seats.js` /
`plan-adapter.js` 里每一个 DSH 运行时调用都对得上 `deepseek-ai/deepseek-harness`
的真实 API。

## 两条校验路径

### A. 运行期校验（离线、零依赖，主路径）
用一份**符合已核实签名的 mock ctx**，实际 `import` 并执行**真实适配器代码**
（`../hesi-dsh-roundtable/src/seats.js`、`../hesi-dsh-plan/src/plan-adapter.js`），
覆盖每个端口：

- `ctx.agents.create({sessionId, agentOptions, setup})` + `setup(agentCtx).systemPrompt.section(...)`
- `agent.followup(createUserMessage({content, source:{kind:'user'}}))` + `agent.whenIdle()`
- `lastAssistantText` 读取 `assistant/message` 事件的 `data.message.content`（**修复点**）
- `ctx.tools.execute({callId, name:'bash', arguments:{command}, signal})`
- `ctx.hesiRoundtable.deriveVerify(...)` 委托
- `ctx.get('planMode')` / `planModeActive()`

```sh
cd verify
node --import ./loader.mjs run-dsh-mock.mjs
```

预期：`DSH 适配层端口校验: 16 通过, 0 失败`。

> 若事件路径仍读 `ev.data.content`（旧错路径），`generatePlan` 会因解析不到 JSON 而抛错，
> 该用例即失败——因此本校验能区分本次修复。

### B. 类型校验（可选，需安装 typescript）
`dsh-api.d.ts` 是对适配器所用 DSH API 的**精确环境声明**，每条均标注 dsh-src 的
`file:line`（可审计的「端口契约」）。适配器 `createRuntime(ctx)` 已带
`@param {import('@deepseek-ai/cordis').Context} ctx`，故可对真实调用做类型校验：

```sh
cd verify
npx -y typescript@latest tsc --noEmit -p tsconfig.verify.json
```

预期：无类型错误。

## 文件
- `stubs/dsh-llm.mjs` — 适配器运行期 import 的 `@deepseek-ai/dsh-llm` 桩（仅 `createUserMessage` / `CallId`）。
- `loader.mjs` — ESM resolve 钩子，把 `@deepseek-ai/dsh-llm` 映射到桩；经 `--import` 自注册。
- `run-dsh-mock.mjs` — 主校验脚本（执行真实适配器）。
- `dsh-api.d.ts` — 类型契约（带 file:line 引用）。
- `tsconfig.verify.json` — 类型校验配置。
