// ============================================================
// index.ts —— Agent Harness M0 入口
// 零依赖 HTTP + WS 服务（node:http 原生实现，无 express/ws）
// 协议与 dsh 完全兼容（docs/plans/agent-harness-m0.md 第 1 节）
// 依赖组装见 bootstrap.ts，WebSocket 传输见 ws.ts
// 中文注释、英文标识符
// ============================================================

import http from 'node:http'

import { makeEventHub } from './api/events'
import { makeRpcHandler } from './api/rpc'
import { handleWsUpgrade } from './ws'
import { bootstrap } from './bootstrap'
import type {
  EventHub,
  RpcHandlerContext,
  SecretsStore,
  SessionEngine,
} from './types'

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
// ============================================================

export async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3080)
  const hub = makeEventHub()
  const { engine, approver, secrets, ops, healthStop } = await bootstrap(hub)
  const { server } = startServer({ engine, approver, secrets, hub, port, ops })
  server.once('error', (e) => {
    console.error(`[agent] failed to listen on :${port}`, e)
    process.exit(1)
  })
  server.once('listening', () => {
    console.warn(`[agent] listening on :${port}`)
  })
  // 优雅退出：停健康调度（其 setInterval 会阻止进程退出）后关服务
  const shutdown = (): void => {
    healthStop?.()
    server.close()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

void main()
