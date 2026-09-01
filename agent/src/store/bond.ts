// ============================================================
// bond.ts —— 羁绊系统好感度引擎（v0.2.2 / docs/plans/v0.2.2-bond.md）
// 存储：settings 表 key `bond:state`（JSON）；结算规则：基础+1、工具+1、
// 长回复+1、单轮上限+3、每日上限+10、points 封顶 100、只升不降
// 中文注释、英文标识符
// ============================================================

import type { Db } from './db'

// settings 表存储键
export const BOND_STATE_KEY = 'bond:state'

// 好感度持久化状态
export interface BondState {
  points: number // 0~100 整数
  interactions: number // 累计对话轮数
  lastTurnAt: number // 最近一次 turn 完成时间戳（ms）
  todayGain: number // 今日已增长点数（跨天重置）
  todayDate: string // 今日计数归属日期 'YYYY-MM-DD'（本地时区）
}

// RPC 展示视图：state + 派生等级字段
export interface BondView extends BondState {
  level: number // 0-3
  levelName: string // 陌生 / 熟悉 / 信赖 / 羁绊
}

// 增长参数：turn 结束时由 engine 从 TurnRunner 返回值传入
export interface SettleOpts {
  hadToolCalls: boolean // 本轮有工具调用 → 额外 +1
  replyLength: number // 本轮回复长度（字）≥100 → 额外 +1
}

// 结算规则常量（严格按规划文档）
const BASE_GAIN = 1 // 基础：每轮 +1
const TOOL_BONUS = 1 // 完成含工具调用的 turn：额外 +1
const LONG_REPLY_BONUS = 1 // 回复 ≥100 字的深度交流：额外 +1
const LONG_REPLY_THRESHOLD = 100
const PER_TURN_CAP = 3 // 单轮上限 +3（防刷）
const DAILY_CAP = 10 // 每日上限 +10
const POINTS_CAP = 100 // points 封顶

// 等级表（只升不降：points 单调递增，天然满足）
const LEVELS: { min: number; level: number; name: string }[] = [
  { min: 90, level: 3, name: '羁绊' },
  { min: 60, level: 2, name: '信赖' },
  { min: 25, level: 1, name: '熟悉' },
  { min: 0, level: 0, name: '陌生' },
]

/** 本地日期字符串 'YYYY-MM-DD'（每日上限按自然日判断） */
function localDateStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 读取好感度状态；无记录或坏数据时返回全零缺省 */
export function getBond(db: Db): BondState {
  try {
    const raw = db.getSetting(BOND_STATE_KEY)
    if (raw && typeof raw === 'object') {
      const s = raw as Partial<BondState>
      return {
        points: typeof s.points === 'number' && s.points >= 0 ? Math.floor(s.points) : 0,
        interactions: typeof s.interactions === 'number' && s.interactions >= 0 ? Math.floor(s.interactions) : 0,
        lastTurnAt: typeof s.lastTurnAt === 'number' ? s.lastTurnAt : 0,
        todayGain: typeof s.todayGain === 'number' && s.todayGain >= 0 ? Math.floor(s.todayGain) : 0,
        todayDate: typeof s.todayDate === 'string' ? s.todayDate : '',
      }
    }
  } catch {
    // 坏数据 → 走缺省
  }
  return { points: 0, interactions: 0, lastTurnAt: 0, todayGain: 0, todayDate: '' }
}

/**
 * turn 结束结算好感度（engine pump 在 runner.run 成功返回后调用）。
 * 增长：基础+1；工具调用额外+1；回复≥100字额外+1；单轮上限+3。
 * 防刷：今日已增长 ≥10 → 本轮不加（interactions 照常累计）；跨天重置今日计数。
 * points 封顶 100，只升不降。
 */
export function settleTurn(db: Db, opts: SettleOpts): BondState {
  const state = getBond(db)

  // 每日上限：todayDate != 今天 → 重置今日计数（跨天）
  const today = localDateStr()
  if (state.todayDate !== today) {
    state.todayDate = today
    state.todayGain = 0
  }

  // 基础 + 各项加成，再按单轮上限截断
  let gain = BASE_GAIN
  if (opts.hadToolCalls) gain += TOOL_BONUS
  if (opts.replyLength >= LONG_REPLY_THRESHOLD) gain += LONG_REPLY_BONUS
  if (gain > PER_TURN_CAP) gain = PER_TURN_CAP

  // 每日上限：已达 → 本轮不加；未达 → 只补足剩余额度
  if (state.todayGain >= DAILY_CAP) {
    gain = 0
  } else {
    gain = Math.min(gain, DAILY_CAP - state.todayGain)
  }

  // 互动轮数恒累计（不受每日上限影响）；points 封顶 100
  state.interactions += 1
  state.points = Math.min(POINTS_CAP, state.points + gain)
  state.todayGain += gain
  state.lastTurnAt = Date.now()

  db.setSetting(BOND_STATE_KEY, state)
  return state
}

/** 按分数派生等级（0-3）与等级名 */
export function deriveLevel(points: number): { level: number; levelName: string } {
  for (const l of LEVELS) {
    if (points >= l.min) return { level: l.level, levelName: l.name }
  }
  return { level: 0, levelName: '陌生' }
}

/** RPC 展示视图：state + level/levelName */
export function getBondView(db: Db): BondView {
  const state = getBond(db)
  const { level, levelName } = deriveLevel(state.points)
  return { ...state, level, levelName }
}
