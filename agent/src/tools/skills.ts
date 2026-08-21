// ============================================================
// skills.ts —— 技能工具：execute_skill（M0 内置：polish / storybeat）
// 契约：types.ts Tool / ToolDef / ToolResult
// ============================================================

import type { Tool, ToolResult } from '../types'

// 文案润色（纯规则，不调用 LLM）：整理标点 / 去重复空格 / 首行缩进
function polishText(text: string): string {
  let s = text.replace(/\r\n/g, '\n').trim()

  // 中文语境半角标点 → 全角（标点后紧跟中文）
  const HALF2FULL: Record<string, string> = {
    ',': '，',
    '.': '。',
    '?': '？',
    '!': '！',
    ':': '：',
    ';': '；',
  }
  s = s.replace(/([,.;:?!])\s*(?=[\u4e00-\u9fff])/g, (_m, p1: string) => HALF2FULL[p1])

  // 行内压缩空白（每行 trim，连续空白 → 单空格）
  s = s
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')

  // 压缩多余空行（最多保留一个空行分隔）
  s = s.replace(/\n{3,}/g, '\n\n')

  // 首行缩进标记（全角缩进）
  s = '　　' + s
  return s
}

// 奥义·展开：生成「展开叙述」提示模板
function storybeatTemplate(text: string): string {
  return [
    '【奥义·展开】',
    '',
    '请将以下内容展开为完整叙述（保留核心信息，补充细节与场景，语言流畅自然）：',
    '',
    text,
    '',
    '展开要求：以「言叶」的叙述风格撰写；开头点题、结尾收束；不少于 800 字。',
  ].join('\n')
}

export const executeSkillTool: Tool = {
  def: {
    name: 'execute_skill',
    description:
      '执行内置技能：polish（文案润色，纯规则）/ storybeat（奥义·展开，生成提示模板）',
    parameters: {
      type: 'object',
      description: 'execute_skill 参数：技能名与可选输入文本',
      properties: {
        skill: { type: 'string', description: '技能名（polish / storybeat）' },
        args: { type: 'string', description: '技能输入文本（可选）' },
      },
      required: ['skill'],
    },
  },
  async run(_ctx, rawArgs): Promise<ToolResult> {
    const args = rawArgs as Record<string, unknown>
    const skill = typeof args.skill === 'string' ? args.skill : undefined
    if (!skill) return { ok: false, output: '', error: '缺少参数：skill' }
    const input = typeof args.args === 'string' ? args.args : ''

    if (skill === 'polish') {
      if (!input) return { ok: false, output: '', error: '缺少参数：args（polish 需要输入文本）' }
      return { ok: true, output: polishText(input) + '\n\n---\n润色完成（规则版）' }
    }

    if (skill === 'storybeat') {
      return { ok: true, output: storybeatTemplate(input) }
    }

    return { ok: false, output: '', error: `未知技能：${skill}` }
  },
}