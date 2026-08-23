// ============================================================
// index.ts —— Store 层统一导出 + 默认 Store 构建
// 中文注释、英文标识符
// ============================================================

import { openDb } from './db'
import { openSecrets } from './secrets'
import type { Db, SecretsStore } from '../types'
import {
  createSessionRecord,
  forkSession,
  historyToChatMessages,
  exportSession,
  importSession,
  compressSessionStore,
  archiveSessionStore,
  unarchiveSessionStore,
  listArchivedSessionsStore,
  isSessionArchived,
} from './sessions'
import type { CompressOpts } from './compress'

export interface SessionStore {
  // 基础
  createSession(cwd: string): ReturnType<typeof createSessionRecord>
  getSession(id: string): ReturnType<Db['getSession']>
  updateSession(id: string, patch: Partial<ReturnType<typeof createSessionRecord>>): ReturnType<Db['updateSession']>
  deleteSession(id: string): ReturnType<Db['deleteSession']>
  listSessions(): ReturnType<Db['listSessions']>
  forkSession(id: string): ReturnType<typeof forkSession>
  // 历史
  appendEvent(id: string, event: any): ReturnType<Db['appendEvent']>
  readEvents(id: string): ReturnType<Db['readEvents']>
  // 新增
  exportSession(id: string, format: 'json' | 'markdown'): Promise<string>
  importSession(data: string, format: 'json' | 'markdown'): Promise<ReturnType<typeof createSessionRecord>>
  compressSession(id: string, opts: CompressOpts): Promise<{ originalEvents: number; compressedEvents: number; summary: string }>
  archiveSession(id: string): Promise<void>
  unarchiveSession(id: string): Promise<void>
  listArchivedSessions(): ReturnType<typeof listArchivedSessionsStore>
  isArchived(id: string): boolean
  // 底层访问
  db: Db
  secrets: SecretsStore
}

export function buildDefaultStore(dataDir: string, envSecret?: string): SessionStore {
  const db = openDb(dataDir)
  const secrets = openSecrets(dataDir, envSecret)

  // 从 providers 获取默认小模型（用于压缩摘要）
  // 这里不直接依赖 providers，调用方需传入 provider 实例
  const getDefaultSummarizeModel = (): string => 'deepseek-v4-flash'

  return {
    // 基础
    createSession: (cwd: string) => createSessionRecord(cwd),
    getSession: (id: string) => db.getSession(id),
    updateSession: (id: string, patch) => db.updateSession(id, patch),
    deleteSession: (id: string) => db.deleteSession(id),
    listSessions: () => db.listSessions(),
    forkSession: (id: string) => forkSession(db, id),
    // 历史
    appendEvent: (id: string, event: any) => db.appendEvent(id, event),
    readEvents: (id: string) => db.readEvents(id),
    // 新增
    exportSession: async (id: string, format: 'json' | 'markdown') => exportSession(db, id, format),
    importSession: async (data: string, format: 'json' | 'markdown') => importSession(db, data, format),
    compressSession: async (id: string, opts: CompressOpts) => {
      // 需要从外部注入 provider，这里抛出提示
      throw new Error('compressSession requires a ModelProvider. Use compressSessionStore directly with provider.')
    },
    archiveSession: async (id: string) => archiveSessionStore(db, id),
    unarchiveSession: async (id: string) => unarchiveSessionStore(db, id),
    listArchivedSessions: () => listArchivedSessionsStore(db),
    isArchived: (id: string) => isSessionArchived(db, id),
    // 底层访问
    db,
    secrets,
  }
}

// 导出所有子模块
export * from './db'
export * from './secrets'
export * from './sessions'
export * from './export'
export * from './compress'
export * from './archive'
// E-ops（M4-4.1 成本 / M3-3.3 全文搜索）
export * from './cost'
export * from './search'
// M4-4.2 降级记录
export * from './degradations'