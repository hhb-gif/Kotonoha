// ============================================================
// test-degradation.mjs —— M4 降级链验收脚本
// 运行：npx tsc && node scripts/test-degradation.mjs（工作目录 agent/）
// 验证：mock 抛错 provider + 成功 provider 组 fallback 链 →
//       1) executeWithFallback 切换成功（文本来自降级 provider）
//       2) degraded 帧发出（logger 产生 {kind:'degraded', from, to, message}）
//       3) 降级记录落库（settings 表 key `degradations`）
//       4) HTTP 400 业务错误不触发切换（直接抛错）
//       5) 流未收 done 结束 → 触发切换（StreamInterrupt）
//       6) idle 超时（无 chunk）→ 触发切换
//       7) 健康监控：checkAll/isHealthy/getStatus/不可用剔除
// 中文注释、英文标识符
// ============================================================
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENT_ROOT = path.resolve(__dirname, '..')

const fallbackMod = require(path.join(AGENT_ROOT, 'dist/providers/fallback.js'))
const healthMod = require(path.join(AGENT_ROOT, 'dist/providers/health.js'))
const storeMod = require(path.join(AGENT_ROOT, 'dist/store/index.js'))

const results = []
function record(status, name, detail) {
  results.push({ status, name, detail })
  console.log(`[${status}] ${name}`)
  if (detail) console.log(`        ${detail}`)
}

// ---- mock provider 构造 ----
function makeProvider(id, opts) {
  return {
    id,
    name: id,
    capabilities: ['chat'],
    listModels: async () => [],
    estimateCost: () => 0,
    healthCheck: opts.healthCheck ?? (async () => true),
    streamChat: opts.streamChat,
  }
}

const PARAMS = {
  model: 'mock-model',
  messages: [{ role: 'user', content: 'hi' }],
}

function collect(gen) {
  const texts = []
  let done = false
  return (async () => {
    for await (const c of gen) {
      if (c.kind === 'text') texts.push(c.text)
      if (c.kind === 'done') done = true
    }
    return { text: texts.join(''), done }
  })()
}

// ============================================================
// T1 基础切换：HTTP 503 主 provider → 切成功 provider
// ============================================================
async function testSwitch() {
  let called = false
  const bad = makeProvider('bad-503', {
    streamChat: async function* () {
      throw new Error('[mock] HTTP 503: service unavailable')
    },
  })
  const good = makeProvider('good-provider', {
    streamChat: async function* () {
      called = true
      yield { kind: 'text', text: 'ok from good' }
      yield { kind: 'done' }
    },
  })

  const logs = []
  const out = await collect(
    fallbackMod.executeWithFallback([bad, good], PARAMS, (ctx) => logs.push(ctx), {
      timeoutMs: 5000,
      maxRetries: 0,
    })
  )
  if (!called || out.text !== 'ok from good' || !out.done) {
    record('FAIL', 'T1 基础切换: HTTP 503 → 切降级 provider', JSON.stringify({ called, out, logs }))
    return
  }
  const ctx = logs.find((c) => c.providerId === 'bad-503' && c.nextProviderId === 'good-provider')
  if (!ctx || ctx.willRetry !== false || !ctx.error.message.includes('503')) {
    record('FAIL', 'T1 基础切换: logger 收到切换上下文', JSON.stringify(logs))
    return
  }
  record('PASS', 'T1 基础切换: HTTP 503 → 切降级 provider（文本=ok from good，logger 记录 from→to）')
}

// ============================================================
// T2 degraded 帧 + 落库：模拟 agent.ts 的 logger 逻辑
// ============================================================
async function testDegradedFrameAndPersist() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-degradation-'))
  let degraded = null
  try {
    const db = storeMod.openDb(dir)
    const bad = makeProvider('bad-500', {
      streamChat: async function* () {
        throw new Error('[mock] HTTP 500: internal error')
      },
    })
    const good = makeProvider('good-provider', {
      streamChat: async function* () {
        yield { kind: 'text', text: 'recovered' }
        yield { kind: 'done' }
      },
    })

    // 与 agent.ts onDegraded 相同逻辑：广播 degraded 帧 + recordDegradation 落库
    const logger = (ctx) => {
      if (ctx.nextProviderId && ctx.nextProviderId !== ctx.providerId) {
        degraded = {
          type: 'finish',
          reason: { kind: 'degraded', from: ctx.providerId, to: ctx.nextProviderId, message: ctx.error.message },
        }
        storeMod.recordDegradation(db, { from: ctx.providerId, to: ctx.nextProviderId, reason: ctx.error.message })
      }
    }

    const out = await collect(
      fallbackMod.executeWithFallback([bad, good], PARAMS, logger, { timeoutMs: 5000, maxRetries: 0 })
    )

    if (!degraded || degraded.reason.kind !== 'degraded') {
      record('FAIL', 'T2 degraded 帧: 切换时发出 degraded finish 帧', JSON.stringify(degraded))
      return
    }
    if (degraded.reason.from !== 'bad-500' || degraded.reason.to !== 'good-provider') {
      record('FAIL', 'T2 degraded 帧: from/to 字段正确', JSON.stringify(degraded))
      return
    }
    if (out.text !== 'recovered') {
      record('FAIL', 'T2 degraded 帧: 帧发出后对话继续', JSON.stringify(out))
      return
    }

    // 落库验证
    const entries = db.getSetting('degradations')
    if (!Array.isArray(entries) || entries.length !== 1) {
      record('FAIL', 'T2 落库: settings.degradations 数组', JSON.stringify(entries))
      return
    }
    const e = entries[0]
    if (e.from !== 'bad-500' || e.to !== 'good-provider' || typeof e.ts !== 'number' || !e.reason) {
      record('FAIL', 'T2 落库: 记录字段 {ts, from, to, reason}', JSON.stringify(e))
      return
    }
    const listed = storeMod.listDegradations(db)
    if (listed.length !== 1 || listed[0].from !== 'bad-500') {
      record('FAIL', 'T2 落库: listDegradations 读回', JSON.stringify(listed))
      return
    }
    record('PASS', 'T2 degraded 帧+落库: 切换→degraded 帧(from/to)→对话继续→settings.degradations 记录')
    db.close()
  } catch (e) {
    record('FAIL', 'T2 degraded 帧+落库', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// T3 HTTP 400 业务错误：不触发切换（链直接抛错）
// ============================================================
async function testNoSwitchOn400() {
  let goodCalled = false
  const bad400 = makeProvider('bad-400', {
    streamChat: async function* () {
      throw new Error('[mock] HTTP 400: invalid parameter')
    },
  })
  const good = makeProvider('good-provider', {
    streamChat: async function* () {
      goodCalled = true
      yield { kind: 'text', text: 'should not reach' }
      yield { kind: 'done' }
    },
  })
  let thrown = null
  try {
    await collect(
      fallbackMod.executeWithFallback([bad400, good], PARAMS, () => {}, { timeoutMs: 5000, maxRetries: 0 })
    )
  } catch (e) {
    thrown = e
  }
  if (!thrown || !String(thrown.message).includes('400')) {
    record('FAIL', 'T3 400 不切换: 应抛出 400 错误', String(thrown?.message ?? thrown))
    return
  }
  if (goodCalled) {
    record('FAIL', 'T3 400 不切换: 400 后仍切到了下一家', 'good provider 被调用')
    return
  }
  record('PASS', 'T3 400 不切换: HTTP 400 业务错误直接抛错，降级 provider 未被调用')
}

// ============================================================
// T4 流异常中断：未收 done 结束 → 切换
// ============================================================
async function testStreamInterrupt() {
  const logs = []
  const bad = makeProvider('bad-stream', {
    streamChat: async function* () {
      yield { kind: 'text', text: 'partial' }
      // 无 done 直接结束 → 流异常
    },
  })
  const good = makeProvider('good-provider', {
    streamChat: async function* () {
      yield { kind: 'text', text: 'full' }
      yield { kind: 'done' }
    },
  })
  const out = await collect(
    fallbackMod.executeWithFallback([bad, good], PARAMS, (ctx) => logs.push(ctx), {
      timeoutMs: 5000,
      maxRetries: 0,
    })
  )
  const switched = logs.some((c) => c.providerId === 'bad-stream' && c.nextProviderId === 'good-provider')
  if (!switched || out.text !== 'partialfull' || !out.done) {
    record('FAIL', 'T4 流异常中断: 未收 done → 切换', JSON.stringify({ switched, text: out.text, done: out.done }))
    return
  }
  record('PASS', 'T4 流异常中断: 流未收 done 结束 → 切降级 provider（部分文本保留+降级 provider 续流）')
}

// ============================================================
// T5 idle 超时：60s 无 chunk（测试用 200ms）→ 切换
// ============================================================
async function testIdleTimeout() {
  const logs = []
  const slow = makeProvider('slow-provider', {
    streamChat: async function* (p) {
      yield { kind: 'text', text: 'a' }
      // 不监听 signal 的 provider 不会触发 abort；此处模拟真实 SSE：abort → 抛 AbortError
      await new Promise((_, rej) =>
        p.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      )
      yield { kind: 'done' }
    },
  })
  const good = makeProvider('good-provider', {
    streamChat: async function* () {
      yield { kind: 'text', text: 'b' }
      yield { kind: 'done' }
    },
  })
  const out = await collect(
    fallbackMod.executeWithFallback([slow, good], PARAMS, (ctx) => logs.push(ctx), {
      timeoutMs: 200,
      maxRetries: 0,
    })
  )
  const switched = logs.some((c) => c.providerId === 'slow-provider' && c.nextProviderId === 'good-provider')
  const timedOut = logs.some((c) => c.error?.name === 'AbortError')
  if (!switched || !timedOut || out.text !== 'ab' || !out.done) {
    record('FAIL', 'T5 idle 超时: 200ms 无 chunk → 切换', JSON.stringify({ switched, timedOut, text: out.text }))
    return
  }
  record('PASS', 'T5 idle 超时: 无 chunk 超时（AbortError）→ 切降级 provider')
}

// ============================================================
// T6 健康监控：checkAll / isHealthy / getStatus / 不可用剔除
// ============================================================
async function testHealthMonitor() {
  const good = makeProvider('healthy-provider', { healthCheck: async () => true })
  const bad = makeProvider('down-provider', { healthCheck: async () => false })
  // 8s 才返回 → 超过 5s 检查超时，判不可用
  const slow = makeProvider('slow-provider', {
    healthCheck: () => new Promise((r) => setTimeout(() => r(true), 8000)),
  })
  const registryMock = { list: () => [good, bad, slow] }
  const monitor = new healthMod.HealthMonitor(registryMock)

  // 未检查过默认可用（冷启动不误伤）
  if (monitor.isHealthy('healthy-provider') !== true || monitor.isHealthy('down-provider') !== true) {
    record('FAIL', 'T6 健康监控: 未检查前默认可用', 'isHealthy 应为 true')
    return
  }

  const results = await monitor.checkAll()
  const byId = Object.fromEntries(results.map((r) => [r.id, r.ok]))
  if (byId['healthy-provider'] !== true || byId['down-provider'] !== false || byId['slow-provider'] !== false) {
    record('FAIL', 'T6 健康监控: checkAll 结果（慢 provider 5s 超时判不可用）', JSON.stringify(results))
    return
  }
  if (monitor.isHealthy('healthy-provider') !== true || monitor.isHealthy('down-provider') !== false) {
    record('FAIL', 'T6 健康监控: isHealthy 反映检查结果', `healthy=${monitor.isHealthy('healthy-provider')} down=${monitor.isHealthy('down-provider')}`)
    return
  }

  // 不可用者从降级链剔除（模拟 agent.ts 的过滤逻辑）
  const chain = ['down-provider', 'healthy-provider'].filter((id) => monitor.isHealthy(id))
  if (JSON.stringify(chain) !== JSON.stringify(['healthy-provider'])) {
    record('FAIL', 'T6 健康监控: 不可用 provider 从降级链剔除', JSON.stringify(chain))
    return
  }

  const status = monitor.getStatus()
  const down = status.find((s) => s.id === 'down-provider')
  if (status.length !== 3 || !down || down.healthy !== false || !down.name) {
    record('FAIL', 'T6 健康监控: getStatus 输出 {id,name,healthy}', JSON.stringify(status))
    return
  }

  // 恢复：下次检查通过后重新加入
  bad.healthCheck = async () => true
  await monitor.checkAll()
  if (monitor.isHealthy('down-provider') !== true) {
    record('FAIL', 'T6 健康监控: 检查通过后恢复可用', `down=${monitor.isHealthy('down-provider')}`)
    return
  }

  // start/stop 不抛错（stop 清理定时器）
  monitor.start(60_000)
  monitor.stop()
  record('PASS', 'T6 健康监控: checkAll/isHealthy/getStatus/剔除/恢复/调度启停 全链路')
}

// ============================================================
// main
// ============================================================
async function main() {
  await testSwitch()
  await testDegradedFrameAndPersist()
  await testNoSwitchOn400()
  await testStreamInterrupt()
  await testIdleTimeout()
  await testHealthMonitor()
  printSummary()
  process.exitCode = results.some((r) => r.status === 'FAIL') ? 1 : 0
}

function printSummary() {
  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  console.log('')
  console.log('================== 汇总 ==================')
  console.log(`PASS: ${pass}   FAIL: ${fail}`)
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
  process.exitCode = 1
})