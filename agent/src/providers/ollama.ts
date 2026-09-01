// ============================================================
// ollama.ts —— Ollama 本地供应商
// /api/chat (OpenAI 兼容) + /api/tags 模型自动发现
// 支持 GPU 分层 (num_gpu) 配置
// 中文注释、英文标识符
// ============================================================

import type { ModelProvider, StreamParams, ProviderChunk, ProviderCapability } from '../types'
import { buildChatBody } from './openai-compat'

export interface OllamaOptions {
  baseURL?: string           // 默认 http://127.0.0.1:11434
  numGpu?: number            // GPU 层数 (-1=全量, 0=纯 CPU)
  getKey?: () => string | undefined  // 兼容接口，Ollama 通常无需 key
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
const CHAT_ENDPOINT = '/api/chat'
const TAGS_ENDPOINT = '/api/tags'

interface OllamaModelInfo {
  name: string
  size: number
  digest: string
  details?: {
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

interface TagsResponse {
  models: OllamaModelInfo[]
}

export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama'
  readonly name = 'Ollama 本地'
  readonly capabilities: ProviderCapability[] = ['chat', 'reasoning', 'tool-calls']

  private readonly baseURL: string
  private readonly chatURL: string
  private readonly tagsURL: string
  private readonly numGpu: number
  private readonly getKey: () => string | undefined
  private modelCache: { id: string; name?: string }[] | null = null

  constructor(opts: OllamaOptions = {}) {
    this.baseURL = opts.baseURL ?? DEFAULT_BASE_URL
    this.chatURL = `${this.baseURL}${CHAT_ENDPOINT}`
    this.tagsURL = `${this.baseURL}${TAGS_ENDPOINT}`
    this.numGpu = opts.numGpu ?? -1
    this.getKey = opts.getKey ?? (() => undefined)
  }

  /** 自动发现本地模型 (/api/tags) */
  async listModels(): Promise<{ id: string; name?: string }[]> {
    if (this.modelCache) return this.modelCache

    try {
      const resp = await fetch(this.tagsURL, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data: TagsResponse = await resp.json()
      this.modelCache = data.models.map(m => ({ id: m.name, name: m.name }))
      return this.modelCache
    } catch (e) {
      // 无法连接 Ollama 时返回空列表，不抛错
      console.warn('[Ollama] 无法获取模型列表:', (e as Error).message)
      this.modelCache = []
      return []
    }
  }

  /** 健康检查：尝试访问 /api/tags */
  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(this.tagsURL, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })
      return resp.ok
    } catch {
      return false
    }
  }

  /** 成本估算：本地免费 */
  estimateCost(_promptTokens: number, _completionTokens: number): number {
    return 0
  }

  async *streamChat(p: StreamParams): AsyncGenerator<ProviderChunk> {
    // Ollama /api/chat 需要在 body 中传递 options (num_gpu 等)
    const body = buildChatBody(p)
    body.options = { num_gpu: this.numGpu }

    const key = this.getKey()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (key) headers.Authorization = `Bearer ${key}`

    let resp: Response
    try {
      resp = await fetch(this.chatURL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: p.signal,
      })
    } catch (e) {
      throw new Error(`[Ollama] 网络错误: ${(e as Error).message}`)
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`[Ollama] HTTP ${resp.status}: ${text}`)
    }

    // Ollama 返回的是 NDJSON 而非 SSE，逐行解析
    if (!resp.body) throw new Error('Ollama 响应无 body 流')
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let json: any
          try {
            json = JSON.parse(line)
          } catch {
            continue
          }

          // Ollama 格式: { message: { role, content }, done: boolean }
          if (json.message?.content) {
            yield { kind: 'text', text: json.message.content }
          }
          if (json.done) {
            yield { kind: 'done' }
            return
          }
        }
      }
      yield { kind: 'done' }
    } finally {
      reader.releaseLock()
    }
  }

  /** 清除模型缓存，强制下次重新发现 */
  invalidateModelCache(): void {
    this.modelCache = null
  }
}