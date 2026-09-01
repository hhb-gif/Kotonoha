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

  'session.interrupt': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    if (!sessionId) throw new Error('sessionId required')
    return ctx.engine.interrupt(sessionId)
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

  // ---- T1-toolsets（工具集门类：list / active / set）----

  'toolsets.list': (ctx) => {
    if (!ctx.ops?.listToolsets) throw new Error('toolsets.list 未注入')
    return { toolsets: ctx.ops.listToolsets() }
  },

  'toolsets.active': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    if (!sessionId) throw new Error('sessionId required')
    if (!ctx.ops?.getActiveToolsets) throw new Error('toolsets.active 未注入')
    return { toolsets: ctx.ops.getActiveToolsets(sessionId) }
  },

  'toolsets.set': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    const names = strArray(p, 'names')
    if (!sessionId || !names) throw new Error('sessionId and names required')
    if (!ctx.ops?.setActiveToolsets || !ctx.ops.getActiveToolsets) {
      throw new Error('toolsets.set 未注入')
    }
    ctx.ops.setActiveToolsets(sessionId, names)
    return { ok: true, toolsets: ctx.ops.getActiveToolsets(sessionId) }
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

  // ---- v0.2.4 任务 B：MCP 配置化（用户服务器 CRUD，ops 注入；mcp.status 保持只读运行态）----

  'mcp.servers.list': async (ctx) => {
    if (!ctx.ops?.listMcpConfiguredServers) throw new Error('mcp.servers.list 未注入')
    return ctx.ops.listMcpConfiguredServers()
  },

  'mcp.servers.add': async (ctx, p) => {
    if (!ctx.ops?.addMcpServer) throw new Error('mcp.servers.add 未注入')
    const raw = p.server
    if (typeof raw !== 'object' || raw === null) throw new Error('server required')
    const s = raw as Record<string, unknown>
    const id = str(s, 'id')?.trim()
    const type = str(s, 'type')
    if (!id) throw new Error('id 不能为空')
    if (type !== 'stdio' && type !== 'sse') throw new Error('type 必须是 stdio 或 sse')
    const command = str(s, 'command')?.trim()
    const url = str(s, 'url')?.trim()
    if (type === 'stdio' && !command) throw new Error('stdio 类型必须提供 command')
    if (type === 'sse' && !url) throw new Error('sse 类型必须提供 url')
    // 组装净化的 payload（多余字段不带进持久化层）
    const server: {
      id: string
      type: 'stdio' | 'sse'
      command?: string
      args?: string[]
      url?: string
      headers?: Record<string, string>
    } = { id, type }
    if (command) server.command = command
    if (url) server.url = url
    const args = strArray(s, 'args')
    if (args) server.args = args
    const headers = s.headers
    if (typeof headers === 'object' && headers !== null) {
      const clean: Record<string, string> = {}
      for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
        if (typeof v === 'string') clean[k] = v
      }
      if (Object.keys(clean).length > 0) server.headers = clean
    }
    return ctx.ops.addMcpServer(server)
  },

  'mcp.servers.remove': async (ctx, p) => {
    if (!ctx.ops?.removeMcpServer) throw new Error('mcp.servers.remove 未注入')
    const id = str(p, 'id')
    if (!id) throw new Error('id required')
    return ctx.ops.removeMcpServer(id)
  },

  'mcp.servers.toggle': async (ctx, p) => {
    if (!ctx.ops?.toggleMcpServer) throw new Error('mcp.servers.toggle 未注入')
    const id = str(p, 'id')
    if (!id) throw new Error('id required')
    if (typeof p.enabled !== 'boolean') throw new Error('enabled 必须是 boolean')
    return ctx.ops.toggleMcpServer(id, p.enabled)
  },

  // ---- C-memory2（三层记忆 RPC）：memory.list / skills.list / skills.approve / skills.reject ----

  'memory.list': (ctx, p) => {
    if (!ctx.ops?.listMemories) throw new Error('memory.list 未注入')
    const sessionId = str(p, 'sessionId')
    const query = str(p, 'query')
    // 有 query → 全文检索；否则按会话列出（无 sessionId 时返回全部）
    if (query) {
      if (!ctx.ops.searchMemories) throw new Error('memory.search 未注入')
      const limit = typeof p.limit === 'number' ? p.limit : 10
      return { memories: ctx.ops.searchMemories(query, limit) }
    }
    return { memories: ctx.ops.listMemories(sessionId) }
  },

  'skills.list': (ctx, p) => {
    if (!ctx.ops?.listSkills) throw new Error('skills.list 未注入')
    const status = str(p, 'status') ?? 'pending'
    if (status !== 'pending' && status !== 'approved' && status !== 'rejected') {
      throw new Error('status 必须是 pending / approved / rejected')
    }
    return { skills: ctx.ops.listSkills(status) }
  },

  'skills.approve': (ctx, p) => {
    if (!ctx.ops?.approveSkill) throw new Error('skills.approve 未注入')
    const id = typeof p.id === 'number' ? p.id : Number(p.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('id required')
    const skill = ctx.ops.approveSkill(id)
    if (!skill) throw new Error(`技能不存在：${id}`)
    return { ok: true, skill }
  },

  'skills.reject': (ctx, p) => {
    if (!ctx.ops?.rejectSkill) throw new Error('skills.reject 未注入')
    const id = typeof p.id === 'number' ? p.id : Number(p.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('id required')
    const skill = ctx.ops.rejectSkill(id)
    if (!skill) throw new Error(`技能不存在：${id}`)
    return { ok: true, skill }
  },

  // ---- E-ops（成本统计 / 全文搜索 / 轨迹审计）----

  'stats.cost': (ctx) => {
    if (!ctx.ops?.getTotalCost) throw new Error('stats.cost 未注入')
    const agg = ctx.ops.getTotalCost()
    // 契约返回 { total, bySession: { id: { tokens, cost } } }
    const bySession: Record<string, { tokens: number; cost: number }> = {}
    for (const id of Object.keys(agg.bySession)) {
      const s = agg.bySession[id]
      bySession[id] = { tokens: s.tokens, cost: s.costUsd }
    }
    return { total: agg.totalCostUsd, bySession }
  },

  'stats.cost.session': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    if (!sessionId) throw new Error('sessionId required')
    if (!ctx.ops?.getSessionCost) throw new Error('stats.cost.session 未注入')
    return ctx.ops.getSessionCost(sessionId)
  },

  'stats.cost.csv': (ctx) => {
    if (!ctx.ops?.exportCostCsv) throw new Error('stats.cost.csv 未注入')
    return { csv: ctx.ops.exportCostCsv() }
  },

  'session.search': (ctx, p) => {
    const sessionId = str(p, 'sessionId') ?? ''
    const query = str(p, 'query')
    if (!query) throw new Error('query required')
    if (!ctx.ops?.searchEvents) throw new Error('session.search 未注入')
    const limit = typeof p.limit === 'number' ? p.limit : 20
    return { results: ctx.ops.searchEvents(sessionId, query, limit) }
  },

  'session.trajectory': (ctx, p) => {
    const sessionId = str(p, 'sessionId')
    if (!sessionId) throw new Error('sessionId required')
    if (!ctx.ops?.getTrajectory) throw new Error('session.trajectory 未注入')
    return { trajectory: ctx.ops.getTrajectory(sessionId) }
  },

  // ---- M4（4.2 provider 可靠性）：降级记录 / 供应商健康状态 ----

  'stats.degradations': (ctx) => {
    if (!ctx.ops?.getDegradations) throw new Error('stats.degradations 未注入')
    return { degradations: ctx.ops.getDegradations() }
  },

  'providers.health': (ctx) => {
    if (!ctx.ops?.getProviderHealth) throw new Error('providers.health 未注入')
    return { providers: ctx.ops.getProviderHealth() }
  },

  // ---- v0.2.2 羁绊系统：好感度视图（增长逻辑在 turn 结束自动跑，无需手动触发）----

  'bond.get': (ctx) => {
    if (!ctx.ops?.getBond) throw new Error('bond.get 未注入')
    return ctx.ops.getBond()
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
