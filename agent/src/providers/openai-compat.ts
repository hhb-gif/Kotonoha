// ============================================================
// openai-compat.ts —— 通用 OpenAI 兼容供应商适配器
// 同时承载公共 SSE 流解析（streamSSE）、请求体构建（buildChatBody）、
// 流式请求（requestChatStream），deepseek.ts 复用本文件导出。
// 中文注释、英文标识符
// ============================================================

import type { ModelProvider, ProviderChunk, StreamParams, ProviderCapability } from '../types'
import { estimateCost } from './cost'

// ---- 适配器 ----

export interface OpenAICompatOptions {
  id: string
  name: string
  baseURL: string
  apiKeyRef: string
  models: { id: string; name?: string }[]
  getKey: (ref: string) => string | undefined
  capabilities?: ProviderCapability[]  // 默认 ['chat', 'tool-calls']
}

export class OpenAICompatProvider implements ModelProvider {
  readonly id: string
  readonly name: string
  readonly capabilities: ProviderCapability[]
  private readonly baseURL: string
  private readonly apiKeyRef: string
  private readonly models: { id: string; name?: string }[]
  protected readonly getKey: (ref: string) => string | undefined

  constructor(opts: OpenAICompatOptions) {
    this.id = opts.id
    this.name = opts.name
    this.baseURL = opts.baseURL
    this.apiKeyRef = opts.apiKeyRef
    this.models = opts.models
    this.getKey = opts.getKey
    this.capabilities = opts.capabilities ?? ['chat', 'tool-calls']
  }

  async listModels(): Promise<{ id: string; name?: string }[]> {
    return this.models
  }

  async *streamChat(p: StreamParams): AsyncGenerator<ProviderChunk> {
    const resp = await requestChatStream({
      baseURL: this.baseURL,
      apiKeyRef: this.apiKeyRef,
      getKey: this.getKey,
      params: p,
    })
    for await (const chunk of streamSSE(resp, { signal: p.signal })) {
      yield chunk
    }
  }

  /** 健康检查：验证 API Key 配置且端点可达 */
  async healthCheck(): Promise<boolean> {
    const key = this.getKey(this.apiKeyRef)
    if (!key) return false
    try {
      const resp = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.models[0]?.id ?? 'test',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(5000),
      })
      return resp.status !== 401
    } catch {
      return false
    }
  }

  /** 成本估算：按模型定价表计算 */
  estimateCost(promptTokens: number, completionTokens: number): number {
    // 使用第一个模型作为定价参考（实际应按 modelId 查表）
    const modelId = this.models[0]?.id ?? ''
    return estimateCost(this.id, modelId, promptTokens, completionTokens)
  }
}

// ---- 公共：构建 OpenAI 兼容请求体 ----

export function buildChatBody(p: StreamParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: p.model,
    messages: p.messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content }
      // role==='tool' 的消息需要 tool_call_id 关联到 assistant 的 tool_calls
      if (m.role === 'tool' && m.toolCallId) msg.tool_call_id = m.toolCallId
      // assistant 的 tool_calls 必须原样回传，否则后续 tool 消息非法
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.args },
        }))
      }
      return msg
    }),
    stream: true,
    max_tokens: 4096,
  }
  // 有 tools 才传；仅含 role==='tool' 历史消息的请求不传 tools 也合法
  if (p.tools && p.tools.length > 0) {
    body.tools = p.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
    body.tool_choice = 'auto'
  }
  return body
}

// ---- 公共：发起流式请求（key 检查 / 网络错误 / 非 2xx 均抛 Error） ----

export interface ChatStreamRequestOptions {
  baseURL: string
  apiKeyRef: string
  getKey: (ref: string) => string | undefined
  params: StreamParams
}

export async function requestChatStream(
  opts: ChatStreamRequestOptions
): Promise<Response> {
  const key = opts.getKey(opts.apiKeyRef)
  if (!key) throw new Error(`未配置 ${opts.apiKeyRef}`)
  let resp: Response
  try {
    resp = await fetch(opts.baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(buildChatBody(opts.params)),
      signal: opts.params.signal,
    })
  } catch (e) {
    throw new Error(`[${opts.apiKeyRef}] 网络错误: ${(e as Error).message}`)
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`[${opts.apiKeyRef}] HTTP ${resp.status}: ${text}`)
  }
  return resp
}

// ---- 公共：SSE 解析 + tool_calls 分片聚合 ----

export interface SSEHandlers {
  signal?: AbortSignal
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
  onToolCall?: (call: { id: string; name: string; args: string }) => void
  onDone?: () => void
}

interface ToolCallAccum {
  index: number
  id: string
  name: string
  args: string
  flushed: boolean
}

export async function* streamSSE(
  resp: Response,
  handlers: SSEHandlers = {}
): AsyncGenerator<ProviderChunk> {
  if (!resp.body) throw new Error('SSE 响应无 body 流')
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // 工具调用按 index 缓存，跨 chunk 拼接 arguments 分片
  const calls = new Map<number, ToolCallAccum>()
  const onAbort = (): void => {
    reader.cancel().catch(() => {})
  }
  handlers.signal?.addEventListener('abort', onAbort)

  const flushCall = (acc: ToolCallAccum): ProviderChunk | null => {
    if (acc.flushed) return null
    acc.flushed = true
    const call = { id: acc.id, name: acc.name, args: acc.args }
    handlers.onToolCall?.(call)
    return { kind: 'tool-call', ...call }
  }
  const flushAll = (): ProviderChunk[] => {
    const out: ProviderChunk[] = []
    for (const acc of calls.values()) {
      const chunk = flushCall(acc)
      if (chunk) out.push(chunk)
    }
    return out
  }
  const emitDone = (): ProviderChunk => {
    handlers.onDone?.()
    return { kind: 'done' }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // 按行切分，留最后一行（可能不完整）进下轮
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          for (const c of flushAll()) yield c
          yield emitDone()
          return
        }
        let json: any
        try {
          json = JSON.parse(payload)
        } catch {
          continue // 非 JSON 行（如 keep-alive）忽略
        }
        const choice = json?.choices?.[0]
        if (!choice) continue
        const delta = choice.delta ?? {}
        if (typeof delta.content === 'string' && delta.content !== '') {
          handlers.onText?.(delta.content)
          yield { kind: 'text', text: delta.content }
        }
        if (
          typeof delta.reasoning_content === 'string' &&
          delta.reasoning_content !== ''
        ) {
          handlers.onReasoning?.(delta.reasoning_content)
          yield { kind: 'reasoning', text: delta.reasoning_content }
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            if (!tc || typeof tc !== 'object') continue
            const idx = typeof tc.index === 'number' ? tc.index : 0
            let acc = calls.get(idx)
            if (!acc) {
              acc = {
                index: idx,
                id: typeof tc.id === 'string' ? tc.id : `call_${idx}`,
                name:
                  typeof tc.function?.name === 'string'
                    ? tc.function.name
                    : '',
                args: '',
                flushed: false,
              }
              calls.set(idx, acc)
            }
            // 首片带 id/name，后续片只有 index + arguments 分片
            if (typeof tc.id === 'string') acc.id = tc.id
            if (typeof tc.function?.name === 'string') acc.name = tc.function.name
            if (typeof tc.function?.arguments === 'string') {
              acc.args += tc.function.arguments
            }
          }
          // arguments 收到 '}' 结尾视为该调用 JSON 完整，立即聚合 yield
          for (const acc of calls.values()) {
            if (!acc.flushed && acc.args.endsWith('}')) {
              const chunk = flushCall(acc)
              if (chunk) yield chunk
            }
          }
        }
        if (choice.finish_reason) {
          // 收尾：兜底 flush 未完成的调用 + done
          for (const c of flushAll()) yield c
          yield emitDone()
          return
        }
      }
    }
    // 流自然结束（无 [DONE]、无 finish_reason）
    for (const c of flushAll()) yield c
    yield emitDone()
  } finally {
    handlers.signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}