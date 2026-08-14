// Plan 插件入口（DSH 形态）：Service + tool。
//  - 注册 ctx.hesiPlan 服务
//  - 注册 `run_plan` 工具（一键执行流）
// 依赖圆桌插件提供的 ctx.hesiRoundtable.deriveVerify（checkpoint 推导）。

import { Service } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRuntime } from './plan-adapter.js'
import { runPlan } from './plan-core.js'

export const name = 'hesi-plan'

export class HesiPlan extends Service {
  // 依赖：agents（抽取/盲审子智能体）、tools（执行/验证）、planMode（审批）
  static inject = ['agents', 'tools', 'planMode']

  constructor(ctx, config = {}) {
    super(ctx, 'hesiPlan')
    // config：{ scopePath?, requireApproval? } —— 见 profile 的 hesi-plan 配置段；
    // 护栏在 plan-adapter.js（forbidden 名单 + scope 收敛 + 审批 fail-closed）。
    const runtime = createRuntime(ctx, config)
    this.runtime = runtime

    ctx.tools.register(defineTool({
      name: 'run_plan',
      description: '一键执行流：生成/校验计划，逐步执行并机器验证，失败时快照回滚。',
      parameters: {
        objective: { type: 'string', required: true, description: '自然语言目标' },
        planJson: { type: 'string', required: false, description: '可选预置 plan JSON（跳过生成）' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const plan = args.planJson ? JSON.parse(args.planJson) : undefined
        const result = await runPlan(runtime, args.objective, { plan })
        return JSON.stringify(result, null, 2)
      },
    }))
  }

  runPlan(objective, config) {
    return runPlan(this.runtime, objective, config)
  }
}

export function apply(ctx, config) {
  ctx.plugin(HesiPlan, config)
}
