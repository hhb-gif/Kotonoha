// ============================================================
// export.ts —— 会话导出/导入（JSON 完整可恢复 + Markdown 可读）
// 中文注释、英文标识符
// ============================================================

import type { Db, HistoryEvent, SessionRecord } from '../types'

export const EXPORT_VERSION = 1
export const AGENT_VERSION = '0.1.0'

export interface ExportData {
  version: number
  session: SessionRecord
  events: HistoryEvent[]
  metadata: {
    exportedAt: string
    agentVersion: string
  }
}

// ---- JSON 导出/导入 ----

export async function exportSessionJson(db: Db, sessionId: string): Promise<string> {
  const session = db.getSession(sessionId)
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  const events = db.readEvents(sessionId)
  const data: ExportData = {
    version: EXPORT_VERSION,
    session,
    events,
    metadata: {
      exportedAt: new Date().toISOString(),
      agentVersion: AGENT_VERSION,
    },
  }

  return JSON.stringify(data, null, 2)
}

export async function importSessionJson(db: Db, jsonData: string): Promise<SessionRecord> {
  const data = JSON.parse(jsonData) as ExportData

  if (data.version !== EXPORT_VERSION) {
    throw new Error(`Unsupported export version: ${data.version}`)
  }

  const { session, events } = data

  // 创建新会话（新 ID，避免冲突）
  const newSession: SessionRecord = {
    ...session,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  }

  db.createSession(newSession)

  // 重放所有事件
  for (const ev of events) {
    db.appendEvent(newSession.id, ev)
  }

  return newSession
}

// ---- Markdown 导出 ----

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/\//g, '-')
}

function formatEvent(ev: HistoryEvent, index: number): string {
  const prefix = index > 0 ? '\n---\n\n' : ''
  const time = formatTimestamp(Date.now()) // 事件无时间戳，用导出时间近似

  if (ev.type === 'user/message') {
    const content = ev.data.content.map((c) => c.text).join('')
    return `${prefix}**你** (${time}):\n\n${content}\n`
  }

  if (ev.type === 'assistant/message') {
    const content = ev.data.message.content.map((c) => c.text).join('')
    return `${prefix}**言叶** (${time}):\n\n${content}\n`
  }

  return ''
}

export async function exportSessionMarkdown(db: Db, sessionId: string): Promise<string> {
  const session = db.getSession(sessionId)
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  const events = db.readEvents(sessionId)
  const exportedAt = new Date().toISOString().replace('T', ' ').slice(0, 19)

  let md = `# 对话记录: ${session.label}\n`
  md += `**导出时间**: ${exportedAt}\n`
  md += `**会话 ID**: ${session.id}\n`
  md += `**工作目录**: ${session.cwd}\n`
  md += `**模型**: ${session.provider} / ${session.model}\n\n`
  md += `---\n\n`

  for (let i = 0; i < events.length; i++) {
    md += formatEvent(events[i], i)
  }

  return md
}

// Markdown 无法完整导入（丢失结构化数据），仅提供导出
export async function importSessionMarkdown(
  _db: Db,
  _markdown: string
): Promise<SessionRecord> {
  throw new Error('Markdown import not supported (lossy format). Use JSON for round-trip.')
}