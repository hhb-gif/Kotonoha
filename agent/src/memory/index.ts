// ============================================================
// index.ts —— Memory 子系统统一导出
// 中文注释、英文标识符
// ============================================================

export * from './rules'
export * from './mentions'
export * from './bonds'
export * from './summarizer'
export * from './context'

import type { Db } from '../store/db'
import type { ModelProvider } from '../types'
import type { Tool } from '../types'
import { buildDefaultMemory, type MemoryEngine } from './context'

/**
 * 创建默认 MemoryEngine 实例
 * 
 * @param deps 依赖注入
 * @returns MemoryEngine 实例
 */
export function createMemoryEngine(deps: {
  db: Db
  providers: {
    get(id: string): ModelProvider | undefined
    list(): ModelProvider[]
    defaultId(): string
  }
  tools: Map<string, Tool>
}): MemoryEngine {
  return buildDefaultMemory(deps)
}