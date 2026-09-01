// ============================================================
// summarizer.ts —— 上下文压缩：超长历史调用小模型生成摘要
// 中文注释、英文标识符
// ============================================================

import type { ModelProvider, ChatMessage, StreamParams } from '../types'
import type { HistoryEvent } from '../types'

export interface SummaryResult {
  summary: string
  originalTokens: number
  summaryTokens: number
  compressed: boolean
}

/**
 * Token 估算（粗略：中文约 1.5 char/token，英文约 4 char/token）
 */
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

/**
 * 估算 messages 的 token 数
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateTokens(msg.content)
    total += 4 // role 等开销
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        total += estimateTokens(tc.name) + estimateTokens(tc.args)
      }
    }
  }
  return total
}

/**
 * 构建摘要提示词
 */
function buildSummaryPrompt(events: HistoryEvent[], keepRecent: number): string {
  const olderEvents = events.slice(0, -keepRecent)

  const olderText = olderEvents.map(ev => {
    if (ev.type === 'user/message') {
      return `用户: ${ev.data.content.map(c => c.text).join('')}`
    } else {
      return `助手: ${ev.data.message.content.map(c => c.text).join('')}`
    }
  }).join('\n\n')

  return `请将以下对话历史压缩为简洁摘要（200-400字），保留关键决策、技术方案、用户偏好和未完成任务：

${olderText}

摘要要求：
1. 保留具体的技术决策（如选择的库、架构方案）
2. 记录用户明确表达的偏好/约束
3. 标记未完成的待办事项
4. 忽略闲聊、重复确认等无关内容
5. 使用第三人称客观陈述`
}

/**
 * 调用模型生成摘要
 */
async function callSummarizer(
  provider: ModelProvider,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const params: StreamParams = {
    model: 'deepseek-v4-flash', // 使用小模型
    messages: [
      { role: 'system', content: '你是对话摘要助手，擅长从长对话中提取关键信息。' },
      { role: 'user', content: prompt },
    ],
    signal,
  }

  let summary = ''
  try {
    for await (const chunk of provider.streamChat(params)) {
      if (chunk.kind === 'text') {
        summary += chunk.text
      }
    }
  } catch (e) {
    throw new Error(`摘要生成失败: ${(e as Error).message}`)
  }

  return summary.trim()
}

/**
 * 压缩历史：保留最近 N 轮，其余生成摘要
 * 
 * @param provider 模型供应商（需支持流式）
 * @param events 完整历史事件
 * @param maxTokens 最大 token 预算
 * @param reservedTokens 预留给 system prompt + 当前轮次等
 * @param signal 中止信号
 * @returns 摘要结果，包含是否压缩、摘要文本、token 统计
 */
export async function compressHistory(
  provider: ModelProvider,
  events: HistoryEvent[],
  maxTokens: number,
  reservedTokens: number,
  signal?: AbortSignal
): Promise<SummaryResult> {
  // 估算当前历史 token 数
  const messages = historyToChatMessages(events)
  const currentTokens = estimateMessagesTokens(messages)

  // 如果未超限，直接返回
  if (currentTokens <= maxTokens - reservedTokens) {
    return {
      summary: '',
      originalTokens: currentTokens,
      summaryTokens: 0,
      compressed: false,
    }
  }

  // 计算保留最近多少轮（每轮约 2 条消息）
  // 先尝试保留最近 10 轮（20 条消息）
  let keepRecent = 20
  let recentEvents = events.slice(-keepRecent)
  let recentTokens = estimateMessagesTokens(historyToChatMessages(recentEvents))

  // 如果最近轮次仍超限，减少保留轮次
  while (recentTokens > (maxTokens - reservedTokens) * 0.6 && keepRecent > 4) {
    keepRecent -= 2
    recentEvents = events.slice(-keepRecent)
    recentTokens = estimateMessagesTokens(historyToChatMessages(recentEvents))
  }

  const olderEvents = events.slice(0, -keepRecent)
  if (olderEvents.length === 0) {
    return {
      summary: '',
      originalTokens: currentTokens,
      summaryTokens: 0,
      compressed: false,
    }
  }

  // 生成摘要
  const prompt = buildSummaryPrompt(events, keepRecent)
  const summary = await callSummarizer(provider, prompt, signal)
  const summaryTokens = estimateTokens(summary)

  return {
    summary,
    originalTokens: currentTokens,
    summaryTokens,
    compressed: true,
  }
}

/**
 * 将摘要转换为 system 消息片段
 */
export function summaryToSystemFragment(summary: string): string {
  if (!summary) return ''
  return `【历史摘要】\n${summary}\n`
}

// 复用 core/context.ts 的转换函数
function historyToChatMessages(events: HistoryEvent[]): ChatMessage[] {
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