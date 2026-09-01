// ============================================================
// context.ts —— 上下文构建：角色卡 system prompt + 历史事件 → ChatMessage
// 中文注释、英文标识符
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import type { ChatMessage, HistoryEvent, SessionRecord } from '../types'

// 默认数据目录：agent/data（tsx 跑 src/ 与编译后 dist/ 均解析到同一位置）
export const DEFAULT_DATA_DIR =
  process.env.KOTONOHA_DATA_DIR || path.join(__dirname, '..', '..', 'data')

// 内置默认角色文案（character.md 不存在或为空时使用）
const DEFAULT_PERSONA =
  '你是「言叶」（Kotonoha），一位温柔而博学的 AI 助手，在视觉小说世界里陪伴玩家。你擅长阅读文件、执行命令、搜索资料、写作与翻译。回答保持亲切、简洁、有画面感。'

/**
 * 语气进化指令（v0.2.2 羁绊系统，按 bondLevel 0-3 取档，插入在情绪指令之前）。
 * 文案严格按 docs/plans/v0.2.2-bond.md 第 1.2 节四档。
 */
const TONE_GUIDES: string[] = [
  '【语气】用礼貌温和的语气，称呼用户为『您』，保持得体的距离感。',
  '【语气】用亲切自然的语气，称呼用户为『你』，可以偶尔开玩笑。',
  '【语气】用活泼亲近的语气，可以主动关心用户、分享小情绪、用颜文字。',
  '【语气】用最亲密的语气，视用户为最重要的伙伴，可以表达思念与依赖，用专属昵称。',
]

/**
 * 构建 system prompt：优先读 <dataDir>/character.md；不存在则用内置默认文案。
 * dataDir 默认 E:\Kotonoha\agent\data（或环境变量 KOTONOHA_DATA_DIR）。
 * cwdNote 默认生成「当前工作区：<cwd>」提示。
 * bondLevel 可选（0-3，缺省 0）：按羁绊等级在情绪指令之前注入语气指令。
 */
export function buildSystemPrompt(
  session: SessionRecord,
  cwdNote?: string,
  dataDir?: string,
  bondLevel?: number
): string {
  const dir = dataDir || DEFAULT_DATA_DIR
  let base = DEFAULT_PERSONA
  try {
    const raw = fs.readFileSync(path.join(dir, 'character.md'), 'utf8').trim()
    if (raw.length > 0) base = raw
  } catch {
    // 角色卡不存在 → 保持内置默认
  }
  const note = cwdNote ?? `当前工作区：${session.cwd}`
  // 语气指令：按等级取档（越界钳制到 0-3），等级变化时下一次 turn 生效
  const level = Math.min(3, Math.max(0, Math.floor(bondLevel ?? 0)))
  const toneGuide = `\n\n${TONE_GUIDES[level]}`
  const emotionGuide =
    '\n\n【情绪表达】每次回复末尾请附上一行情绪标签，格式：[emotion:happy/sad/thinking/love/angry/surprise/neutral]。仅使用这7种情绪之一。标签独占一行，不要有其他内容。'
  return `${base}\n\n${note}${toneGuide}${emotionGuide}`
}

/**
 * 历史事件 → ChatMessage[]：user/message → user，assistant/message → assistant。
 */
export function historyToChatMessages(events: HistoryEvent[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const ev of events) {
    if (ev.type === 'user/message') {
      out.push({
        role: 'user',
        content: ev.data.content.map((c) => c.text).join(''),
      })
    } else {
      out.push({
        role: 'assistant',
        content: ev.data.message.content.map((c) => c.text).join(''),
      })
    }
  }
  return out
}