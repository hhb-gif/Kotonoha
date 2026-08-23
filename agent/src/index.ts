// ============================================================
// index.ts —— Agent Harness M0 入口
// 零依赖 HTTP + WS 服务（node:http 原生实现，无 express/ws）
// 协议与 dsh 完全兼容（docs/plans/agent-harness-m0.md 第 1 节）
// 中文注释、英文标识符
// ============================================================

import http from 'node:http'
import crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { makeEventHub } from './api/events'
import { makeRpcHandler } from './api/rpc'
import type {
  EventHub,
  HistoryEvent,
  OutboundFrame,
  RpcHandlerContext,
  SecretsStore,
  SessionEngine,
  SessionRecord,
} from './types'

// ============================================================
// 最小 WebSocket 服务端（RFC 6455 子集，够用即可）
// 支持：握手、接收客户端掩码帧、发送文本帧、ping→pong、close
// ============================================================

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 握手响应头 */
function wsAcceptKey(key: string): string {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
}

/** 编码一帧（服务端发送，不掩码；支持 7bit/16bit/64bit 长度） */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
  let header: Buffer
  if (payload.length < 126) {
    header = Buffer.alloc(2)
    header[1] = payload.length
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  header[0] = 0x80 | opcode
  return Buffer.concat([header, payload])
}

function encodeTextFrame(text: string): Buffer {
  return encodeFrame(0x1, Buffer.from(text, 'utf8'))
}

/**
 * 尝试从缓冲开头解码一个完整帧（FIN=1 单帧）。
 * 缓冲不足时返回 null（等待更多数据）；返回 consumed 供调用方推进缓冲。
 */
function tryDecodeFrame(
  buf: Buffer
): { opcode: number; payload: Buffer; consumed: number } | null {
  if (buf.length < 2) return null
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let len = buf[1] & 0x7f
  let offset = 2
  if (len === 126) {
    if (buf.length < 4) return null
    len = buf.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    if (buf.length < 10) return null
    len = Number(buf.readBigUInt64BE(2))
    offset = 10
  }
  const maskLen = masked ? 4 : 0
  if (buf.length < offset + maskLen + len) return null
  const mask = masked ? buf.subarray(offset, offset + 4) : null
  offset += maskLen
  const payload = Buffer.from(buf.subarray(offset, offset + len))
  if (mask) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
  }
  return { opcode, payload, consumed: offset + len }
}

/** 处理 /api/events.mux 的升级请求：握手 → 挂到事件总线 → 读帧循环 */
function handleWsUpgrade(
  req: http.IncomingMessage,
  socket: import('node:net').Socket,
  head: Buffer,
  hub: EventHub
): void {
  const key = req.headers['sec-websocket-key']
  if (typeof key !== 'string') {
    socket.destroy()
    return
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${wsAcceptKey(key)}\r\n` +
      '\r\n'
  )
  socket.setNoDelay(true)

  // 广播回调：把 OutboundFrame 序列化为文本帧推给客户端
  const send = (frame: OutboundFrame): void => {
    if (socket.destroyed) return
    socket.write(encodeTextFrame(JSON.stringify(frame)))
  }
  const detach = hub.attach(send)

  const cleanup = (): void => {
    detach()
    socket.destroy()
  }
  socket.on('close', cleanup)
  socket.on('end', cleanup)
  socket.on('error', cleanup)

  // 读帧循环：解析完整帧，响应 ping/close；握手后附带的 head 数据一并处理
  let buffer = Buffer.from(head)
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const frame = tryDecodeFrame(buffer)
      if (!frame) break
      buffer = buffer.subarray(frame.consumed)
      if (frame.opcode === 0x8) {
        // close：回 close 帧并关闭
        socket.write(encodeFrame(0x8, frame.payload))
        socket.end()
        return
      } else if (frame.opcode === 0x9) {
        // ping → pong（原样回 payload）
        socket.write(encodeFrame(0xa, frame.payload))
      }
      // 0x1 text / 0x2 binary：客户端无需上行业务数据，忽略
    }
  })
}

// ============================================================
// HTTP 服务
// ============================================================

export interface StartServerDeps {
  engine: SessionEngine
  approver: RpcHandlerContext['approver']
  secrets: SecretsStore
  hub: EventHub
  port?: number
  ops?: RpcHandlerContext['ops']
}

function setCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 处理 POST /api/respond（client-response）：
 * 取 rpcId + result.value.outcome → approver.respond → { accepted }
 */
function handleRespond(
  body: unknown,
  approver: RpcHandlerContext['approver']
): boolean {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  if (b.type !== 'client-response' || typeof b.rpcId !== 'string') return false
  const result = b.result as Record<string, unknown> | undefined
  if (!result || result.ok !== true) return false
  const value = result.value as Record<string, unknown> | undefined
  if (!value) return false
  const outcome = value.outcome
  if (outcome !== 'allowed-once' && outcome !== 'rejected') return false
  return approver.respond(b.rpcId, outcome)
}

export function startServer(deps: StartServerDeps): {
  server: http.Server
  close: () => void
} {
  const { engine, approver, secrets, hub, port = 3080, ops } = deps
  const rpcHandler = makeRpcHandler({ engine, approver, secrets, ops })

  const server = http.createServer(async (req, res) => {
    setCors(res)

    if (req.method === 'OPTIONS') {
      // CORS 预检
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname

    if (req.method === 'GET' && pathname === '/api/health') {
      writeJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && pathname === '/api/respond') {
      let body: unknown
      try {
        body = await readJson(req)
      } catch {
        writeJson(res, 400, { ok: false, error: 'invalid JSON body' })
        return
      }
      writeJson(res, 200, { accepted: handleRespond(body, approver) })
      return
    }

    if (req.method === 'POST' && pathname.startsWith('/api/')) {
      const method = pathname.slice('/api/'.length)
      let body: unknown
      try {
        body = await readJson(req)
      } catch {
        writeJson(res, 400, { ok: false, error: 'invalid JSON body' })
        return
      }
      const resp = await rpcHandler(method, body)
      writeJson(res, 200, resp)
      return
    }

    writeJson(res, 404, { ok: false, error: 'not found' })
  })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/api/events.mux') {
      socket.destroy()
      return
    }
    // upgrade 事件的 socket 在运行时是 net.Socket（类型声明为 Duplex）
    handleWsUpgrade(req, socket as import('node:net').Socket, head, hub)
  })

  server.listen(port)

  return {
    server,
    close: () => server.close(),
  }
}

// ============================================================
// main()：组装依赖并启动
// 其他模块（store/providers/tools/auth/core）由并行 agent 提供，
// 集成时替换 stub；缺失时以内存 stub 保证骨架可跑
// ============================================================

/** 内存 stub：模块未就绪时的兜底，session.list 返回空数组 */
function stubDeps(): {
  engine: SessionEngine
  approver: RpcHandlerContext['approver']
  secrets: SecretsStore
} {
  const sessions = new Map<string, SessionRecord>()

  const engine: SessionEngine = {
    create(cwd: string): SessionRecord {
      const now = Date.now()
      const rec: SessionRecord = {
        id: randomUUID(),
        cwd,
        label: '对话',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        createdAt: now,
        lastActiveAt: now,
      }
      sessions.set(rec.id, rec)
      return rec
    },
    prompt(): { accepted: boolean } {
      return { accepted: true }
    },
    interrupt(): { ok: boolean } {
      return { ok: true }
    },
    history(): { events: { event: HistoryEvent }[] } {
      return { events: [] }
    },
    selectModel(): { ok: boolean } {
      return { ok: true }
    },
    list(): SessionRecord[] {
      return [...sessions.values()]
    },
    rename(): { ok: boolean } {
      return { ok: true }
    },
    fork(sessionId: string): SessionRecord {
      const src = sessions.get(sessionId)
      if (!src) throw new Error(`session not found: ${sessionId}`)
      const now = Date.now()
      const rec: SessionRecord = { ...src, id: randomUUID(), createdAt: now, lastActiveAt: now }
      sessions.set(rec.id, rec)
      return rec
    },
    delete(sessionId: string): { ok: boolean } {
      return { ok: sessions.delete(sessionId) }
    },
  }

  const approver: RpcHandlerContext['approver'] = {
    request: async () => 'rejected',
    respond: () => false,
  }

  const secrets: SecretsStore = {
    get: () => undefined,
    has: () => false,
    describe: (refs) => refs.map((ref) => ({ ref, configured: false, source: null })),
    set: () => {},
    remove: () => {},
  }

  return { engine, approver, secrets }
}

/** 组装真实依赖；模块缺失时回落 stub（异步：插件扫描加载需要 await） */
async function loadDeps(hub: EventHub): Promise<{
  engine: SessionEngine
  approver: RpcHandlerContext['approver']
  secrets: SecretsStore
  ops?: RpcHandlerContext['ops']
}> {
  try {
    // 并行 agent 交付的真实组装（store/providers/tools/auth/core/memory/mcp）
    // require 返回 any，缺失模块不会造成类型错误
    const dataDir =
      process.env.KOTONOHA_DATA_DIR || path.join(__dirname, '..', 'data')
    const { openDb } = require('./store/db') as { openDb: (dir: string) => unknown }
    const { openSecrets } = require('./store/secrets') as {
      openSecrets: (dir: string) => SecretsStore
    }
    const { buildDefaultAuth } = require('./auth') as {
      buildDefaultAuth: (secrets: SecretsStore, broadcast: (frame: OutboundFrame) => void) => {
        engine: import('./auth/types').AuthEngine
        permissionEngine: import('./auth/permission').PermissionEngine
        rulesManager: import('./auth/rules').RulesManager
        defaultRules: readonly import('./auth/types').PermissionRule[]
      }
    }
    const { createEngine } = require('./core/engine') as {
      createEngine: (deps: unknown, opts: { dataDir: string; extraHooks?: import('./tools/hooks').Hook[] }) => SessionEngine
    }
    const { buildDefaultRegistry } = require('./providers/registry') as {
      buildDefaultRegistry: (getKey: (ref: string) => string | undefined) => {
        get: (id: string) => unknown
        list: () => unknown[]
        defaultId: () => string
      }
    }
    const { buildDefaultTools, ToolRegistry } = require('./tools/registry') as {
      buildDefaultTools: () => import('./tools').Tool[]
      ToolRegistry: new () => import('./tools/registry').ToolRegistry
    }
    const { listToolsets, validateToolsetNames, DEFAULT_ACTIVE_TOOLSETS } = require('./tools/toolsets') as {
      listToolsets: () => { name: string; description: string; tools: string[] }[]
      validateToolsetNames: (names: string[]) => string[]
      DEFAULT_ACTIVE_TOOLSETS: readonly string[]
    }
    const { createSkillTool } = require('./tools/skills') as {
      createSkillTool: (db: unknown) => import('./types').Tool
    }
    const { buildSystemPrompt } = require('./core/context') as {
      buildSystemPrompt: (session: SessionRecord) => string
    }
    const { buildDefaultStore } = require('./store') as {
      buildDefaultStore: (dir: string, envSecret?: string) => import('./store').SessionStore
    }
    const { compressSessionStore } = require('./store') as {
      compressSessionStore: (
        db: import('./store').Db,
        sessionId: string,
        opts: { keepRecent: number; summarizeModel: string; maxTokens: number },
        provider: import('./providers').ModelProvider
      ) => Promise<{ originalEvents: number; compressedEvents: number; summary: string }>
    }
    const { buildDefaultMemory } = require('./memory') as {
      buildDefaultMemory: (deps: { db: import('./store').Db; providers: import('./providers').ProviderRegistry; tools: import('./types').Tool[] }) => import('./memory').MemoryEngine
    }
    const { buildDefaultMCP } = require('./mcp') as {
      buildDefaultMCP: (cwd?: string) => import('./mcp').MCPManager
    }
    const { getTotalCost, getSessionCost, exportAllCostCsv } = require('./store/cost') as {
      getTotalCost: (db: import('./store').Db) => {
        totalCostUsd: number
        totalTokens: number
        bySession: Record<string, { sessionId: string; tokens: number; costUsd: number }>
      }
      getSessionCost: (db: import('./store').Db, sessionId: string) => {
        sessionId: string
        records: unknown[]
        tokens: { prompt: number; completion: number }
        costUsd: number
      }
      exportAllCostCsv: (db: import('./store').Db) => string
    }
    const { searchEvents } = require('./store/search') as {
      searchEvents: (
        db: import('./store').Db,
        sessionId: string,
        query: string,
        limit?: number
      ) => { id: number; sessionId: string; seq: number; payload: unknown; snippet?: string }[]
    }
    const { getTrajectory } = require('./tools/hooks') as {
      getTrajectory: (
        db: import('./store').Db,
        sessionId: string
      ) => { ts: number; tool: string; args: string; ok: boolean; error?: string; sessionId: string }[]
    }
    const { loadPlugins } = require('./tools/plugins/loader') as {
      loadPlugins: (
        dir: string
      ) => Promise<{
        tools: import('./tools/protocol').ExtendedTool[]
        hooks: import('./tools/hooks').Hook[]
        errors: { name: string; error: string }[]
      }>
    }
    const { loadExternalTools } = require('./tools/external') as {
      loadExternalTools: (
        dir: string
      ) => Promise<{
        tools: import('./tools/protocol').ExtendedTool[]
        errors: { file: string; error: string }[]
      }>
    }

    const db = openDb(dataDir) as import('./store').Db
    const secrets = openSecrets(dataDir)
    const store = buildDefaultStore(dataDir)
    const auth = buildDefaultAuth(secrets, (frame) => hub.broadcast(frame))
    const providers = buildDefaultRegistry((ref) => secrets.get(ref)) as import('./providers').ProviderRegistry
    // 注册表实例：list({checkCtx})/listAvailable/get 满足 EngineDeps.tools 契约（check_fn 门控）
    const registry = new ToolRegistry()
    registry.registerAll(buildDefaultTools(), { source: 'default' })
    // execute_skill 换成带 db 的版本（内置 polish/storybeat + approved 自定义技能）
    registry.register(createSkillTool(db), { source: 'default', allowOverride: true })
    const tools = registry.list()

    // T3-plugins：扫描加载插件（目录为 src/tools/plugins 开发期 / dist/tools/plugins 编译后）
    // 插件工具并入工具列表、插件钩子随引擎注入（与内置钩子共存）
    // 错误隔离：loadPlugins 内部已隔离单个插件失败，此处仅做工具重名保护
    const pluginDir = path.join(__dirname, 'tools', 'plugins')
    const plugins = await loadPlugins(pluginDir)
    for (const pt of plugins.tools) {
      if (tools.some((t) => t.def.name === pt.def.name)) {
        console.warn(`[plugins] 工具「${pt.def.name}」与现有工具重名，跳过该插件工具`)
        continue
      }
      tools.push(pt)
    }

    const mcp = buildDefaultMCP()

    // T2-external：配置驱动外接工具（tool.yaml → shell/HTTP 工具，不写核心代码）
    // 配置目录：<agent>/tools/external（tool.yaml / *.tools.yaml）；目录不存在 → 空
    // 错误隔离：loadExternalTools 内部已隔离单个文件失败，此处仅做工具重名保护
    const externalDir = path.join(__dirname, '..', 'tools', 'external')
    const external = await loadExternalTools(externalDir)
    for (const et of external.tools) {
      if (tools.some((t) => t.def.name === et.def.name)) {
        console.warn(`[external] 工具「${et.def.name}」与现有工具重名，跳过该外接工具`)
        continue
      }
      tools.push(et)
    }

    const ops: RpcHandlerContext['ops'] = {
      listTools: () => tools.map((t) => ({ name: t.def.name, description: t.def.description })),
      listProviders: async () =>
        Promise.all(
          providers.list().map(async (p) => ({
            id: p.id,
            name: p.name,
            capabilities: (p as import('./providers').ModelProvider).capabilities,
            models: await p.listModels(),
          }))
        ),
      providerDefaultId: () => providers.defaultId(),
      exportSession: (id, format) => store.exportSession(id, format),
      importSession: async (data, format) => {
        const rec = await store.importSession(data, format)
        return { sessionId: rec.id }
      },
      compressSession: async (id, opts) => {
        const provider = providers.get(providers.defaultId())
        if (!provider) throw new Error('无可用 provider')
        return compressSessionStore(db, id, {
          keepRecent: opts.keepRecent,
          summarizeModel: 'deepseek-v4-flash',
          maxTokens: 4096,
        }, provider)
      },
      archiveSession: (id) => store.archiveSession(id),
      unarchiveSession: (id) => store.unarchiveSession(id),
      listArchivedSessions: () => store.listArchivedSessions(),
      isSessionArchived: (id) => store.isArchived(id),
      getRules: () => auth.engine.getRules().map((r) => ({ tool: r.tool, level: r.level })),
      setRules: (rules) => {
        auth.engine.setRules(rules)
      },
      listMcpServers: () =>
        mcp.listServers().map((s) => ({
          id: s.id,
          type: s.config.type,
          status: s.status,
          tools: s.tools.map((t) => t.def.name),
        })),
      // T1-toolsets：工具集门类（list / active / set，会话级持久化到 db）
      listToolsets: () => listToolsets(),
      getActiveToolsets: (id) => {
        const rec = db.getSession(id)
        if (!rec) throw new Error('会话不存在')
        return rec.toolsets ?? [...DEFAULT_ACTIVE_TOOLSETS]
      },
      setActiveToolsets: (id, names) => {
        const rec = db.getSession(id)
        if (!rec) throw new Error('会话不存在')
        // 未知集名剔除；空集合法（模型将收不到任何工具 schema，属用户显式选择）
        db.updateSession(id, { toolsets: validateToolsetNames(names) })
      },
      // C-memory2：语义记忆 + 程序性技能（走 db 已就绪接口）
      listMemories: (sessionId?: string) =>
        sessionId ? db.getMemoriesBySession(sessionId) : db.searchMemories('', 100),
      searchMemories: (query, limit) => db.searchMemories(query, limit),
      listSkills: (status) => db.getSkillsByStatus(status),
      approveSkill: (id) => {
        db.updateSkillStatus(id, 'approved')
        return db.getSkillById(id)
      },
      rejectSkill: (id) => {
        db.updateSkillStatus(id, 'rejected')
        return db.getSkillById(id)
      },
      // E-ops：成本统计 / 全文搜索 / 轨迹审计
      getSessionCost: (id) => getSessionCost(db, id),
      getTotalCost: () => getTotalCost(db),
      exportCostCsv: () => exportAllCostCsv(db),
      searchEvents: (sessionId, query, limit) => searchEvents(db, sessionId, query, limit),
      getTrajectory: (id) => getTrajectory(db, id),
    }

    const engine = createEngine(
      {
        db,
        providers: {
          get: (id: string) => providers.get(id),
          list: () => providers.list(),
          defaultId: () => providers.defaultId(),
        },
        tools: registry,
        approver: auth.engine,
        secrets,
        broadcast: (frame: OutboundFrame) => hub.broadcast(frame),
        systemPrompt: buildSystemPrompt,
      },
      { dataDir, extraHooks: plugins.hooks }
    )
    return { engine, approver: auth.engine, secrets, ops }
  } catch (e) {
    console.warn('[agent] 后端模块未就绪，以内存 stub 运行（骨架模式）:', (e as Error).message)
    return stubDeps()
  }
}

export async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3080)
  const hub = makeEventHub()
  const { engine, approver, secrets, ops } = await loadDeps(hub)
  const { server } = startServer({ engine, approver, secrets, hub, port, ops })
  server.once('error', (e) => {
    console.error(`[agent] failed to listen on :${port}`, e)
    process.exit(1)
  })
  server.once('listening', () => {
    console.log(`[agent] listening on :${port}`)
  })
}

void main()
