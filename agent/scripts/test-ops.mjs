// ============================================================
// test-ops.mjs —— E-ops 验收脚本（成本统计 / hooks 联动 / 全文搜索 / 轨迹审计）
// 运行：node scripts/test-ops.mjs（工作目录 agent/，先 npx tsc 构建 dist）
// 行为：逐项输出 [PASS|FAIL|SKIP]，任一 FAIL → 退出码非 0。
//       若 agent 未在 3080 运行，自动以 PORT=3081 启动 dist/index.js。
// 中文注释、英文标识符
// ============================================================
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENT_ROOT = path.resolve(__dirname, '..')

const results = []
function record(status, name, detail) {
  results.push({ status, name, detail })
  console.log(`[${status}] ${name}`)
  if (detail) console.log(`        ${detail}`)
}

// ---- 服务器定位：优先 3080（已有进程），否则 spawn 3081 ----
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
  child.on('exit', (code) => console.log(`[setup] 3081 进程退出 code=${code}`))
  for (let i = 0; i < 30; i++) {
    if (await ping('http://localhost:3081')) {
      BASE = 'http://localhost:3081'
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('无法连接 3080 也无法在 3081 启动 agent')
}

let seq = 0
async function rpc(method, payload) {
  const body = {
    type: 'client-request',
    rpcId: `ops-${++seq}-${Date.now()}`,
    method,
    payload: payload ?? {},
  }
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (res.status !== 200) return { ok: false, error: { code: 'HTTP', message: `HTTP ${res.status}` } }
  const data = await res.json()
  if (!data || data.type !== 'server-response' || !data.result) {
    return { ok: false, error: { code: 'BAD_RESP', message: '响应非 server-response' } }
  }
  return data.result
}

function makeTempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

const toolsMod = require(path.join(AGENT_ROOT, 'dist/tools/index.js'))
const storeMod = require(path.join(AGENT_ROOT, 'dist/store/index.js'))
const bashMod = require(path.join(AGENT_ROOT, 'dist/tools/bash.js'))

// ============================================================
// T1 bash 黑名单 hook（直接调用）：拦截 rm -rf /，放行 echo hi
// ============================================================
async function testBlacklist() {
  const ws = makeTempDir('kotonoha-ops-blacklist-')
  try {
    const db = storeMod.openDb(ws)
    const registry = toolsMod.createDefaultHooks(db)
    const ctx = { cwd: ws, sessionId: 'ops-blacklist', approve: async () => 'allowed-once', emit: () => {} }

    const blocked = await toolsMod.runToolWithHooks(registry, bashMod.bashTool, ctx, { command: 'rm -rf /' })
    if (blocked.ok || !String(blocked.error).includes('黑名单')) {
      record('FAIL', 'T1 bash 黑名单: 拦截 rm -rf /', JSON.stringify(blocked))
    } else {
      record('PASS', `T1 bash 黑名单: 拦截 rm -rf /（${blocked.error.slice(0, 60)}…）`)
    }

    const allowed = await toolsMod.runToolWithHooks(registry, bashMod.bashTool, ctx, { command: 'echo hi' })
    if (!allowed.ok || !allowed.output.includes('hi')) {
      record('FAIL', 'T1 bash 黑名单: 放行 echo hi', JSON.stringify(allowed))
    } else {
      record('PASS', 'T1 bash 黑名单: 放行 echo hi')
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T1 bash 黑名单: 拦截 rm -rf /', e.message)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ============================================================
// T2 审计 hook：工具执行后 trajectory 落库
// ============================================================
async function testTrajectoryHook() {
  const ws = makeTempDir('kotonoha-ops-trajectory-')
  try {
    const db = storeMod.openDb(ws)
    const registry = toolsMod.createDefaultHooks(db)
    const ctx = { cwd: ws, sessionId: 'ops-traj', approve: async () => 'allowed-once', emit: () => {} }
    await toolsMod.runToolWithHooks(registry, bashMod.bashTool, ctx, { command: 'echo hook-audit' })
    const traj = toolsMod.getTrajectory(db, 'ops-traj')
    const entry = traj.find((t) => t.tool === 'bash')
    if (!entry || !entry.ok || !entry.args.includes('hook-audit') || !entry.ts) {
      record('FAIL', 'T2 审计 hook: trajectory 落库', JSON.stringify(traj))
    } else {
      record('PASS', `T2 审计 hook: trajectory 落库（${traj.length} 条，tool=bash ok=true args 含摘要）`)
    }

    // 被拦截的调用也应记录（ok=false）
    await toolsMod.runToolWithHooks(registry, bashMod.bashTool, ctx, { command: 'rm -rf /' })
    const traj2 = toolsMod.getTrajectory(db, 'ops-traj')
    const blockedEntry = traj2.find((t) => t.ok === false)
    if (traj2.length !== 2 || !blockedEntry) {
      record('FAIL', 'T2 审计 hook: 拦截调用也记录轨迹', JSON.stringify(traj2))
    } else {
      record('PASS', 'T2 审计 hook: 被拦截的调用也记录轨迹（ok=false）')
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T2 审计 hook: trajectory 落库', e.message)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ============================================================
// T3 会话全文搜索（FTS5 / LIKE 降级）
// ============================================================
async function testSearch() {
  const ws = makeTempDir('kotonoha-ops-search-')
  try {
    const db = storeMod.openDb(ws)
    const marker = `OPS_SEARCH_MARKER_${Date.now().toString(36)}`
    db.appendEvent('s1', {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `请搜索这个关键词 ${marker}` }] },
    })
    db.appendEvent('s1', {
      type: 'assistant/message',
      data: { message: { role: 'assistant', content: [{ type: 'text', text: '无关内容' }] } },
    })
    db.appendEvent('s2', {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `另一个会话也有 ${marker}` }] },
    })

    const mode = storeMod.hasFts5(db) ? 'FTS5' : 'LIKE(降级)'
    const hits = storeMod.searchEvents(db, 's1', marker, 10)
    const hit = hits.find((h) => h.sessionId === 's1')
    if (!hit || !hit.payload || !JSON.stringify(hit.payload).includes(marker)) {
      record('FAIL', `T3 全文搜索（${mode}）: 命中关键词`, JSON.stringify(hits))
    } else if (hits.some((h) => h.sessionId === 's2')) {
      record('FAIL', `T3 全文搜索（${mode}）: 按会话隔离`, `s2 事件串入 s1 结果：${JSON.stringify(hits)}`)
    } else {
      record('PASS', `T3 全文搜索（${mode}）: 命中关键词且按会话隔离（${hits.length} 条）`)
    }

    const none = storeMod.searchEvents(db, 's1', '不存在的词xyzzy', 10)
    if (none.length !== 0) {
      record('FAIL', `T3 全文搜索（${mode}）: 无匹配返回空`, JSON.stringify(none))
    } else {
      record('PASS', `T3 全文搜索（${mode}）: 无匹配返回空`)
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T3 会话全文搜索', e.message)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ============================================================
// T4 成本统计落库（store 层直接验证）
// ============================================================
async function testCostStore() {
  const ws = makeTempDir('kotonoha-ops-cost-')
  try {
    const db = storeMod.openDb(ws)
    storeMod.recordCost(db, {
      sessionId: 's-cost-a',
      providerId: 'deepseek-official',
      modelId: 'deepseek-v4-flash',
      promptTokens: 1000,
      completionTokens: 500,
    })
    storeMod.recordCost(db, {
      sessionId: 's-cost-a',
      providerId: 'deepseek-official',
      modelId: 'deepseek-v4-flash',
      promptTokens: 2000,
      completionTokens: 1000,
    })

    const sc = storeMod.getSessionCost(db, 's-cost-a')
    if (sc.records.length !== 2 || sc.tokens.prompt !== 3000 || sc.tokens.completion !== 1500 || sc.costUsd <= 0) {
      record('FAIL', 'T4 成本落库: getSessionCost 聚合', JSON.stringify(sc))
    } else {
      record('PASS', `T4 成本落库: getSessionCost（2 条记录，prompt=3000 completion=1500 cost=$${sc.costUsd.toFixed(6)}）`)
    }

    const total = storeMod.getTotalCost(db)
    const agg = total.bySession['s-cost-a']
    if (total.totalCostUsd <= 0 || !agg || agg.tokens !== 4500) {
      record('FAIL', 'T4 成本落库: getTotalCost 聚合', JSON.stringify(total))
    } else {
      record('PASS', `T4 成本落库: getTotalCost（total=$${total.totalCostUsd.toFixed(6)} bySession 含 s-cost-a）`)
    }

    const csv = storeMod.exportAllCostCsv(db)
    if (!csv.startsWith('timestamp,providerId,modelId,promptTokens,completionTokens,costUsd') || csv.split('\n').length !== 3) {
      record('FAIL', 'T4 成本落库: CSV 导出', `csv=${JSON.stringify(csv.slice(0, 120))}`)
    } else {
      record('PASS', `T4 成本落库: CSV 导出（${csv.split('\n').length} 行）`)
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T4 成本统计落库', e.message)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ============================================================
// T5 真实对话链路（依赖 DEEPSEEK_API_KEY）：
// 一轮对话后 stats.cost 有记录；工具调用后 session.trajectory 有记录；
// session.search 命中关键词
// ============================================================
async function hasKey() {
  const r = await rpc('credentials.describe', { refs: ['DEEPSEEK_API_KEY'] })
  if (!r.ok) return false
  const entry = Array.isArray(r.value?.refs) ? r.value.refs.find((x) => x.ref === 'DEEPSEEK_API_KEY') : null
  return !!entry && entry.configured === true
}

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
        await fetch(`${BASE}/api/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...base, rpcId: frame.payload.approvalId }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {})
      }
    } catch { /* 超时兜底 */ }
  }
  async function runTurn(text, timeoutMs = 120000) {
    const collector = { text: '', tools: [], approvals: [], finish: null, timedOut: false }
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
    record('SKIP', 'T5 真实对话链路（无 DEEPSEEK_API_KEY）')
    return
  }
  const ws = makeTempDir('kotonoha-ops-chat-')
  const wsUrl = BASE.replace(/^http/, 'ws') + '/api/events.mux'
  let sid = null
  let socket = null
  try {
    const cr = await rpc('session.create', { cwd: ws })
    if (!cr.ok) { record('FAIL', 'T5 真实对话链路: 会话创建', `${cr.error.code}: ${cr.error.message}`); return }
    sid = cr.value.sessionId

    socket = new WebSocket(wsUrl)
    await new Promise((res, rej) => {
      socket.addEventListener('open', res, { once: true })
      socket.addEventListener('error', () => rej(new Error('WS 连接失败')), { once: true })
    })
    const conv = makeConversation(sid)
    socket.addEventListener('message', conv.onMessage)

    let turn = await conv.runTurn('请调用 bash 工具执行命令 echo hi，并汇报结果')
    if (!turn.finish && turn.approvals.length === 0) {
      turn = await conv.runTurn('必须调用 bash 工具执行 echo hi，不得只回复文字')
    }
    if (turn.promptError) {
      record('FAIL', 'T5 真实对话链路: 对话轮', `prompt 错误: ${turn.promptError}`)
      return
    }
    if (turn.timedOut) {
      record('FAIL', 'T5 真实对话链路: 对话轮', '等待 finish 超时 120s')
      return
    }

    // 5.1 成本落库：stats.cost 应包含本会话且 tokens > 0
    {
      const r = await rpc('stats.cost', {})
      const agg = r.ok ? r.value?.bySession?.[sid] : null
      if (r.ok && agg && agg.tokens > 0 && agg.cost >= 0) {
        record('PASS', `T5.1 成本落库: stats.cost 含本会话（tokens=${agg.tokens} cost=$${agg.cost.toFixed(6)}）`)
      } else {
        record('FAIL', 'T5.1 成本落库: stats.cost 含本会话', `resp=${JSON.stringify(r).slice(0, 300)}`)
      }
      const sc = await rpc('stats.cost.session', { sessionId: sid })
      if (sc.ok && Array.isArray(sc.value?.records) && sc.value.records.length > 0 && sc.value.tokens.prompt > 0) {
        record('PASS', `T5.1b 成本落库: stats.cost.session（${sc.value.records.length} 条记录，prompt=${sc.value.tokens.prompt}）`)
      } else {
        record('FAIL', 'T5.1b 成本落库: stats.cost.session', `resp=${JSON.stringify(sc).slice(0, 300)}`)
      }
    }

    // 5.2 轨迹审计：session.trajectory 含工具调用记录
    {
      const r = await rpc('session.trajectory', { sessionId: sid })
      const entries = r.ok ? r.value?.trajectory : null
      const toolHit = Array.isArray(entries) && entries.some((t) => t.tool === 'bash' && typeof t.args === 'string' && t.ts > 0)
      if (Array.isArray(entries) && entries.length > 0 && toolHit) {
        record('PASS', `T5.2 轨迹审计: session.trajectory（${entries.length} 条，含 bash 调用）`)
      } else {
        record('FAIL', 'T5.2 轨迹审计: session.trajectory', `entries=${JSON.stringify(entries ?? []).slice(0, 300)}`)
      }
    }

    // 5.3 全文搜索：session.search 命中用户消息关键词
    {
      const r = await rpc('session.search', { sessionId: sid, query: 'echo', limit: 10 })
      const hits = r.ok ? r.value?.results : null
      if (Array.isArray(hits) && hits.length > 0 && hits.some((h) => JSON.stringify(h.payload).includes('echo'))) {
        record('PASS', `T5.3 全文搜索: session.search 命中（${hits.length} 条）`)
      } else {
        record('FAIL', 'T5.3 全文搜索: session.search 命中', `resp=${JSON.stringify(r).slice(0, 300)}`)
      }
    }

    // 5.4 stats.cost.csv 可用
    {
      const r = await rpc('stats.cost.csv', {})
      if (r.ok && typeof r.value?.csv === 'string' && r.value.csv.includes('deepseek')) {
        record('PASS', 'T5.4 成本导出: stats.cost.csv')
      } else {
        record('FAIL', 'T5.4 成本导出: stats.cost.csv', `resp=${JSON.stringify(r).slice(0, 200)}`)
      }
    }
  } catch (e) {
    record('FAIL', 'T5 真实对话链路', e.message)
  } finally {
    if (socket) { try { socket.close() } catch { /* 忽略 */ } }
    if (sid) await rpc('session.delete', { sessionId: sid }).catch(() => {})
    rmSync(ws, { recursive: true, force: true })
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
  await testBlacklist()
  await testTrajectoryHook()
  await testSearch()
  await testCostStore()
  await testConversation()
  printSummary()
  process.exitCode = results.some((r) => r.status === 'FAIL') ? 1 : 0
  if (child) child.kill()
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