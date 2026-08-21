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
  const { engine, approver, secrets, hub, port = 3080 } = deps
  const rpcHandler = makeRpcHandler({ engine, approver, secrets })

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

/** 组装真实依赖；模块缺失时回落 stub */
function loadDeps(hub: EventHub): {
  engine: SessionEngine
  approver: RpcHandlerContext['approver']
  secrets: SecretsStore
} {
  try {
    // 并行 agent 交付的真实组装（store/providers/tools/auth/core）
    // require 返回 any，缺失模块不会造成类型错误
    const dataDir =
      process.env.KOTONOHA_DATA_DIR || path.join(__dirname, '..', 'data')
    const { openDb } = require('./store/db') as { openDb: (dir: string) => unknown }
    const { openSecrets } = require('./store/secrets') as {
      openSecrets: (dir: string) => SecretsStore
    }
    const { Approver } = require('./auth/approver') as {
      Approver: new (opts: { broadcast: (frame: OutboundFrame) => void }) => RpcHandlerContext['approver']
    }
    const { createEngine } = require('./core/engine') as {
      createEngine: (deps: unknown, opts: { dataDir: string }) => SessionEngine
    }
    const { buildDefaultRegistry } = require('./providers/registry') as {
      buildDefaultRegistry: (getKey: (ref: string) => string | undefined) => {
        get: (id: string) => unknown
        list: () => unknown[]
        defaultId: () => string
      }
    }
    const { buildDefaultTools } = require('./tools/registry') as {
      buildDefaultTools: () => { def: { name: string } }[]
    }
    const { buildSystemPrompt } = require('./core/context') as {
      buildSystemPrompt: (session: SessionRecord) => string
    }

    const db = openDb(dataDir)
    const secrets = openSecrets(dataDir)
    const approver = new Approver({ broadcast: (frame) => hub.broadcast(frame) })
    const providers = buildDefaultRegistry((ref) => secrets.get(ref))
    const tools = buildDefaultTools()

    const engine = createEngine(
      {
        db,
        providers: {
          get: (id: string) => providers.get(id),
          list: () => providers.list(),
          defaultId: () => providers.defaultId(),
        },
        tools: {
          list: () => tools,
          get: (name: string) => tools.find((t) => t.def.name === name),
        },
        approver,
        secrets,
        broadcast: (frame: OutboundFrame) => hub.broadcast(frame),
        systemPrompt: buildSystemPrompt,
      },
      { dataDir }
    )
    return { engine, approver, secrets }
  } catch (e) {
    console.warn('[agent] 后端模块未就绪，以内存 stub 运行（骨架模式）:', (e as Error).message)
    return stubDeps()
  }
}

export function main(): void {
  const port = Number(process.env.PORT ?? 3080)
  const hub = makeEventHub()
  const { engine, approver, secrets } = loadDeps(hub)
  const { server } = startServer({ engine, approver, secrets, hub, port })
  server.once('error', (e) => {
    console.error(`[agent] failed to listen on :${port}`, e)
    process.exit(1)
  })
  server.once('listening', () => {
    console.log(`[agent] listening on :${port}`)
  })
}

main()
