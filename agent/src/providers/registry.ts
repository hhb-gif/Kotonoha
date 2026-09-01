// ============================================================
// registry.ts —— 供应商注册表 + 默认注册表构建 + 降级链
// 中文注释、英文标识符
// ============================================================

import type { ModelProvider, ProviderRegistry } from '../types'
import { DeepSeekProvider } from './deepseek'
import { AgnesProvider } from './agnes'
import { OllamaProvider } from './ollama'

const DEFAULT_PROVIDER_ID = 'deepseek-official'

export class ProviderRegistryImpl implements ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>()
  private fallbackChain: string[] = [DEFAULT_PROVIDER_ID]

  // 同 id 覆盖
  register(p: ModelProvider): void {
    this.providers.set(p.id, p)
    // 新注册的 provider 若不在 fallback 链中，加到末尾
    if (!this.fallbackChain.includes(p.id)) {
      this.fallbackChain.push(p.id)
    }
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

  unregister(id: string): void {
    this.providers.delete(id)
    this.fallbackChain = this.fallbackChain.filter(x => x !== id)
  }

  setFallbackChain(chain: string[]): void {
    // 验证所有 id 都已注册
    for (const id of chain) {
      if (!this.providers.has(id)) {
        throw new Error(`Provider "${id}" 未注册，无法加入降级链`)
      }
    }
    this.fallbackChain = [...chain]
  }

  getFallbackChain(): string[] {
    return [...this.fallbackChain]
  }
}

// 默认注册表：DeepSeek + Agnes + Ollama
// 用户可在设置面板增删自定义 OpenAI 兼容端点
export function buildDefaultRegistry(
  getKey: (ref: string) => string | undefined
): ProviderRegistry {
  const registry = new ProviderRegistryImpl()

  // DeepSeek 官方
  registry.register(
    new DeepSeekProvider({ getKey: () => getKey('DEEPSEEK_API_KEY') })
  )

  // Agnes AI (图像/视频)
  registry.register(
    new AgnesProvider({ getKey })
  )

  // Ollama 本地 (通常无需 key，传空函数兼容)
  registry.register(
    new OllamaProvider({ getKey: () => getKey('OLLAMA_API_KEY') })
  )

  return registry
}