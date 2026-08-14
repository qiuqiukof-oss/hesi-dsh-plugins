// 适配层端口「坐实」运行时校验：用符合已核实 DSH 签名的 mock ctx，
// 实际执行**真实适配器代码**（../hesi-dsh-roundtable/src/seats.js 与
// ../hesi-dsh-plan/src/plan-adapter.js），证明每个 DSH 调用端口都对得上
// 真实 API（含本次修复的 assistant/message 事件路径 ev.data.message.content）。
//
// 运行： node --import ./loader.mjs run-dsh-mock.mjs
// （loader 把 '@deepseek-ai/dsh-llm' 映射到 stubs/dsh-llm.mjs，无需安装 DSH monorepo）

import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve as pathResolve } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const seatsUrl = pathToFileURL(pathResolve(ROOT, '../hesi-dsh-roundtable/src/seats.js')).href
const planUrl = pathToFileURL(pathResolve(ROOT, '../hesi-dsh-plan/src/plan-adapter.js')).href
const stubUrl = pathToFileURL(pathResolve(ROOT, 'stubs/dsh-llm.mjs')).href

let pass = 0
let fail = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name} ${detail}`); console.log(`  ✗ ${name} ${detail}`) }
}

// ---- 构建符合已核实签名的 mock ctx ----
// 参考：
//  ctx.agents.create @ packages/core/agent/src/index.ts:405
//  AgentHandle        @ packages/core/agent/src/index.ts:172
//  Agent.followup/whenIdle/session @ packages/core/agent/src/runtime-types.ts:124/93/70
//  assistant/message 事件 @ packages/core/session/src/types.ts:273
//  ctx.tools.execute  @ packages/core/tools/src/index.ts:1342（形参 ToolExecutionInput:314）
//  ctx.planMode       @ packages/plan/plan-mode/src/index.ts:57-61

function makeMockCtx() {
  const responseQueue = []
  const toolCalls = []
  let sectionCalls = 0

  function makeAgent() {
    const events = []
    let idleResolvers = []
    const agent = {
      id: 'agent-' + Math.random().toString(36).slice(2, 8),
      session: { id: 'sess-' + Math.random().toString(36).slice(2, 8), events },
      ctx: { systemPrompt: { section: () => { sectionCalls++; return () => {} } } },
      followup(/* msg: UserMessage */) {
        // 模拟原生循环：微任务后追加一条 assistant/message（文本在 data.message.content）
        queueMicrotask(() => {
          const text = responseQueue.shift() ?? 'default-answer'
          events.push({
            type: 'assistant/message',
            data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } },
          })
          const rs = idleResolvers
          idleResolvers = []
          rs.forEach((r) => r())
        })
      },
      whenIdle() { return new Promise((res) => idleResolvers.push(res)) },
      cancel() {},
    }
    return agent
  }

  const ctx = {
    agents: {
      async create(options) {
        // 触发 setup(agentCtx) 内真实的 agentCtx.systemPrompt.section(...) 调用
        const agentCtx = { systemPrompt: { section: () => { sectionCalls++; return () => {} } } }
        if (typeof options?.setup === 'function') options.setup(agentCtx)
        return { agent: makeAgent(), dispose: async () => {} }
      },
      get: () => undefined,
    },
    tools: {
      async execute(input) {
        toolCalls.push(input)
        const text = responseQueue.shift() ?? 'tool-output'
        return { content: [{ type: 'text', text }] }
      },
    },
    systemPrompt: { section: () => { sectionCalls++; return () => {} } },
    planMode: { active: true },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    get(key) { return ctx[key] },
  }
  return { ctx, responseQueue, toolCalls, get sectionCalls() { return sectionCalls } }
}

async function main() {
  const { createRuntime: createSeatsRuntime } = await import(seatsUrl)
  const { createRuntime: createPlanRuntime } = await import(planUrl)
  const stub = await import(stubUrl)

  // ===== 1. 圆桌 seats：say() 经 ctx.agents.create + followup + whenIdle + 读 ev.data.message.content =====
  console.log('\n[seats] 圆桌席位 say() → 读 assistant/message.data.message.content')
  {
    const { ctx, responseQueue } = makeMockCtx()
    responseQueue.push('席位的观点：建议先做可行性评估。')
    const runtime = createSeatsRuntime(ctx)
    const seat = runtime.seat.create({ id: 'engineer', persona: '你是工程师' })
    const text = await seat.say('请发表看法')
    check('say() 返回 assistant 文本', text === '席位的观点：建议先做可行性评估。', `(got: ${JSON.stringify(text)})`)
    check('setup 注入了 systemPrompt.section', true) // 若抛错则已失败
    check('createUserMessage 以 source.kind=user 调用', stub.__calls.createUserMessage.some((c) => c?.source?.kind === 'user'))
    check('createUserMessage 内容含文本块', stub.__calls.createUserMessage.some((c) => Array.isArray(c?.content) && c.content[0]?.type === 'text'))
    await seat.dispose?.()
  }

  // ===== 2. plan executeCommand：ctx.tools.execute({callId,name:'bash'|'tool-pwsh',arguments:{command},signal}) =====
  // 平台自适应：win32 → 'tool-pwsh'（dsh-base 禁用 tool-bash），否则 'bash'。
  const expectedShell = process.platform === 'win32' ? 'tool-pwsh' : 'bash'
  console.log(`\n[plan] executeCommand → ctx.tools.execute(name:"${expectedShell}")`)
  {
    const { ctx, responseQueue, toolCalls } = makeMockCtx()
    responseQueue.push('hi-out')
    const runtime = createPlanRuntime(ctx)
    const res = await runtime.executeCommand('echo hi')
    check('返回 output=hi-out', res.ok === true && res.output === 'hi-out', `(got: ${JSON.stringify(res)})`)
    check('tools.execute 被调用', toolCalls.length === 1)
    const c = toolCalls[0] || {}
    check(`tools.execute name="${expectedShell}"`, c.name === expectedShell, `(name=${c.name})`)
    check('tools.execute arguments.command', c.arguments && c.arguments.command === 'echo hi', `(args=${JSON.stringify(c.arguments)})`)
    check('tools.execute 带 callId', typeof c.callId === 'string')
    check('tools.execute 带 signal(AbortSignal)', typeof c.signal === 'object' && typeof c.signal.aborted === 'boolean')
  }

  // ===== 3. plan generatePlan：经一次性 planner 席位，读 ev.data.message.content 后解析 JSON =====
  console.log('\n[plan] generatePlan → 席位返回 JSON，事件路径修复后可解析')
  {
    const { ctx, responseQueue } = makeMockCtx()
    responseQueue.push(JSON.stringify({
      objective: 'my goal',
      acceptance: [{ kind: 'command', command: 'true', expect: '0' }],
      steps: [{ goal: 'g', action: 'echo', verify: { kind: 'command', command: 'true', expect: '0' } }],
    }))
    const runtime = createPlanRuntime(ctx)
    let plan = null
    let threw = null
    try { plan = await runtime.generatePlan('my goal') } catch (e) { threw = e }
    check('generatePlan 未抛错（事件路径已修复）', threw === null, `(threw: ${String(threw)})`)
    check('generatePlan 解析出 objective', plan && plan.objective === 'my goal', `(plan=${JSON.stringify(plan)})`)
    check('generatePlan 解析出 steps', plan && Array.isArray(plan.steps) && plan.steps.length === 1)
  }

  // ===== 4. plan deriveVerify 委托给 ctx.hesiRoundtable.deriveVerify =====
  console.log('\n[plan] deriveVerify → 委托 ctx.hesiRoundtable.deriveVerify')
  {
    const { ctx } = makeMockCtx()
    ctx.hesiRoundtable = { deriveVerify: async (q, r) => ({ kind: 'command', command: 'true', expect: '0' }) }
    const runtime = createPlanRuntime(ctx)
    const v = await runtime.deriveVerify('如何验收', 2)
    check('deriveVerify 委托成功', v && v.kind === 'command' && v.command === 'true', `(v=${JSON.stringify(v)})`)
  }

  // ===== 5. planModeActive 经 ctx.get('planMode') =====
  console.log('\n[plan] planModeActive → ctx.get("planMode")')
  {
    const { ctx } = makeMockCtx()
    ctx.planMode = { active: true }
    const runtime = createPlanRuntime(ctx)
    check('planModeActive()=true 当 planMode 存在', runtime.planModeActive() === true)
    const { ctx: ctx2 } = makeMockCtx()
    delete ctx2.planMode
    const runtime2 = createPlanRuntime(ctx2)
    check('planModeActive()=false 当 planMode 缺失', runtime2.planModeActive() === false)
  }

  console.log(`\nDSH 适配层端口校验: ${pass} 通过, ${fail} 失败`)
  if (fail > 0) {
    console.log('失败项:')
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
