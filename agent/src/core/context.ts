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
 * 构建 system prompt：优先读 <dataDir>/character.md；不存在则用内置默认文案。
 * dataDir 默认 E:\Kotonoha\agent\data（或环境变量 KOTONOHA_DATA_DIR）。
 * cwdNote 默认生成「当前工作区：<cwd>」提示。
 */
export function buildSystemPrompt(
  session: SessionRecord,
  cwdNote?: string,
  dataDir?: string
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
  const emotionGuide =
    '\n\n【情绪表达】每次回复末尾请附上一行情绪标签，格式：[emotion:happy/sad/thinking/love/angry/surprise/neutral]。仅使用这7种情绪之一。标签独占一行，不要有其他内容。'
  return `${base}\n\n${note}${emotionGuide}`
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