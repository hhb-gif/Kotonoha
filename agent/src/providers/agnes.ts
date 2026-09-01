// ============================================================
// agnes.ts —— Agnes AI 供应商 (图像/视频生成)
// OpenAI 兼容接口，但模型为非聊天类型
// chat 报错友好提示，引导用户使用正确工具
// 中文注释、英文标识符
// ============================================================

import type { StreamParams, ProviderChunk, ProviderCapability } from '../types'
import { OpenAICompatProvider } from './openai-compat'

const BASE_URL = 'https://apihub.agnes-ai.com/v1/chat/completions'
const API_KEY_REF = 'AGNES_API_KEY'

export interface AgnesOptions {
  getKey: (ref: string) => string | undefined
}

export class AgnesProvider extends OpenAICompatProvider {
  readonly id = 'agnes'
  readonly name = 'Agnes AI'
  readonly capabilities: ProviderCapability[] = ['image', 'video']

  constructor(opts: AgnesOptions) {
    super({
      id: 'agnes',
      name: 'Agnes AI',
      baseURL: BASE_URL,
      apiKeyRef: API_KEY_REF,
      models: [
        { id: 'agnes-image-2.1-flash', name: 'Agnes 图像生成 2.1 Flash' },
        { id: 'agnes-video-v2.0', name: 'Agnes 视频生成 v2.0' },
      ],
      getKey: opts.getKey,
    })
  }

  /** 图像/视频模型不支持聊天，调用时抛出友好错误 */
  override async *streamChat(p: StreamParams): AsyncGenerator<ProviderChunk> {
    const model = p.model
    const isImage = model.includes('image')
    const isVideo = model.includes('video')
    const typeLabel = isImage ? '图像生成' : isVideo ? '视频生成' : '媒体生成'

    throw new Error(
      `[Agnes] ${this.name} 的 "${model}" 是 ${typeLabel} 模型，不支持流式聊天。\n` +
      `请使用专门的 ${typeLabel} 工具，或切换到支持聊天的模型 (如 DeepSeek、Ollama)。`
    )
  }

  /** 健康检查：验证 API Key 是否配置 */
  async healthCheck(): Promise<boolean> {
    const key = this.getKey(API_KEY_REF)
    if (!key) return false
    try {
      const resp = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: 'agnes-image-2.1-flash', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(5000),
      })
      return resp.status !== 401 // 401 表示 key 无效，其他视为服务可达
    } catch {
      return false
    }
  }

  /** 成本估算：按次计费，非 token，此处返回 0 */
  override estimateCost(_promptTokens: number, _completionTokens: number): number {
    return 0
  }
}