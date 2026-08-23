// ============================================================
// degradations.ts —— 降级记录落库（M4-4.2）
// 落库位置：settings 表，key `degradations` → JSON 数组（每次降级一条）
// 依赖 types.ts 的 Db 接口（getSetting/setSetting 已内置 JSON 序列化）
// 中文注释、英文标识符
// ============================================================

import type { Db, DegradationEntry } from '../types'

// settings 表键名
const DEGRADATIONS_KEY = 'degradations'

function readEntries(db: Db): DegradationEntry[] {
  // getSetting 契约返回 string，但 db 实现会对设置值 JSON.parse（运行时可能是数组）
  const raw = db.getSetting(DEGRADATIONS_KEY) as unknown
  if (Array.isArray(raw)) {
    return raw.filter(
      (x) =>
        typeof x === 'object' && x !== null && typeof (x as DegradationEntry).from === 'string'
    ) as DegradationEntry[]
  }
  return []
}

function writeEntries(db: Db, entries: DegradationEntry[]): void {
  db.setSetting(DEGRADATIONS_KEY, entries as unknown as string)
}

/**
 * 记录一次降级事件（追加到降级记录数组）。
 * 每次降级都落库：即使同 provider 反复失败也逐条记录，供 stats 查询。
 */
export function recordDegradation(
  db: Db,
  entry: { from: string; to: string; reason: string; ts?: number }
): DegradationEntry {
  const full: DegradationEntry = {
    ts: entry.ts ?? Date.now(),
    from: entry.from,
    to: entry.to,
    reason: entry.reason,
  }
  const entries = readEntries(db)
  entries.push(full)
  writeEntries(db, entries)
  return full
}

/** 读取全部降级记录（新→旧排序） */
export function listDegradations(db: Db): DegradationEntry[] {
  return readEntries(db).slice().reverse()
}