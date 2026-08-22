// ============================================================
// permission.ts —— PermissionEngine: 规则匹配、默认 ask
// 实现 SPEC.md 中的 AuthEngine.check() 接口
// ============================================================

import type { ToolContext as BaseToolContext } from '../types'
import type { PermissionRule, PermissionLevel, ToolContext } from './types'
import { RulesManager } from './rules'

export class PermissionEngine {
  private readonly rulesManager: RulesManager

  constructor(rulesManager: RulesManager) {
    this.rulesManager = rulesManager
  }

  // 核心检查：按规则顺序匹配，首个匹配生效
  // 支持 condition 函数，支持 * 通配符兜底
  check(tool: string, ctx: BaseToolContext, args?: unknown): PermissionLevel {
    const rules = this.rulesManager.getRules()

    // 构造包含 args 的上下文供 condition 使用
    const ctxWithArgs: ToolContext = { ...ctx, args }

    for (const rule of rules) {
      if (!this.matchTool(rule.tool, tool)) continue
      if (rule.condition && !rule.condition(ctxWithArgs)) continue
      return rule.level
    }

    // 理论上不会到这里（DEFAULT_RULES 有 * 兜底），但保险起见
    return 'ask'
  }

  // 热更新：外部调用后立即生效
  setRules(rules: PermissionRule[]): void {
    this.rulesManager.setRules(rules)
  }

  getRules(): PermissionRule[] {
    return this.rulesManager.getRules()
  }

  // 检查 always 规则
  checkAlways(tool: string, args: unknown): boolean {
    return this.rulesManager.checkAlways(tool, args)
  }

  // 添加 always 规则
  addAlwaysRule(tool: string, args: unknown): void {
    this.rulesManager.addAlwaysRule(tool, args)
  }

  // 工具名匹配：精确匹配或 * 通配符
  private matchTool(ruleTool: string, actualTool: string): boolean {
    return ruleTool === '*' || ruleTool === actualTool
  }
}