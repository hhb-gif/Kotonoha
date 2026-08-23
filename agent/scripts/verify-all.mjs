// ============================================================
// verify-all.mjs —— V-verifier 全量验收脚本（node 原生，零 npm 依赖）
// 契约：docs/plans/rpc-contract-round2.md（必读）
// 运行：node scripts/verify-all.mjs（工作目录 agent/）
// 行为：逐项输出 [PASS|FAIL|SKIP]，任一 FAIL → 退出码非 0。
//       若 agent 未在 3080 运行，自动以 PORT=3081 启动 dist/index.js。
// 中文注释、英文标识符
// ============================================================
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENT_ROOT = path.resolve(__dirname, '..')

// ---- 全局结果收集 ----
const results = []
function record(status, name, detail) {
  results.push({ status, name, detail })
  console.log(`[${status}] ${name}`)
  if (detail) console.log(`        ${detail}`)
}

// ---- 服务器定位：优先 3080（已有进程），否则 spawn 3081 ----
const HEALTH = 'http://localhost:3080/api/health'
async function ping(base) {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return false
    const body = await res.json()
    return body && body.ok === true
  } catch {
    return false
  }
}

let BASE
let child = null
async function ensureServer() {
  if (await ping('http://localhost:3080')) {
    BASE = 'http://localhost:3080'
    return
  }
  console.log('[setup] 3080 无服务，启动 dist/index.js（PORT=3081）…')
  child = spawn(process.execPath, ['dist/index.js'], {
    cwd: AGENT_ROOT,
    env: { ...process.env, PORT: '3081' },
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('exit', (code) => {
    console.log(`[setup] 3081 进程退出 code=${code}`)
  })
  for (let i = 0; i < 30; i++) {
    if (await ping('http://localhost:3081')) {
      BASE = 'http://localhost:3081'
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('无法连接 3080 也无法在 3081 启动 agent')
}

// ---- RPC 辅助 ----
let seq = 0
async function rpc(method, payload) {
  const body = {
    type: 'client-request',
    rpcId: `verify-${++seq}-${Date.now()}`,
    method,
    payload: payload ?? {},
  }
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (res.status !== 200) {
    return { ok: false, error: { code: 'HTTP', message: `HTTP ${res.status}` } }
  }
  const data = await res.json()
  if (!data || data.type !== 'server-response' || !data.result) {
    return { ok: false, error: { code: 'BAD_RESP', message: '响应非 server-response' } }
  }
  return data.result
}

// ---- 临时工作区 ----
function makeTempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  return dir
}

// ============================================================
// T1 HTTP 基础
// ============================================================
async function testHealth() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) })
    const body = await res.json()
    if (res.ok && body && body.ok === true) {
      record('PASS', 'T1 HTTP 基础: GET /api/health → ok:true')
    } else {
      record('FAIL', 'T1 HTTP 基础: GET /api/health', `HTTP ${res.status} body=${JSON.stringify(body)}`)
    }
  } catch (e) {
    record('FAIL', 'T1 HTTP 基础: GET /api/health', e.message)
  }
}

// ============================================================
// T2 会话 CRUD
// ============================================================
async function testSessionCrud() {
  const ws = makeTempDir('kotonoha-verify-crud-')
  let sidA = null
  let sidB = null
  try {
    // create
    const cr = await rpc('session.create', { cwd: ws })
    if (!cr.ok) { record('FAIL', 'T2 会话 CRUD: session.create', `${cr.error.code}: ${cr.error.message}`); return }
    sidA = cr.value.sessionId
    if (typeof sidA !== 'string' || !sidA) { record('FAIL', 'T2 会话 CRUD: session.create', '返回值缺 sessionId'); return }

    // rename
    const rr = await rpc('session.rename', { sessionId: sidA, label: '验收测试会话' })
    if (!rr.ok) { record('FAIL', 'T2 会话 CRUD: session.rename', `${rr.error.code}: ${rr.error.message}`); return }

    // fork
    const fr = await rpc('session.fork', { sessionId: sidA })
    if (!fr.ok) { record('FAIL', 'T2 会话 CRUD: session.fork', `${fr.error.code}: ${fr.error.message}`); return }
    sidB = fr.value.sessionId

    // list 校验：A 存在且 label 已改、B 存在
    const lr = await rpc('session.list', {})
    if (!lr.ok) { record('FAIL', 'T2 会话 CRUD: session.list', `${lr.error.code}: ${lr.error.message}`); return }
    const list = lr.value
    const aRec = list.find((s) => s.sessionId === sidA)
    const bRec = list.find((s) => s.sessionId === sidB)
    if (!aRec || aRec.label !== '验收测试会话') {
      record('FAIL', 'T2 会话 CRUD: rename 后 list 校验', `A=${JSON.stringify(aRec)}`)
      return
    }
    if (!bRec || !String(bRec.label).includes('fork')) {
      record('FAIL', 'T2 会话 CRUD: fork 后 list 校验', `B=${JSON.stringify(bRec)}`)
      return
    }

    // delete B
    const dr = await rpc('session.delete', { sessionId: sidB })
    if (!dr.ok || dr.value.ok !== true) { record('FAIL', 'T2 会话 CRUD: session.delete', `${dr.error?.code ?? ''}: ${dr.error?.message ?? ''}`); return }
    const lr2 = await rpc('session.list', {})
    if (lr2.ok && lr2.value.some((s) => s.sessionId === sidB)) {
      record('FAIL', 'T2 会话 CRUD: delete 后 list 不含 B')
      return
    }
    sidB = null // 已删除，不再清理
    record('PASS', 'T2 会话 CRUD: create→rename→fork→list→delete 全链路')
  } finally {
    if (sidB) await rpc('session.delete', { sessionId: sidB }).catch(() => {})
    if (sidA) await rpc('session.delete', { sessionId: sidA }).catch(() => {})
    rmSync(ws, { recursive: true, force: true })
  }
}

// ============================================================
// T3 新 RPC 契约（round-2）
// ============================================================
async function testRound2() {
  const ws = makeTempDir('kotonoha-verify-r2-')
  let sid = null
  try {
    const cr = await rpc('session.create', { cwd: ws })
    if (cr.ok) sid = cr.value.sessionId

    // 3.1 tools.list（契约要求 ≥10 工具）
    {
      const r = await rpc('tools.list', {})
      if (!r.ok) {
        record('FAIL', 'T3.1 新RPC契约: tools.list（≥10 工具）', `${r.error.code}: ${r.error.message}`)
      } else {
        const n = Array.isArray(r.value?.tools) ? r.value.tools.length : -1
        if (Array.isArray(r.value?.tools) && n >= 10) {
          record('PASS', `T3.1 新RPC契约: tools.list（${n} 个工具 ≥ 10）`)
        } else {
          record('FAIL', 'T3.1 新RPC契约: tools.list（≥10 工具）', `实际 ${n} 个工具`)
        }
      }
    }

    // 3.2 providers.list（应含 deepseek-official）
    {
      const r = await rpc('providers.list', {})
      if (!r.ok) {
        record('FAIL', 'T3.2 新RPC契约: providers.list（含 deepseek-official）', `${r.error.code}: ${r.error.message}`)
      } else {
        const ids = Array.isArray(r.value?.providers) ? r.value.providers.map((p) => p.id) : []
        const ok = r.value && typeof r.value.defaultId === 'string' && ids.includes('deepseek-official')
        if (ok) record('PASS', `T3.2 新RPC契约: providers.list（default=${r.value.defaultId}，${ids.length} 家）`)
        else record('FAIL', 'T3.2 新RPC契约: providers.list（含 deepseek-official）', `ids=${JSON.stringify(ids)} defaultId=${r.value?.defaultId}`)
      }
    }

    // 3.3 rules.get（返回数组）
    {
      const r = await rpc('rules.get', {})
      if (!r.ok) {
        record('FAIL', 'T3.3 新RPC契约: rules.get（数组）', `${r.error.code}: ${r.error.message}`)
      } else if (Array.isArray(r.value?.rules)) {
        record('PASS', `T3.3 新RPC契约: rules.get（${r.value.rules.length} 条规则）`)
      } else {
        record('FAIL', 'T3.3 新RPC契约: rules.get（数组）', `value=${JSON.stringify(r.value)}`)
      }
    }

    // 3.4 mcp.status（servers 数组）
    {
      const r = await rpc('mcp.status', {})
      if (!r.ok) {
        record('FAIL', 'T3.4 新RPC契约: mcp.status（servers 数组）', `${r.error.code}: ${r.error.message}`)
      } else if (Array.isArray(r.value?.servers)) {
        record('PASS', `T3.4 新RPC契约: mcp.status（${r.value.servers.length} 个 server）`)
      } else {
        record('FAIL', 'T3.4 新RPC契约: mcp.status（servers 数组）', `value=${JSON.stringify(r.value)}`)
      }
    }

    // 3.5 session.export（json，content 非空）
    if (sid) {
      const r = await rpc('session.export', { sessionId: sid, format: 'json' })
      if (!r.ok) {
        record('FAIL', 'T3.5 新RPC契约: session.export(json)', `${r.error.code}: ${r.error.message}`)
      } else if (typeof r.value?.content === 'string' && r.value.content.length > 0 && typeof r.value?.filename === 'string') {
        record('PASS', `T3.5 新RPC契约: session.export(json)（${r.value.content.length} 字节）`)
      } else {
        record('FAIL', 'T3.5 新RPC契约: session.export(json)', `value=${JSON.stringify(r.value).slice(0, 200)}`)
      }
    } else {
      record('FAIL', 'T3.5 新RPC契约: session.export(json)', '前置 session.create 失败')
    }

    // 3.6 session.import（回读）
    if (sid) {
      const ex = await rpc('session.export', { sessionId: sid, format: 'json' })
      const content = ex.ok ? ex.value.content : ''
      const r = await rpc('session.import', { content, format: 'json' })
      if (!r.ok) {
        record('FAIL', 'T3.6 新RPC契约: session.import + 回读', `${r.error.code}: ${r.error.message}`)
      } else {
        const importedId = r.value?.sessionId
        const hist = await rpc('session.history', { sessionId: importedId })
        if (typeof importedId === 'string' && hist.ok && Array.isArray(hist.value?.events)) {
          record('PASS', `T3.6 新RPC契约: session.import + 回读（${hist.value.events.length} 条事件）`)
          await rpc('session.delete', { sessionId: importedId }).catch(() => {})
        } else {
          record('FAIL', 'T3.6 新RPC契约: session.import + 回读', `importedId=${importedId} hist=${JSON.stringify(hist).slice(0, 200)}`)
        }
      }
    } else {
      record('FAIL', 'T3.6 新RPC契约: session.import + 回读', '前置 session.create 失败')
    }

    // 3.7 session.archive → listArchived → unarchive
    if (sid) {
      const ar = await rpc('session.archive', { sessionId: sid })
      if (!ar.ok) {
        record('FAIL', 'T3.7 新RPC契约: archive→listArchived→unarchive', `${ar.error.code}: ${ar.error.message}`)
      } else {
        const la = await rpc('session.listArchived', {})
        const has = la.ok && Array.isArray(la.value?.sessions) && la.value.sessions.some((s) => s.id === sid)
        if (!has) {
          record('FAIL', 'T3.7 新RPC契约: archive→listArchived→unarchive', `listArchived 未含 ${sid}，resp=${JSON.stringify(la).slice(0, 200)}`)
        } else {
          const ua = await rpc('session.unarchive', { sessionId: sid })
          if (!ua.ok || ua.value?.ok !== true) {
            record('FAIL', 'T3.7 新RPC契约: archive→listArchived→unarchive', `unarchive ${JSON.stringify(ua).slice(0, 200)}`)
          } else {
            const la2 = await rpc('session.listArchived', {})
            const gone = la2.ok && !la2.value.sessions.some((s) => s.id === sid)
            if (gone) record('PASS', 'T3.7 新RPC契约: archive→listArchived→unarchive 往返')
            else record('FAIL', 'T3.7 新RPC契约: archive→listArchived→unarchive', 'unarchive 后 listArchived 仍含该会话')
          }
        }
      }
    } else {
      record('FAIL', 'T3.7 新RPC契约: archive→listArchived→unarchive', '前置 session.create 失败')
    }

    // 3.8 契约补充：session.compress（round-2 表内方法）
    if (sid) {
      const r = await rpc('session.compress', { sessionId: sid, keepRecent: 5 })
      if (r.ok && r.value?.ok === true) record('PASS', 'T3.8 新RPC契约: session.compress')
      else record('FAIL', 'T3.8 新RPC契约: session.compress', r.ok ? JSON.stringify(r.value) : `${r.error.code}: ${r.error.message}`)
    }

    // 3.9 契约补充：rules.set
    {
      const r = await rpc('rules.set', { rules: [{ tool: 'bash', level: 'ask' }] })
      if (r.ok && r.value?.ok === true) record('PASS', 'T3.9 新RPC契约: rules.set')
      else record('FAIL', 'T3.9 新RPC契约: rules.set', r.ok ? JSON.stringify(r.value) : `${r.error.code}: ${r.error.message}`)
    }

    // 3.10 契约补充：memory.bonds.get（契约标注“可选”，METHOD_NOT_FOUND 记 SKIP）
    {
      const r = await rpc('memory.bonds.get', {})
      if (r.ok && Array.isArray(r.value?.bonds)) record('PASS', 'T3.10 新RPC契约: memory.bonds.get')
      else if (!r.ok && r.error?.code === 'METHOD_NOT_FOUND') record('SKIP', 'T3.10 新RPC契约: memory.bonds.get', '契约标注可选，后端未实现')
      else record('FAIL', 'T3.10 新RPC契约: memory.bonds.get', r.ok ? JSON.stringify(r.value) : `${r.error.code}: ${r.error.message}`)
    }
  } finally {
    if (sid) await rpc('session.delete', { sessionId: sid }).catch(() => {})
    rmSync(ws, { recursive: true, force: true })
  }
}

// ============================================================
// T4 工具直接调用（require dist/tools，不经 HTTP）
// ============================================================
async function testDirectTools() {
  const tools = require(path.join(AGENT_ROOT, 'dist/tools/index.js'))
  const ws = makeTempDir('kotonoha-verify-tools-')
  const token = `VVERIFY_TOKEN_${Date.now().toString(36)}`
  try {
    writeFileSync(path.join(ws, 'hello.txt'), `the quick brown fox\n${token}\nlast line\n`, 'utf8')
    const ctx = {
      cwd: ws,
      sessionId: 'verify-direct',
      approve: async () => 'allowed-once',
      emit: () => {},
    }

    // 4.1 read_file
    {
      const r = await tools.readFileTool.run(ctx, { path: 'hello.txt' })
      if (r.ok && r.output.includes(token)) record('PASS', 'T4.1 工具直接调用: read_file 读取内容正确')
      else record('FAIL', 'T4.1 工具直接调用: read_file 读取内容正确', `ok=${r.ok} output=${JSON.stringify(r.output).slice(0, 120)}`)
    }

    // 4.2 grep
    {
      const r = await tools.grepTool.run(ctx, { pattern: token })
      if (r.ok && r.output.includes('hello.txt')) record('PASS', 'T4.2 工具直接调用: grep 命中文件:行号')
      else record('FAIL', 'T4.2 工具直接调用: grep 命中文件:行号', `ok=${r.ok} output=${JSON.stringify(r.output).slice(0, 160)}`)
    }

    // 4.3 glob
    {
      const r = await tools.globTool.run(ctx, { pattern: '*.txt' })
      if (r.ok && r.output.includes('hello.txt')) record('PASS', 'T4.3 工具直接调用: glob 匹配 *.txt')
      else record('FAIL', 'T4.3 工具直接调用: glob 匹配 *.txt', `ok=${r.ok} output=${JSON.stringify(r.output).slice(0, 160)}`)
    }

    // 4.4 bash（Windows 下经 cmd.exe 执行）
    {
      const r = await tools.bashTool.run(ctx, { command: 'echo hi' })
      if (r.ok && r.output.includes('hi')) record('PASS', 'T4.4 工具直接调用: bash 执行 echo hi')
      else record('FAIL', 'T4.4 工具直接调用: bash 执行 echo hi', `ok=${r.ok} output=${JSON.stringify(r.output).slice(0, 160)}`)
    }
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ============================================================
// T5 真实对话（依赖 DEEPSEEK_API_KEY）
// ============================================================
async function hasKey() {
  const r = await rpc('credentials.describe', { refs: ['DEEPSEEK_API_KEY'] })
  if (!r.ok) return false
  const entry = Array.isArray(r.value?.refs) ? r.value.refs.find((x) => x.ref === 'DEEPSEEK_API_KEY') : null
  return !!entry && entry.configured === true
}

/**
 * 会话对话驱动器：单条 WS 连接，顺序驱动多轮 turn。
 * 每个 turn 返回 collector：{ text, tools[], approvals[], finish, timedOut, protocolAccepted, fallbackAccepted }
 */
function makeConversation(sessionId) {
  let active = null
  const onMessage = async (e) => {
    let frame
    try { frame = JSON.parse(e.data) } catch { return }
    if (!active) return
    if (frame.type === 'session/event') {
      const pl = frame.payload
      if (!pl || pl.type !== 'session/event' || pl.sessionId !== sessionId || !pl.event) return
      const ev = pl.event
      if (ev.type === 'assistant/chunk') {
        const chunk = ev.data.chunk
        if (chunk.type === 'text-delta') active.collector.text += chunk.text
        else if (chunk.type === 'tool-call-delta') active.collector.tools.push(chunk.toolCall.name)
        else if (chunk.type === 'finish') {
          active.collector.finish = chunk
          if (active.resolve) { clearTimeout(active.timer); const c = active.collector; active.resolve(c); active = null }
        }
      }
    } else if (frame.type === 'server-request' && frame.method === 'approval/requested') {
      const pl = frame.payload
      if (!pl || pl.sessionId !== sessionId) return
      active.collector.approvals.push(frame)
      await respondApproval(frame)
    }
  }

  // 先按文档协议（rpcId=帧 rpcId）；若不被接受，再用 approvalId 兜底解挂
  async function respondApproval(frame) {
    const base = {
      type: 'client-response',
      result: { ok: true, value: { sessionId: frame.payload.sessionId, approvalId: frame.payload.approvalId, outcome: 'allowed-once' } },
    }
    try {
      const res = await fetch(`${BASE}/api/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, rpcId: frame.rpcId }),
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json()
      active.collector.protocolAccepted = data.accepted === true
      if (active.collector.protocolAccepted !== true) {
        const res2 = await fetch(`${BASE}/api/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...base, rpcId: frame.payload.approvalId }),
          signal: AbortSignal.timeout(10000),
        })
        const data2 = await res2.json()
        active.collector.fallbackAccepted = data2.accepted === true
      }
    } catch (err) {
      // 网络异常不致命：交回超时机制兜底
    }
  }

  async function runTurn(text, timeoutMs = 120000) {
    const collector = { text: '', tools: [], approvals: [], finish: null, timedOut: false, protocolAccepted: null, fallbackAccepted: null }
    active = { collector, resolve: null, timer: null }
    const done = new Promise((resolve) => { active.resolve = resolve })
    active.timer = setTimeout(() => {
      if (active) { active.collector.timedOut = true; const c = active.collector; active.resolve(c); active = null }
    }, timeoutMs)
    const pr = await rpc('session.prompt', { sessionId, content: [{ type: 'text', text }] })
    if (!pr.ok) {
      clearTimeout(active.timer)
      active = null
      return { ...collector, promptError: pr.error?.message }
    }
    return await done
  }

  return { onMessage, runTurn }
}

async function testConversation() {
  const keyAvailable = await hasKey()
  if (!keyAvailable) {
    record('SKIP', 'T5 真实对话（无 DEEPSEEK_API_KEY）')
    return
  }
  const ws = makeTempDir('kotonoha-verify-chat-')
  const wsUrl = BASE.replace(/^http/, 'ws') + '/api/events.mux'
  let sid = null
  let socket = null
  try {
    const cr = await rpc('session.create', { cwd: ws })
    if (!cr.ok) { record('FAIL', 'T5 真实对话: 会话创建', `${cr.error.code}: ${cr.error.message}`); return }
    sid = cr.value.sessionId

    socket = new WebSocket(wsUrl)
    await new Promise((res, rej) => {
      socket.addEventListener('open', res, { once: true })
      socket.addEventListener('error', () => rej(new Error('WS 连接失败')), { once: true })
    })

    const conv = makeConversation(sid)
    socket.addEventListener('message', conv.onMessage)

    // 5.1 普通对话
    {
      const t = await conv.runTurn('你好')
      if (t.promptError) {
        record('FAIL', 'T5.1 真实对话: 「你好」→ assistant/chunk→finish', `prompt 错误: ${t.promptError}`)
      } else if (t.timedOut) {
        record('FAIL', 'T5.1 真实对话: 「你好」→ assistant/chunk→finish', '等待 finish 超时 120s')
      } else if (t.finish && t.finish.reason?.kind === 'stop' && t.text.length > 0) {
        record('PASS', 'T5.1 真实对话: 「你好」→ assistant/chunk(text-delta)→finish{stop}')
      } else if (t.finish && t.finish.reason?.kind === 'error') {
        record('FAIL', 'T5.1 真实对话: 「你好」→ assistant/chunk→finish', `finish error: ${t.finish.reason.message}`)
      } else {
        record('FAIL', 'T5.1 真实对话: 「你好」→ assistant/chunk→finish', `text=${t.text.length} 字 finish=${JSON.stringify(t.finish)}`)
      }
    }

    // 5.2 工具调用 → 审批帧 → respond → finish
    let toolTurn = await conv.runTurn('请调用 bash 工具执行命令 echo hi，并汇报结果')
    if (!toolTurn.finish && toolTurn.approvals.length === 0) {
      // 模型未调用工具时重试一次更强指令
      toolTurn = await conv.runTurn('必须调用 bash 工具执行 echo hi，不得只回复文字')
    }

    if (toolTurn.promptError) {
      record('FAIL', 'T5.2 真实对话: 工具调用+审批流', `prompt 错误: ${toolTurn.promptError}`)
    } else if (toolTurn.timedOut) {
      record('FAIL', 'T5.2 真实对话: 工具调用+审批流', '等待 finish 超时 120s')
    } else if (toolTurn.approvals.length === 0) {
      record('FAIL', 'T5.2 真实对话: 工具调用+审批流', '未收到 approval/requested 帧（模型未发起工具调用）')
    } else {
      const okFlow = toolTurn.finish && toolTurn.finish.reason?.kind === 'stop'
      const approved = toolTurn.protocolAccepted === true || toolTurn.fallbackAccepted === true
      if (okFlow && approved) {
        record('PASS', `T5.2 真实对话: 工具调用→approval/requested(${toolTurn.approvals[0].payload.toolName})→respond allowed-once→finish{stop}`)
      } else {
        record('FAIL', 'T5.2 真实对话: 工具调用+审批流', `approvals=${toolTurn.approvals.length} protocolAccepted=${toolTurn.protocolAccepted} fallbackAccepted=${toolTurn.fallbackAccepted} finish=${JSON.stringify(toolTurn.finish)}`)
      }
    }

    // 5.3 审批 respond 文档协议一致性（round-2 契约明确：前端回传帧 rpcId）
    {
      if (toolTurn.approvals.length > 0) {
        if (toolTurn.protocolAccepted === true) {
          record('PASS', 'T5.3 审批 respond: POST /api/respond rpcId=帧rpcId → accepted:true')
        } else {
          record('FAIL', 'T5.3 审批 respond: POST /api/respond rpcId=帧rpcId → accepted:true',
            `实际 accepted:false（rpcId=approvalId 才 accepted:true）→ 前后端审批 id 语义不一致，见报告`)
        }
      } else {
        record('SKIP', 'T5.3 审批 respond: 未收到审批帧，无法验证')
      }
    }
  } finally {
    if (socket) { try { socket.close() } catch { /* 忽略 */ } }
    if (sid) await rpc('session.delete', { sessionId: sid }).catch(() => {})
    rmSync(ws, { recursive: true, force: true })
  }
}

// ============================================================
// T6 存储往返（store 层：export json → import → 事件数一致）
// ============================================================
async function testStorageRoundTrip() {
  const store = require(path.join(AGENT_ROOT, 'dist/store/index.js'))
  const dir = makeTempDir('kotonoha-verify-store-')
  try {
    const db = store.openDb(dir)
    const rec = store.createSessionRecord(dir)
    db.createSession(rec)
    db.appendEvent(rec.id, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
    })
    db.appendEvent(rec.id, {
      type: 'assistant/message',
      data: { message: { role: 'assistant', content: [{ type: 'text', text: '你好呀' }] } },
    })
    const json = await store.exportSession(db, rec.id, 'json')
    const imported = await store.importSession(db, json, 'json')
    const origCount = db.readEvents(rec.id).length
    const impCount = db.readEvents(imported.id).length
    db.close()
    if (typeof json === 'string' && json.length > 0 && imported.id && origCount === 2 && impCount === origCount) {
      record('PASS', `T6 存储往返: export json → import → 事件数一致（${origCount}==${impCount}）`)
    } else {
      record('FAIL', 'T6 存储往返: export json → import → 事件数一致',
        `jsonLen=${typeof json === 'string' ? json.length : -1} imported=${imported?.id} orig=${origCount} imp=${impCount}`)
    }
  } catch (e) {
    record('FAIL', 'T6 存储往返: export json → import → 事件数一致', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// main
// ============================================================
async function main() {
  try {
    await ensureServer()
  } catch (e) {
    record('FAIL', 'T0 服务器探测/启动', e.message)
    printSummary()
    process.exitCode = 1
    return
  }
  console.log(`[setup] 使用后端 ${BASE}`)
  await testHealth()
  await testSessionCrud()
  await testRound2()
  await testDirectTools()
  await testConversation()
  await testStorageRoundTrip()
  printSummary()
  process.exitCode = results.some((r) => r.status === 'FAIL') ? 1 : 0
  if (child) {
    child.kill()
  }
}

function printSummary() {
  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  const skip = results.filter((r) => r.status === 'SKIP').length
  console.log('')
  console.log('================== 汇总 ==================')
  console.log(`PASS: ${pass}   FAIL: ${fail}   SKIP: ${skip}`)
  if (fail > 0) {
    console.log('FAIL 项：')
    for (const r of results) {
      if (r.status === 'FAIL') console.log(`  - ${r.name}${r.detail ? `  |  ${r.detail}` : ''}`)
    }
  }
  console.log('===========================================')
}

main().catch((e) => {
  record('FATAL', '脚本异常', e.stack || e.message)
  printSummary()
  if (child) child.kill()
  process.exitCode = 1
})