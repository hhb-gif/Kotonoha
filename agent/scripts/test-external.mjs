// ============================================================
// test-external.mjs —— T2-external 验收脚本（从 dist 导入）
// 运行：node scripts/test-external.mjs（需先 npm run build）
// 行为：
//   1. 临时目录写 tool.yaml / *.tools.yaml（shell echo + HTTP GET 本地端点）
//   2. loadExternalTools → 校验协议字段、schema 生成、直接调用输出
//   3. {env:VAR} 占位符：本地 HTTP 服务回显收到的请求头
//   4. 目录不存在 → 空结果；坏文件 → 错误隔离
//   5. 汇总 [PASS|FAIL]，任一 FAIL → 退出码非 0
// 中文注释、英文标识符
// ============================================================

import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { loadExternalTools } from '../dist/tools/external/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENT_ROOT = path.resolve(__dirname, '..')

// ---- 结果收集 ----
const results = []
function record(status, name, detail) {
  results.push({ status, name, detail })
  console.log(`[${status}] ${name}`)
  if (detail) console.log(`        ${detail}`)
}

const ctx = { cwd: AGENT_ROOT, sessionId: 'test-external', approve: async () => 'allowed-once', emit: () => {} }

// 启动本地 HTTP 服务：回显 method/path/headers/body 的 JSON（用作 http 工具端点）
// 路径以 /missing 开头 → 404（用于非 2xx 用例）
async function startEchoServer() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/missing')) {
      res.setHeader('content-type', 'application/json')
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      let body = null
      try { body = raw ? JSON.parse(raw) : null } catch { body = raw }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ method: req.method, path: req.url, headers: req.headers, body }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port }
}

// ---- 测试 1：shell 工具（schema 生成 + 调用 + 非零退出码）----
async function testShell() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-ext-shell-'))
  writeFileSync(path.join(dir, 'echo.tools.yaml'), [
    'tools:',
    '  - name: ext_echo',
    '    description: 回显文本',
    '    type: shell',
    '    command: "echo {text}"',
    '    cwd: .',
    '    timeout: 10',
  ].join('\n'), 'utf8')
  try {
    const res = await loadExternalTools(dir)
    const tool = res.tools.find((t) => t.def.name === 'ext_echo')
    if (!tool) {
      record('FAIL', 'T1.1 shell: 加载成功', `tools=${res.tools.map((t) => t.def.name).join(',')} errors=${JSON.stringify(res.errors)}`)
    } else {
      record('PASS', 'T1.1 shell: 加载成功（errors 为空）')
    }
    if (tool) {
      // 1.2 协议字段 + schema：{text} → properties.text（string，required）
      const props = tool.def.parameters.properties
      const ok = tool.kind === 'dynamic' && tool.group === 'external' && tool.readOnly === false
        && props && typeof props.text === 'object' && props.text.type === 'string'
        && Array.isArray(tool.def.parameters.required) && tool.def.parameters.required.includes('text')
      if (ok) record('PASS', 'T1.2 shell: 协议字段（dynamic/external）+ schema 生成（{text} → string 参数）')
      else record('FAIL', 'T1.2 shell: 协议字段 + schema 生成', `kind=${tool.kind} group=${tool.group} readOnly=${tool.readOnly} props=${JSON.stringify(props)}`)
      // 1.3 调用：输出即 echo 结果
      const r = await tool.run(ctx, { text: 'hello 外接' })
      if (r.ok && r.output.trim() === 'hello 外接') {
        record('PASS', 'T1.3 shell: 直接调用（输出 hello 外接）')
      } else {
        record('FAIL', 'T1.3 shell: 直接调用', `ok=${r.ok} output=${JSON.stringify(r.output)} error=${r.error}`)
      }
      // 1.4 缺参数：占位符替换为空串，不报错
      const r2 = await tool.run(ctx, {})
      if (r2.ok) record('PASS', 'T1.4 shell: 缺参数 → 空串替换仍执行')
      else record('FAIL', 'T1.4 shell: 缺参数 → 空串替换仍执行', `ok=${r2.ok} error=${r2.error}`)
    }
    // 1.5 非零退出码 → ok:false 带 error
    writeFileSync(path.join(dir, 'fail.tools.yaml'), [
      'tools:',
      '  - name: ext_fail',
      '    description: 必然失败',
      '    type: shell',
      '    command: "exit 3"',
    ].join('\n'), 'utf8')
    const res2 = await loadExternalTools(dir)
    const failTool = res2.tools.find((t) => t.def.name === 'ext_fail')
    if (failTool) {
      const rf = await failTool.run(ctx, {})
      if (!rf.ok && rf.error) record('PASS', 'T1.5 shell: 非零退出码 → ok:false 带 error')
      else record('FAIL', 'T1.5 shell: 非零退出码 → ok:false', `ok=${rf.ok} error=${rf.error}`)
    } else {
      record('FAIL', 'T1.5 shell: 非零退出码', 'ext_fail 未加载')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---- 测试 2：http 工具（GET 本地端点 + env 占位符 + POST body）----
async function testHttp() {
  const { server, port } = await startEchoServer()
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-ext-http-'))
  process.env.EXT_TEST_TOKEN = 'secret-abc-123'
  try {
    writeFileSync(path.join(dir, 'http.tools.yaml'), [
      'tools:',
      '  - name: ext_get',
      '    description: 本地回显 GET',
      '    type: http',
      '    method: GET',
      `    url: "http://127.0.0.1:${port}/echo/{path}"`,
      '    headers: { X-Test-Token: "{env:EXT_TEST_TOKEN}" }',
      '  - name: ext_post',
      '    description: 本地回显 POST',
      '    type: http',
      '    method: POST',
      `    url: "http://127.0.0.1:${port}/submit"`,
      '    body: { title: "{title}", body: "{body}" }',
    ].join('\n'), 'utf8')
    const res = await loadExternalTools(dir)
    const get = res.tools.find((t) => t.def.name === 'ext_get')
    const post = res.tools.find((t) => t.def.name === 'ext_post')

    // 2.1 schema：url 的 {path} → 参数；{env:...} 不入 schema
    if (get) {
      const props = get.def.parameters.properties
      const ok = props && props.path && props.path.type === 'string' && !props.EXT_TEST_TOKEN
      if (ok) record('PASS', 'T2.1 http: schema 生成（url {path} → 参数；{env:...} 不入 schema）')
      else record('FAIL', 'T2.1 http: schema 生成', `props=${JSON.stringify(props)}`)
    } else {
      record('FAIL', 'T2.1 http: schema 生成', 'ext_get 未加载')
    }
    // 2.2 GET 调用：本地端点返回 JSON → 输出含回显 path
    if (get) {
      const r = await get.run(ctx, { path: 'abc' })
      if (r.ok && r.output.includes('/echo/abc')) {
        record('PASS', 'T2.2 http: GET 调用（JSON 输出含 /echo/abc）')
      } else {
        record('FAIL', 'T2.2 http: GET 调用', `ok=${r.ok} output=${JSON.stringify(r.output)} error=${r.error}`)
      }
    }
    // 2.3 {env:VAR}：本地服务回显请求头 → 收到 Bearer secret-abc-123
    if (get) {
      const r = await get.run(ctx, { path: 'env' })
      if (r.ok && r.output.includes('secret-abc-123')) {
        record('PASS', 'T2.3 http: {env:VAR} 从环境变量取值（请求头含 secret-abc-123）')
      } else {
        record('FAIL', 'T2.3 http: {env:VAR} 取值', `output=${JSON.stringify(r.output)}`)
      }
    }
    // 2.4 缺失环境变量 → ok:false 提示
    const saved = process.env.EXT_TEST_TOKEN
    delete process.env.EXT_TEST_TOKEN
    try {
      const r = await get.run(ctx, { path: 'env' })
      if (!r.ok && r.error.includes('EXT_TEST_TOKEN')) record('PASS', 'T2.4 http: 缺失环境变量 → ok:false 明确报错')
      else record('FAIL', 'T2.4 http: 缺失环境变量 → 报错', `ok=${r.ok} error=${r.error}`)
    } finally {
      process.env.EXT_TEST_TOKEN = saved
    }
    // 2.5 POST body 插值：{title}/{body} 替换后发送
    if (post) {
      const r = await post.run(ctx, { title: '标题A', body: '内容B' })
      if (r.ok && r.output.includes('标题A') && r.output.includes('内容B')) {
        record('PASS', 'T2.5 http: POST body 插值（{title}/{body} 生效）')
      } else {
        record('FAIL', 'T2.5 http: POST body 插值', `ok=${r.ok} output=${JSON.stringify(r.output)} error=${r.error}`)
      }
    }
    // 2.6 readOnly：GET 只读 / POST 非只读
    if (get && post) {
      if (get.readOnly === true && post.readOnly === false) record('PASS', 'T2.6 http: readOnly（GET=true / POST=false）')
      else record('FAIL', 'T2.6 http: readOnly', `get=${get.readOnly} post=${post.readOnly}`)
    }
    // 2.7 非 2xx → ok:false
    writeFileSync(path.join(dir, 'http404.tools.yaml'), [
      'tools:',
      '  - name: ext_404',
      '    description: 404 端点',
      '    type: http',
      '    method: GET',
      `    url: "http://127.0.0.1:${port}/missing-{id}"`,
    ].join('\n'), 'utf8')
    const res2 = await loadExternalTools(dir)
    const notFound = res2.tools.find((t) => t.def.name === 'ext_404')
    if (notFound) {
      const r = await notFound.run(ctx, { id: 'x' })
      if (!r.ok && r.error.includes('404')) record('PASS', 'T2.7 http: 非 2xx → ok:false（error 含 404）')
      else record('FAIL', 'T2.7 http: 非 2xx → ok:false', `ok=${r.ok} error=${r.error}`)
    } else {
      record('FAIL', 'T2.7 http: 非 2xx → ok:false', 'ext_404 未加载')
    }
  } finally {
    delete process.env.EXT_TEST_TOKEN
    rmSync(dir, { recursive: true, force: true })
    server.close()
  }
}

// ---- 测试 3：目录不存在 / 命名识别 / 坏文件隔离 ----
async function testRobustness() {
  // 3.1 目录不存在 → 空结果不抛错
  const missing = path.join(tmpdir(), `kotonoha-ext-none-${Date.now()}`)
  const r1 = await loadExternalTools(missing)
  if (r1.tools.length === 0 && r1.errors.length === 0) {
    record('PASS', 'T3.1 目录不存在: 返回空结果不抛错')
  } else {
    record('FAIL', 'T3.1 目录不存在: 返回空结果不抛错', JSON.stringify(r1))
  }

  // 3.2 命名识别：tool.yaml + *.tools.yaml 都加载；无关文件忽略
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-ext-naming-'))
  writeFileSync(path.join(dir, 'tool.yaml'), 'tools:\n  - name: ext_naming_a\n    type: shell\n    command: "echo a"\n', 'utf8')
  writeFileSync(path.join(dir, 'b.tools.yaml'), 'tools:\n  - name: ext_naming_b\n    type: shell\n    command: "echo b"\n', 'utf8')
  writeFileSync(path.join(dir, 'ignore.txt'), 'not yaml', 'utf8')
  writeFileSync(path.join(dir, 'ignore.yaml'), 'tools:\n  - name: ext_ignored\n    type: shell\n    command: "echo x"\n', 'utf8')
  try {
    const r = await loadExternalTools(dir)
    const names = r.tools.map((t) => t.def.name).sort()
    if (names.includes('ext_naming_a') && names.includes('ext_naming_b') && !names.includes('ext_ignored')) {
      record('PASS', 'T3.2 命名识别: tool.yaml + *.tools.yaml 均加载，无关文件忽略')
    } else {
      record('FAIL', 'T3.2 命名识别', `names=${names.join(',')} errors=${JSON.stringify(r.errors)}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // 3.3 坏文件隔离：坏 yaml 进 errors，好文件不受影响
  const dir2 = mkdtempSync(path.join(tmpdir(), 'kotonoha-ext-broken-'))
  writeFileSync(path.join(dir2, 'bad.tools.yaml'), 'tools:\n  - stray\n', 'utf8') // 列表项无键声明 → 解析抛错
  writeFileSync(path.join(dir2, 'good.tools.yaml'), 'tools:\n  - name: ext_good\n    type: shell\n    command: "echo good"\n', 'utf8')
  try {
    const r = await loadExternalTools(dir2)
    const good = r.tools.find((t) => t.def.name === 'ext_good')
    const hasBad = r.errors.some((e) => e.file === 'bad.tools.yaml')
    if (good && hasBad && r.errors.length === 1) {
      record('PASS', 'T3.3 坏文件隔离: bad.tools.yaml 进 errors，good 正常加载')
    } else {
      record('FAIL', 'T3.3 坏文件隔离', `good=${!!good} errors=${JSON.stringify(r.errors)}`)
    }
  } finally {
    rmSync(dir2, { recursive: true, force: true })
  }
}

// ---- main ----
async function main() {
  await testShell()
  await testHttp()
  await testRobustness()
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