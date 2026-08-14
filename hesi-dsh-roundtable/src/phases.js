// 圆桌五阶段状态机（纯函数，零 DSH 依赖）
//
// Hesi 原创核心：讨论(discuss) → 方案(propose) → 实施(implement) → 审核(review) → 报告(report)
// 每个阶段给各席位构造不同议程，主持人每轮综合。这是可移植内核，不依赖 DSH。

export const PHASES = ['discuss', 'propose', 'implement', 'review', 'report']

export const PHASE_LABELS = {
  discuss: '讨论',
  propose: '方案',
  implement: '实施',
  review: '审核',
  report: '报告',
}

/**
 * 为某阶段某一轮构造发给席位的议程。
 * @param {string} phase 阶段名
 * @param {string} topic 议题
 * @param {Array<{phase:string,round:number,seat:string,text:string}>} history 已有发言
 * @param {number} round 当前轮
 * @param {number} totalRounds 每阶段总轮数
 */
export function phaseAgenda(phase, topic, history, round, totalRounds) {
  const recent = history
    .slice(-6)
    .map(h => `[${h.seat}] ${String(h.text).slice(0, 300)}`)
    .join('\n')
  const base =
    `议题: ${topic}\n` +
    `阶段: ${PHASE_LABELS[phase] || phase} (第 ${round}/${totalRounds} 轮)\n\n` +
    `近期上下文:\n${recent || '(无)'}\n\n`

  switch (phase) {
    case 'discuss':
      return base + '请从你的角色视角发表对议题的看法，指出关键张力与假设。'
    case 'propose':
      return base + '请提出一个具体、可执行的方案或解决路径。'
    case 'implement':
      return base + '请批判方案的可行性，并勾勒具体的实施步骤与依赖。'
    case 'review':
      return base + '请做对抗性审核：找出风险、缺口与失败模式。'
    case 'report':
      return base + '请总结你给主持人的立场要点。'
    default:
      return base
  }
}
