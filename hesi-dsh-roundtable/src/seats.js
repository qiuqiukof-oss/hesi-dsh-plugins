// 圆桌 DSH 薄适配层：把 RoundtableRuntime 契约映射到 DSH 真实 API。
// 这是插件里唯一触碰 DSH 运行时之处；若 DSH 定型后有接口变动，只需改本文件。
//
// 已坐实的 DSH API（file:line 见各 dsh-src 源码引用，基于 DSH 0.1.0-rc.5）：
//  - ctx.agents.create({ sessionId, agentOptions?, setup? }) => Promise<AgentHandle>
//      dsh-src packages/core/agent/src/index.ts:405 (async create(options: CreateAgentOptions))
//      AgentHandle = { agent, dispose() }  (packages/core/agent/src/index.ts:172)
//  - agent.followup(createUserMessage({content:[{type:'text',text}], source:{kind:'user'}})) 唤醒驱动
//      Agent.followup: packages/core/agent/src/runtime-types.ts:124
//      createUserMessage: packages/llm/llm/src/message.ts:192（source.kind:'user' 见同文件测试广泛用法）
//  - agent.whenIdle() 等待整智能体 quiescence（packages/core/agent/src/runtime-types.ts:93）
//  - agent.session.events 只读轨迹，assistant 文本在 ev.data.message.content
//      Session.events: packages/core/session/src/index.ts:559
//      assistant/message 形态: packages/core/session/src/types.ts:273
//  - 在 setup(agentCtx) 内通过 agentCtx.systemPrompt.section({name,order,text:()=>...}) 注入人设
//      PromptSection.text 支持函数: packages/core/system-prompt/src/index.ts:67

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'

/**
 * 从会话事件中提取最近一次 assistant 文本。
 *
 * 已核实事件形态（dsh-src packages/core/session/src/types.ts:273）：
 *   'assistant/message': { turn: number; step: number; message: AssistantMessage; usage? }
 * 而 AssistantMessage.content 是 ContentBlock[]（packages/llm/llm/src/message.ts:146/129）。
 * 所以文本在 `ev.data.message.content`，**不是** `ev.data.content`（后者不存在于该事件）。
 */
function lastAssistantText(events) {
  let text = ''
  for (const ev of events || []) {
    if (ev?.type !== 'assistant/message') continue
    const blocks = ev?.data?.message?.content
    if (!Array.isArray(blocks)) continue
    const t = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('')
    if (t) text = t
  }
  return text
}

/**
 * 用 DSH 原生多智能体机制实现 RoundtableRuntime。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function createRuntime(ctx) {
  return {
    seat: {
      create(role) {
        // ctx.agents.create 是异步的；say() 惰性等待句柄就绪。
        const ready = ctx.agents.create({
          sessionId: `hesi-rt-${role.id}-${randomUUID()}`,
          agentOptions: {}, // 用部署默认 persona；人设经 systemPrompt.section 注入
          setup: (agentCtx) => {
            if (role.persona) {
              agentCtx.systemPrompt.section({
                name: `hesi-seat-${role.id}`,
                order: 10,
                text: () => role.persona,
              })
            }
          },
        })

        let resolved = null
        const ensure = async () => {
          if (!resolved) resolved = await ready
          return resolved
        }

        return {
          id: role.id,
          async say(message) {
            const h = await ensure()
            h.agent.followup(
              createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }),
            )
            await h.agent.whenIdle()
            return lastAssistantText(h.agent.session.events)
          },
          async dispose() {
            const h = await ensure()
            await h.dispose()
          },
        }
      },
    },
    log: (level, msg) => {
      const fn = ctx?.logger?.[level] ?? console[level]
      if (typeof fn === 'function') fn(msg)
    },
  }
}
