// ============================================================
// emotion.ts —— 情绪标签解析器（模型回复末尾的 [emotion:xxx]）
// 纯正则解析，零依赖；容错：无标签默认 neutral
// ============================================================

const EMOTION_RE = /\[emotion:(happy|sad|thinking|love|angry|surprise|neutral)\]\s*$/i

export type Emotion = 'happy' | 'sad' | 'thinking' | 'love' | 'angry' | 'surprise' | 'neutral'

export interface EmotionResult {
  emotion: Emotion
  cleanText: string
}

/** 从完整文本中提取情绪标签，返回情绪+去掉标签后的纯文本 */
export function extractEmotion(text: string): EmotionResult {
  if (!text) return { emotion: 'neutral', cleanText: text }
  const match = text.match(EMOTION_RE)
  if (match) {
    return {
      emotion: match[1].toLowerCase() as Emotion,
      cleanText: text.slice(0, match.index).trimEnd(),
    }
  }
  return { emotion: 'neutral', cleanText: text }
}

/** 仅清理末尾标签（保留中间文本完整） */
export function stripEmotionTag(text: string): string {
  return text.replace(EMOTION_RE, '').trimEnd()
}
