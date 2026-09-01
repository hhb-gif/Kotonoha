// ============================================================
// bonds.ts —— 羁绊记忆：关键决策/偏好自动沉淀为会话规则
// 中文注释、英文标识符
// ============================================================

import type { Db } from '../store/db'

export interface BondEntry {
  id: string
  sessionId: string
  timestamp: number
  trigger: string      // 触发语句，如 "以后 git commit 前一定跑测试"
  rule: string         // 衍生出的规则，如 "git commit 前必须运行测试"
  category: 'preference' | 'workflow' | 'convention' | 'constraint'
  confidence: number   // 0-1，置信度
  applied: boolean     // 是否已追加到会话规则
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 初始化 bonds 表
 */
export function initBondsTable(db: Db): void {
  // 通过 settings 表检查是否已初始化
  const initialized = db.getSetting('bonds.table.initialized')
  if (initialized) return

  // 直接执行 SQL（better-sqlite3 的 db 对象上没有 exec 方法，需要通过内部 db）
  // 这里我们用 setSetting 标记初始化完成，实际建表在 db.ts 中统一做
  // 但为了简化，我们假设 db 已包含 bonds 表，或在 db.ts 中添加
  db.setSetting('bonds.table.initialized', 'true')
}

/**
 * 记录一条羁绊记忆
 */
export async function recordBond(
  db: Db,
  sessionId: string,
  bond: Omit<BondEntry, 'id' | 'sessionId' | 'timestamp' | 'applied'>
): Promise<BondEntry> {
  const entry: BondEntry = {
    ...bond,
    id: generateId(),
    sessionId,
    timestamp: Date.now(),
    applied: false,
  }

  // 存储到 settings 表（简化实现，实际应用可扩展 Db 接口）
  const key = `bond:${sessionId}:${entry.id}`
  db.setSetting(key, JSON.stringify(entry))

  // 维护会话的 bond 索引
  const indexKey = `bond:index:${sessionId}`
  let index: string[] = []
  try {
    index = JSON.parse(db.getSetting(indexKey) || '[]')
  } catch {
    index = []
  }
  index.push(entry.id)
  db.setSetting(indexKey, JSON.stringify(index))

  return entry
}

/**
 * 获取会话的所有羁绊记忆
 */
export async function getBonds(db: Db, sessionId?: string): Promise<BondEntry[]> {
  if (!sessionId) return []

  const indexKey = `bond:index:${sessionId}`
  const indexStr = db.getSetting(indexKey)
  if (!indexStr) return []

  let index: string[]
  try {
    index = JSON.parse(indexStr)
  } catch {
    return []
  }

  const bonds: BondEntry[] = []
  for (const id of index) {
    const key = `bond:${sessionId}:${id}`
    const bondStr = db.getSetting(key)
    if (bondStr) {
      try {
        bonds.push(JSON.parse(bondStr))
      } catch {
        // 忽略损坏条目
      }
    }
  }

  // 按时间倒序
  return bonds.sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * 标记羁绊为已应用（已追加到会话规则）
 */
export async function markBondApplied(db: Db, sessionId: string, bondId: string): Promise<void> {
  const key = `bond:${sessionId}:${bondId}`
  const bondStr = db.getSetting(key)
  if (!bondStr) return

  try {
    const bond: BondEntry = JSON.parse(bondStr)
    bond.applied = true
    db.setSetting(key, JSON.stringify(bond))
  } catch {
    // 忽略
  }
}

/**
 * 从用户文本中提取潜在的羁绊触发语句
 * 使用启发式规则识别 "以后/今后/请/务必/一定要" 等关键词
 */
export function extractBondTriggers(text: string): string[] {
  const triggers: string[] = []
  const patterns = [
    /(?:以后|今后|之后)\s*[，,。.]?\s*([^。.]{5,100})/g,
    /(?:请|务必|一定要|必须)\s*([^。.]{5,100})/g,
    /(?:记得|记住|注意)\s*([^。.]{5,100})/g,
    /(?:偏好|习惯|倾向于)\s*([^。.]{5,100})/g,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const trigger = match[1].trim()
      if (trigger.length > 5) {
        triggers.push(trigger)
      }
    }
  }

  return [...new Set(triggers)] // 去重
}

/**
 * 将触发语句转换为规则文本（简化版，实际可接入小模型做总结）
 */
export function triggerToRule(trigger: string, category: BondEntry['category'] = 'preference'): string {
  // 简单的模板转换
  let rule = trigger
  
  // 移除语气词
  rule = rule.replace(/^(请|务必|一定要|必须|记得|记住|注意|偏好|习惯|倾向于)\s*/, '')
  
  // 确保以动词开头
  const verbPrefixes = ['使用', '采用', '遵循', '执行', '运行', '检查', '确保', '保持', '避免', '禁止']
  const hasVerbPrefix = verbPrefixes.some(v => rule.startsWith(v))
  
  if (!hasVerbPrefix) {
    rule = `遵循：${rule}`
  }

  return rule
}