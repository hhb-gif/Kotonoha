// ============================================================
// db.ts —— SQLite 持久化层（better-sqlite3，单文件 data/kotonoha.db）
// 实现 types.ts 的 Db 接口；建表 SQL 严格按规划 agent-harness-m0.md 第 2 节
// 中文注释、英文标识符
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Db, HistoryEvent, SessionRecord } from '../types'

// 行映射：SQLite 下划线列名 → SessionRecord 驼峰字段
interface SessionRow {
  id: string
  cwd: string
  label: string
  provider: string
  model: string
  created_at: number
  last_active_at: number
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    cwd: row.cwd,
    label: row.label,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  }
}

const SESSION_COLUMNS =
  'id, cwd, label, provider, model, created_at, last_active_at'

export function openDb(dir: string): Db {
  // 目录不存在则创建
  fs.mkdirSync(dir, { recursive: true })

  const db = new Database(path.join(dir, 'kotonoha.db'))
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '对话',
      provider TEXT NOT NULL DEFAULT 'deepseek-official',
      model TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload TEXT NOT NULL,
      UNIQUE(session_id, seq)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // ---- prepared statements ----
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, cwd, label, provider, model, created_at, last_active_at)
     VALUES (@id, @cwd, @label, @provider, @model, @createdAt, @lastActiveAt)`
  )
  const selectSession = db.prepare(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`
  )
  const selectAllSessions = db.prepare(
    `SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY last_active_at DESC`
  )
  const insertEvent = db.prepare(
    `INSERT INTO events (session_id, seq, payload) VALUES (?, ?, ?)`
  )
  const selectMaxSeq = db.prepare(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM events WHERE session_id = ?`
  )
  const selectEvents = db.prepare(
    `SELECT payload FROM events WHERE session_id = ? ORDER BY seq ASC`
  )
  const selectSetting = db.prepare(
    `SELECT value FROM settings WHERE key = ?`
  )
  const upsertSetting = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  const deleteEvents = db.prepare(
    `DELETE FROM events WHERE session_id = ?`
  )
  const deleteSessionStmt = db.prepare(
    `DELETE FROM sessions WHERE id = ?`
  )

  // 删除会话 = 删 events + 删 sessions，事务保证原子性
  const deleteSessionTx = db.transaction((id: string) => {
    deleteEvents.run(id)
    deleteSessionStmt.run(id)
  })

  // 会话表可被动态更新的字段（last_active_at 恒随更新刷新）
  const UPDATABLE: { field: keyof SessionRecord; column: string }[] = [
    { field: 'cwd', column: 'cwd' },
    { field: 'label', column: 'label' },
    { field: 'provider', column: 'provider' },
    { field: 'model', column: 'model' },
  ]

  return {
    createSession(rec: SessionRecord): void {
      insertSession.run({
        id: rec.id,
        cwd: rec.cwd,
        label: rec.label,
        provider: rec.provider,
        model: rec.model,
        createdAt: rec.createdAt,
        lastActiveAt: rec.lastActiveAt,
      })
    },

    getSession(id: string): SessionRecord | null {
      const row = selectSession.get(id) as SessionRow | undefined
      return row ? toSessionRecord(row) : null
    },

    listSessions(): SessionRecord[] {
      return (selectAllSessions.all() as SessionRow[]).map(toSessionRecord)
    },

    updateSession(id: string, patch: Partial<SessionRecord>): void {
      const sets: string[] = []
      const params: Record<string, unknown> = { id, lastActiveAt: Date.now() }
      for (const { field, column } of UPDATABLE) {
        if (patch[field] !== undefined) {
          sets.push(`${column} = @${field}`)
          params[field] = patch[field]
        }
      }
      sets.push('last_active_at = @lastActiveAt')
      db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = @id`).run(params)
    },

    deleteSession(id: string): void {
      deleteSessionTx(id)
    },

    appendEvent(sessionId: string, ev: HistoryEvent): void {
      const row = selectMaxSeq.get(sessionId) as { next_seq: number }
      insertEvent.run(sessionId, row.next_seq, JSON.stringify(ev))
    },

    readEvents(sessionId: string): HistoryEvent[] {
      const rows = selectEvents.all(sessionId) as { payload: string }[]
      return rows.map((r) => JSON.parse(r.payload) as HistoryEvent)
    },

    getSetting(key: string): string | null {
      const row = selectSetting.get(key) as { value: string } | undefined
      return row ? (JSON.parse(row.value) as string) : null
    },

    setSetting(key: string, value: string): void {
      upsertSetting.run(key, JSON.stringify(value))
    },

    close(): void {
      db.close()
    },
  }
}