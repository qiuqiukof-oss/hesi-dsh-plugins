// 主持人 / 席位提示词与裁决解析（纯函数，零 DSH 依赖，可单测）
//
// 这是 Hesi 圆桌工作流的「可移植内核」：阶段语义、议程构造、[VERDICT:xxx]
// 裁决解析、验证标准 JSON 解析。移植到任何运行时都不变，因为不碰任何 DSH API。

export const MODERATOR_SYSTEM_PROMPT = `你是一场多智能体圆桌讨论的主持人。
你的职责不是自己回答问题，而是：
1. 综合各席位（不同角色视角）的观点；
2. 暴露分歧与未决张力；
3. 在最终阶段给出明确裁决。
最终报告必须以一行 [VERDICT:<proceed|revise|reject>] 结尾，并附一句理由。
保持简洁、务实、可操作。用与用户相同的语言。`

export const VERIFIER_SYSTEM_PROMPT = `你是一名验收标准专家。
给定一个问题，请推导出「机器可验证」的验收准则，以 JSON 返回：
{ "kind": "command"|"script"|"http"|"manual", "command": string, "expect": string }
- kind=command: 用一条 shell 命令验证（command 为命令，expect 为期望在输出中出现的子串或 "ok" 表示仅看退出码）。
- kind=script: 用一段脚本验证。
- kind=http: 用一次 HTTP 请求验证。
- kind=manual: 无法机器验证，必须由人工确认（command 留空）。
只输出 JSON，不要解释。`

/**
 * 从文本中提取 [VERDICT:xxx] 裁决。
 * @returns {'proceed'|'revise'|'reject'|null}
 */
export function parseVerdict(text) {
  const m = /\[VERDICT:\s*(proceed|revise|reject)\s*\]/i.exec(text || '')
  return m ? m[1].toLowerCase() : null
}

/**
 * 从文本中提取第一个 JSON 对象（用于 deriveVerify 的验收标准解析）。
 * @returns {object|null}
 */
export function parseVerifyJson(text) {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const slice = text.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch {
    return null
  }
}
