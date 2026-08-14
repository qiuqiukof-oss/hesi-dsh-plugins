// dsh-api.d.ts — 适配层使用到的 DSH 真实 API 的「精确环境声明」(ambient)。
//
// 用途：作为「适配层端口坐实」的可审计类型契约。每一条均摘自 dsh-src（clone @ 2026-08-15），
// 并标注 file:line。安装 `typescript` 后可用 `tsc --noEmit` 对适配器做类型校验：
//   npx -y typescript@latest tsc --noEmit -p tsconfig.verify.json
// （若无网络装 tsc，改用 run-dsh-mock.mjs 做运行期校验，同样能证明端口正确。）
//
// 注意：仅声明插件真正 import / 调用的符号；不试图复刻整个 monorepo 的类型。
// 与官方类型不一致时，以 dsh-src 源码为本文件的校准基准。

// ============================ @deepseek-ai/dsh-llm ============================
declare module '@deepseek-ai/dsh-llm' {
  // packages/llm/llm/src/brand.ts:31,38
  export type CallId = string & { readonly __brand: 'CallId' }
  export function CallId(id: string): CallId

  // packages/llm/llm/src/message.ts:129-148
  export interface ContentBlock {
    type: string
    text?: string
    [key: string]: unknown
  }
  export interface Message {
    readonly role: 'system' | 'user' | 'assistant'
    content: ContentBlock[]
    source: unknown
  }
  export interface UserMessage extends Message {
    readonly role: 'user'
  }
  export interface AssistantMessage extends Message {
    readonly role: 'assistant'
  }
  // packages/llm/llm/src/message.ts:192
  export function createUserMessage<T extends { content: ContentBlock[]; source: unknown }>(
    input: T & { readonly id?: never; readonly role?: never },
  ): T & Pick<UserMessage, 'id' | 'role'>
}

// ============================ @deepseek-ai/dsh-tools ============================
declare module '@deepseek-ai/dsh-tools' {
  import type { ContentBlock } from '@deepseek-ai/dsh-llm'

  // packages/core/tools/src/schema.ts:545 (defineTool) + 483-498 (DefineToolOptions)
  export interface ToolDefinition {
    name: string
    description: string
    parameters: unknown
    output: { schema: unknown; render(args: unknown, value: unknown): ContentBlock[] }
    execute(args: unknown, exec: unknown): Promise<unknown>
    [key: string]: unknown
  }
  export function defineTool(options: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: { schema: unknown; render(args: unknown, value: unknown): ContentBlock[] }
    execute(args: unknown, exec: unknown): Promise<unknown>
    [key: string]: unknown
  }): ToolDefinition
}

// ========================= @deepseek-ai/dsh-system-prompt =========================
declare module '@deepseek-ai/dsh-system-prompt' {
  // packages/core/system-prompt/src/index.ts:53-67
  export interface PromptSection {
    readonly name: string
    readonly order: number
    readonly text: string | ((context: unknown) => string)
    [key: string]: unknown
  }
  export interface SystemPrompt {
    section(section: PromptSection): () => void
    [key: string]: unknown
  }
}

// ============================ @deepseek-ai/dsh-session ============================
declare module '@deepseek-ai/dsh-session' {
  import type { ContentBlock, AssistantMessage } from '@deepseek-ai/dsh-llm'

  // packages/core/session/src/types.ts:236- (SessionEventMap), 411 (SessionEvent 形态)
  export interface SessionEvent {
    readonly type: string
    readonly data: unknown
    readonly seq?: number
    readonly time?: number
  }
  export interface Session {
    readonly id: string
    // packages/core/session/src/index.ts:559
    readonly events: readonly SessionEvent[]
    [key: string]: unknown
  }
  export type SessionId = string
  // 仅用于类型引用（assistant/message 形态见 types.ts:273）
  export type { AssistantMessage }
  export type { ContentBlock }
}

// ============================ @deepseek-ai/dsh-agent ============================
declare module '@deepseek-ai/dsh-agent' {
  import type { Context } from '@deepseek-ai/cordis'
  import type { Session, SessionId } from '@deepseek-ai/dsh-session'
  import type { UserMessage } from '@deepseek-ai/dsh-llm'

  // packages/core/agent/src/runtime-types.ts:24-31
  export interface AgentOptions {
    provider?: string
    model?: string
    maxTokens?: number
  }
  // packages/core/agent/src/runtime-types.ts:64- (Agent)
  export interface Agent {
    readonly id: string
    readonly session: Session
    readonly ctx: Context
    followup(message: UserMessage): void // :124
    whenIdle(): Promise<void> // :93
    cancel(cause: unknown, options?: unknown): void
    [key: string]: unknown
  }
  // packages/core/agent/src/index.ts:172
  export interface AgentHandle {
    agent: Agent
    dispose(): Promise<void>
  }
  // packages/core/agent/src/index.ts:69-71
  export type AgentSetup = (ctx: Context) => unknown
  // packages/core/agent/src/index.ts:80-133
  export interface CreateAgentOptions {
    readonly sessionId: SessionId
    readonly meta?: unknown
    readonly seed?: readonly unknown[]
    readonly agentOptions?: AgentOptions
    readonly signal?: AbortSignal
    readonly setup?: AgentSetup
  }
  // packages/core/agent/src/index.ts:256 (AgentRegistry)，create 见 :405
  export interface AgentRegistry {
    create(options: CreateAgentOptions): Promise<AgentHandle>
    get(id: SessionId): Agent | undefined
    [key: string]: unknown
  }
}

// ========================== @deepseek-ai/dsh-plan-mode ==========================
declare module '@deepseek-ai/dsh-plan-mode' {
  // packages/plan/plan-mode/src/index.ts:57-61（declare module Context { planMode: PlanModeController }）
  export interface PlanModeController {
    [key: string]: unknown
  }
}

// ============================ node:crypto (适配器运行期依赖) ============================
declare module 'node:crypto' {
  export function randomUUID(): string
}

// ============================ @deepseek-ai/cordis ============================
declare module '@deepseek-ai/cordis' {
  export class Service {
    constructor(ctx: Context, key: string)
    static inject?: string[] | Record<string, unknown>
    ctx: Context
    [key: string]: unknown
  }
  // 仅声明插件实际用到/注入的服务；非穷举。services 在运行时由 DSH 基座装配，
  // 插件经 static inject 声明依赖（agents/systemPrompt/tools/planMode 等）。
  export interface Context {
    plugin(plugin: unknown, config?: unknown): void
    get<T = unknown>(key: string): T | undefined
    inject(keys: string[] | Record<string, unknown>, cb?: unknown): void
    logger?: {
      info?(msg: string): void
      warn?(msg: string): void
      error?(msg: string): void
      debug?(msg: string): void
      [key: string]: unknown
    }
    // 必需服务（插件的 static inject 保证存在）
    agents: import('@deepseek-ai/dsh-agent').AgentRegistry
    tools: {
      register(definition: unknown): () => void
      // packages/core/tools/src/index.ts:1342；形参 ToolExecutionInput 见 :314
      execute(input: {
        callId: import('@deepseek-ai/dsh-llm').CallId
        name: string
        arguments: unknown
        signal: AbortSignal
        agent?: unknown
        rootCallId?: import('@deepseek-ai/dsh-llm').CallId
      }): Promise<{ content: import('@deepseek-ai/dsh-llm').ContentBlock[]; isError?: boolean }>
      [key: string]: unknown
    }
    systemPrompt: import('@deepseek-ai/dsh-system-prompt').SystemPrompt
    // 可选服务 / 跨插件依赖
    llm?: unknown
    planMode?: import('@deepseek-ai/dsh-plan-mode').PlanModeController
    hesiRoundtable?: { deriveVerify(question: string, rounds?: number): Promise<unknown> }
    hesiPlan?: unknown
    [key: string]: unknown
  }
}
