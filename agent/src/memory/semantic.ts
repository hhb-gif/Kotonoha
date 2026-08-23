// ============================================================
// semantic.ts —— 语义记忆库（Hermes 模式 semantic 层）
// 实体-关系三元组持久化 + 对话启发式提取 + 上下文注入
// 纯规则启发式，不调用模型（自动提取零成本）
// 中文注释、英文标识符
// ============================================================

import path from 'node:path'
import type { Db } from '../store/db'
import type { HistoryEvent, MemoryEntry } from '../types'

// ---- 基础封装（对接 db.ts 已就绪的 memories 表接口）----

/**
 * 记录一条语义记忆（实体-关系-详情 三元组）
 */
export function recordMemory(
  db: Db,
  sessionId: string,
  entity: string,
  relation: string,
  detail: string,
  confidence = 0.8
): void {
  db.insertMemory(sessionId, entity.trim(), relation.trim(), detail.trim(), confidence)
}

/**
 * 读取会话的全部记忆（新→旧）
 */
export function getMemories(db: Db, sessionId: string): MemoryEntry[] {
  return db.getMemoriesBySession(sessionId)
}

/**
 * 全文模糊检索记忆（entity/relation/detail 任一命中，按置信度排序）
 */
export function searchMemories(db: Db, query: string, limit = 5): MemoryEntry[] {
  return db.searchMemories(query.trim(), limit)
}

// ---- 启发式提取（不调模型）----

// 主题词典：用于从详情中捕获实体（命中优先，未命中兜底为「用户」）
const ENTITY_DICT = [
  '小说', '诗歌', '写作', '代码', '编程', '开发', '咖啡', '茶', '音乐', '歌曲',
  '动漫', '动画', '游戏', '跑步', '运动', '健身', '阅读', '读书', '电影', '日剧',
  '日语', '英语', '画画', '绘画', '旅行', '旅游', '猫', '狗', '早睡', '早起',
  '熬夜', '做饭', '烹饪', '甜食', '辣', '小说', '剧本', '角色', '章节', '大纲',
]

// 动词模式 → 规范 relation + 置信度
interface VerbRule {
  relation: string
  confidence: number
}

// 单遍扫描正则：修饰语可选组（最长词在前，贪婪匹配）→ 动词捕获组
// 避免多规则独立扫描产生重叠匹配（如「我以后总是…」被「打算」抢先）
const VERB_RE =
  /(?:我|咱)(?:特别|非常|平时|一般|现在|目前|最近|以后|今后|之后|接下来|很|超|最|还|都|只)?(喜欢|偏爱|偏好|讨厌|不喜欢|希望|期望|想要|想|需要|记得|总是|通常|习惯|经常|一向|老|打算)/g

function verbRule(verb: string): VerbRule {
  switch (verb) {
    case '喜欢':
    case '偏爱':
    case '偏好':
      return { relation: '喜欢', confidence: 0.85 }
    case '讨厌':
    case '不喜欢':
      return { relation: '不喜欢', confidence: 0.85 }
    case '希望':
    case '期望':
    case '想要':
    case '想':
      return { relation: '希望', confidence: 0.7 }
    case '需要':
      return { relation: '需要', confidence: 0.85 }
    case '记得':
      return { relation: '记得', confidence: 0.9 }
    case '总是':
    case '通常':
    case '习惯':
    case '经常':
    case '一向':
    case '老':
      return { relation: '习惯', confidence: 0.9 }
    default:
      return { relation: '打算', confidence: 0.75 }
  }
}

// 详情截断长度（避免长句污染记忆库）
const DETAIL_MAX = 80

/** 从详情中捕获实体（主题词典优先，兜底「用户」） */
function captureEntity(detail: string): string {
  for (const word of ENTITY_DICT) {
    if (detail.includes(word)) return word
  }
  // 兜底：取详情中第一个 2-6 字的中文名词片段（排除语气/虚词）
  const m = detail.match(/[\u4e00-\u9fff]{2,6}/)
  return m ? m[0] : '用户'
}

/** 清洗详情：去尾部语气词、截断 */
function cleanDetail(raw: string): string {
  let s = raw.trim()
  s = s.replace(/[（(].*?[)）]/g, '').replace(/^[，,、\s]+/, '')
  s = s.replace(/(?:的|了|吧|啊|呢|哦|嘛|哈)+$/, '')
  s = s.replace(/[。！？!?；;]+$/, '')
  if (s.length > DETAIL_MAX) s = s.slice(0, DETAIL_MAX)
  return s.trim()
}

/**
 * 从对话文本自动提取候选记忆（启发式）：
 * 匹配「我(喜欢|偏好|希望|记得|以后|总是|想要|讨厌|需要)…」模式，
 * 实体用主题词典捕获，去重后写入记忆库。
 * @returns 本次新入库的记忆条目
 */
export function extractMemories(db: Db, sessionId: string, text: string): MemoryEntry[] {
  const extracted: MemoryEntry[] = []
  const existing = getMemories(db, sessionId)

  let m: RegExpExecArray | null
  VERB_RE.lastIndex = 0
  while ((m = VERB_RE.exec(text)) !== null) {
    const rule = verbRule(m[1])
    const rest = text.slice(VERB_RE.lastIndex)
    // 取动词后到句末（或逗号前，最长 60 字）的内容
    const detailRaw = rest.split(/[。！？!?；;]/, 1)[0].split(/[，,、]/, 1)[0].slice(0, 60)
    const detail = cleanDetail(detailRaw)
    if (detail.length < 2) continue // 太短无信息量

    const entity = captureEntity(detail)
    const relation = rule.relation

    // 去重：同会话已有相同（entity+relation+detail）则跳过
    const dup = existing.some(
      (e) => e.entity === entity && e.relation === relation && e.detail === detail
    )
    if (dup) continue

    recordMemory(db, sessionId, entity, relation, detail, rule.confidence)
    extracted.push({
      id: -1,
      session_id: sessionId,
      entity,
      relation,
      detail,
      confidence: rule.confidence,
      created_at: Date.now(),
    })
  }
  return extracted
}

// ---- 上下文注入 ----

const MEMORY_INJECT_LIMIT = 5

/**
 * 构建「关于你的记忆」system 片段：buildContext 时注入 top-K 相关记忆。
 * 查询词 = 最近用户消息（截 120 字）+ 项目名；无命中时兜底取最近 3 条全局记忆。
 * @returns 片段文本；无可用记忆时返回 ''（调用方跳过注入）
 */
export function injectMemoryContext(
  db: Db,
  history: HistoryEvent[],
  projectRoot: string
): string {
  // 1. 收集查询词
  const queries: string[] = []
  let recentCount = 0
  for (let i = history.length - 1; i >= 0 && recentCount < 3; i--) {
    const ev = history[i]
    if (ev.type === 'user/message') {
      const text = ev.data.content.map((c) => c.text).join('').trim()
      if (text) {
        queries.push(text.slice(0, 120))
        recentCount++
      }
    }
  }
  const projectName = path.basename(projectRoot)
  if (projectName && projectName !== '.') queries.push(projectName)

  // 2. 逐个查询词检索并去重合并（保留置信度高者）
  const hits = new Map<number, MemoryEntry>()
  for (const q of queries) {
    for (const mem of db.searchMemories(q, MEMORY_INJECT_LIMIT)) {
      const prev = hits.get(mem.id)
      if (!prev || mem.confidence > prev.confidence) hits.set(mem.id, mem)
    }
    if (hits.size >= MEMORY_INJECT_LIMIT) break
  }

  // 3. 无命中兜底：最近记忆
  if (hits.size === 0) {
    for (const mem of db.searchMemories('', 3)) hits.set(mem.id, mem)
  }
  if (hits.size === 0) return ''

  // 4. 组装片段
  const lines = [...hits.values()].map(
    (m) => `- [${m.entity}] ${m.relation}：${m.detail}（置信度 ${m.confidence.toFixed(1)}）`
  )
  return lines.join('\n')
}