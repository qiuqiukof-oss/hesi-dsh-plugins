// 适配层运行时桩：仅实现 seats.js / plan-adapter.js 在运行期真正 import 的符号。
// 真实符号签名见 dsh-src：
//   createUserMessage  packages/llm/llm/src/message.ts:192
//   CallId             packages/llm/llm/src/brand.ts:38
// 本桩让「真实适配器代码」能在离线 Node 下被 import 并执行（配合 verify/loader.mjs）。

/** 记录调用，供 harness 在运行期断言消息形态端口。 */
export const __calls = { createUserMessage: [], CallId: [] }

/** 与 dsh-src packages/llm/llm/src/message.ts:192 同形态：返回冻结的 user 消息。 */
export function createUserMessage(input) {
  __calls.createUserMessage.push(input)
  return Object.freeze({
    ...input,
    id: 'um-' + Math.random().toString(36).slice(2, 10),
    role: 'user',
  })
}

/** 与 dsh-src packages/llm/llm/src/brand.ts:38 同形态：返回 branded string。 */
export function CallId(id) {
  __calls.CallId.push(id)
  return String(id)
}

