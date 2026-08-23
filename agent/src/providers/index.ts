// ============================================================
// index.ts —— Providers 统一导出 + 默认注册表构建
// 中文注释、英文标识符
// ============================================================

export type { ModelProvider, ProviderRegistry, ProviderCapability, StreamParams, ProviderChunk, ChatMessage, ToolDef } from '../types'
export { ProviderRegistryImpl, buildDefaultRegistry } from './registry'
export { OpenAICompatProvider, buildChatBody, requestChatStream, streamSSE, type OpenAICompatOptions, type ChatStreamRequestOptions, type SSEHandlers } from './openai-compat'
export { DeepSeekProvider, type DeepSeekOptions } from './deepseek'
export { AgnesProvider, type AgnesOptions } from './agnes'
export { OllamaProvider, type OllamaOptions } from './ollama'
export { estimateCost, exportCostCsv, getPricing, type ModelPricing, type CostRecord, PRICING_TABLE } from './cost'
export { executeWithFallback, createFallbackExecutor, type FallbackOptions, type FallbackContext, type FallbackLogger } from './fallback'
export { HealthMonitor, type HealthCheckResult } from './health'