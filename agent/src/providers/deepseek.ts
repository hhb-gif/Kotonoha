// ============================================================
// deepseek.ts —— DeepSeek 官方供应商（OpenAI 兼容 + function calling）
// baseURL: https://api.deepseek.com/chat/completions
// 复用 openai-compat.ts 的 requestChatStream / streamSSE。
// 中文注释、英文标识符
// ============================================================

import type { ModelProvider, ProviderChunk, StreamParams } from '../types'
import { requestChatStream, streamSSE } from './openai-compat'

const BASE_URL = 'https://api.deepseek.com/chat/completions'
const API_KEY_REF = 'DEEPSEEK_API_KEY'

export interface DeepSeekOptions {
  // 由集成方注入：读 secrets 的 DEEPSEEK_API_KEY
  getKey: () => string | undefined
}

export class DeepSeekProvider implements ModelProvider {
  readonly id = 'deepseek-official'
  readonly name = 'DeepSeek 官方'
  private readonly getKey: () => string | undefined

  constructor(opts: DeepSeekOptions) {
    this.getKey = opts.getKey
  }

  // 固定列表，不调 API
  async listModels(): Promise<{ id: string; name?: string }[]> {
    return [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4' }]
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
}