// ============================================================
// archive.ts —— 会话归档/解归档（软删，单独表 archived_sessions）
// 中文注释、英文标识符
// ============================================================

import type { Db, SessionRecord } from '../types'

export interface ArchiveRecord {
  id: string
  sessionId: string
  archivedAt: number
  originalData: string // JSON string of SessionRecord
}

const ARCHIVE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS archived_sessions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    archived_at INTEGER NOT NULL,
    original_data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_archived_session_id ON archived_sessions(session_id);
`

export function ensureArchiveTable(db: any): void {
  db.exec(ARCHIVE_TABLE_SQL)
}

const insertArchive = (db: any) =>
  db.prepare(
    `INSERT INTO archived_sessions (id, session_id, archived_at, original_data)
     VALUES (@id, @sessionId, @archivedAt, @originalData)`
  )

const selectArchive = (db: any) =>
  db.prepare(`SELECT * FROM archived_sessions WHERE session_id = ?`)

const selectAllArchives = (db: any) =>
  db.prepare(`SELECT * FROM archived_sessions ORDER BY archived_at DESC`)

const deleteArchive = (db: any) =>
  db.prepare(`DELETE FROM archived_sessions WHERE session_id = ?`)

// 为 sessions 表添加 archived_at 列（迁移）
export function migrateAddArchivedColumn(db: any): void {
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN archived_at INTEGER DEFAULT 0`)
  } catch {
    // 列已存在，忽略
  }
}

export function archiveSession(db: Db, sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const session = db.getSession(sessionId)
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      const sqliteDb = (db as any).db // 访问底层 better-sqlite3 实例
      ensureArchiveTable(sqliteDb)
      migrateAddArchivedColumn(sqliteDb)

      const now = Date.now()
      const archiveId = crypto.randomUUID()

      // 事务：写入归档表 + 标记会话为已归档
      const tx = sqliteDb.transaction(() => {
        insertArchive(sqliteDb).run({
          id: archiveId,
          sessionId,
          archivedAt: now,
          originalData: JSON.stringify(session),
        })
        sqliteDb.prepare(`UPDATE sessions SET archived_at = ? WHERE id = ?`).run(now, sessionId)
      })

      tx()
      resolve()
    } catch (e) {
      reject(e)
    }
  })
}

export function unarchiveSession(db: Db, sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const sqliteDb = (db as any).db
      ensureArchiveTable(sqliteDb)

      const archive = selectArchive(sqliteDb).get(sessionId) as ArchiveRecord | undefined
      if (!archive) {
        throw new Error(`Archived session not found: ${sessionId}`)
      }

      const tx = sqliteDb.transaction(() => {
        deleteArchive(sqliteDb).run(sessionId)
        sqliteDb.prepare(`UPDATE sessions SET archived_at = 0 WHERE id = ?`).run(sessionId)
      })

      tx()
      resolve()
    } catch (e) {
      reject(e)
    }
  })
}

export function listArchivedSessions(db: Db): SessionRecord[] {
  const sqliteDb = (db as any).db
  ensureArchiveTable(sqliteDb)

  const rows = selectAllArchives(sqliteDb).all() as ArchiveRecord[]
  return rows.map((r) => JSON.parse(r.originalData) as SessionRecord)
}

export function isArchived(db: Db, sessionId: string): boolean {
  const session = db.getSession(sessionId)
  if (!session) return false
  const sqliteDb = (db as any).db
  const row = sqliteDb.prepare(`SELECT archived_at FROM sessions WHERE id = ?`).get(sessionId) as
    | { archived_at: number }
    | undefined
  return (row?.archived_at ?? 0) > 0
}