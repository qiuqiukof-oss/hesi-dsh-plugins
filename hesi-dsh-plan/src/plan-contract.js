// Plan 契约（纯函数，移植自 Hesi routes/ai-tools/plan-contract.js）
// 零 DSH 依赖；resolveCheckpoint 需要 runtime.deriveVerify（由圆桌插件提供）。
//
// 两个核心决策（Hesi 原创）：
//  ① 闸门 gatePlan：目标/验收不可机器验证即拒收（除非走人工审批）。
//  ② checkpoint：某步骤无机器可验证验收时，注入圆桌推导；推导失败则回退决策①。

import { isMachineVerifiable } from './plan-schema.js'

/**
 * 闸门：plan 必须至少含一个机器可验证的验收标准。
 * @param {object} plan
 * @returns {{ok:boolean, reason?:string}}
 */
export function gatePlan(plan) {
  const acc = Array.isArray(plan?.acceptance) ? plan.acceptance : []
  const hasMachine = acc.some((a) => isMachineVerifiable(a))
  if (!hasMachine) {
    return { ok: false, reason: 'plan 缺少机器可验证的验收标准（acceptance 中需至少一个 command/script/http）' }
  }
  return { ok: true }
}

/**
 * checkpoint 软断点：若步骤无机器可验证验收，则调用圆桌 deriveVerify 推导。
 * 推导出的种类仍可能为 manual（无法机器验证）→ 抛错，回退决策①。
 * @param {object} runtime PlanRuntime（需含 deriveVerify）
 * @param {{goal:string, verify?:object}} step
 * @returns {Promise<object>} 解析后的 verify 描述
 */
export async function resolveCheckpoint(runtime, step) {
  if (isMachineVerifiable(step.verify)) return step.verify
  if (typeof runtime?.deriveVerify !== 'function') {
    throw new Error('resolveCheckpoint: 无 deriveVerify（圆桌插件未加载），无法推导验收标准')
  }
  const derived = await runtime.deriveVerify(step.goal, 2)
  if (derived.kind === 'manual' || !isMachineVerifiable(derived)) {
    // 决策①回退：推导不出可验证准则，视为不可验证
    throw new Error(`checkpoint 推导失败：步骤「${step.goal}」无法获得机器可验证验收标准`)
  }
  return derived
}
