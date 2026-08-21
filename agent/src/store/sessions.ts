// ============================================================
// sessions.ts —— 会话记录工厂 / fork 复制 / 历史转 ChatMessage
// 依赖 Db 接口（types.ts），供 core 引擎使用
// 中文注释、英文标识符
// ============================================================

import { randomUUID } from 'node:crypto'
import type { ChatMessage, Db, HistoryEvent, SessionRecord } from '../types'

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