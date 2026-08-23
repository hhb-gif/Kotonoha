// ============================================================
// deepseek.ts —— DeepSeek 官方供应商（OpenAI 兼容 + function calling + thinking）
// baseURL: https://api.deepseek.com/chat/completions
// 复用 openai-compat.ts 的 requestChatStream / streamSSE。
// 中文注释、英文标识符
// ============================================================

import type { ModelProvider, ProviderChunk, StreamParams, ProviderCapability } from '../types'
import { requestChatStream, streamSSE } from './openai-compat'
import { estimateCost } from './cost'

const BASE_URL = 'https://api.deepseek.com/chat/completions'
const API_KEY_REF = 'DEEPSEEK_API_KEY'

// 官方模型清单（2026-08）：deepseek-chat/reasoner 已弃用（2026-07-24），当前为 V4 系列
const MODELS = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash（推荐，快速低成本）' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro（旗舰，更强推理）' },
  { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision（多模态实验）' },
]

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

  // 固定列表，不调 API（官方 /models 端点需登录态，直接维护清单）
  async listModels(): Promise<{ id: string; name?: string }[]> {
    return MODELS
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
          model: 'deepseek-v4-flash',
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

  /** 成本估算：按当前默认模型（V4 Flash）定价计算 */
  estimateCost(promptTokens: number, completionTokens: number): number {
    return estimateCost(this.id, 'deepseek-v4-flash', promptTokens, completionTokens)
  }
}