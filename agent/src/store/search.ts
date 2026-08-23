// ============================================================
// search.ts —— 会话全文搜索（M3-3.3）
// 优先 SQLite FTS5 虚拟表（events_fts，触发器增量同步）；
// FTS5 不可用时优雅降级为 LIKE 模糊匹配。
// 表结构：rowid = events.id；列：session_id(UNINDEXED), seq(UNINDEXED), payload
// 中文注释、英文标识符
// ============================================================

import type { Db, HistoryEvent } from '../types'

export interface SearchHit {
  id: number
  sessionId: string
  seq: number
  payload: HistoryEvent
  snippet?: string
}

interface SearchRow {
  id: number
  sessionId: string
  seq: number
  payload: string
  snippet?: string
}

/** 检测当前 SQLite 编译是否启用 FTS5 */
export function hasFts5(db: Db): boolean {
  try {
    const row = (db as { _db: any })._db
      .prepare(`SELECT sqlite_compileoption_used('ENABLE_FTS5') AS used`)
      .get() as { used: number } | undefined
    return row?.used === 1
  } catch {
    return false
  }
}

// 进程内缓存：按数据库实例记录 FTS 索引是否已就绪（不同 db 实例独立）
const ftsReadyByDb = new WeakSet<object>()

/**
 * 确保 FTS5 索引就绪：建虚拟表 + 触发器（insert/delete 增量同步）+ 回填存量数据。
 * 仅首次调用生效（按 db 实例缓存）；FTS5 不可用返回 false（调用方走 LIKE 降级）。
 */
export function ensureFtsIndex(db: Db): boolean {
  const raw = (db as { _db: any })._db as {
    exec: (sql: string) => void
    prepare: (sql: string) => { all: () => unknown[] }
  }
  if (ftsReadyByDb.has(raw)) return true
  if (!hasFts5(db)) return false
  try {
    raw.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        session_id UNINDEXED,
        seq UNINDEXED,
        payload,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS events_fts_ai AFTER INSERT ON events BEGIN
        INSERT INTO events_fts(rowid, session_id, seq, payload)
        VALUES (new.id, new.session_id, new.seq, new.payload);
      END;
      CREATE TRIGGER IF NOT EXISTS events_fts_ad AFTER DELETE ON events BEGIN
        DELETE FROM events_fts WHERE rowid = old.id;
      END;
    `)
    // 回填存量数据（仅当虚拟表为空时）
    const count = raw.prepare(`SELECT COUNT(*) AS n FROM events_fts`).all() as {
      n: number
    }[]
    if (!count[0] || count[0].n === 0) {
      raw.exec(`
        INSERT INTO events_fts(rowid, session_id, seq, payload)
        SELECT id, session_id, seq, payload FROM events;
      `)
    }
    ftsReadyByDb.add(raw)
    return true
  } catch {
    return false
  }
}

/** 把用户查询转成 FTS5 短语查询（转义内部双引号） */
function toFtsQuery(query: string): string {
  return `"${query.replace(/"/g, '""')}"`
}

/** LIKE 降级：转义 % _ 通配符 */
function toLikePattern(query: string): string {
  return `%${query.replace(/[%_]/g, (m) => '\\' + m)}%`
}

/**
 * 会话全文搜索：匹配 events.payload 文本。
 * @param sessionId 限定会话（空串则全局搜索）
 * @param query 关键词
 * @param limit 返回条数上限（默认 20）
 */
export function searchEvents(
  db: Db,
  sessionId: string,
  query: string,
  limit = 20
): SearchHit[] {
  if (!query) return []
  const n = Math.max(1, Math.min(500, limit))

  // FTS5 路径
  if (ensureFtsIndex(db)) {
    try {
      const rows = (db as { _db: any })._db
        .prepare(
          `SELECT rowid AS id, session_id AS sessionId, seq, payload,
                  snippet(events_fts, 2, '[', ']', '…', 24) AS snippet
           FROM events_fts
           WHERE events_fts MATCH @q AND (@sid = '' OR session_id = @sid)
           ORDER BY rank
           LIMIT @n`
        )
        .all({ q: toFtsQuery(query), sid: sessionId, n })
      return (rows as SearchHit[]).map((r) => ({ ...r, payload: JSON.parse(r.payload as unknown as string) }))
    } catch {
      // FTS 查询失败（如极端语法）→ 降级 LIKE
    }
  }

  // LIKE 降级路径
  const pattern = toLikePattern(query)
  const rows = (db as { _db: any })._db
    .prepare(
      `SELECT id, session_id AS sessionId, seq, payload
       FROM events
       WHERE (@sid = '' OR session_id = @sid) AND payload LIKE @p ESCAPE '\\'
       ORDER BY seq DESC
       LIMIT @n`
    )
    .all({ sid: sessionId, p: pattern, n })
  return (rows as SearchHit[]).map((r) => ({ ...r, payload: JSON.parse(r.payload as unknown as string) }))
}