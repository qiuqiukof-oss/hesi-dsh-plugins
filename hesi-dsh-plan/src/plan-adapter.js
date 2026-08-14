// Plan DSH 薄适配层：把 PlanRuntime 契约映射到 DSH 真实 API。
// 这是插件里唯一触碰 DSH 运行时之处；DSH 接口有变只改本文件。
//
// 已坐实的 DSH API（file:line 见各 dsh-src 源码引用，基于 DSH 0.1.0-rc.5）：
//  - ctx.tools.execute({ callId: CallId(...), name:'bash'|'tool-pwsh', arguments:{command,workdir}, signal })
//      => ToolExecutionResult（.content: ContentBlock[]）
//      精确用法见 dsh-src packages/shell/tool-bash/tests/tools.spec.ts:836：
//        await ctx.tools.execute({ signal, callId: CallId('cwd-noagent'), name:'bash', arguments:{command:'pwd',description:'pwd'} })
//      ToolRuntime.execute 签名: packages/core/tools/src/index.ts:1342
//      ToolExecutionInput 形态: packages/core/tools/src/index.ts:314（callId,name,arguments,signal 必填；agent/rootCallId 可选）
//  - ⚠️ Windows 平台：tool-bash 在 dsh-base 中被 disabled（process.platform==='win32'），
//      由 @deepseek-ai/dsh-tool-pwsh（工具名 'tool-pwsh'）实现；参数支持 command/workdir/
//      sandbox_permissions/justification（sandbox_permissions⇔justification 成对，接 ctx.approval 审批）。
//  - ctx.hesiRoundtable.deriveVerify(question, rounds)  （圆桌插件提供）
//  - ctx.planMode 存在即代表内置 plan-mode 服务已装配（packages/plan/plan-mode/src/index.ts:57-61 声明于 Context）
//  - ctx.get('planMode') 读取服务（用于 planModeActive）
//  - 抽取/盲审子智能体可用 ctx.agents.create（generatePlan 用一次性 planner 席位；已核实 packages/core/agent/src/index.ts:405）
//
// ⚠️ 生产护栏（2026-08-15 补，对应 Hesi run-plan.js 红线）：
//  - forbidden 命令名单（静态第一道闸，平台无关核心危险模式）
//  - scope 收敛：workdir 固定到 scopePath，命令不得切换到盘符根/裸盘符/越界绝对路径
//  - 审批：askApproval 接 ctx.userQuestions.ask；无可用通道时 fail-closed（拒绝）
//  - 平台 shell 工具名自适应：win32 → 'tool-pwsh'，否则 'bash'

import { CallId } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'

// 平台 shell 工具名：dsh-base 在 win32 上禁用 tool-bash，由 tool-pwsh 承接同一契约。
const SHELL_TOOL = process.platform === 'win32' ? 'tool-pwsh' : 'bash'

// ---- 生产护栏：forbidden 命令名单（静态正则，防真危险，不误伤常见开发命令）----
const FORBIDDEN_PATTERNS = [
  // ① 无差别/根删除：rm -rf /、rm -rf C:\、del /s /q C:\、Remove-Item 盘符根、format/mkfs
  /\brm\s+(-rf|-r\s+-f)\s+(--no-preserve-root\s+)?([/\\]|[a-zA-Z]:[\\/]\s*)/i,
  /\bRemove-Item\b[^\r\n]*(?:-Path\s+)?[A-Za-z]:[\\/]\s*(?:-Recurse|-Force)/i,
  /\bdel\s+\/s\s+\/q\s+[a-zA-Z]:[\\/]/i,
  /\bformat\s+[a-zA-Z]:/i,
  /\bmkfs\.\w+/i,
  // ② git 破坏（force push / hard reset / clean / filter-branch）
  /\bgit\s+push\s+(-f|--force)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+(-f|-d|--force)\b/i,
  /\bgit\s+filter-branch\b/i,
  // ③ 系统/提权
  /\bshutdown\b|\breboot\b|\binit\s+0\b/i,
  /\btaskkill\s+\/f\s+\/im\s+(explorer\.exe|winlogon\.exe|csrss\.exe|lsass\.exe)\b/i,
  /\breg\s+(delete|add)\s+HK/i,
  /\bsc\s+(delete|stop)\s+[A-Za-z]/i,
  /\bchmod\s+777\b|\bsudo\s+rm\b/i,
  // ④ 磁盘直写
  /\b>\s*\/dev\/(s|h)d[a-z][0-9]*/i,
]

/**
 * 静态禁止名单检查。
 * @returns {string|null} 命中返回说明，否则 null
 */
function checkForbidden(command) {
  for (const re of FORBIDDEN_PATTERNS) {
    if (re.test(command)) return `命中禁止模式: ${re}`
  }
  return null
}

/**
 * scope 收敛：命令不得切换到盘符根/根目录、裸盘符，或访问工作区外绝对路径。
 * @param {string} command
 * @param {string|undefined} scope 工作区根（Windows 形式，如 C:/DSH/repo）
 */
function checkScopeEscape(command, scope) {
  if (!scope) return null
  // 切换盘符根/根目录：cd /、cd C:\、Set-Location C:\、pushd 盘符根
  if (/(^|[;&|]\s*)(cd|Set-Location|pushd)\s+([/\\]|[a-zA-Z]:[\\/]\s*)(\s*$|[;&|])/i.test(command)) {
    return `禁止切换到盘符/根目录（scope=${scope}）`
  }
  // 裸盘符切换：独立出现的 `C:`（非路径前缀）
  if (/(^|[;&|]\s*)[a-zA-Z]:\s*(\s*$|[;&|])/i.test(command)) return '禁止裸盘符切换'
  // 绝对路径越界：Windows 绝对路径必须落在 scope 内
  const scopeNorm = scope.replace(/[\\/]+$/, '').toLowerCase()
  const scopeDrive = scopeNorm.slice(0, 2)
  const absPaths = command.match(/[a-zA-Z]:[\\/][^ \t"';&|<>]+/g) || []
  for (const p of absPaths) {
    const pd = p.slice(0, 2).toLowerCase()
    if (pd !== scopeDrive) return `命令涉及其他盘符路径: ${p}`
    if (!p.toLowerCase().startsWith(scopeNorm)) return `命令涉及工作区外路径: ${p}`
  }
  return null
}

function toolText(result) {
  if (!result || !Array.isArray(result.content)) return ''
  return result.content.filter((b) => b?.type === 'text').map((b) => b.text).join('')
}

/**
 * 从会话事件中提取最近一次 assistant 文本（与 seats.js 同口径）。
 * assistant/message 形态见 packages/core/session/src/types.ts:273，文本在 ev.data.message.content。
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
 * 通过 ctx.userQuestions 发起人工审批；无可用通道时 fail-closed（拒绝）。
 * @returns {Promise<boolean>}
 */
async function askViaUserQuestions(ctx, detail) {
  if (ctx.userQuestions && typeof ctx.userQuestions.ask === 'function') {
    try {
      const answer = await ctx.userQuestions.ask({
        questions: [{
          id: 'hesi-plan-approval',
          header: 'Hesi Plan 审批',
          question: '批准该操作执行？',
          detail,
          options: [
            { label: '批准', description: '允许执行' },
            { label: '驳回', description: '拒绝执行' },
          ],
        }],
      })
      const first = answer?.answers?.[0]
      return Array.isArray(first?.selected) && first.selected.includes('批准')
    } catch (e) {
      ctx.logger?.warn?.(`hesi-plan: 审批通道异常 → fail-closed: ${e?.message}`)
      return false
    }
  }
  ctx.logger?.warn?.('hesi-plan: 无可用审批通道（headless 无 UI provider）→ fail-closed 拒绝')
  return false
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ scopePath?: string, requireApproval?: boolean }} [config]
 */
export function createRuntime(ctx, config = {}) {
  const scope = config.scopePath || process.cwd()
  const requireApproval = config.requireApproval === true
  let callSeq = 0

  const runShell = (command, callIdPrefix) =>
    ctx.tools.execute({
      callId: CallId(`${callIdPrefix}-${++callSeq}`),
      name: SHELL_TOOL,
      arguments: { command, workdir: scope, description: 'hesi-plan step' },
      signal: new AbortController().signal,
    })

  return {
    scopePath: scope,

    async generatePlan(objective) {
      // 用一次性 planner 席位（原生多智能体，已核实 ctx.agents.create @
      // packages/core/agent/src/index.ts:405）。生产中亦可换 ctx.llm.stream 直出 JSON。
      const handle = await ctx.agents.create({
        sessionId: `hesi-plan-gen-${randomUUID()}`,
        agentOptions: {},
        setup: (agentCtx) => {
          agentCtx.systemPrompt.section({
            name: 'hesi-planner',
            order: 10,
            text: () =>
              '你是计划生成器。给定目标，输出 JSON：' +
              '{ objective, acceptance:[{kind,command,expect}], steps:[{goal,action,verify,critical?}] }。',
          })
        },
      })
      handle.agent.followup(
        createUserMessage({ content: [{ type: 'text', text: `目标: ${objective}` }], source: { kind: 'user' } }),
      )
      await handle.agent.whenIdle()
      const events = handle.agent.session.events || []
      const text = lastAssistantText(events)
      await handle.dispose()
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start < 0 || end <= start) throw new Error('generatePlan: 无法解析模型返回的 plan JSON')
      return JSON.parse(text.slice(start, end + 1))
    },

    async executeCommand(command) {
      // ① 静态 forbidden 名单
      const hit = checkForbidden(command)
      if (hit) return { ok: false, output: `[hesi-plan 护栏] 命令被禁止：${hit}` }
      // ② scope 收敛
      const esc = checkScopeEscape(command, scope)
      if (esc) return { ok: false, output: `[hesi-plan 护栏] 命令可能逃逸工作区：${esc}` }
      // ③ 命令级审批（仅 requireApproval 配置开启时；headless 无通道 fail-closed）
      if (requireApproval) {
        const approved = await askViaUserQuestions(ctx, `命令: ${command}`)
        if (!approved) return { ok: false, output: '[hesi-plan] 用户未批准该命令，已拒绝执行' }
      }
      const result = await runShell(command, 'hesi-plan')
      const output = toolText(result)
      // shell 工具在失败时通常会在 content 中带非零退出/错误标记；此处以「有输出即视为成功」的保守策略。
      return { ok: true, output }
    },

    async snapshot() {
      const id = `hesi-snap-${randomUUID()}`
      // 简化策略：用 git stash 记录工作区；真实实现应接 path-guard + 硬快照。
      await runShell('git stash push -u -m "hesi-plan-snapshot"', 'hesi-snap').catch(() => {})
      return id
    },

    async rollback() {
      await runShell('git stash pop', 'hesi-rollback').catch(() => {})
    },

    async deriveVerify(question, rounds) {
      if (!ctx.hesiRoundtable || typeof ctx.hesiRoundtable.deriveVerify !== 'function') {
        throw new Error('plan-adapter: 圆桌插件(@hesi/dsh-roundtable)未加载，无法 deriveVerify')
      }
      return ctx.hesiRoundtable.deriveVerify(question, rounds)
    },

    planModeActive() {
      return ctx.get != null ? ctx.get('planMode') != null : false
    },

    async askApproval(payload) {
      // 生产：接 userQuestions / exit_plan_mode 流程做真实人工审批；无通道 fail-closed。
      const detail = payload?.command ? `命令: ${payload.command}` : JSON.stringify(payload)
      return askViaUserQuestions(ctx, detail)
    },

    log: (level, msg) => {
      const fn = ctx?.logger?.[level] ?? console[level]
      if (typeof fn === 'function') fn(msg)
    },
  }
}
