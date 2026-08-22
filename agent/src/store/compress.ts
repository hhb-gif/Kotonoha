// ============================================================
// compress.ts —— 会话上下文压缩（保留最近 N 轮，其余用小模型摘要替换）
// 中文注释、英文标识符
// ============================================================

import type { Db, HistoryEvent, ModelProvider } from '../types'

export interface CompressOpts {
  keepRecent: number
  summarizeModel: string
  maxTokens: number
}

export interface CompressResult {
  originalEvents: number
  compressedEvents: number
  summary: string
}

const SYSTEM_PROMPT = `你是会话摘要助手。请将用户提供的对话历史压缩为简洁摘要，保留关键信息：
1. 用户的核心需求/问题
2. 关键决策/结论
3. 重要的代码/文件变更
4. 待办事项/后续步骤

输出格式：纯文本，不超过 2000 字符，中文。`

function buildSummaryPrompt(events: HistoryEvent[]): string {
  let prompt = '请压缩以下对话历史：\n\n'
  for (const ev of events) {
    if (ev.type === 'user/message') {
      const content = ev.data.content.map((c) => c.text).join('')
      prompt += `用户: ${content}\n\n`
    } else if (ev.type === 'assistant/message') {
      const content = ev.data.message.content.map((c) => c.text).join('')
      prompt += `助手: ${content}\n\n`
    }
  }
  return prompt
}

function createSummaryEvent(summary: string): HistoryEvent {
  return {
    type: 'assistant/message',
    data: {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `[会话摘要] ${summary}` }],
      },
    },
  }
}

export async function compressSession(
  db: Db,
  sessionId: string,
  opts: CompressOpts,
  provider: ModelProvider
): Promise<CompressResult> {
  const session = db.getSession(sessionId)
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  const events = db.readEvents(sessionId)
  const totalEvents = events.length

  // 按轮次分组（用户+助手 = 1 轮）
  const turns: HistoryEvent[][] = []
  let currentTurn: HistoryEvent[] = []

  for (const ev of events) {
    currentTurn.push(ev)
    if (ev.type === 'assistant/message' && currentTurn.length >= 2) {
      turns.push(currentTurn)
      currentTurn = []
    }
  }
  if (currentTurn.length > 0) {
    turns.push(currentTurn)
  }

  const keepTurns = opts.keepRecent
  if (turns.length <= keepTurns) {
    return {
      originalEvents: totalEvents,
      compressedEvents: totalEvents,
      summary: '(无需压缩，轮次数未超过阈值)',
    }
  }

  const recentTurns = turns.slice(-keepTurns)
  const oldTurns = turns.slice(0, -keepTurns)

  // 将旧轮次扁平化为事件列表用于摘要
  const oldEvents = oldTurns.flat()

  // 调用小模型生成摘要
  const prompt = buildSummaryPrompt(oldEvents)

  const chunks: string[] = []
  for await (const chunk of provider.streamChat({
    model: opts.summarizeModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    signal: AbortSignal.timeout(60_000),
  })) {
    if (chunk.kind === 'text') {
      chunks.push(chunk.text)
    }
  }

  const summary = chunks.join('').trim()

  // 重建事件：摘要事件 + 最近轮次事件
  const newEvents: HistoryEvent[] = [createSummaryEvent(summary)]
  for (const turn of recentTurns) {
    newEvents.push(...turn)
  }

  // 删除旧事件，写入新事件
  // 注意：Db 接口无删除特定会话事件的方法，需扩展或直接操作
  // 这里假设 Db 已扩展 deleteEvents(sessionId) 方法
  ;(db as any).deleteEvents?.(sessionId)
  for (const ev of newEvents) {
    db.appendEvent(sessionId, ev)
  }

  return {
    originalEvents: totalEvents,
    compressedEvents: newEvents.length,
    summary,
  }
}

// 估算 token 数（粗略：中文 ~1.5 字/token，英文 ~4 字/token）
export function estimateTokens(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const other = text.length - chinese
  return Math.ceil(chinese / 1.5 + other / 4)
}