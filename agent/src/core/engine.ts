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
import { TurnRunner } from './agent'
import { DEFAULT_DATA_DIR } from './context'
import { createSessionRecord, forkSession } from '../store/sessions'

interface PendingTurn {
  sessionId: string
  text: string
}

export function createEngine(deps: EngineDeps, opts: { dataDir?: string } = {}): SessionEngine {
  const dataDir = opts.dataDir || DEFAULT_DATA_DIR
  const runner = new TurnRunner({ deps, dataDir })

  let busy = false
  const pending: PendingTurn[] = []

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
        try {
          await runner.run(session, next.text)
        } catch (err) {
          // TurnRunner 内部已兜底；防御性再兜一层
          const message = err instanceof Error ? err.message : String(err)
          broadcastEvent(session.id, {
            type: 'assistant/chunk',
            data: { chunk: { type: 'finish', reason: { kind: 'error', message } } },
          })
        } finally {
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