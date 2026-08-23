// ============================================================
// test-plugins.mjs —— T3-plugins 验收脚本（tsx 运行，加载 TS 源码形态）
// 运行：npm run test:plugins（即 npx tsx scripts/test-plugins.mjs）
// 行为：
//   1. 加载示例插件（src/tools/plugins）→ example_echo 出现在结果且可调用
//   2. 损坏插件（yaml 损坏 / 入口抛错 / 语法错误）→ 不崩、errors 记录、好插件不受影响
//   3. 汇总 [PASS|FAIL]，任一 FAIL → 退出码非 0
// 中文注释、英文标识符
// ============================================================

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugins } from '../dist/tools/plugins/loader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENT_ROOT = path.resolve(__dirname, '..')
const EXAMPLE_DIR = path.join(AGENT_ROOT, 'dist', 'tools', 'plugins')

// ---- 结果收集 ----
const results = []
function record(status, name, detail) {
  results.push({ status, name, detail })
  console.log(`[${status}] ${name}`)
  if (detail) console.log(`        ${detail}`)
}

// ---- 测试 1：示例插件加载 + 直接调用 ----
async function testExample() {
  const res = await loadPlugins(EXAMPLE_DIR)

  // 1.1 加载结果：无错误，含 example_echo
  const echo = res.tools.find((t) => t.def.name === 'example_echo')
  if (res.errors.length > 0) {
    record('FAIL', 'T1.1 示例插件: loadPlugins 无错误', `errors=${JSON.stringify(res.errors)}`)
  } else if (echo) {
    record('PASS', `T1.1 示例插件: loadPlugins（工具 ${res.tools.length} 个，含 example_echo）`)
  } else {
    record('FAIL', 'T1.1 示例插件: loadPlugins 含 example_echo', `tools=${res.tools.map((t) => t.def.name).join(',')}`)
  }

  // 1.2 协议字段：kind=builtin / group=plugin / readOnly=true
  if (echo) {
    const ok = echo.kind === 'builtin' && echo.group === 'plugin' && echo.readOnly === true
    if (ok) record('PASS', 'T1.2 示例插件: 协议字段（kind/group/readOnly）正确')
    else record('FAIL', 'T1.2 示例插件: 协议字段（kind/group/readOnly）正确', `kind=${echo.kind} group=${echo.group} readOnly=${echo.readOnly}`)
  } else {
    record('FAIL', 'T1.2 示例插件: 协议字段', 'example_echo 未加载，跳过')
  }

  // 1.3 直接调用：参数 text → `echo: ${text}`
  if (echo) {
    const ctx = { cwd: EXAMPLE_DIR, sessionId: 'test-plugin', approve: async () => 'allowed-once', emit: () => {} }
    const r = await echo.run(ctx, { text: 'hello 插件' })
    if (r.ok && r.output === 'echo: hello 插件') {
      record('PASS', 'T1.3 示例插件: example_echo 直接调用（echo: hello 插件）')
    } else {
      record('FAIL', 'T1.3 示例插件: example_echo 直接调用', `ok=${r.ok} output=${JSON.stringify(r.output)} error=${r.error}`)
    }
    // 1.4 参数校验：缺 text → ok:false
    const r2 = await echo.run(ctx, {})
    if (!r2.ok && r2.error) {
      record('PASS', 'T1.4 示例插件: 缺参数 → ok:false 带 error')
    } else {
      record('FAIL', 'T1.4 示例插件: 缺参数 → ok:false 带 error', `ok=${r2.ok}`)
    }
  } else {
    record('FAIL', 'T1.3/T1.4 示例插件: 直接调用', 'example_echo 未加载，跳过')
  }
}

// ---- 测试 2：损坏插件不崩（错误隔离）----
function makeBrokenPlugins() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-plugins-broken-'))
  // 2a. yaml 损坏：列表项无键声明 → 解析抛错
  mkdirSync(path.join(dir, 'bad-yaml'))
  writeFileSync(path.join(dir, 'bad-yaml', 'plugin.yaml'), '- stray-item\nname: x\n', 'utf8')
  // 2b. 入口抛错：register 内 throw
  mkdirSync(path.join(dir, 'bad-register'))
  writeFileSync(path.join(dir, 'bad-register', 'plugin.yaml'), 'name: bad-register\n', 'utf8')
  writeFileSync(path.join(dir, 'bad-register', 'index.ts'), 'export function register() { throw new Error("boom from bad-register") }\n', 'utf8')
  // 2c. 语法错误：import 阶段即失败
  mkdirSync(path.join(dir, 'bad-syntax'))
  writeFileSync(path.join(dir, 'bad-syntax', 'plugin.yaml'), 'name: bad-syntax\n', 'utf8')
  writeFileSync(path.join(dir, 'bad-syntax', 'index.ts'), 'export function register( {\n', 'utf8')
  // 2d. 好插件（对照组）：应正常加载，验证隔离不误伤
  mkdirSync(path.join(dir, 'good'))
  writeFileSync(path.join(dir, 'good', 'plugin.yaml'), 'name: good\n', 'utf8')
  writeFileSync(path.join(dir, 'good', 'index.ts'), 'export function register(ctx) { ctx.registerTool({ def: { name: "good_tool", description: "好插件工具", parameters: {} }, run: async () => ({ ok: true, output: "good" }) }) }\n', 'utf8')
  return dir
}

async function testBrokenIsolation() {
  const dir = makeBrokenPlugins()
  try {
    let res
    try {
      res = await loadPlugins(dir)
    } catch (e) {
      record('FAIL', 'T2.1 损坏插件: loadPlugins 不抛异常', e.message)
      return
    }
    // 2.1 三个坏插件都进 errors，且不中断
    const badNames = res.errors.map((e) => e.name).sort()
    if (res.errors.length >= 3 && badNames.includes('bad-yaml') && badNames.includes('bad-register') && badNames.includes('bad-syntax')) {
      record('PASS', `T2.1 损坏插件: 3 个坏插件全部隔离（errors=${res.errors.length}）`)
    } else {
      record('FAIL', 'T2.1 损坏插件: 3 个坏插件全部隔离', `errors=${JSON.stringify(res.errors)}`)
    }
    // 2.2 好插件不受影响：good_tool 正常加载
    if (res.tools.some((t) => t.def.name === 'good_tool')) {
      record('PASS', 'T2.2 损坏插件: 好插件正常加载（错误隔离不误伤）')
    } else {
      record('FAIL', 'T2.2 损坏插件: 好插件正常加载', `tools=${res.tools.map((t) => t.def.name).join(',')}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---- 测试 3：目录不存在 → 空结果不抛错（dist 未复制插件资源场景）----
async function testMissingDir() {
  const dir = path.join(tmpdir(), `kotonoha-plugins-none-${Date.now()}`)
  const res = await loadPlugins(dir)
  if (res.tools.length === 0 && res.hooks.length === 0 && res.errors.length === 0) {
    record('PASS', 'T3 目录不存在: 返回空结果不抛错')
  } else {
    record('FAIL', 'T3 目录不存在: 返回空结果不抛错', JSON.stringify(res))
  }
}

// ---- main ----
async function main() {
  await testExample()
  await testBrokenIsolation()
  await testMissingDir()
  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  console.log('')
  console.log('================== 汇总 ==================')
  console.log(`PASS: ${pass}   FAIL: ${fail}`)
  if (fail > 0) {
    for (const r of results) {
      if (r.status === 'FAIL') console.log(`  - ${r.name}${r.detail ? `  |  ${r.detail}` : ''}`)
    }
  }
  console.log('===========================================')
  process.exitCode = fail > 0 ? 1 : 0
}

main().catch((e) => {
  record('FATAL', '脚本异常', e.stack || e.message)
  process.exitCode = 1
})