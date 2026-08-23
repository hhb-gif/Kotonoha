// ============================================================
// db.ts —— SQLite 持久化层（better-sqlite3，单文件 data/kotonoha.db）
// 实现 types.ts 的 Db 接口；建表 SQL 严格按规划 agent-harness-m0.md 第 2 节
// 中文注释、英文标识符
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Db, HistoryEvent, MemoryEntry, SessionRecord, SkillEntry } from '../types'

export type { Db }

// 行映射：SQLite 下划线列名 → SessionRecord 驼峰字段
interface SessionRow {
  id: string
  cwd: string
  label: string
  provider: string
  model: string
  created_at: number
  last_active_at: number
  archived_at: number
  toolsets: string | null
}

function toSessionRecord(row: SessionRow): SessionRecord {
  const rec: SessionRecord = {
    id: row.id,
    cwd: row.cwd,
    label: row.label,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  }
  // toolsets 列存 JSON 数组字符串；解析失败视为未设置（缺省走 DEFAULT_ACTIVE_TOOLSETS）
  if (row.toolsets) {
    try {
      const parsed = JSON.parse(row.toolsets) as unknown
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        rec.toolsets = parsed as string[]
      }
    } catch {
      // 忽略坏数据
    }
  }
  return rec
}

const SESSION_COLUMNS =
  'id, cwd, label, provider, model, created_at, last_active_at, archived_at, toolsets'

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
      last_active_at INTEGER NOT NULL,
      archived_at INTEGER NOT NULL DEFAULT 0
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
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      relation TEXT NOT NULL,
      detail TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.8,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
    CREATE INDEX IF NOT EXISTS idx_memories_entity ON memories(entity);
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trigger TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending / approved / rejected
      created_at INTEGER NOT NULL,
      approved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);
  `)

  // 迁移：为旧表添加 archived_at 列
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN archived_at INTEGER NOT NULL DEFAULT 0`)
  } catch {
    // 列已存在，忽略
  }

  // 迁移：为旧表添加 toolsets 列（JSON 数组字符串；NULL = 未设置，走默认激活集）
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN toolsets TEXT`)
  } catch {
    // 列已存在，忽略
  }

  // ---- prepared statements ----
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, cwd, label, provider, model, created_at, last_active_at)
     VALUES (@id, @cwd, @label, @provider, @model, @createdAt, @lastActiveAt)`
  )
  const selectSession = db.prepare(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`
  )
  const selectAllSessions = db.prepare(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE archived_at = 0 ORDER BY last_active_at DESC`
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

  // memories table prepared statements
  const insertMemory = db.prepare(
    `INSERT INTO memories (session_id, entity, relation, detail, confidence, created_at)
     VALUES (@sessionId, @entity, @relation, @detail, @confidence, @createdAt)`
  )
  const selectMemoriesBySession = db.prepare(
    `SELECT * FROM memories WHERE session_id = ? ORDER BY created_at DESC`
  )
  const searchMemories = db.prepare(
    `SELECT * FROM memories WHERE entity LIKE ? OR relation LIKE ? OR detail LIKE ? ORDER BY confidence DESC, created_at DESC LIMIT ?`
  )

  // skills table prepared statements
  const insertSkill = db.prepare(
    `INSERT INTO skills (name, trigger, content, status, created_at, approved_at)
     VALUES (@name, @trigger, @content, @status, @createdAt, @approvedAt)`
  )
  const selectSkillsByStatus = db.prepare(
    `SELECT * FROM skills WHERE status = ? ORDER BY created_at DESC`
  )
  const selectSkillById = db.prepare(
    `SELECT * FROM skills WHERE id = ?`
  )
  const updateSkillStatus = db.prepare(
    `UPDATE skills SET status = @status, approved_at = @approvedAt WHERE id = @id`
  )

  // 删除会话 = 删 events + 删 sessions，事务保证原子性
  const deleteSessionTx = db.transaction((id: string) => {
    deleteEvents.run(id)
    deleteSessionStmt.run(id)
  })

  // 会话表可被动态更新的字段（last_active_at 恒随更新刷新）
  const UPDATABLE: { field: keyof SessionRecord; column: string; serialize?: (v: unknown) => unknown }[] = [
    { field: 'cwd', column: 'cwd' },
    { field: 'label', column: 'label' },
    { field: 'provider', column: 'provider' },
    { field: 'model', column: 'model' },
    // toolsets 以 JSON 数组字符串落库
    { field: 'toolsets', column: 'toolsets', serialize: (v) => JSON.stringify(v) },
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

    listAllSessions(includeArchived = false): SessionRecord[] {
      if (includeArchived) {
        const stmt = db.prepare(
          `SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY last_active_at DESC`
        )
        return (stmt.all() as SessionRow[]).map(toSessionRecord)
      }
      return (selectAllSessions.all() as SessionRow[]).map(toSessionRecord)
    },

    updateSession(id: string, patch: Partial<SessionRecord>): void {
      const sets: string[] = []
      const params: Record<string, unknown> = { id, lastActiveAt: Date.now() }
      for (const { field, column, serialize } of UPDATABLE) {
        if (patch[field] !== undefined) {
          sets.push(`${column} = @${field}`)
          params[field] = serialize ? serialize(patch[field]) : patch[field]
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

    deleteEvents(sessionId: string): void {
      deleteEvents.run(sessionId)
    },

    getSetting(key: string): string | null {
      const row = selectSetting.get(key) as { value: string } | undefined
      return row ? (JSON.parse(row.value) as string) : null
    },

    setSetting(key: string, value: unknown): void {
      upsertSetting.run(key, JSON.stringify(value))
    },

    close(): void {
      db.close()
    },

    // 语义记忆
    insertMemory(sessionId: string, entity: string, relation: string, detail: string, confidence: number): void {
      insertMemory.run({ sessionId, entity, relation, detail, confidence, createdAt: Date.now() })
    },
    getMemoriesBySession(sessionId: string): MemoryEntry[] {
      return selectMemoriesBySession.all(sessionId) as MemoryEntry[]
    },
    searchMemories(query: string, limit: number): MemoryEntry[] {
      const pattern = `%${query}%`
      return searchMemories.all(pattern, pattern, pattern, limit) as MemoryEntry[]
    },

    // 程序性技能
    insertSkill(name: string, trigger: string, content: string, status: 'pending' | 'approved' | 'rejected'): number {
      const result = insertSkill.run({ name, trigger, content, status, createdAt: Date.now(), approvedAt: null })
      return result.lastInsertRowid as number
    },
    getSkillsByStatus(status: 'pending' | 'approved' | 'rejected'): SkillEntry[] {
      return selectSkillsByStatus.all(status) as SkillEntry[]
    },
    getSkillById(id: number): SkillEntry | null {
      const row = selectSkillById.get(id) as SkillEntry | undefined
      return row ?? null
    },
    updateSkillStatus(id: number, status: 'pending' | 'approved' | 'rejected'): void {
      const approvedAt = status === 'approved' ? Date.now() : null
      updateSkillStatus.run({ id, status, approvedAt })
    },

    // 暴露底层数据库实例（供 archive.ts 等高级用法使用）
    _db: db,
  }
}