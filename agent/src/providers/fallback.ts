// ============================================================
// fallback.ts —— 降级链执行器
// 支持：超时、5xx、429 限流自动切换到下一供应商
// 日志记录切换原因
// 中文注释、英文标识符
// ============================================================

import type { ModelProvider, StreamParams, ProviderChunk } from '../types'

export interface FallbackOptions {
  /** 单次请求超时 (ms) */
  timeoutMs?: number
  /** 可重试的 HTTP 状态码 */
  retryStatusCodes?: number[]
  /** 最大重试次数（每个 provider） */
  maxRetries?: number
}

export interface FallbackContext {
  providerId: string
  modelId: string
  attempt: number
  error: Error
  willRetry: boolean
  nextProviderId?: string
}

export type FallbackLogger = (ctx: FallbackContext) => void

const DEFAULT_RETRY_CODES = [408, 429, 500, 502, 503, 504]
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 1

/**
 * 判断错误是否可重试
 */
function isRetryableError(error: Error, retryCodes: number[]): boolean {
  // 网络错误 / AbortError / 超时
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
  // HTTP 状态码错误
  const match = error.message.match(/HTTP (\d{3})/)
  if (match) {
    const code = parseInt(match[1], 10)
    return retryCodes.includes(code)
  }
  // fetch 抛出的 TypeError (网络失败)
  if (error instanceof TypeError && error.message.includes('fetch')) return true
  return false
}

/**
 * 执行带降级链的流式聊天
 * @param providers 供应商列表（按优先级排序）
 * @param params 流式参数
 * @param logger 切换日志回调
 * @param options 降级选项
 * @returns AsyncGenerator<ProviderChunk>
 */
export async function* executeWithFallback(
  providers: ModelProvider[],
  params: StreamParams,
  logger: FallbackLogger = () => {},
  options: FallbackOptions = {}
): AsyncGenerator<ProviderChunk> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryStatusCodes = DEFAULT_RETRY_CODES,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options

  let lastError: Error | null = null

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]
    let attempt = 0

    while (attempt <= maxRetries) {
      // 创建带超时的 AbortSignal
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      // 合并外部 signal
      const signal = params.signal
        ? AbortSignal.any([params.signal, controller.signal])
        : controller.signal

      try {
        // 尝试流式调用
        const stream = provider.streamChat({ ...params, signal })
        let hasYielded = false

        for await (const chunk of stream) {
          hasYielded = true
          yield chunk
        }

        // 成功完成，清理并返回
        clearTimeout(timeoutId)
        if (hasYielded) return
        // 没有 yield 任何 chunk 视为失败，尝试重试
      } catch (error) {
        lastError = error as Error
        const willRetry = attempt < maxRetries && isRetryableError(lastError, retryStatusCodes)
        const nextProvider = providers[i + 1]

        logger({
          providerId: provider.id,
          modelId: params.model,
          attempt,
          error: lastError,
          willRetry,
          nextProviderId: willRetry ? provider.id : nextProvider?.id,
        })

        clearTimeout(timeoutId)

        if (!willRetry) {
          // 不再重试当前 provider，跳出内层循环进入下一个 provider
          break
        }
        // 重试：短暂等待后继续
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        attempt++
        continue
      }

      clearTimeout(timeoutId)
      break // 成功或不可重试错误，跳出重试循环
    }

    // 当前 provider 彻底失败，继续下一个
    if (i === providers.length - 1) {
      // 最后一个 provider 也失败了
      throw lastError ?? new Error('所有供应商均不可用')
    }
  }

  // 理论上不会到达这里
  throw lastError ?? new Error('降级链执行异常结束')
}

/**
 * 从注册表构建降级链执行器
 */
export function createFallbackExecutor(
  registry: { get: (id: string) => ModelProvider | undefined; getFallbackChain: () => string[] },
  logger?: FallbackLogger,
  options?: FallbackOptions
) {
  const chain = registry.getFallbackChain()
  const providers = chain.map(id => registry.get(id)).filter((p): p is ModelProvider => !!p)

  return async function* execute(params: StreamParams): AsyncGenerator<ProviderChunk> {
    yield* executeWithFallback(providers, params, logger ?? (() => {}), options)
  }
}