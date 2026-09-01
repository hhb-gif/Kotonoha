// ============================================================
// test-bond.mjs —— v0.2.2 羁绊系统验收脚本（node 原生，零 npm 依赖）
// 前置：先运行 npx tsc（读取 dist 产物）
// 运行：node scripts/test-bond.mjs（工作目录 agent/）
// 验收项：
//   T1 settleTurn 增长规则（基础+1 / 工具+1 / 长回复+1 / 单轮上限3）
//   T2 每日上限 10（interactions 照常累计）
//   T3 跨天重置今日计数
//   T4 points 封顶 100
//   T5 等级边界（24→陌生 / 25→熟悉 / 90→羁绊）
//   T6 语气指令随等级出现在 buildSystemPrompt 输出（且在情绪指令之前）
//   T7 bond.get RPC 路由（ops 注入模式）
// 中文注释、英文标识符
// ============================================================
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = (p) => path.join(AGENT_ROOT, 'dist', p)

// ---- 结果收集 ----
const results = []
function record(status, name, detail) {
  results.push({ status, name, detail })
  console.log(`[${status}] ${name}`)
  if (detail) console.log(`        ${detail}`)
}

// ---- 加载 dist 产物 ----
let openDb, bond, buildSystemPrompt, makeRpcHandler
try {
  ;({ openDb } = require(dist('store/db.js')))
  bond = require(dist('store/bond.js'))
  ;({ buildSystemPrompt } = require(dist('core/context.js')))
  ;({ makeRpcHandler } = require(dist('api/rpc.js')))
} catch (e) {
  record('FATAL', '加载 dist 产物（先运行 npx tsc）', e.message)
  process.exitCode = 1
  process.exit(1)
}

// 最小 SessionRecord（context 测试用）
function fakeSession() {
  const now = Date.now()
  return {
    id: 'test-bond-session',
    cwd: tmpdir(),
    label: '对话',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    createdAt: now,
    lastActiveAt: now,
  }
}

// 直接改写 bond:state（等级边界 / 封顶测试用）
function forceState(db, patch) {
  db.setSetting(bond.BOND_STATE_KEY, {
    points: 0,
    interactions: 0,
    lastTurnAt: 0,
    todayGain: 0,
    todayDate: '',
    ...patch,
  })
}

// ============================================================
// T1 增长规则
// ============================================================
function testGrowthRules() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-bond-grow-'))
  try {
    const db = openDb(dir)
    const s0 = bond.getBond(db)
    if (s0.points === 0 && s0.interactions === 0) {
      record('PASS', 'T1.0 getBond 缺省全零状态')
    } else {
      record('FAIL', 'T1.0 getBond 缺省全零状态', JSON.stringify(s0))
    }

    // 基础 +1
    let s = bond.settleTurn(db, { hadToolCalls: false, replyLength: 10 })
    if (s.points === 1 && s.todayGain === 1 && s.interactions === 1) {
      record('PASS', 'T1.1 基础增长：普通短回复 +1')
    } else {
      record('FAIL', 'T1.1 基础增长：普通短回复 +1', JSON.stringify(s))
    }

    // 工具调用额外 +1（共 +2）
    s = bond.settleTurn(db, { hadToolCalls: true, replyLength: 10 })
    if (s.points === 3 && s.todayGain === 3) {
      record('PASS', 'T1.2 工具调用：额外 +1（共 +2）')
    } else {
      record('FAIL', 'T1.2 工具调用：额外 +1（共 +2）', JSON.stringify(s))
    }

    // 工具 + 长回复 → 1+1+1=3，恰好等于单轮上限
    s = bond.settleTurn(db, { hadToolCalls: true, replyLength: 150 })
    if (s.points === 6 && s.todayGain === 6) {
      record('PASS', 'T1.3 工具+长回复：+3（单轮上限 3）')
    } else {
      record('FAIL', 'T1.3 工具+长回复：+3（单轮上限 3）', JSON.stringify(s))
    }

    // 长回复阈值边界：<100 只 +1，=100 算长回复 +2
    s = bond.settleTurn(db, { hadToolCalls: false, replyLength: 99 })
    if (s.points === 7) record('PASS', 'T1.4a 长回复阈值：99 字只 +1')
    else record('FAIL', 'T1.4a 长回复阈值：99 字只 +1', JSON.stringify(s))
    s = bond.settleTurn(db, { hadToolCalls: false, replyLength: 100 })
    if (s.points === 9) record('PASS', 'T1.4b 长回复阈值：100 字算长回复 +2')
    else record('FAIL', 'T1.4b 长回复阈值：100 字算长回复 +2', JSON.stringify(s))
    db.close()
  } catch (e) {
    record('FAIL', 'T1 增长规则', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// T2 每日上限 10（interactions 照常累计）
// ============================================================
function testDailyCap() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-bond-day-'))
  try {
    const db = openDb(dir)
    let s = null
    for (let i = 0; i < 5; i++) {
      s = bond.settleTurn(db, { hadToolCalls: true, replyLength: 150 }) // 每轮理论 +3
    }
    // 3 轮 +3 → 9；第 4 轮只补足 1 → 10；第 5 轮 0 → 10
    if (s.points === 10 && s.todayGain === 10 && s.interactions === 5) {
      record('PASS', 'T2 每日上限：3 轮×3 + 补足 1 = 10，第 5 轮 0（interactions 照常累计）')
    } else {
      record('FAIL', 'T2 每日上限', `points=${s.points} todayGain=${s.todayGain} interactions=${s.interactions}`)
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T2 每日上限', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// T3 跨天重置今日计数
// ============================================================
function testDailyReset() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-bond-reset-'))
  try {
    const db = openDb(dir)
    // 模拟昨天已达到每日上限
    forceState(db, { points: 10, interactions: 5, todayGain: 10, todayDate: '2000-01-01' })
    const s = bond.settleTurn(db, { hadToolCalls: false, replyLength: 10 })
    if (s.todayGain === 1 && s.points === 11 && s.todayDate !== '2000-01-01') {
      record('PASS', 'T3 跨天重置：昨日 todayGain=10 不影响今日（重置后 +1）')
    } else {
      record('FAIL', 'T3 跨天重置', JSON.stringify(s))
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T3 跨天重置', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// T4 points 封顶 100
// ============================================================
function testPointsCap() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-bond-cap-'))
  try {
    const db = openDb(dir)
    forceState(db, { points: 99 })
    const s = bond.settleTurn(db, { hadToolCalls: true, replyLength: 150 }) // 理论 +3
    if (s.points === 100) {
      record('PASS', 'T4 points 封顶：99 + 3 → 100')
    } else {
      record('FAIL', 'T4 points 封顶', JSON.stringify(s))
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T4 points 封顶', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// T5 等级边界
// ============================================================
function testLevelBoundary() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-bond-lv-'))
  try {
    const db = openDb(dir)
    const cases = [
      { points: 0, level: 0, name: '陌生' },
      { points: 24, level: 0, name: '陌生' },
      { points: 25, level: 1, name: '熟悉' },
      { points: 59, level: 1, name: '熟悉' },
      { points: 60, level: 2, name: '信赖' },
      { points: 89, level: 2, name: '信赖' },
      { points: 90, level: 3, name: '羁绊' },
      { points: 100, level: 3, name: '羁绊' },
    ]
    let allOk = true
    for (const c of cases) {
      forceState(db, { points: c.points })
      const v = bond.getBondView(db)
      if (v.level !== c.level || v.levelName !== c.name) {
        allOk = false
        record('FAIL', 'T5 等级边界', `points=${c.points} → 期望 ${c.level}/${c.name}，实际 ${v.level}/${v.levelName}`)
      }
    }
    if (allOk) {
      record('PASS', `T5 等级边界：${cases.length} 个分界点全部正确（0-24陌生/25-59熟悉/60-89信赖/90-100羁绊）`)
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T5 等级边界', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// T6 语气指令随等级出现在 buildSystemPrompt 输出
// ============================================================
function testToneGuides() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-bond-tone-')) // 无 character.md → 默认人设
  try {
    const session = fakeSession()
    const cases = [
      { level: 0, marker: '礼貌温和', extra: '您' },
      { level: 1, marker: '亲切自然', extra: '你' },
      { level: 2, marker: '活泼亲近', extra: '颜文字' },
      { level: 3, marker: '最亲密', extra: '专属昵称' },
    ]
    for (const c of cases) {
      const out = buildSystemPrompt(session, undefined, dir, c.level)
      const hasTone = out.includes('【语气】') && out.includes(c.marker) && out.includes(c.extra)
      if (!hasTone) {
        record('FAIL', `T6 语气指令 level=${c.level}`, out.slice(-300))
        return
      }
      // 语气指令必须在情绪指令之前
      if (out.indexOf('【语气】') > out.indexOf('【情绪表达】')) {
        record('FAIL', `T6 语气指令 level=${c.level} 位置`, '语气指令应出现在情绪指令之前')
        return
      }
    }
    record('PASS', `T6 语气指令：level 0-3 四档文案均注入且位于情绪指令之前`)

    // 缺省（不传参）= level 0 文案
    const dflt = buildSystemPrompt(session, undefined, dir)
    if (dflt.includes('礼貌温和') && dflt.includes('您')) {
      record('PASS', 'T6.2 缺省 bondLevel=0（陌生档文案）')
    } else {
      record('FAIL', 'T6.2 缺省 bondLevel=0', dflt.slice(-300))
    }
  } catch (e) {
    record('FAIL', 'T6 语气指令', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// T7 bond.get RPC 路由（ops 注入模式）
// ============================================================
async function testBondRpc() {
  try {
    const view = { points: 42, level: 1, levelName: '熟悉', interactions: 30, todayGain: 4, lastTurnAt: Date.now() }
    const handler = makeRpcHandler({
      engine: {},
      approver: { request: async () => 'rejected', respond: () => false },
      secrets: {},
      ops: { getBond: () => view },
    })
    const resp = await handler('bond.get', {
      type: 'client-request',
      rpcId: 'test-bond-rpc',
      method: 'bond.get',
      payload: {},
    })
    if (resp.result?.ok === true && resp.result.value?.points === 42 && resp.result.value?.levelName === '熟悉') {
      record('PASS', 'T7 bond.get RPC：ops 注入 → 返回好感度视图')
    } else {
      record('FAIL', 'T7 bond.get RPC', JSON.stringify(resp))
    }

    // 未注入 ops → 引擎错误（不静默）
    const handler2 = makeRpcHandler({ engine: {}, approver: { request: async () => 'rejected', respond: () => false }, secrets: {} })
    const resp2 = await handler2('bond.get', {
      type: 'client-request',
      rpcId: 'test-bond-rpc2',
      method: 'bond.get',
      payload: {},
    })
    if (resp2.result?.ok === false && /未注入/.test(resp2.result.error?.message ?? '')) {
      record('PASS', 'T7.2 bond.get 未注入 ops → 明确报错')
    } else {
      record('FAIL', 'T7.2 bond.get 未注入 ops', JSON.stringify(resp2))
    }
  } catch (e) {
    record('FAIL', 'T7 bond.get RPC', e.message)
  }
}

// ============================================================
// main
// ============================================================
async function main() {
  testGrowthRules()
  testDailyCap()
  testDailyReset()
  testPointsCap()
  testLevelBoundary()
  testToneGuides()
  await testBondRpc()

  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  console.log('')
  console.log('================== 汇总 ==================')
  console.log(`PASS: ${pass}   FAIL: ${fail}`)
  if (fail > 0) {
    console.log('FAIL 项：')
    for (const r of results) {
      if (r.status === 'FAIL') console.log(`  - ${r.name}  |  ${r.detail}`)
    }
  }
  console.log('===========================================')
  process.exitCode = fail > 0 ? 1 : 0
}

main().catch((e) => {
  record('FATAL', '脚本异常', e.stack || e.message)
  process.exitCode = 1
})
