// 圆桌编排核心（纯函数，零 DSH 依赖）
//
// 关键设计（对照原草稿的根本修正）：
// 原草稿想「整体替换 ctx.agentLoop」——这是 DSH 官方不推荐的重路径。
// 现在圆桌是一个 **service + tool 插件**：通过 runtime.seat.create() 用 DSH 原生的
// 多智能体机制（ctx.agents.create）拉起若干「席位」子智能体，由本核心驱动多轮讨论。
// 所有 DSH 运行时调用都收口在 seats.js（薄适配层），本文件完全不 import 任何 DSH 包。

import { PHASES, phaseAgenda } from './phases.js'
import { MODERATOR_SYSTEM_PROMPT, VERIFIER_SYSTEM_PROMPT, parseVerdict, parseVerifyJson } from './moderator.js'

/**
 * RoundtableRuntime 契约（由 seats.js 用 DSH 实现，smoke 测试用 mock 实现）：
 *   runtime.seat.create(role: {id:string, persona?:string}) => Seat
 *     Seat = { id:string, say(message:string)=>Promise<string>, dispose?():Promise<void> }
 *     say() 返回该席位最近一次助手回复的纯文本。
 *   runtime.log(level:string, msg:string)
 */

/**
 * 运行一场圆桌讨论。
 * @param {object} runtime RoundtableRuntime
 * @param {object} options { topic, seats:[{id,persona}], phases?, roundsPerPhase?, moderatorPersona? }
 */
export async function runRoundtable(runtime, options) {
  const {
    topic,
    seats = [],
    phases = PHASES,
    roundsPerPhase = 1,
    moderatorPersona,
  } = options

  if (!topic) throw new Error('runRoundtable: topic is required')
  const history = []
  const created = []

  const createSeat = (role) => {
    const s = runtime.seat.create(role)
    created.push(s)
    return s
  }

  const moderator = createSeat({ id: 'moderator', persona: moderatorPersona || MODERATOR_SYSTEM_PROMPT })
  const participants = seats.map((s) => createSeat(s))

  for (const phase of phases) {
    for (let r = 1; r <= roundsPerPhase; r++) {
      const agenda = phaseAgenda(phase, topic, history, r, roundsPerPhase)
      for (const seat of participants) {
        const text = await seat.say(agenda)
        history.push({ phase, round: r, seat: seat.id, text })
      }
      const synth = await moderator.say(
        `阶段「${phase}」第 ${r}/${roundsPerPhase} 轮结束。` +
        `请把各席位的观点综合成该阶段的一份简洁立场。`,
      )
      history.push({ phase, round: r, seat: 'moderator', text: synth })
    }
  }

  const report = await moderator.say(
    `请就议题「${topic}」产出最终圆桌报告，` +
    `并以一行 [VERDICT:<proceed|revise|reject>] 结尾并附一句理由。`,
  )
  history.push({ phase: 'report', round: 1, seat: 'moderator', text: report })
  const verdict = parseVerdict(report) || 'proceed'

  for (const s of created) {
    if (s.dispose) await s.dispose()
  }

  return { topic, transcript: history, report, verdict }
}

/**
 * 聚焦圆桌：推导机器可验证的验收标准。供 plan 插件的 checkpoint 软断点调用。
 * @param {object} runtime RoundtableRuntime
 * @param {string} question 待推导的问题
 * @param {number} rounds 聚焦轮数（默认 2）
 * @returns {Promise<{kind:string, command:string, expect:string}>}
 */
export async function deriveVerify(runtime, question, rounds = 2) {
  const verifier = runtime.seat.create({ id: 'verifier', persona: VERIFIER_SYSTEM_PROMPT })
  let last = ''
  for (let r = 1; r <= rounds; r++) {
    last = await verifier.say(
      `问题: ${question}\n` +
      `请给出一个机器可验证的验收准则，仅输出 JSON：` +
      `{ "kind": "command"|"script"|"http"|"manual", "command": string, "expect": string }。` +
      `第 ${r}/${rounds} 轮，若有前轮结果请精炼。`,
    )
  }
  if (verifier.dispose) await verifier.dispose()

  const parsed = parseVerifyJson(last)
  const KINDS = ['command', 'script', 'http', 'manual']
  if (!parsed || !KINDS.includes(parsed.kind)) {
    throw new Error(`deriveVerify: 无法推导出可验证准则 (原始: ${String(last).slice(0, 200)})`)
  }
  return { kind: parsed.kind, command: parsed.command || '', expect: parsed.expect || 'ok' }
}
