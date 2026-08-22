import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { globTool } from '../glob'
import { grepTool } from '../grep'
import { bashTool } from '../bash'
import { taskTool } from '../task'

// 每个测试套件用独立目录避免并发冲突
const GLOB_TEST_DIR = join(tmpdir(), 'kotonoha-glob-test')
const GREP_TEST_DIR = join(tmpdir(), 'kotonoha-grep-test')
const BASH_TEST_DIR = join(tmpdir(), 'kotonoha-bash-test')
const TASK_TEST_DIR = join(tmpdir(), 'kotonoha-task-test')

function makeCtx(cwd: string) {
  return {
    cwd,
    sessionId: 'test-session',
    approve: async () => 'allowed-once' as const,
    emit: () => {},
  }
}

async function setupGlobDir() {
  await rm(GLOB_TEST_DIR, { recursive: true, force: true })
  await mkdir(GLOB_TEST_DIR, { recursive: true })
  await mkdir(join(GLOB_TEST_DIR, 'src'), { recursive: true })
  await mkdir(join(GLOB_TEST_DIR, 'src/utils'), { recursive: true })
  await mkdir(join(GLOB_TEST_DIR, 'tests'), { recursive: true })
  await writeFile(join(GLOB_TEST_DIR, 'src/index.ts'), 'export const a = 1')
  await writeFile(join(GLOB_TEST_DIR, 'src/utils/helpers.ts'), 'export function help() {}')
  await writeFile(join(GLOB_TEST_DIR, 'src/utils/types.ts'), 'export type T = string')
  await writeFile(join(GLOB_TEST_DIR, 'tests/index.test.ts'), 'test("ok", () => {})')
  await writeFile(join(GLOB_TEST_DIR, 'README.md'), '# Project\n\nContent')
  await writeFile(join(GLOB_TEST_DIR, 'package.json'), '{"name":"test"}')
  await writeFile(join(GLOB_TEST_DIR, '.hidden'), 'secret')
}

async function setupGrepDir() {
  await rm(GREP_TEST_DIR, { recursive: true, force: true })
  await mkdir(GREP_TEST_DIR, { recursive: true })
  await writeFile(join(GREP_TEST_DIR, 'grep-target.txt'), 'hello world\nhello again\nfoo bar\nHELLO case\n')
  await mkdir(join(GREP_TEST_DIR, 'src'), { recursive: true })
  await writeFile(join(GREP_TEST_DIR, 'src/index.ts'), 'export const a = 1')
  await writeFile(join(GREP_TEST_DIR, 'README.md'), '# Project')
}

async function setupBashDir() {
  await rm(BASH_TEST_DIR, { recursive: true, force: true })
  await mkdir(BASH_TEST_DIR, { recursive: true })
  await mkdir(join(BASH_TEST_DIR, 'sub'), { recursive: true })
  await writeFile(join(BASH_TEST_DIR, 'sub/file.txt'), 'content')
}

async function setupTaskDir() {
  await rm(TASK_TEST_DIR, { recursive: true, force: true })
  await mkdir(TASK_TEST_DIR, { recursive: true })
}

async function cleanupAll() {
  await rm(GLOB_TEST_DIR, { recursive: true, force: true })
  await rm(GREP_TEST_DIR, { recursive: true, force: true })
  await rm(BASH_TEST_DIR, { recursive: true, force: true })
  await rm(TASK_TEST_DIR, { recursive: true, force: true })
}

describe('glob', () => {
  beforeEach(async () => await setupGlobDir())
  afterEach(async () => await cleanupAll())

  it('简单模式匹配', async () => {
    const res = await globTool.run(makeCtx(GLOB_TEST_DIR), { pattern: 'src/**/*.ts' })
    expect(res.ok).toBe(true)
    const files = JSON.parse(res.output)
    expect(files).toContain('src/index.ts')
    expect(files).toContain('src/utils/helpers.ts')
    expect(files).toContain('src/utils/types.ts')
  })

  it('单层 * 匹配', async () => {
    const res = await globTool.run(makeCtx(GLOB_TEST_DIR), { pattern: 'src/*.ts' })
    expect(res.ok).toBe(true)
    const files = JSON.parse(res.output)
    expect(files).toEqual(['src/index.ts'])
  })

  it('大括号展开', async () => {
    const res = await globTool.run(makeCtx(GLOB_TEST_DIR), { pattern: '{src,tests}/**/*.ts' })
    expect(res.ok).toBe(true)
    const files = JSON.parse(res.output)
    expect(files).toContain('src/index.ts')
    expect(files).toContain('tests/index.test.ts')
  })

  it('否定模式 !', async () => {
    const res = await globTool.run(makeCtx(GLOB_TEST_DIR), { pattern: 'src/**/*.ts,!src/utils/*' })
    expect(res.ok).toBe(true)
    const files = JSON.parse(res.output)
    expect(files).toContain('src/index.ts')
    expect(files).not.toContain('src/utils/helpers.ts')
  })

  it('cwd 参数', async () => {
    const res = await globTool.run(makeCtx(GLOB_TEST_DIR), { pattern: '*.ts', cwd: 'src' })
    expect(res.ok).toBe(true)
    const files = JSON.parse(res.output)
    expect(files).toContain('src/index.ts')
  })

  it('dot: true 包含隐藏文件', async () => {
    const res = await globTool.run(makeCtx(GLOB_TEST_DIR), { pattern: '.*', dot: true })
    expect(res.ok).toBe(true)
    const files = JSON.parse(res.output)
    expect(files).toContain('.hidden')
  })

  it('cwd 超出工作区返回错误', async () => {
    const res = await globTool.run(makeCtx(GLOB_TEST_DIR), { pattern: '*', cwd: '../../etc' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('路径超出工作区')
  })
})

describe('grep', () => {
  beforeEach(async () => await setupGrepDir())
  afterEach(async () => await cleanupAll())

  it('正则搜索', async () => {
    const res = await grepTool.run(makeCtx(GREP_TEST_DIR), { pattern: 'hello' })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('hello world')
    expect(res.output).toContain('hello again')
  })

  it('固定字符串搜索', async () => {
    const res = await grepTool.run(makeCtx(GREP_TEST_DIR), { pattern: 'hello', fixed: true })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('hello world')
  })

  it('忽略大小写', async () => {
    const res = await grepTool.run(makeCtx(GREP_TEST_DIR), { pattern: 'HELLO', ignoreCase: true })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('HELLO case')
    expect(res.output).toContain('hello world')
  })

  it('文件名过滤', async () => {
    const res = await grepTool.run(makeCtx(GREP_TEST_DIR), { pattern: 'export', filePattern: '\\.ts$' })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('src/index.ts')
    expect(res.output).not.toContain('README.md')
  })

  it('上下文行', async () => {
    const res = await grepTool.run(makeCtx(GREP_TEST_DIR), { pattern: 'again', context: 1 })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('hello world')
    expect(res.output).toContain('foo bar')
  })

  it('未找到返回提示', async () => {
    const res = await grepTool.run(makeCtx(GREP_TEST_DIR), { pattern: 'notfoundxyz' })
    expect(res.ok).toBe(true)
    expect(res.output).toBe('未找到匹配')
  })

  it('path 参数限制搜索目录', async () => {
    const res = await grepTool.run(makeCtx(GREP_TEST_DIR), { pattern: 'export', path: 'src' })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('src/index.ts')
    expect(res.output).not.toContain('tests/')
  })

  it('无效正则返回错误', async () => {
    const res = await grepTool.run(makeCtx(GREP_TEST_DIR), { pattern: '[invalid' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('正则无效')
  })
})

describe('bash', () => {
  beforeEach(async () => await setupBashDir())
  afterEach(async () => await cleanupAll())

  it('简单命令执行', async () => {
    const res = await bashTool.run(makeCtx(BASH_TEST_DIR), { command: 'echo hello' })
    expect(res.ok).toBe(true)
    expect(res.output.trim()).toBe('hello')
  })

  it('命令带参数', async () => {
    const res = await bashTool.run(makeCtx(BASH_TEST_DIR), { command: 'echo a b c' })
    expect(res.ok).toBe(true)
    expect(res.output.trim()).toBe('a b c')
  })

  it('cwd 参数', async () => {
    const res = await bashTool.run(makeCtx(BASH_TEST_DIR), { command: 'type file.txt', cwd: 'sub' })
    expect(res.ok).toBe(true)
    expect(res.output.trim()).toBe('content')
  })

  it('非零退出码返回错误', async () => {
    const res = await bashTool.run(makeCtx(BASH_TEST_DIR), { command: 'exit /b 1' })
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('超时', async () => {
    // ping 循环 10 次约 10 秒，设置 200ms 超时
    const cmd = process.platform === 'win32' ? 'ping -n 11 127.0.0.1' : 'sleep 10'
    const res = await bashTool.run(makeCtx(BASH_TEST_DIR), { command: cmd, timeout: 200 })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('超时')
  })

  it('cwd 超出工作区返回错误', async () => {
    const res = await bashTool.run(makeCtx(BASH_TEST_DIR), { command: 'echo test', cwd: '../../etc' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('cwd 超出工作区')
  })

  it('stderr 合并到输出', async () => {
    const cmd = process.platform === 'win32' ? 'echo err 1>&2' : 'echo err >&2'
    const res = await bashTool.run(makeCtx(BASH_TEST_DIR), { command: cmd })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('[stderr]')
    expect(res.output).toContain('err')
  })
})

describe('task', () => {
  beforeEach(async () => await setupTaskDir())
  afterEach(async () => await cleanupAll())

  it('启动子任务', async () => {
    const res = await taskTool.run(makeCtx(TASK_TEST_DIR), {
      description: 'test task',
      prompt: 'do something',
    })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('子任务')
    expect(res.output).toContain('test task')
  })

  it('缺少 description 返回错误', async () => {
    const res = await taskTool.run(makeCtx(TASK_TEST_DIR), { prompt: 'only prompt' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('description')
  })

  it('缺少 prompt 返回错误', async () => {
    const res = await taskTool.run(makeCtx(TASK_TEST_DIR), { description: 'only desc' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('prompt')
  })
})