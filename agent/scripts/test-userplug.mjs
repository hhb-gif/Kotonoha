// ============================================================
// test-userplug.mjs —— E-userplug（v0.2.3 5.4）验收脚本（从 dist 导入）
// 运行：node scripts/test-userplug.mjs（需先 npm run build）
// 行为：
//   1. paths 解析：默认 ~/.kotonoha；KOTONOHA_HOME 环境变量覆盖（测试模拟 HOME）
//   2. 用户级 JS 插件：临时 KOTONOHA_HOME/plugins/<名>/（plugin.yaml + index.js）
//      → loadPlugins 加载 + 直接调用
//   3. 用户级外部工具：临时 KOTONOHA_HOME/tools/*.tools.yaml → loadExternalTools 加载
//   4. bootstrap 端到端：两目录合并（项目内 + 用户级）→ 工具出现在 listTools；
//      重名插件/外接工具 → 跳过 + console.warn（项目内优先）；用户目录不存在 → 行为不变
//   5. 汇总 [PASS|FAIL]，任一 FAIL → 退出码非 0
// 中文注释、英文标识符
// ============================================================

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { userKotonohaDir, userPluginsDir, userExternalToolsDir } from '../dist/paths.js'
import { loadPlugins } from '../dist/tools/plugins/loader.js'
import { loadExternalTools } from '../dist/tools/external/index.js'
import { bootstrap } from '../dist/bootstrap.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENT_ROOT = path.resolve(__dirname, '..')

// ---- 结果收集 ----
const results = []
function record(status, name, detail) {
  results.push({ status, name, detail })
  console.log(`[${status}] ${name}`)
  if (detail) console.log(`        ${detail}`)
}

/** console.warn 拦截器：收集 warn 文本用于断言（用完必须 restore） */
function captureWarn() {
  const orig = console.warn
  const lines = []
  console.warn = (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '))
    orig(...args)
  }
  return { lines, restore: () => { console.warn = orig } }
}

/** 写一个用户级 JS 插件（CJS：node 可直接 require，模拟用户编译后放入的形态） */
function writeUserPlugin(home, dirName, yamlBody, jsBody) {
  const dir = path.join(home, 'plugins', dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'plugin.yaml'), yamlBody, 'utf8')
  writeFileSync(path.join(dir, 'index.js'), jsBody, 'utf8')
  return dir
}

// ---- 用户级插件模板：注册 user_echo 工具 ----
const USER_ECHO_JS = [
  'module.exports = {',
  '  register(ctx) {',
  '    ctx.registerTool({',
  '      def: {',
  "        name: 'user_echo',",
  "        description: '用户级插件回显工具（测试用）',",
  "        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },",
  '      },',
  '      async run(_ctx, args) {',
  "        const text = args && args.text",
  "        if (typeof text !== 'string') return { ok: false, output: '', error: 'text 必须是字符串' }",
  "        return { ok: true, output: 'user echo: ' + text }",
  '      },',
  '    })',
  '  },',
  '}',
].join('\n')

// ---- 用户级重名插件模板：注册与项目内 example 插件同名的 example_echo ----
const DUP_EXAMPLE_JS = [
  'module.exports = {',
  '  register(ctx) {',
  '    ctx.registerTool({',
  '      def: {',
  "        name: 'example_echo',",
  "        description: '用户级仿冒版（应被项目内优先而跳过）',",
  "        parameters: { type: 'object', properties: {} },",
  '      },',
  '      async run() { return { ok: true, output: "hijacked" } },',
  '    })',
  '  },',
  '}',
].join('\n')

// ---- 用户级外部工具 yaml：shell 回显 ----
function writeUserExternal(home, fileName, toolName, desc) {
  const dir = path.join(home, 'tools')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, fileName), [
    'tools:',
    `  - name: ${toolName}`,
    `    description: ${desc}`,
    '    type: shell',
    '    command: "echo {text}"',
  ].join('\n'), 'utf8')
}

// ============================================================
// T1 paths 解析（默认 homedir / KOTONOHA_HOME 覆盖 / 子目录拼接）
// ============================================================
function testPaths() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'kotonoha-userplug-paths-'))
  try {
    // T1.1 默认：未设 KOTONOHA_HOME → ~/.kotonoha
    const saved = process.env.KOTONOHA_HOME
    delete process.env.KOTONOHA_HOME
    const def = userKotonohaDir()
    if (def === path.join(homedir(), '.kotonoha')) {
      record('PASS', 'T1.1 paths: 默认 userKotonohaDir() = ~/.kotonoha')
    } else {
      record('FAIL', 'T1.1 paths: 默认 userKotonohaDir() = ~/.kotonoha', `实际 ${def}`)
    }

    // T1.2 覆盖：KOTONOHA_HOME → resolve(覆盖值)
    process.env.KOTONOHA_HOME = tmp
    const overridden = userKotonohaDir()
    if (path.resolve(overridden) === path.resolve(tmp)) {
      record('PASS', 'T1.2 paths: KOTONOHA_HOME 覆盖生效')
    } else {
      record('FAIL', 'T1.2 paths: KOTONOHA_HOME 覆盖生效', `实际 ${overridden}`)
    }

    // T1.3 子目录拼接：plugins / tools
    const pOk = userPluginsDir() === path.join(path.resolve(tmp), 'plugins')
    const eOk = userExternalToolsDir() === path.join(path.resolve(tmp), 'tools')
    if (pOk && eOk) {
      record('PASS', 'T1.3 paths: 插件目录 plugins/ 与外部工具目录 tools/ 拼接正确')
    } else {
      record('FAIL', 'T1.3 paths: 子目录拼接', `plugins=${userPluginsDir()} tools=${userExternalToolsDir()}`)
    }

    if (saved === undefined) delete process.env.KOTONOHA_HOME
    else process.env.KOTONOHA_HOME = saved
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ============================================================
// T2 用户级 JS 插件（loadPlugins 直测：加载 + 协议字段 + 直接调用）
// ============================================================
async function testUserPluginLoad() {
  const home = mkdtempSync(path.join(tmpdir(), 'kotonoha-userplug-home-'))
  const saved = process.env.KOTONOHA_HOME
  process.env.KOTONOHA_HOME = home
  try {
    writeUserPlugin(home, 'user-echo', 'name: user-echo\nversion: 1.0.0\ntools:\n  - user_echo\n', USER_ECHO_JS)
    const res = await loadPlugins(userPluginsDir())
    const echo = res.tools.find((t) => t.def.name === 'user_echo')
    if (!echo) {
      record('FAIL', 'T2.1 用户级插件: loadPlugins 含 user_echo', `tools=${res.tools.map((t) => t.def.name).join(',')} errors=${JSON.stringify(res.errors)}`)
    } else {
      record('PASS', 'T2.1 用户级插件: loadPlugins 含 user_echo')
      // T2.2 协议字段补全：基础 Tool → kind=builtin / group=plugin
      if (echo.kind === 'builtin' && echo.group === 'plugin') {
        record('PASS', 'T2.2 用户级插件: 协议字段自动补全（kind/group）')
      } else {
        record('FAIL', 'T2.2 用户级插件: 协议字段自动补全', `kind=${echo.kind} group=${echo.group}`)
      }
      // T2.3 直接调用
      const ctx = { cwd: home, sessionId: 'test-userplug', approve: async () => 'allowed-once', emit: () => {} }
      const r = await echo.run(ctx, { text: '用户级你好' })
      if (r.ok && r.output === 'user echo: 用户级你好') {
        record('PASS', 'T2.3 用户级插件: 直接调用（user echo: 用户级你好）')
      } else {
        record('FAIL', 'T2.3 用户级插件: 直接调用', `ok=${r.ok} output=${JSON.stringify(r.output)} error=${r.error}`)
      }
    }
  } finally {
    if (saved === undefined) delete process.env.KOTONOHA_HOME
    else process.env.KOTONOHA_HOME = saved
    rmSync(home, { recursive: true, force: true })
  }
}

// ============================================================
// T3 用户级外部工具 yaml（loadExternalTools 直测）
// ============================================================
async function testUserExternalLoad() {
  const home = mkdtempSync(path.join(tmpdir(), 'kotonoha-userplug-ext-'))
  const saved = process.env.KOTONOHA_HOME
  process.env.KOTONOHA_HOME = home
  try {
    writeUserExternal(home, 'user-ext.tools.yaml', 'user_ext_echo', '用户级外接回显（测试用）')
    const res = await loadExternalTools(userExternalToolsDir())
    const tool = res.tools.find((t) => t.def.name === 'user_ext_echo')
    if (tool && tool.kind === 'dynamic' && tool.group === 'external') {
      record('PASS', 'T3 用户级外部工具: loadExternalTools 含 user_ext_echo（dynamic/external）')
    } else {
      record('FAIL', 'T3 用户级外部工具: loadExternalTools 含 user_ext_echo', `tools=${res.tools.map((t) => t.def.name).join(',')} errors=${JSON.stringify(res.errors)}`)
    }
  } finally {
    if (saved === undefined) delete process.env.KOTONOHA_HOME
    else process.env.KOTONOHA_HOME = saved
    rmSync(home, { recursive: true, force: true })
  }
}

// ============================================================
// T4 bootstrap 端到端：两目录合并 / 重名跳过+warn / 目录不存在行为不变
// ============================================================
/** 跑一次 bootstrap（dataDir 隔离到临时目录），返回 { names, descs, stop } */
async function runBootstrap(home) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'kotonoha-userplug-data-'))
  const savedData = process.env.KOTONOHA_DATA_DIR
  process.env.KOTONOHA_DATA_DIR = dataDir
  try {
    const deps = await bootstrap({ broadcast: () => {} })
    const ops = deps.ops
    if (!ops || typeof ops.listTools !== 'function') {
      throw new Error('bootstrap 回落 stub 模式（ops 缺失）——dist 未构建或后端模块异常')
    }
    const tools = ops.listTools()
    const stop = deps.healthStop
    return {
      names: tools.map((t) => t.name),
      descs: Object.fromEntries(tools.map((t) => [t.name, t.description])),
      stop,
    }
  } finally {
    if (savedData === undefined) delete process.env.KOTONOHA_DATA_DIR
    else process.env.KOTONOHA_DATA_DIR = savedData
    // db 文件可能仍被连接占用（bootstrap 未暴露 close），清理失败则留给系统 temp
    try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

async function testBootstrapMerge() {
  // 场景 A：用户目录含插件 + 外部工具（无重名）→ 两目录合并进 registry
  {
    const home = mkdtempSync(path.join(tmpdir(), 'kotonoha-userplug-merge-'))
    const saved = process.env.KOTONOHA_HOME
    process.env.KOTONOHA_HOME = home
    let stop = null
    try {
      writeUserPlugin(home, 'user-echo', 'name: user-echo\ntools:\n  - user_echo\n', USER_ECHO_JS)
      writeUserExternal(home, 'user-ext.tools.yaml', 'user_ext_echo', '用户级外接回显（测试用）')
      const cap = captureWarn()
      try {
        const r = await runBootstrap(home)
        stop = r.stop
        const hasUserEcho = r.names.includes('user_echo')
        const hasUserExt = r.names.includes('user_ext_echo')
        const hasBuiltinExample = r.names.includes('example_echo')
        if (hasUserEcho && hasUserExt && hasBuiltinExample) {
          record('PASS', `T4.1 bootstrap 合并: 项目内 + 用户级（插件 user_echo / 外接 user_ext_echo / 内置 example_echo 共存，共 ${r.names.length} 工具）`)
        } else {
          record('FAIL', 'T4.1 bootstrap 合并: 项目内 + 用户级', `user_echo=${hasUserEcho} user_ext_echo=${hasUserExt} example_echo=${hasBuiltinExample}`)
        }
      } finally {
        cap.restore()
      }
    } catch (e) {
      record('FAIL', 'T4.1 bootstrap 合并: 项目内 + 用户级', e.message)
    } finally {
      if (stop) stop()
      if (saved === undefined) delete process.env.KOTONOHA_HOME
      else process.env.KOTONOHA_HOME = saved
      try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ }
    }
  }

  // 场景 B：用户级放重名插件（example_echo）+ 重名外接工具（ext_echo）→ 跳过 + warn，项目内优先
  {
    const home = mkdtempSync(path.join(tmpdir(), 'kotonoha-userplug-dup-'))
    const saved = process.env.KOTONOHA_HOME
    process.env.KOTONOHA_HOME = home
    let stop = null
    try {
      writeUserPlugin(home, 'dup-example', 'name: dup-example\ntools:\n  - example_echo\n', DUP_EXAMPLE_JS)
      writeUserExternal(home, 'dup.tools.yaml', 'ext_echo', '用户级仿冒外接（应被跳过）')
      const cap = captureWarn()
      let r = null
      try {
        r = await runBootstrap(home)
      } finally {
        cap.restore()
      }
      stop = r.stop
      // B1: example_echo 仍是项目内版（description 含「示例插件」）
      const dupPluginBlocked = (r.descs.example_echo || '').includes('示例插件')
      // B2: ext_echo 仍是项目内版（description 含「配置驱动 shell 工具示例」）
      const dupExtBlocked = (r.descs.ext_echo || '').includes('配置驱动 shell 工具示例')
      if (dupPluginBlocked && dupExtBlocked) {
        record('PASS', 'T4.2 重名跳过: example_echo/ext_echo 均保留项目内版（先到先得）')
      } else {
        record('FAIL', 'T4.2 重名跳过: 项目内优先', `example_echo=${r.descs.example_echo} ext_echo=${r.descs.ext_echo}`)
      }
      // B3: warn 文案
      const warnPlugin = cap.lines.some((l) => l.includes('[plugins] 用户级插件 example_echo 与内置重名，已跳过'))
      const warnExt = cap.lines.some((l) => l.includes('[external] 用户级工具 ext_echo 与内置重名，已跳过'))
      if (warnPlugin && warnExt) {
        record('PASS', 'T4.3 重名 warn: 插件/外接工具的用户级重名提示均输出')
      } else {
        record('FAIL', 'T4.3 重名 warn', `warnPlugin=${warnPlugin} warnExt=${warnExt} lines=${cap.lines.filter((l) => l.includes('重名')).join(' | ')}`)
      }
    } catch (e) {
      record('FAIL', 'T4.2/T4.3 重名跳过+warn', e.message)
    } finally {
      if (stop) stop()
      if (saved === undefined) delete process.env.KOTONOHA_HOME
      else process.env.KOTONOHA_HOME = saved
      try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ }
    }
  }

  // 场景 C：KOTONOHA_HOME 指向不存在的目录 → 行为与现在一致（不报错、不含用户级工具）
  {
    const saved = process.env.KOTONOHA_HOME
    process.env.KOTONOHA_HOME = path.join(tmpdir(), `kotonoha-userplug-none-${Date.now()}`)
    let stop = null
    try {
      const r = await runBootstrap(process.env.KOTONOHA_HOME)
      stop = r.stop
      const unchanged = r.names.length >= 10 && !r.names.includes('user_echo') && !r.names.includes('user_ext_echo')
      if (unchanged) {
        record('PASS', `T4.4 目录不存在: 行为不变（${r.names.length} 工具，无用户级工具混入）`)
      } else {
        record('FAIL', 'T4.4 目录不存在: 行为不变', `tools=${r.names.length} user_echo=${r.names.includes('user_echo')}`)
      }
    } catch (e) {
      record('FAIL', 'T4.4 目录不存在: 行为不变', e.message)
    } finally {
      if (stop) stop()
      if (saved === undefined) delete process.env.KOTONOHA_HOME
      else process.env.KOTONOHA_HOME = saved
    }
  }
}

// ---- main ----
async function main() {
  testPaths()
  await testUserPluginLoad()
  await testUserExternalLoad()
  await testBootstrapMerge()
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
