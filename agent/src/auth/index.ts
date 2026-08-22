// ============================================================
// auth/index.ts —— 统一导出：buildDefaultAuth() 构造完整认证栈
// ============================================================

import type { SecretsStore, ToolContext } from '../types'
import type { AuthEngine, PermissionRule, PermissionLevel } from './types'
import { PermissionEngine } from './permission'
import { Approver } from './approver'
import { RulesManager, DEFAULT_RULES } from './rules'

export interface AuthStack {
  engine: AuthEngine
  permissionEngine: PermissionEngine
  rulesManager: RulesManager
  defaultRules: readonly PermissionRule[]
}

/**
 * 构造默认认证栈
 * @param secrets 用于规则持久化
 * @param broadcast 事件广播函数（发送 approval/requested 帧）
 */
export function buildDefaultAuth(
  secrets: SecretsStore,
  broadcast: (frame: import('../types').OutboundFrame) => void
): AuthStack {
  const rulesManager = new RulesManager(secrets)
  const permissionEngine = new PermissionEngine(rulesManager)
  const approver = new Approver({
    broadcast,
    permissionEngine,
    rulesManager,
  })

  return {
    engine: approver,
    permissionEngine,
    rulesManager,
    defaultRules: DEFAULT_RULES,
  }
}

// 重新导出类型供外部使用
export type { AuthEngine, PermissionRule, PermissionLevel, ToolContext }
export { PermissionEngine } from './permission'
export { Approver } from './approver'
export { RulesManager, DEFAULT_RULES } from './rules'