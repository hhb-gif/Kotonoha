// ============================================================
// api/rpc.ts —— HTTP POST /api/<method> 的 RPC 分发层
// 协议与 dsh 完全兼容（docs/plans/agent-harness-m0.md 第 1.1/1.2 节）
// 中文注释、英文标识符
// ============================================================

import type {
  RpcError,
  RpcHandlerContext,
  RpcRequest,
  RpcResponse,
  SessionRecord,
} from '../types'

// ---- 响应构造 ----

function ok(rpcId: string, value: unknown): RpcResponse {
  return { type: 'server-response', rpcId, result: { ok: true, value } }
}

function err(rpcId: string, code: string, message: string, details?: unknown): RpcResponse {
  const error: { code: string; message: string; details?: unknown } = { code, message }
  if (details !== undefined) error.details = details
  const result: RpcError = { ok: false, error }
  return { type: 'server-response', rpcId, result }
}

// ---- 请求体校验 ----

function extractRpcId(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const rpcId = (body as Record<string, unknown>).rpcId
    if (typeof rpcId === 'string') return rpcId
  }
  return ''
}

/** 校验并归一化 client-request；不合法返回 null */
function parseRequest(body: unknown): RpcRequest | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (b.type !== 'client-request') return null
  if (typeof b.rpcId !== 'string' || typeof b.method !== 'string') return null
  const payload =
    typeof b.payload === 'object' && b.payload !== null
      ? (b.payload as Record<string, unknown>)
      : {}
  return { type: 'client-request', rpcId: b.rpcId, method: b.method, payload }
}

// ---- payload 取值辅助 ----

function str(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key]
  return typeof v === 'string' ? v : undefined
}

function strArray(p: Record<string, unknown>, key: string): string[] | undefined {
  const v = p[key]
  if (!Array.isArray(v)) return undefined
  if (!v.every((x) => typeof x === 'string')) return undefined
  return v as string[]
}

/** 从 content 数组取第一个 type==='text' 的 text */
function firstText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  for (const c of content) {
    if (typeof c !== 'object' || c === null) continue
    const o = c as Record<string, unknown>
    if (o.type === 'text' && typeof o.text === 'string') return o.text
  }
  return ''
}

// ---- 路由表（返回值与规划第 1.2 节一致）----

type Route = (ctx: RpcHandlerContext, payload: Record<string, unknown>) => unknown

function sessionIdOf(rec: SessionRecord): { sessionId: string } {
  return { sessionId: rec.id }
}

const routes: Record<string, Route> = {
  'session.create': (ctx, p) => {
    const cwd = str(p, 'cwd') ?? process.cwd()
    return sessionIdOf(ctx.engine.create(cwd))
  },

  'session.prompt': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    if (!sessionId) throw new Error('sessionId required')
    return ctx.engine.prompt(sessionId, firstText(p.content))
  },

  'session.history': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    if (!sessionId) throw new Error('sessionId required')
    return ctx.engine.history(sessionId)
  },

  'session.selectModel': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    const provider = str(p, 'provider')
    const model = str(p, 'model')
    if (!sessionId || !provider || !model) {
      throw new Error('sessionId, provider and model are required')
    }
    return ctx.engine.selectModel(sessionId, provider, model)
  },

  'session.list': (ctx) =>
    ctx.engine.list().map((r) => ({
      sessionId: r.id,
      cwd: r.cwd,
      label: r.label,
      provider: r.provider,
      model: r.model,
      createdAt: r.createdAt,
      lastActiveAt: r.lastActiveAt,
    })),

  'session.rename': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    const label = str(p, 'label')
    if (!sessionId || !label) throw new Error('sessionId and label are required')
    return ctx.engine.rename(sessionId, label)
  },

  'session.fork': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    if (!sessionId) throw new Error('sessionId required')
    return sessionIdOf(ctx.engine.fork(sessionId))
  },

  'session.delete': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    if (!sessionId) throw new Error('sessionId required')
    return ctx.engine.delete(sessionId)
  },

  'credentials.describe': (ctx, p) => {
    const refs = strArray(p, 'refs') ?? []
    return { refs: ctx.secrets.describe(refs) }
  },

  'credentials.set': (ctx, p) => {
    const ref = str(p, 'ref')
    const value = str(p, 'value')
    if (!ref || !value) throw new Error('ref and value required')
    ctx.secrets.set(ref, value, 'settings panel')
    return {}
  },

  'credentials.unset': (ctx, p) => {
    const ref = str(p, 'ref')
    if (!ref) throw new Error('ref required')
    ctx.secrets.remove(ref)
    return {}
  },

  'mcp.list': () => ({ servers: [] }),

  // ---- Round-2 扩展（依赖 ctx.ops；未注入时按 METHOD_NOT_FOUND 处理）----

  'tools.list': (ctx) => {
    if (!ctx.ops?.listTools) throw new Error('tools.list 未注入')
    return { tools: ctx.ops.listTools() }
  },

  'providers.list': async (ctx) => {
    if (!ctx.ops?.listProviders) throw new Error('providers.list 未注入')
    return { defaultId: ctx.ops.providerDefaultId?.() ?? '', providers: await ctx.ops.listProviders() }
  },

  'session.export': async (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    const format = str(p, 'format') === 'markdown' ? 'markdown' : 'json'
    if (!sessionId) throw new Error('sessionId required')
    if (!ctx.ops?.exportSession) throw new Error('session.export 未注入')
    const content = await ctx.ops.exportSession(sessionId, format)
    return { filename: `${sessionId}.${format === 'markdown' ? 'md' : 'json'}`, content }
  },

  'session.import': async (ctx, p) => {
    const content = str(p, 'content')
    const format = str(p, 'format') === 'markdown' ? 'markdown' : 'json'
    if (!content) throw new Error('content required')
    if (!ctx.ops?.importSession) throw new Error('session.import 未注入')
    const rec = await ctx.ops.importSession(content, format)
    return { sessionId: rec.sessionId }
  },

  'session.archive': async (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    if (!sessionId) throw new Error('sessionId required')
    if (!ctx.ops?.archiveSession) throw new Error('session.archive 未注入')
    await ctx.ops.archiveSession(sessionId)
    return { ok: true }
  },

  'session.unarchive': async (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    if (!sessionId) throw new Error('sessionId required')
    if (!ctx.ops?.unarchiveSession) throw new Error('session.unarchive 未注入')
    await ctx.ops.unarchiveSession(sessionId)
    return { ok: true }
  },

  'session.listArchived': (ctx) => {
    if (!ctx.ops?.listArchivedSessions) throw new Error('session.listArchived 未注入')
    return { sessions: ctx.ops.listArchivedSessions() }
  },

  'session.compress': async (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    const keepRecent = typeof p.keepRecent === 'number' ? p.keepRecent : 5
    if (!sessionId) throw new Error('sessionId required')
    if (!ctx.ops?.compressSession) throw new Error('session.compress 未注入')
    const result = await ctx.ops.compressSession(sessionId, { keepRecent })
    return { ok: true, ...result }
  },

  'rules.get': (ctx) => {
    if (!ctx.ops?.getRules) throw new Error('rules.get 未注入')
    return { rules: ctx.ops.getRules() }
  },

  'rules.set': (ctx, p) => {
    if (!ctx.ops?.setRules) throw new Error('rules.set 未注入')
    const rules = p.rules as { tool: string; level: 'allow' | 'ask' | 'deny' }[] | undefined
    if (!Array.isArray(rules)) throw new Error('rules required (array of {tool, level})')
    ctx.ops.setRules(rules)
    return { ok: true }
  },

  'mcp.status': (ctx) => {
    if (!ctx.ops?.listMcpServers) throw new Error('mcp.status 未注入')
    return { servers: ctx.ops.listMcpServers() }
  },
}

// ---- 入口 ----

/**
 * 构造 RPC 处理器：校验请求体 → 路由分发 → 统一错误包装。
 * HTTP 层（index.ts）负责把 body 解析为 unknown 并调用本函数。
 */
export function makeRpcHandler(ctx: RpcHandlerContext) {
  return async (method: string, body: unknown): Promise<RpcResponse> => {
    const req = parseRequest(body)
    if (!req) {
      return err(
        extractRpcId(body),
        'INVALID_REQUEST',
        'body must be { type: "client-request", rpcId, method, payload }'
      )
    }
    const route = routes[req.method]
    if (!route) {
      return err(req.rpcId, 'METHOD_NOT_FOUND', `unknown method: ${req.method}`)
    }
    try {
      return ok(req.rpcId, await route(ctx, req.payload))
    } catch (e) {
      return err(
        req.rpcId,
        'ENGINE_ERROR',
        e instanceof Error ? e.message : String(e)
      )
    }
  }
}
