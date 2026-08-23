// ============================================================
// test-mcp-server.mjs —— Kotonoha MCP Server 验收测试
// 使用 @modelcontextprotocol/sdk 的 Client + StdioClientTransport 连接 serve.js
// 验证：tools/list 返回 14+ 工具、调用 read_file 读取真实文件返回正确内容
// ============================================================

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')
const servePath = join(projectRoot, 'dist', 'mcp', 'serve.js')

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runTest() {
  console.log('[test] Starting Kotonoha MCP Server test...')
  console.log('[test] Server path:', servePath)
  console.log('[test] Working directory:', projectRoot)

  // 启动 MCP server 子进程
  const serverProcess = spawn('node', [servePath], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, KOTONOHA_DATA_DIR: projectRoot },
  })

  // 捕获 stderr 用于调试
  serverProcess.stderr?.on('data', (data) => {
    console.log('[server stderr]', data.toString().trim())
  })

  serverProcess.stdout?.on('data', (data) => {
    console.log('[server stdout]', data.toString().trim())
  })

  serverProcess.on('error', (err) => {
    console.error('[test] Server process error:', err)
  })

  serverProcess.on('exit', (code) => {
    console.log('[test] Server exited with code:', code)
  })

  // 等待 server 启动
  await sleep(1000)

  // 创建客户端连接
  const transport = new StdioClientTransport({
    command: 'node',
    args: [servePath],
    cwd: projectRoot,
    env: { ...process.env, KOTONOHA_DATA_DIR: projectRoot },
  })

  const client = new Client(
    { name: 'kotonoha-test-client', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  try {
    console.log('[test] Connecting to MCP server...')
    await client.connect(transport)
    console.log('[test] Connected successfully!')

    // 测试 1: tools/list
    console.log('\n[test] === Test 1: tools/list ===')
    const toolsResult = await client.listTools()
    console.log('[test] Tools count:', toolsResult.tools.length)
    console.log('[test] Tool names:')
    for (const tool of toolsResult.tools) {
      console.log(`  - ${tool.name}: ${tool.description}`)
    }

    // 验证：至少有 14 个工具（kotonoha_ 前缀）
    const kotonohaTools = toolsResult.tools.filter(t => t.name.startsWith('kotonoha_'))
    console.log(`[test] Kotonoha tools (with prefix): ${kotonohaTools.length}`)
    
    if (kotonohaTools.length < 14) {
      throw new Error(`Expected at least 14 kotonoha_ tools, got ${kotonohaTools.length}`)
    }
    console.log('[test] ✓ tools/list PASS')

    // 测试 2: 调用 read_file (kotonoha_read_file)
    console.log('\n[test] === Test 2: call kotonoha_read_file ===')
    const testFile = join(projectRoot, 'package.json')
    const readResult = await client.callTool({
      name: 'kotonoha_read_file',
      arguments: { path: 'package.json' },
    })

    console.log('[test] read_file result:')
    console.log('[test] isError:', readResult.isError)
    if (readResult.content && readResult.content.length > 0) {
      const text = readResult.content[0].text
      console.log('[test] Content preview:', text.slice(0, 200))
      
      // 验证内容包含 package.json 的关键字段
      if (!text.includes('@kotonoha/agent') || !text.includes('version')) {
        throw new Error('read_file did not return expected package.json content')
      }
    }
    console.log('[test] ✓ call kotonoha_read_file PASS')

    // 测试 3: 调用 glob (kotonoha_glob)
    console.log('\n[test] === Test 3: call kotonoha_glob ===')
    const globResult = await client.callTool({
      name: 'kotonoha_glob',
      arguments: { pattern: 'src/**/*.ts' },
    })

    console.log('[test] glob result:')
    console.log('[test] isError:', globResult.isError)
    if (globResult.content && globResult.content.length > 0) {
      const text = globResult.content[0].text
      console.log('[test] Content preview:', text.slice(0, 300))
      
      if (!text.includes('server.ts') || !text.includes('serve.ts')) {
        throw new Error('glob did not return expected TypeScript files')
      }
    }
    console.log('[test] ✓ call kotonoha_glob PASS')

    // 测试 4: 调用 grep (kotonoha_grep)
    console.log('\n[test] === Test 4: call kotonoha_grep ===')
    const grepResult = await client.callTool({
      name: 'kotonoha_grep',
      arguments: { pattern: 'createMCPServer', path: 'src/mcp' },
    })

    console.log('[test] grep result:')
    console.log('[test] isError:', grepResult.isError)
    if (grepResult.content && grepResult.content.length > 0) {
      const text = grepResult.content[0].text
      console.log('[test] Content preview:', text.slice(0, 300))
      
      if (!text.includes('createMCPServer')) {
        throw new Error('grep did not find expected pattern')
      }
    }
    console.log('[test] ✓ call kotonoha_grep PASS')

    // 测试 5: 调用 bash (kotonoha_bash) - 简单命令
    console.log('\n[test] === Test 5: call kotonoha_bash ===')
    const bashResult = await client.callTool({
      name: 'kotonoha_bash',
      arguments: { command: 'echo hello from mcp' },
    })

    console.log('[test] bash result:')
    console.log('[test] isError:', bashResult.isError)
    if (bashResult.content && bashResult.content.length > 0) {
      const text = bashResult.content[0].text
      console.log('[test] Output:', text.trim())
      
      if (!text.includes('hello from mcp')) {
        throw new Error('bash did not return expected output')
      }
    }
    console.log('[test] ✓ call kotonoha_bash PASS')

    console.log('\n[test] ===== ALL TESTS PASSED =====')
    
  } catch (error) {
    console.error('[test] TEST FAILED:', error)
    process.exitCode = 1
  } finally {
    // 清理
    try {
      await client.close()
    } catch {}
    
    serverProcess.kill('SIGTERM')
    await sleep(500)
    if (!serverProcess.killed) {
      serverProcess.kill('SIGKILL')
    }
  }
}

runTest()