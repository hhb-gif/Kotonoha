// ============================================================
// deepseek.ts —— DeepSeek 官方供应商（OpenAI 兼容 + function calling）
// baseURL: https://api.deepseek.com/chat/completions
// 复用 openai-compat.ts 的 requestChatStream / streamSSE。
// 中文注释、英文标识符
// ============================================================

import type { ModelProvider, ProviderChunk, StreamParams, ProviderCapability } from '../types'
import { requestChatStream, streamSSE } from './openai-compat'
import { estimateCost } from './cost'

const BASE_URL = 'https://api.deepseek.com/chat/completions'
const API_KEY_REF = 'DEEPSEEK_API_KEY'

export interface DeepSeekOptions {
  // 由集成方注入：读 secrets 的 DEEPSEEK_API_KEY
  getKey: () => string | undefined
}

export class DeepSeekProvider implements ModelProvider {
  readonly id = 'deepseek-official'
  readonly name = 'DeepSeek 官方'
  readonly capabilities: ProviderCapability[] = ['chat', 'reasoning', 'tool-calls']
  private readonly getKey: () => string | undefined

  constructor(opts: DeepSeekOptions) {
    this.getKey = opts.getKey
  }

  // 固定列表，不调 API
  async listModels(): Promise<{ id: string; name?: string }[]> {
    return [{ id: 'deepseek-chat', name: 'DeepSeek V3 (Chat)' }, { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoning)' }]
  }

  async *streamChat(p: StreamParams): AsyncGenerator<ProviderChunk> {
    const resp = await requestChatStream({
      baseURL: BASE_URL,
      apiKeyRef: API_KEY_REF,
      getKey: () => this.getKey(),
      params: p,
    })
    for await (const chunk of streamSSE(resp, { signal: p.signal })) {
      yield chunk
    }
  }

  /** 健康检查：验证 API Key 配置且端点可达 */
  async healthCheck(): Promise<boolean> {
    const key = this.getKey()
    if (!key) return false
    try {
      const resp = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
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

  /** 成本估算：按 DeepSeek 官方定价计算 */
  estimateCost(promptTokens: number, completionTokens: number): number {
    // 使用当前模型作为定价参考
    return estimateCost(this.id, 'deepseek-chat', promptTokens, completionTokens)
  }
}