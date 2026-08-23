// ============================================================
// context.ts —— ContextBuilder：组装 systemPrompt + 历史 + 规则 + 文件引用
// 中文注释、英文标识符
// ============================================================

import type { Db } from '../store/db'
import type { ModelProvider, ChatMessage, HistoryEvent, SessionRecord, ToolDef } from '../types'
import type { RuleSet } from './rules'
import type { FileRef, MentionResult } from './mentions'
import type { BondEntry } from './bonds'
import { loadRules, appendSessionRule } from './rules'
import { resolveMentions, fileRefsToSystemFragments } from './mentions'
import { recordBond, extractBondTriggers, triggerToRule, getBonds } from './bonds'
import { compressHistory, estimateTokens, estimateMessagesTokens, summaryToSystemFragment } from './summarizer'
import { injectMemoryContext } from './semantic'
import { buildSystemPrompt } from '../core/context'

export interface ContextOpts {
  sessionId: string
  userText: string
  history: HistoryEvent[]
  projectRoot: string
  maxTokens: number
  reservedTokens: number
  tools?: ToolDef[]
}

export interface ContextResult {
  systemPrompt: string
  messages: ChatMessage[]
  usedTokens: number
  truncated: boolean
  bonds: BondEntry[]
  fileRefs: FileRef[]
}

export interface MemoryEngine {
  loadRules(projectRoot: string): Promise<RuleSet>
  saveRules(rules: RuleSet): Promise<void>
  resolveMentions(text: string, cwd: string): Promise<MentionResult>
  recordBond(sessionId: string, bond: BondEntry): Promise<void>
  getBonds(sessionId?: string): Promise<BondEntry[]>
  buildContext(opts: ContextOpts): Promise<ContextResult>
}

/**
 * 构建工具上下文（用于 @mention 读取文件）
 */
function createToolContext(sessionId: string, cwd: string): {
  cwd: string
  sessionId: string
  approve: () => Promise<'allowed-once' | 'rejected'>
  emit: () => void
} {
  return {
    cwd,
    sessionId,
    approve: async () => 'allowed-once',
    emit: () => {},
  }
}

/**
 * 默认 MemoryEngine 实现
 */
export class DefaultMemoryEngine implements MemoryEngine {
  private db: Db
  private providers: { get(id: string): ModelProvider | undefined; list(): ModelProvider[]; defaultId(): string }
  private tools: Map<string, import('../types').Tool>

  constructor(deps: {
    db: Db
    providers: { get(id: string): ModelProvider | undefined; list(): ModelProvider[]; defaultId(): string }
    tools: Map<string, import('../types').Tool>
  }) {
    this.db = deps.db
    this.providers = deps.providers
    this.tools = deps.tools
  }

  async loadRules(projectRoot: string): Promise<RuleSet> {
    return loadRules(projectRoot)
  }

  async saveRules(rules: RuleSet): Promise<void> {
    // 当前只持久化会话规则，由 appendSessionRule 处理
    // 此处预留接口
  }

  async resolveMentions(text: string, cwd: string): Promise<MentionResult> {
    const ctx = createToolContext('', cwd)
    return resolveMentions(text, cwd, this.tools, ctx)
  }

  async recordBond(sessionId: string, bond: BondEntry): Promise<void> {
    await recordBond(this.db, sessionId, bond)
  }

  async getBonds(sessionId?: string): Promise<BondEntry[]> {
    return getBonds(this.db, sessionId)
  }

  async buildContext(opts: ContextOpts): Promise<ContextResult> {
    const {
      sessionId,
      userText,
      history,
      projectRoot,
      maxTokens,
      reservedTokens,
      tools = [],
    } = opts

    // 1. 加载三层规则
    const ruleSet = await loadRules(projectRoot)

    // 2. 解析 @mention 并读取文件
    const toolCtx = createToolContext(sessionId, projectRoot)
    const mentionResult = await resolveMentions(userText, projectRoot, this.tools, toolCtx)

    // 3. 提取羁绊触发语句并记录
    const triggers = extractBondTriggers(userText)
    for (const trigger of triggers) {
      const rule = triggerToRule(trigger, 'preference')
      const bond = await recordBond(this.db, sessionId, {
        trigger,
        rule,
        category: 'preference',
        confidence: 0.8,
      })
      // 自动追加到会话规则
      await appendSessionRule(projectRoot, bond.rule)
      await markBondApplied(this.db, sessionId, bond.id)
    }

    // 4. 获取已有羁绊（用于上下文注入）
    const bonds = await getBonds(this.db, sessionId)
    const bondRules = bonds
      .filter(b => b.applied)
      .map(b => `- ${b.rule}`)
      .join('\n')

    // 5. 历史压缩
    const summarizerProvider = this.providers.get(this.providers.defaultId())
    let summaryFragment = ''
    let truncated = false
    
    if (summarizerProvider) {
      const summaryResult = await compressHistory(
        summarizerProvider,
        history,
        maxTokens,
        reservedTokens
      )
      if (summaryResult.compressed) {
        summaryFragment = summaryToSystemFragment(summaryResult.summary)
        truncated = true
      }
    }

    // 6. 构建基础 system prompt（角色卡 + 工作区）
    const sessionRecord: SessionRecord = {
      id: sessionId,
      cwd: projectRoot,
      label: '对话',
      provider: this.providers.defaultId(),
      model: 'deepseek-v4-flash',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }
    let systemPrompt = buildSystemPrompt(sessionRecord, undefined, undefined)

    // 7. 组装 system prompt：角色卡 + 规则 + 羁绊 + 摘要 + 文件引用
    const systemParts: string[] = [systemPrompt]

    if (ruleSet.merged) {
      systemParts.push('\n## 规则上下文\n' + ruleSet.merged)
    }

    if (bondRules) {
      systemParts.push('\n## 羁绊记忆（会话沉淀）\n' + bondRules)
    }

    // 6.5 语义记忆注入（Hermes semantic 层）：相关记忆作为「关于你的记忆」片段
    const memoryFragment = injectMemoryContext(this.db, history, projectRoot)
    if (memoryFragment) {
      systemParts.push('\n## 关于你的记忆\n' + memoryFragment)
    }

    if (summaryFragment) {
      systemParts.push('\n' + summaryFragment)
    }

    if (mentionResult.systemFragments.length > 0) {
      systemParts.push('\n## 文件引用\n' + mentionResult.systemFragments.join('\n\n'))
    }

    systemPrompt = systemParts.join('\n')

    // 8. 构建 messages：历史 + 当前用户输入（已移除 @mention）
    const historyMessages = historyToChatMessages(history)
    const currentMessage: ChatMessage = {
      role: 'user',
      content: mentionResult.text || userText,
    }

    // 9. Token 预算控制：如果超限，截断历史（保留最近轮次）
    let messages = [...historyMessages, currentMessage]
    let usedTokens = estimateTokens(systemPrompt) + estimateMessagesTokens(messages)
    const toolsTokens = tools.length > 0 ? estimateToolsTokens(tools) : 0
    usedTokens += toolsTokens

    if (usedTokens > maxTokens) {
      // 截断历史，保留最近轮次
      const availableForHistory = maxTokens - reservedTokens - estimateTokens(systemPrompt) - toolsTokens
      messages = truncateHistory(historyMessages, currentMessage, availableForHistory)
      usedTokens = estimateTokens(systemPrompt) + estimateMessagesTokens(messages) + toolsTokens
      truncated = true
    }

    return {
      systemPrompt,
      messages,
      usedTokens,
      truncated,
      bonds,
      fileRefs: mentionResult.files,
    }
  }
}

/**
 * 估算工具 schema token 数
 */
function estimateToolsTokens(tools: ToolDef[]): number {
  let total = 0
  for (const tool of tools) {
    total += estimateTokens(JSON.stringify(tool.parameters))
    total += estimateTokens(tool.name) + estimateTokens(tool.description)
  }
  return total
}

/**
 * 截断历史消息以适应 token 预算
 * 策略：保留 system prompt、当前用户消息、最近的助手回复
 */
function truncateHistory(
  history: ChatMessage[],
  current: ChatMessage,
  budget: number
): ChatMessage[] {
  const result: ChatMessage[] = []
  let used = estimateTokens(current.content) + 4 // current message

  // 从后往前加入历史
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    const msgTokens = estimateTokens(msg.content) + 4
    if (used + msgTokens > budget && result.length > 0) {
      break
    }
    result.unshift(msg)
    used += msgTokens
  }

  result.push(current)
  return result
}

/**
 * 历史事件转 ChatMessage（复用 core/context.ts 逻辑）
 */
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

/**
 * 标记羁绊已应用（内部辅助）
 */
async function markBondApplied(db: Db, sessionId: string, bondId: string): Promise<void> {
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
 * 构建默认 MemoryEngine
 */
export function buildDefaultMemory(deps: {
  db: Db
  providers: { get(id: string): ModelProvider | undefined; list(): ModelProvider[]; defaultId(): string }
  tools: Map<string, import('../types').Tool>
}): MemoryEngine {
  return new DefaultMemoryEngine(deps)
}