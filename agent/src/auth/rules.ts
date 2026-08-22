// ============================================================
// rules.ts —— 内置规则 + 用户规则持久化 (secrets store)
// ============================================================

import type { SecretsStore } from '../types'
import type { PermissionRule, PermissionLevel, ToolContext } from './types'

// 危险命令检测
function isDangerous(cmd: string): boolean {
  const dangerous = [
    'rm -rf',
    'rm -rf /',
    ':(){ :|:& };:',  // fork bomb
    'mkfs',
    'dd if=',
    '> /dev/sda',
    'chmod 777',
    'chown -R',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
  ]
  return dangerous.some(d => cmd.includes(d))
}

// 默认规则
export const DEFAULT_RULES: PermissionRule[] = [
  { tool: 'read_file',   level: 'allow' },
  { tool: 'glob',        level: 'allow' },
  { tool: 'grep',        level: 'allow' },
  { tool: 'task',        level: 'allow' },
  { tool: 'write_file',  level: 'ask',   condition: (ctx: ToolContext) => !ctx.cwd.includes('.git') },
  { tool: 'file_edit',   level: 'ask' },
  { tool: 'bash',        level: 'ask',   condition: (ctx: ToolContext) => !isDangerous(String((ctx.args as Record<string, unknown>)?.cmd ?? '')) },
  { tool: 'patch',       level: 'ask' },
  { tool: '*',           level: 'deny' },  // 兜底
]

const RULES_STORAGE_KEY = 'auth:permission-rules'
const ALWAYS_RULES_KEY = 'auth:always-rules'

interface AlwaysRule {
  tool: string
  argsPattern: Record<string, unknown>
  createdAt: number
}

export class RulesManager {
  private rules: PermissionRule[]
  private alwaysRules: AlwaysRule[]
  private readonly secrets: SecretsStore

  constructor(secrets: SecretsStore) {
    this.secrets = secrets
    this.rules = [...DEFAULT_RULES]
    this.alwaysRules = []
    this.load()
  }

  private load(): void {
    // 加载权限规则
    const rulesJson = this.secrets.get(RULES_STORAGE_KEY)
    if (rulesJson) {
      try {
        const parsed = JSON.parse(rulesJson) as PermissionRule[]
        // 验证规则结构
        if (Array.isArray(parsed) && parsed.every(r => r.tool && r.level)) {
          this.rules = parsed
        }
      } catch {
        // 忽略解析错误，使用默认规则
      }
    }

    // 加载 always 规则
    const alwaysJson = this.secrets.get(ALWAYS_RULES_KEY)
    if (alwaysJson) {
      try {
        const parsed = JSON.parse(alwaysJson) as AlwaysRule[]
        if (Array.isArray(parsed)) {
          this.alwaysRules = parsed
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  private persistRules(): void {
    this.secrets.set(RULES_STORAGE_KEY, JSON.stringify(this.rules))
  }

  private persistAlwaysRules(): void {
    this.secrets.set(ALWAYS_RULES_KEY, JSON.stringify(this.alwaysRules))
  }

  getRules(): PermissionRule[] {
    return [...this.rules]
  }

  setRules(rules: PermissionRule[]): void {
    if (!Array.isArray(rules) || !rules.every(r => r.tool && r.level)) {
      throw new Error('Invalid rules format')
    }
    this.rules = [...rules]
    this.persistRules()
  }

  // 检查是否有匹配的 always 规则
  checkAlways(tool: string, args: unknown): boolean {
    return this.alwaysRules.some(rule => {
      if (rule.tool !== tool && rule.tool !== '*') return false
      return this.matchArgs(rule.argsPattern, args)
    })
  }

  // 添加 always 规则
  addAlwaysRule(tool: string, args: unknown): void {
    const pattern = this.extractArgsPattern(args)
    this.alwaysRules.push({
      tool,
      argsPattern: pattern,
      createdAt: Date.now(),
    })
    this.persistAlwaysRules()
  }

  // 移除 always 规则
  removeAlwaysRule(tool: string, args: unknown): void {
    const pattern = this.extractArgsPattern(args)
    this.alwaysRules = this.alwaysRules.filter(rule =>
      rule.tool !== tool || !this.matchArgs(rule.argsPattern, pattern)
    )
    this.persistAlwaysRules()
  }

  getAlwaysRules(): AlwaysRule[] {
    return [...this.alwaysRules]
  }

  // 简单的参数模式匹配（精确匹配或通配符）
  private matchArgs(pattern: Record<string, unknown>, args: unknown): boolean {
    if (typeof args !== 'object' || args === null) return false
    const argsObj = args as Record<string, unknown>
    return Object.entries(pattern).every(([key, value]) => {
      if (value === '*') return true
      return argsObj[key] === value
    })
  }

  // 从参数提取模式（简化版：仅提取前几个关键字段）
  private extractArgsPattern(args: unknown): Record<string, unknown> {
    if (typeof args !== 'object' || args === null) return {}
    const obj = args as Record<string, unknown>
    const pattern: Record<string, unknown> = {}
    // 只提取常用字段作为模式
    for (const key of ['path', 'cmd', 'pattern', 'query']) {
      if (key in obj) pattern[key] = obj[key]
    }
    return pattern
  }

  // 热更新：重新加载规则
  reload(): void {
    this.load()
  }
}