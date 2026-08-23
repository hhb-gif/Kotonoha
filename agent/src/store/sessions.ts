// ============================================================
// sessions.ts —— 会话记录工厂 / fork 复制 / 历史转 ChatMessage
// 依赖 Db 接口（types.ts），供 core 引擎使用
// 中文注释、英文标识符
// ============================================================

import { randomUUID } from 'node:crypto'
import type { ChatMessage, Db, HistoryEvent, SessionRecord, ModelProvider } from '../types'
import { exportSessionJson, importSessionJson, exportSessionMarkdown, importSessionMarkdown } from './export'
import { compressSession, type CompressOpts } from './compress'
import { archiveSession, unarchiveSession, listArchivedSessions, isArchived } from './archive'

export const DEFAULT_PROVIDER = 'deepseek-official'
export const DEFAULT_MODEL = 'deepseek-v4-flash'
export const DEFAULT_LABEL = '对话'

export function createSessionRecord(cwd: string): SessionRecord {
  const now = Date.now()
  return {
    id: randomUUID(),
    cwd,
    label: DEFAULT_LABEL,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    createdAt: now,
    lastActiveAt: now,
  }
}

export function forkSession(db: Db, sourceId: string): SessionRecord | null {
  const source = db.getSession(sourceId)
  if (!source) return null

  const events = db.readEvents(sourceId)
  const now = Date.now()
  const fork: SessionRecord = {
    id: randomUUID(),
    cwd: source.cwd,
    label: `${source.label}(fork)`,
    provider: source.provider,
    model: source.model,
    createdAt: now,
    lastActiveAt: now,
    // fork 继承源会话的激活工具集
    toolsets: source.toolsets,
  }

  db.createSession(fork)
  // 复制全部事件（appendEvent 自增 seq，保持原有顺序）
  for (const ev of events) {
    db.appendEvent(fork.id, ev)
  }
  return fork
}

function toChatMessage(ev: HistoryEvent): ChatMessage {
  switch (ev.type) {
    case 'user/message':
      return { role: 'user', content: ev.data.content.map((c) => c.text).join('') }
    case 'assistant/message':
      return {
        role: 'assistant',
        content: ev.data.message.content.map((c) => c.text).join(''),
      }
  }
}

export function historyToChatMessages(db: Db, sessionId: string): ChatMessage[] {
  return db.readEvents(sessionId).map(toChatMessage)
}

// ---- 新增：导出/导入 ----

export async function exportSession(
  db: Db,
  sessionId: string,
  format: 'json' | 'markdown'
): Promise<string> {
  if (format === 'json') {
    return exportSessionJson(db, sessionId)
  }
  return exportSessionMarkdown(db, sessionId)
}

export async function importSession(
  db: Db,
  data: string,
  format: 'json' | 'markdown'
): Promise<SessionRecord> {
  if (format === 'json') {
    return importSessionJson(db, data)
  }
  return importSessionMarkdown(db, data)
}

// ---- 新增：压缩 ----

export async function compressSessionStore(
  db: Db,
  sessionId: string,
  opts: CompressOpts,
  provider: ModelProvider
): Promise<{ originalEvents: number; compressedEvents: number; summary: string }> {
  return compressSession(db, sessionId, opts, provider)
}

// ---- 新增：归档/解归档 ----

export async function archiveSessionStore(db: Db, sessionId: string): Promise<void> {
  return archiveSession(db, sessionId)
}

export async function unarchiveSessionStore(db: Db, sessionId: string): Promise<void> {
  return unarchiveSession(db, sessionId)
}

export function listArchivedSessionsStore(db: Db): SessionRecord[] {
  return listArchivedSessions(db)
}

export function isSessionArchived(db: Db, sessionId: string): boolean {
  return isArchived(db, sessionId)
}