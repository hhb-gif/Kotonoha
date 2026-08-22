// ============================================================
// approver.ts —— 审批队列：request / respond / 超时 / always 规则
// 实现 SPEC.md 中的 AuthEngine 接口
// ============================================================

import { randomUUID } from 'crypto'
import type { OutboundFrame, ApprovalRequestFrame } from '../types'
import type { PermissionRule, ApprovalRequest, AuthEngine } from './types'
import { PermissionEngine } from './permission'
import { RulesManager } from './rules'

type ApprovalOutcome = 'allowed-once' | 'always' | 'rejected'

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000 // 5 分钟

interface PendingApproval {
  request: ApprovalRequest
  timeout: NodeJS.Timeout
  rpcId: string
}

export class Approver implements AuthEngine {
  private readonly broadcast: (frame: OutboundFrame) => void
  private readonly permissionEngine: PermissionEngine
  private readonly rulesManager: RulesManager
  private readonly pending = new Map<string, PendingApproval>()

  constructor(opts: {
    broadcast: (frame: OutboundFrame) => void
    permissionEngine: PermissionEngine
    rulesManager: RulesManager
  }) {
    this.broadcast = opts.broadcast
    this.permissionEngine = opts.permissionEngine
    this.rulesManager = opts.rulesManager
  }

  // 权限检查：委托给 PermissionEngine
  check(tool: string, ctx: import('../types').ToolContext, args?: unknown): import('./types').PermissionLevel {
    return this.permissionEngine.check(tool, ctx, args)
  }

  // RPC handler 兼容接口：按参数创建 ApprovalRequest 并委托 requestApproval
  async request(sessionId: string, toolName: string, callId: string, reason: string): Promise<'allowed-once' | 'rejected'> {
    const req: ApprovalRequest = {
      id: randomUUID(),
      sessionId,
      toolName,
      callId,
      args: {}, // 简化：RPC handler 暂不传 args
      reason,
      timestamp: Date.now(),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      resolve: () => {}, // 占位，requestApproval 内部会替换
    }
    const outcome = await this.requestApproval(req)
    return outcome === 'rejected' ? 'rejected' : 'allowed-once'
  }

  // 请求审批：发送帧 + 挂起 Promise，支持 always 规则预检
  async requestApproval(req: ApprovalRequest): Promise<ApprovalOutcome> {
    // 先检查是否有 always 规则匹配
    if (this.permissionEngine.checkAlways(req.toolName, req.args)) {
      return 'allowed-once' // always 规则按 once 处理（避免无限循环）
    }

    const rpcId = randomUUID()

    const frame: ApprovalRequestFrame = {
      type: 'server-request',
      method: 'approval/requested',
      rpcId,
      payload: {
        sessionId: req.sessionId,
        approvalId: req.id,
        toolName: req.toolName,
        callId: req.callId,
        reason: req.reason,
      },
    }

    return new Promise<ApprovalOutcome>((resolve) => {
      const timeout = setTimeout(() => {
        this.settle(rpcId, 'rejected')
        // 可选：广播超时通知
      }, req.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      this.pending.set(rpcId, {
        request: { ...req, resolve },
        timeout,
        rpcId,
      })

      this.broadcast(frame)
    })
  }

  // 响应审批：按 rpcId 匹配，支持三档结果
  respond(approvalId: string, outcome: ApprovalOutcome): boolean {
    // 查找匹配的 pending 项（approvalId 对应 request.id）
    let foundRpcId: string | null = null
    for (const [rpcId, pending] of this.pending) {
      if (pending.request.id === approvalId) {
        foundRpcId = rpcId
        break
      }
    }

    if (!foundRpcId) return false

    const entry = this.pending.get(foundRpcId)!
    this.pending.delete(foundRpcId)
    clearTimeout(entry.timeout)

    // 处理 always 结果：持久化规则
    if (outcome === 'always') {
      this.permissionEngine.addAlwaysRule(entry.request.toolName, entry.request.args)
      // always 规则按 once 处理（避免无限循环），resolve 'allowed-once'
      entry.request.resolve('allowed-once')
      return true
    }

    entry.request.resolve(outcome)
    return true
  }

  // 规则管理：委托给 PermissionEngine / RulesManager
  setRules(rules: PermissionRule[]): void {
    this.permissionEngine.setRules(rules)
  }

  getRules(): PermissionRule[] {
    return this.permissionEngine.getRules()
  }

  // 获取当前挂起数（调试/监控用）
  pendingCount(): number {
    return this.pending.size
  }

  // 清理所有挂起（关闭时用）
  clearAll(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeout)
      entry.request.resolve('rejected')
    }
    this.pending.clear()
  }

  // 统一结算
  private settle(rpcId: string, outcome: ApprovalOutcome): boolean {
    const entry = this.pending.get(rpcId)
    if (!entry) return false
    this.pending.delete(rpcId)
    clearTimeout(entry.timeout)
    entry.request.resolve(outcome)
    return true
  }
}