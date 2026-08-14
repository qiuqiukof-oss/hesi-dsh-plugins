// 圆桌插件入口（DSH 形态）：Service + tool。
//  - 注册 ctx.hesiRoundtable 服务（供 plan 插件消费 deriveVerify）
//  - 注册 `roundtable` 工具（任意智能体/用户可调用）
//
// 插件写法（已核实）：
//  export const name / export const inject / export function apply(ctx, config)
//  或继承 Service 子类（本文件采用，契合 dsh-plan-mode 的范例写法）。

import { Service } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRuntime } from './seats.js'
import { runRoundtable, deriveVerify } from './roundtable-core.js'

export const name = 'hesi-roundtable'

export class HesiRoundtable extends Service {
  // 只声明我们真正依赖的服务键（已核实：agents / systemPrompt 由 agent-loop 提供）
  static inject = ['agents', 'systemPrompt']

  constructor(ctx, config = {}) {
    super(ctx, 'hesiRoundtable')
    const runtime = createRuntime(ctx)
    this.runtime = runtime

    ctx.tools.register(defineTool({
      name: 'roundtable',
      description: '运行一场多智能体圆桌讨论，返回综合报告与 [VERDICT] 裁决。',
      parameters: {
        topic: { type: 'string', required: true, description: '讨论议题' },
        seats: {
          type: 'array',
          required: false,
          description: '参与席位人设，每项 { id, persona }',
        },
        roundsPerPhase: { type: 'number', required: false, description: '每阶段轮数，默认 1' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const result = await runRoundtable(runtime, {
          topic: args.topic,
          seats: Array.isArray(args.seats) ? args.seats : [],
          roundsPerPhase: args.roundsPerPhase || 1,
        })
        return JSON.stringify({ verdict: result.verdict, report: result.report }, null, 2)
      },
    }))
  }

  /** 供 plan 插件调用的圆桌编排入口。 */
  runRoundtable(opts) {
    return runRoundtable(this.runtime, opts)
  }

  /** 供 plan 插件 checkpoint 推导验收标准。 */
  deriveVerify(question, rounds) {
    return deriveVerify(this.runtime, question, rounds)
  }
}

export function apply(ctx, config) {
  ctx.plugin(HesiRoundtable, config)
}
