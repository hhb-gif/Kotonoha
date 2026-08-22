// ============================================================
// auth/types.ts —— 权限引擎类型定义
// ============================================================

import type { ToolContext as BaseToolContext } from '../types'

export type PermissionLevel = 'allow' | 'ask' | 'deny'

// 扩展 ToolContext，包含工具参数（用于 condition 判断）
export interface ToolContext extends BaseToolContext {
  args?: unknown
}

export interface PermissionRule {
  tool: string
  level: PermissionLevel
  condition?: (ctx: ToolContext) => boolean
}

export interface ApprovalRequest {
  id: string
  sessionId: string
  toolName: string
  callId: string
  args: unknown
  reason: string
  timestamp: number
  timeoutMs: number
  resolve: (outcome: 'allowed-once' | 'always' | 'rejected') => void
}

export interface AuthEngine {
  check(tool: string, ctx: ToolContext, args?: unknown): PermissionLevel
  requestApproval(req: ApprovalRequest): Promise<'allowed-once' | 'always' | 'rejected'>
  // RPC handler 兼容接口
  request(sessionId: string, toolName: string, callId: string, reason: string): Promise<'allowed-once' | 'rejected'>
  respond(approvalId: string, outcome: 'allowed-once' | 'always' | 'rejected'): boolean
  setRules(rules: PermissionRule[]): void
  getRules(): PermissionRule[]
}

export interface ApprovalOutcome {
  type: 'allowed-once' | 'always' | 'rejected'
}