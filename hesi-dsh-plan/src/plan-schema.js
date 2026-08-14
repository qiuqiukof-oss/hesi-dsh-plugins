// Plan 数据模型与契约（纯函数，移植自 Hesi routes/ai-tools/plan-schema.js）
// 零 DSH 依赖，可单测。定义 plan 形状、机器可验证性判定、验收种类。

export const VERIFY_KINDS = ['command', 'script', 'http', 'manual']

/** 机器可验证的验收种类（manual 不算，需人工）。 */
const MACHINE_KINDS = ['command', 'script', 'http']

/**
 * 判定一个 verify 描述是否机器可验证。
 * @param {{kind?:string, command?:string, expect?:string}} verify
 */
export function isMachineVerifiable(verify) {
  return !!verify && MACHINE_KINDS.includes(verify.kind) && typeof verify.command === 'string' && verify.command.length > 0
}

/**
 * 校验 plan 结构。返回 null 表示合法，否则返回错误字符串。
 * @param {object} plan
 */
export function validatePlan(plan) {
  if (plan == null || typeof plan !== 'object') return 'plan 必须是对象'
  if (typeof plan.objective !== 'string' || plan.objective.trim() === '') return 'objective 必须是非空字符串'
  if (!Array.isArray(plan.steps)) return 'steps 必须是数组'
  if (plan.steps.length === 0) return 'steps 不能为空'
  for (const [i, s] of plan.steps.entries()) {
    if (typeof s.goal !== 'string' || s.goal.trim() === '') return `steps[${i}].goal 必须是非空字符串`
    if (typeof s.action !== 'string' || s.action.trim() === '') return `steps[${i}].action 必须是非空字符串`
  }
  if (plan.acceptance !== undefined) {
    if (!Array.isArray(plan.acceptance)) return 'acceptance 必须是数组'
    for (const [i, a] of plan.acceptance.entries()) {
      if (!VERIFY_KINDS.includes(a.kind)) return `acceptance[${i}].kind 必须是 ${VERIFY_KINDS.join('/')}`
    }
  }
  return null
}
