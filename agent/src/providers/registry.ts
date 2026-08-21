// ============================================================
// registry.ts —— 供应商注册表 + 默认注册表构建
// 中文注释、英文标识符
// ============================================================

import type { ModelProvider } from '../types'
import { DeepSeekProvider } from './deepseek'
import { OpenAICompatProvider } from './openai-compat'

const DEFAULT_PROVIDER_ID = 'deepseek-official'

export class ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>()

  // 同 id 覆盖
  register(p: ModelProvider): void {
    this.providers.set(p.id, p)
  }

  get(id: string): ModelProvider | undefined {
    return this.providers.get(id)
  }

  list(): ModelProvider[] {
    return [...this.providers.values()]
  }

  defaultId(): string {
    return DEFAULT_PROVIDER_ID
  }
}

// 默认注册表：deepseek-official + agnes（OpenAI 兼容）
// agnes 无 key 也注册——缺 key 的报错留到运行时 streamChat 才抛
export function buildDefaultRegistry(
  getKey: (ref: string) => string | undefined
): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register(
    new DeepSeekProvider({ getKey: () => getKey('DEEPSEEK_API_KEY') })
  )
  registry.register(
    new OpenAICompatProvider({
      id: 'agnes',
      name: 'Agnes AI',
      baseURL: 'https://apihub.agnes-ai.com/v1/chat/completions',
      apiKeyRef: 'AGNES_API_KEY',
      models: [{ id: 'agnes-chat-v1' }],
      getKey,
    })
  )
  return registry
}