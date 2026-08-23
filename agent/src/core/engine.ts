// ============================================================
// engine.ts —— 会话引擎：全局串行 turn 队列 + SessionEngine 接口实现
// create/prompt/history/selectModel/list/rename/fork/delete 全直通 store
// 中文注释、英文标识符
// ============================================================

import type {
  EngineDeps,
  HistoryEvent,
  SessionEngine,
  SessionEvent,
  SessionRecord,
} from '../types'
import type { Hook } from '../tools/hooks'
import { TurnRunner } from './agent'
import { DEFAULT_DATA_DIR } from './context'
import { createSessionRecord, forkSession } from '../store/sessions'

interface PendingTurn {
  sessionId: string
  text: string
}

export function createEngine(
  deps: EngineDeps,
  opts: { dataDir?: string; extraHooks?: Hook[] } = {}
): SessionEngine {
  const dataDir = opts.dataDir || DEFAULT_DATA_DIR
  const runner = new TurnRunner({ deps, dataDir, extraHooks: opts.extraHooks })

  let busy = false
  const pending: PendingTurn[] = []
  // 活动 turn 的中断控制器（sessionId → AbortController），interrupt 时 abort 对应 turn
  const active = new Map<string, AbortController>()

  function broadcastEvent(sessionId: string, event: SessionEvent): void {
    deps.broadcast({
      type: 'session/event',
      payload: { type: 'session/event', sessionId, event },
    })
  }

  // 全局串行 pump：取队首执行，直到队列清空（prompt 在 idle 时触发）
  async function pump(): Promise<void> {
    if (busy) return
    busy = true
    try {
      while (pending.length > 0) {
        const next = pending.shift()!
        const session = deps.db.getSession(next.sessionId)
        if (!session) continue // 会话已被删除 → 跳过

        console.log('[engine] turn/start', session.id, 'text:', next.text.slice(0, 40))
        broadcastEvent(session.id, { type: 'turn/start' })
        // 本 turn 的中断控制器：interrupt 后可随时 abort
        const controller = new AbortController()
        active.set(session.id, controller)
        try {
          await runner.run(session, next.text, controller.signal)
        } catch (err) {
          // TurnRunner 内部已兜底；防御性再兜一层
          const message = err instanceof Error ? err.message : String(err)
          broadcastEvent(session.id, {
            type: 'assistant/chunk',
            data: { chunk: { type: 'finish', reason: { kind: 'error', message } } },
          })
        } finally {
          active.delete(session.id)
          broadcastEvent(session.id, { type: 'turn/end' })
        }
      }
    } finally {
      busy = false
    }
  }

  return {
    create(cwd: string): SessionRecord {
      const rec = createSessionRecord(cwd)
      deps.db.createSession(rec)
      return rec
    },

    prompt(sessionId: string, text: string): { accepted: boolean } {
      const session = deps.db.getSession(sessionId)
      if (!session) throw new Error('会话不存在')
      pending.push({ sessionId, text })
      if (!busy) void pump()
      return { accepted: true }
    },

    interrupt(sessionId: string): { ok: boolean } {
      // 1. 有活动 turn → abort（TurnRunner 收到 signal 后发 finish error + turn/end 由 pump 收尾）
      const controller = active.get(sessionId)
      if (controller) {
        controller.abort()
        active.delete(sessionId)
        console.log('[engine] interrupt', sessionId)
        return { ok: true }
      }
      // 2. 无活动 turn → 清理排队中该会话的 prompt（防止中断后残留挂起状态）
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].sessionId === sessionId) pending.splice(i, 1)
      }
      // 幂等：会话未在运行也返回 ok（前端「停止」按钮无需关心状态）
      return { ok: true }
    },

    history(sessionId: string): { events: { event: HistoryEvent }[] } {
      return { events: deps.db.readEvents(sessionId).map((e) => ({ event: e })) }
    },

    selectModel(sessionId: string, provider: string, model: string): { ok: boolean } {
      deps.db.updateSession(sessionId, { provider, model })
      return { ok: true }
    },

    list(): SessionRecord[] {
      return deps.db.listSessions()
    },

    rename(sessionId: string, label: string): { ok: boolean } {
      if (!label || !label.trim()) throw new Error('会话名称不能为空')
      deps.db.updateSession(sessionId, { label })
      return { ok: true }
    },

    fork(sessionId: string): SessionRecord {
      const rec = forkSession(deps.db, sessionId)
      if (!rec) throw new Error('会话不存在')
      return rec
    },

    delete(sessionId: string): { ok: boolean } {
      // 幂等：会话不存在也返回 ok
      deps.db.deleteSession(sessionId)
      return { ok: true }
    },
  }
}