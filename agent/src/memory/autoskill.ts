// ============================================================
// autoskill.ts —— 自学习技能沉淀（Hermes 模式 procedural 层）
// 任务完成启发式 → 生成候选 SKILL.md → pending → 审批 → execute_skill 复用
// 纯规则生成（不调模型），阈值门控防止垃圾技能污染
// 中文注释、英文标识符
// ============================================================

import type { Db } from '../store/db'
import type { SkillEntry } from '../types'

// ---- 门控阈值 ----

// 助手回复至少 50 字（说明真的干了活）
const MIN_ASSISTANT_LEN = 50
// 用户任务文本至少 6 字（有实际任务内容）
const MIN_TASK_LEN = 6
// 完成标志：用户或助手文本命中其一即视为任务完成
const DONE_FLAGS = /(?:完成|搞定|好了|完毕|收工|done)/i

// ---- SKILL.md 生成 ----

/** 从任务文本提取技能名：去标点取前 12 字 + 时间戳防重名 */
function skillNameFrom(taskText: string): string {
  const theme = taskText.replace(/[，。！？!?、；;：:\s]/g, '').slice(0, 12)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  return `task-${theme || 'untitled'}-${stamp}`
}

/** 从任务文本提取触发词：去标点取前 16 字 */
function triggerFrom(taskText: string): string {
  const t = taskText.replace(/[，。！？!?、；;：:\s]/g, '').slice(0, 16)
  return t || 'task'
}

/** 从助手回复提取步骤：优先按步骤标记切分，兜底整体截断 */
function extractSteps(assistantText: string): string[] {
  // 按句子切分（。！？换行）
  const sentences = assistantText
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  // 带步骤标记的句子（首先/然后/接着/最后/第N步/数字序号）
  const marked = sentences.filter((s) =>
    /(?:首先|然后|接着|其次|最后|最终|第[一二三四五六七八九十百]+步|\d+[\.、．])/.test(s)
  )
  if (marked.length >= 2) {
    return marked.map((s) => s.replace(/^\d+[\.、．]\s*/, '')).slice(0, 8)
  }

  // 兜底：取前 3 个句子作为步骤（每句再截 80 字）
  const steps = sentences.slice(0, 3).map((s) => s.slice(0, 80))
  return steps.length > 0 ? steps : [assistantText.slice(0, 120)]
}

/** 从任务文本提取验收标准，兜底通用验收 */
function extractAcceptance(taskText: string): string[] {
  const m = taskText.match(/(?:验收|标准|要求|预期)(?:是|为|：|:)?([^。！？!?]{2,80})/)
  if (m && m[1].trim()) return [m[1].trim()]
  return ['任务完成且输出符合用户要求']
}

/**
 * 生成候选 SKILL.md 内容（name/trigger/steps/acceptance 四段式）
 */
export function buildSkillMarkdown(
  name: string,
  trigger: string,
  steps: string[],
  acceptance: string[]
): string {
  const lines: string[] = []
  lines.push(`# ${name}`)
  lines.push('')
  lines.push('## Trigger')
  lines.push(trigger)
  lines.push('')
  lines.push('## Steps')
  steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  lines.push('')
  lines.push('## Acceptance')
  acceptance.forEach((a) => lines.push(`- ${a}`))
  lines.push('')
  return lines.join('\n')
}

// ---- 沉淀与审批 ----

/**
 * 任务完成启发式判断 + 沉淀候选技能：
 * 助手回复 ≥50 字 且（用户或助手文本）含完成标志 且 任务文本 ≥6 字。
 * 达标 → 生成 SKILL.md 存入 skills 表（status=pending），等用户审批。
 * @returns 新技能条目；未达标返回 null
 */
export function considerSkillCapture(
  db: Db,
  sessionId: string,
  userText: string,
  assistantText: string
): SkillEntry | null {
  const task = (userText || '').trim()
  const reply = (assistantText || '').trim()

  if (reply.length < MIN_ASSISTANT_LEN) return null
  if (task.length < MIN_TASK_LEN) return null
  if (!DONE_FLAGS.test(reply) && !DONE_FLAGS.test(task)) return null

  const name = skillNameFrom(task)
  const trigger = triggerFrom(task)
  const steps = extractSteps(reply)
  const acceptance = extractAcceptance(task)
  const content = buildSkillMarkdown(name, trigger, steps, acceptance)

  const id = db.insertSkill(name, trigger, content, 'pending')
  return db.getSkillById(id)
}

/**
 * 列出待审批技能（pending）
 */
export function listPendingSkills(db: Db): SkillEntry[] {
  return db.getSkillsByStatus('pending')
}

/**
 * 列出指定状态的技能（pending / approved / rejected）
 */
export function listSkills(db: Db, status: 'pending' | 'approved' | 'rejected'): SkillEntry[] {
  return db.getSkillsByStatus(status)
}

/**
 * 批准技能：pending → approved，approved_at 落库
 * @returns 更新后的技能条目；不存在返回 null
 */
export function approveSkill(db: Db, id: number): SkillEntry | null {
  const existing = db.getSkillById(id)
  if (!existing) return null
  db.updateSkillStatus(id, 'approved')
  return db.getSkillById(id)
}

/**
 * 拒绝技能：pending → rejected（垃圾技能不进入库）
 * @returns 更新后的技能条目；不存在返回 null
 */
export function rejectSkill(db: Db, id: number): SkillEntry | null {
  const existing = db.getSkillById(id)
  if (!existing) return null
  db.updateSkillStatus(id, 'rejected')
  return db.getSkillById(id)
}