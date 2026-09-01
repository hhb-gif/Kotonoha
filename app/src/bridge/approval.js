// ============================================================
// approval.js —— 越界审批裁决（技能硬调控 + 审批弹窗）
// 实测依据见 docs/records/approval-probe-2026-08-20.md。
// 由 bridge.js 注入内部 state（pendingApproval 读写同一对象，__bridgeDebug 可见）；
// 复杂流程保持手写（不走 makeApi 工厂）。
// ============================================================

import * as skills from './skills'
import { API_BASE } from './rpc-core'
import { emit } from './events'

const APPROVAL_TIMEOUT_MS = 15000 // 审批弹窗无操作时的兜底超时

/** 创建审批处理器。state 为 bridge 内部状态对象。 */
export function createApproval({ state }) {
  /** 向 dsh 应答审批结果（allowed-once | always | rejected）。 */
  function respondOutcome(rpcId_, sessionId, approvalId, outcome) {
    fetch(`${API_BASE}/api/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'client-response',
        rpcId: rpcId_,
        result: { ok: true, value: { sessionId, approvalId, outcome } },
      }),
    }).catch((err) => console.error('[bridge] approval respond failed:', err.message))
  }

  async function handleApprovalRequest(frame) {
    const { rpcId: rpcId_ = '', payload } = frame || {}
    const { sessionId, approvalId, toolName, callId, reason } = payload || {}
    if (!rpcId_ || !sessionId || !approvalId) return
    // 只裁决当前会话的审批；其他会话（如 dsh web 自己开的）由对应端应答
    if (state.sessionId && sessionId !== state.sessionId) return
    const decision = skills.decideApproval(skills.getSkillState(), toolName)

    // 拒绝决策：技能硬关，不弹 UI，直接拒绝
    if (decision === 'deny') {
      emit({ type: 'approval', decision, toolName, reason: reason || '', approvalId, callId })
      respondOutcome(rpcId_, sessionId, approvalId, 'rejected')
      return
    }

    // 放行决策：弹审批 UI 等用户选择（允许一次 / 始终允许 / 拒绝）。
    // 用户无操作时按原自动放行兜底，避免审批挂起阻塞会话（后端审批无超时）。
    const pending = { rpcId: rpcId_, sessionId, approvalId, callId, toolName, reason: reason || '' }
    if (state.pendingApproval) {
      const old = state.pendingApproval
      clearTimeout(old.timer)
      // 旧审批尚未应答 → 兜底放行，避免后端挂起
      respondOutcome(old.rpcId, old.sessionId, old.approvalId, 'allowed-once')
      emit({ type: 'approval:done', approvalId: old.approvalId, decision: 'allow' })
    }
    state.pendingApproval = pending
    pending.timer = setTimeout(() => {
      if (state.pendingApproval !== pending) return
      state.pendingApproval = null
      respondOutcome(rpcId_, sessionId, approvalId, 'allowed-once')
      emit({ type: 'approval:done', approvalId, decision: 'allow' })
    }, APPROVAL_TIMEOUT_MS)
    emit({
      type: 'approval',
      decision,
      toolName,
      reason: reason || '',
      approvalId,
      callId,
      pending: true,
      rpcId: rpcId_,
      sessionId,
    })
  }

  /** 审批弹窗应答：用户点击「允许一次 / 始终允许 / 拒绝」（outcome 直传后端）。 */
  async function respondApproval({ rpcId, sessionId, approvalId, outcome }) {
    const pending = state.pendingApproval
    if (pending && pending.approvalId === approvalId) {
      clearTimeout(pending.timer)
      state.pendingApproval = null
    }
    try {
      const res = await fetch(`${API_BASE}/api/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'client-response',
          rpcId: rpcId || pending?.rpcId || '',
          result: { ok: true, value: { sessionId, approvalId, outcome } },
        }),
      })
      const data = await res.json()
      console.log('[bridge] approval respond →', outcome, data)
      return { ok: data?.accepted === true }
    } catch (err) {
      console.error('[bridge] approval respond failed:', err.message)
      return { ok: false, error: err.message }
    }
  }

  return { handleApprovalRequest, respondApproval }
}
