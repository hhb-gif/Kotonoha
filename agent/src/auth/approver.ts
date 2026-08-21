// ============================================================
// approver.ts —— 审批队列：request（发帧 + 挂起）/ respond（按 rpcId 匹配）
// 时序见 docs/plans/agent-harness-m0.md 第 1.5 节
// ============================================================

import { randomUUID } from 'crypto'
import type { ApprovalRequestFrame, OutboundFrame } from '../types'

type ApprovalOutcome = 'allowed-once' | 'rejected'

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000 // 5 分钟超时自动拒绝（与前端 bridge 5s 兜底双保险）

interface PendingRequest {
  resolve: (outcome: ApprovalOutcome) => void
  timeout: NodeJS.Timeout
}

export class Approver {
  private readonly broadcast: (frame: OutboundFrame) => void
  private readonly pending = new Map<string, PendingRequest>()

  constructor(opts: { broadcast: (frame: OutboundFrame) => void }) {
    this.broadcast = opts.broadcast
  }

  request(
    sessionId: string,
    toolName: string,
    callId: string,
    reason: string
  ): Promise<'allowed-once' | 'rejected'> {
    const approvalId = randomUUID()
    const rpcId = randomUUID()

    const frame: ApprovalRequestFrame = {
      type: 'server-request',
      method: 'approval/requested',
      rpcId,
      payload: { sessionId, approvalId, toolName, callId, reason },
    }

    return new Promise<ApprovalOutcome>((resolve) => {
      // 先注册后广播：保证 broadcast 同步返回前条目已可被 respond 命中
      const timeout = setTimeout(() => {
        this.settle(rpcId, 'rejected')
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(rpcId, { resolve, timeout })
      this.broadcast(frame)
    })
  }

  // 找到并 resolve 返回 true；已超时/重复响应返回 false
  respond(rpcId: string, outcome: 'allowed-once' | 'rejected'): boolean {
    return this.settle(rpcId, outcome)
  }

  // 调试用：当前挂起的审批数
  pendingCount(): number {
    return this.pending.size
  }

  // 统一结算：超时与 respond 共用；resolve 后清理 map 条目 + clearTimeout
  private settle(rpcId: string, outcome: ApprovalOutcome): boolean {
    const entry = this.pending.get(rpcId)
    if (!entry) return false
    this.pending.delete(rpcId)
    clearTimeout(entry.timeout)
    entry.resolve(outcome)
    return true
  }
}