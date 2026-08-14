// Plan 一键执行流编排核心（纯函数，零 DSH 依赖）
//
// 关键设计（对照原草稿的根本修正）：
//  原草稿想「整体替换 ctx.agentLoop」并自己实现整套循环——错误且重。
//  现方案：plan 是一个 **service + tool 插件**，在 DSH 之上做「自主执行编排」，
//  复用 DSH 原生的 tools.execute（执行/验证）、agents.create（抽取/盲审子智能体）、
//  并 **对接内置 ctx.planMode**（规划+审批），而非另造 plan mode。
//  所有 DSH 运行时调用收口在 plan-adapter.js（薄适配层）。
//
// PlanRuntime 契约（由 plan-adapter.js 用 DSH 实现，smoke 用 mock 实现）：
//   generatePlan(objective) => plan
//   executeCommand(command) => { ok:boolean, output:string }
//   snapshot() => id:string
//   rollback(id)
//   deriveVerify(question, rounds) => {kind,command,expect}
//   planModeActive() => boolean
//   askApproval(payload) => boolean
//   log(level, msg)

import { validatePlan, isMachineVerifiable } from './plan-schema.js'
import { gatePlan, resolveCheckpoint } from './plan-contract.js'

async function verifyStep(runtime, step, execResult) {
  if (!isMachineVerifiable(step.verify)) return true // manual：信任执行结果
  if (!execResult.ok) return false
  try {
    const v = await runtime.executeCommand(step.verify.command)
    if (!v.ok) return false
    if (step.verify.expect && step.verify.expect !== 'ok') return v.output.includes(step.verify.expect)
    return true
  } catch {
    return false
  }
}

/**
 * 运行一键执行流。
 * @param {object} runtime PlanRuntime
 * @param {string} objective 自然语言目标
 * @param {object} config { plan?, requireApproval? }
 */
export async function runPlan(runtime, objective, config = {}) {
  if (!objective || typeof objective !== 'string') throw new Error('runPlan: objective 必填')

  let plan = config.plan
  if (!plan) plan = await runtime.generatePlan(objective)

  const schemaErr = validatePlan(plan)
  if (schemaErr) throw new Error(`plan 结构非法: ${schemaErr}`)

  // 闸门（决策①）
  const gate = gatePlan(plan)
  if (!gate.ok) {
    if (runtime.planModeActive() && config.requireApproval !== false) {
      const approved = await runtime.askApproval(plan)
      if (!approved) return { status: 'rejected', reason: '用户驳回计划' }
    } else {
      throw new Error(`plan 被闸门拦截: ${gate.reason}`)
    }
  }

  const results = []
  const snap = await runtime.snapshot()
  let rolledBack = false
  try {
    for (const step of plan.steps) {
      // checkpoint 软断点：推导机器可验证验收（决策②，耦合圆桌 deriveVerify）
      if (!isMachineVerifiable(step.verify)) {
        step.verify = await resolveCheckpoint(runtime, step)
      }
      // 逐步审批闸（依赖 plan-mode）
      if (step.requireApproval && runtime.planModeActive()) {
        const ok = await runtime.askApproval(step)
        if (!ok) {
          results.push({ step: step.goal, status: 'blocked' })
          break
        }
      }
      // 执行
      const res = await runtime.executeCommand(step.action)
      // 验证
      const verified = await verifyStep(runtime, step, res)
      results.push({ step: step.goal, status: verified ? 'passed' : 'failed', output: res.output })
      if (!verified && step.critical) {
        await runtime.rollback(snap)
        rolledBack = true
        return { status: 'failed', results, rolledBack: true, reason: '关键步骤验证失败，已回滚' }
      }
    }
  } catch (e) {
    await runtime.rollback(snap)
    rolledBack = true
    return { status: 'error', error: String(e), results, rolledBack: true }
  }

  return { status: 'done', plan, results, rolledBack }
}
