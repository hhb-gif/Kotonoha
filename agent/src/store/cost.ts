// ============================================================
// cost.ts —— 成本统计落库（M4-4.1）
// 落库位置：settings 表，key `cost:session:<sessionId>` → JSON 数组（每次 turn 一条）
// 依赖 types.ts 的 Db 接口（getSetting/setSetting 已内置 JSON 序列化）
// 中文注释、英文标识符
// ============================================================

import type { Db } from '../types'
import { exportCostCsv, estimateCost, type CostRecord } from '../providers/cost'

// 单条成本记录（对应一次 turn 的 token 用量）
export interface CostEntry {
  sessionId: string
  providerId: string
  modelId: string
  promptTokens: number
  completionTokens: number
  costUsd: number
  ts: number
}

// settings 表键前缀
const COST_KEY_PREFIX = 'cost:session:'

function costKey(sessionId: string): string {
  return `${COST_KEY_PREFIX}${sessionId}`
}

function readEntries(db: Db, sessionId: string): CostEntry[] {
  // getSetting 契约返回 string，但 db 实现会对设置值 JSON.parse（运行时可能是数组）
  const raw = db.getSetting(costKey(sessionId)) as unknown
  if (Array.isArray(raw)) {
    // 兼容旧数据：过滤非对象项
    return raw.filter((x) => typeof x === 'object' && x !== null) as CostEntry[]
  }
  return []
}

function writeEntries(db: Db, sessionId: string, entries: CostEntry[]): void {
  db.setSetting(costKey(sessionId), entries as unknown as string)
}

/**
 * 记录一次 turn 的 token 用量与估算成本（追加到会话成本数组）。
 * 若未传 costUsd，按定价表自动估算。
 */
export function recordCost(
  db: Db,
  entry: {
    sessionId: string
    providerId: string
    modelId: string
    promptTokens: number
    completionTokens: number
    costUsd?: number
    ts?: number
  }
): CostEntry {
  const full: CostEntry = {
    sessionId: entry.sessionId,
    providerId: entry.providerId,
    modelId: entry.modelId,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    costUsd:
      entry.costUsd ??
      estimateCost(entry.providerId, entry.modelId, entry.promptTokens, entry.completionTokens),
    ts: entry.ts ?? Date.now(),
  }
  const entries = readEntries(db, entry.sessionId)
  entries.push(full)
  writeEntries(db, entry.sessionId, entries)
  return full
}

/** 读取单会话成本统计 */
export function getSessionCost(db: Db, sessionId: string): {
  sessionId: string
  records: CostEntry[]
  tokens: { prompt: number; completion: number }
  costUsd: number
} {
  const records = readEntries(db, sessionId)
  let prompt = 0
  let completion = 0
  let cost = 0
  for (const r of records) {
    prompt += r.promptTokens
    completion += r.completionTokens
    cost += r.costUsd
  }
  return { sessionId, records, tokens: { prompt, completion }, costUsd: cost }
}

/** 会话级聚合（供 stats.cost 返回 { total, bySession } 使用） */
export interface CostSessionAgg {
  sessionId: string
  tokens: number // 总 token（prompt+completion）
  costUsd: number
}

/** 全量成本统计：总成本 + 按会话聚合 */
export function getTotalCost(db: Db): {
  totalCostUsd: number
  totalTokens: number
  bySession: Record<string, CostSessionAgg>
} {
  const dbInst = (db as { _db: any })._db as {
    prepare: (sql: string) => { all: (...args: unknown[]) => { key: string; value: string }[] }
  }
  // 直接扫 settings 表前缀（cost:session: 不含 % _ 通配符），避免反复 JSON 解析全部 key
  const rows = dbInst
    .prepare(`SELECT key, value FROM settings WHERE key LIKE 'cost:session:%'`)
    .all()
  const bySession: Record<string, CostSessionAgg> = {}
  let totalCostUsd = 0
  let totalTokens = 0
  for (const row of rows) {
    const sessionId = row.key.slice(COST_KEY_PREFIX.length)
    if (!sessionId) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(row.value)
    } catch {
      continue
    }
    if (!Array.isArray(parsed)) continue
    let tokens = 0
    let cost = 0
    for (const r of parsed) {
      if (typeof r !== 'object' || r === null) continue
      tokens += (r as CostEntry).promptTokens + (r as CostEntry).completionTokens
      cost += (r as CostEntry).costUsd
    }
    bySession[sessionId] = { sessionId, tokens, costUsd: cost }
    totalTokens += tokens
    totalCostUsd += cost
  }
  return { totalCostUsd, totalTokens, bySession }
}

/** 导出全部成本记录为 CSV（复用 providers/cost.ts 的 exportCostCsv） */
export function exportAllCostCsv(db: Db): string {
  const dbInst = (db as { _db: any })._db as {
    prepare: (sql: string) => { all: (...args: unknown[]) => { key: string; value: string }[] }
  }
  const rows = dbInst
    .prepare(`SELECT key, value FROM settings WHERE key LIKE 'cost:session:%'`)
    .all()
  const records: CostRecord[] = []
  for (const row of rows) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.value)
    } catch {
      continue
    }
    if (!Array.isArray(parsed)) continue
    for (const r of parsed) {
      if (typeof r !== 'object' || r === null) continue
      const e = r as CostEntry
      records.push({
        timestamp: e.ts,
        providerId: e.providerId,
        modelId: e.modelId,
        promptTokens: e.promptTokens,
        completionTokens: e.completionTokens,
        costUsd: e.costUsd,
      })
    }
  }
  return exportCostCsv(records)
}