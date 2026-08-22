import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileTool, writeFileTool } from '../file'
import { editFileTool } from '../file-edit'

const TEST_DIR = join(tmpdir(), 'kotonoha-tools-test')

function makeCtx(cwd: string) {
  return {
    cwd,
    sessionId: 'test-session',
    approve: async () => 'allowed-once' as const,
    emit: () => {},
  }
}

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
  await mkdir(TEST_DIR, { recursive: true })
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('read_file', () => {
  it('读取存在的文件', async () => {
    await writeFile(join(TEST_DIR, 'foo.txt'), 'hello world')
    const res = await readFileTool.run(makeCtx(TEST_DIR), { path: 'foo.txt' })
    expect(res.ok).toBe(true)
    expect(res.output).toBe('hello world')
  })

  it('文件不存在返回错误', async () => {
    const res = await readFileTool.run(makeCtx(TEST_DIR), { path: 'not-exist.txt' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('文件不存在')
  })

  it('目录返回错误', async () => {
    await mkdir(join(TEST_DIR, 'subdir'))
    const res = await readFileTool.run(makeCtx(TEST_DIR), { path: 'subdir' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('是目录')
  })

  it('大文件截断', async () => {
    const bigContent = 'x'.repeat(40 * 1024)
    await writeFile(join(TEST_DIR, 'big.txt'), bigContent)
    const res = await readFileTool.run(makeCtx(TEST_DIR), { path: 'big.txt' })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('已截断')
    expect(res.output.length).toBeLessThan(40 * 1024)
  })

  it('路径遍历防御', async () => {
    const res = await readFileTool.run(makeCtx(TEST_DIR), { path: '../../etc/passwd' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('路径超出工作区')
  })
})

describe('write_file', () => {
  it('新建文件', async () => {
    const res = await writeFileTool.run(makeCtx(TEST_DIR), { path: 'new.txt', content: 'new content' })
    expect(res.ok).toBe(true)
    const content = await readFile(join(TEST_DIR, 'new.txt'), 'utf8')
    expect(content).toBe('new content')
  })

  it('覆盖文件', async () => {
    await writeFile(join(TEST_DIR, 'exist.txt'), 'old')
    const res = await writeFileTool.run(makeCtx(TEST_DIR), { path: 'exist.txt', content: 'new' })
    expect(res.ok).toBe(true)
    const content = await readFile(join(TEST_DIR, 'exist.txt'), 'utf8')
    expect(content).toBe('new')
  })

  it('自动创建父目录', async () => {
    const res = await writeFileTool.run(makeCtx(TEST_DIR), { path: 'a/b/c.txt', content: 'deep' })
    expect(res.ok).toBe(true)
    const content = await readFile(join(TEST_DIR, 'a/b/c.txt'), 'utf8')
    expect(content).toBe('deep')
  })

  it('路径遍历防御', async () => {
    const res = await writeFileTool.run(makeCtx(TEST_DIR), { path: '../../evil.txt', content: 'x' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('路径超出工作区')
  })
})

describe('edit_file', () => {
  beforeEach(async () => {
    await writeFile(join(TEST_DIR, 'edit.txt'), 'line1\nline2\nline3\n')
  })

  it('精确替换单处', async () => {
    const res = await editFileTool.run(makeCtx(TEST_DIR), {
      path: 'edit.txt',
      old_str: 'line2',
      new_str: 'LINE2',
    })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('已替换 1 处')
    const content = await readFile(join(TEST_DIR, 'edit.txt'), 'utf8')
    expect(content).toBe('line1\nLINE2\nline3\n')
  })

  it('多处替换', async () => {
    await writeFile(join(TEST_DIR, 'multi.txt'), 'foo\nfoo\nfoo\n')
    const res = await editFileTool.run(makeCtx(TEST_DIR), {
      path: 'multi.txt',
      old_str: 'foo',
      new_str: 'bar',
    })
    expect(res.ok).toBe(true)
    expect(res.output).toContain('已替换 3 处')
    const content = await readFile(join(TEST_DIR, 'multi.txt'), 'utf8')
    expect(content).toBe('bar\nbar\nbar\n')
  })

  it('未找到 old_str 返回错误', async () => {
    const res = await editFileTool.run(makeCtx(TEST_DIR), {
      path: 'edit.txt',
      old_str: 'not-exist',
      new_str: 'x',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('未找到匹配')
  })

  it('内容无变化', async () => {
    const res = await editFileTool.run(makeCtx(TEST_DIR), {
      path: 'edit.txt',
      old_str: 'line1',
      new_str: 'line1',
    })
    expect(res.ok).toBe(true)
    expect(res.output).toBe('内容无变化')
  })

  it('路径遍历防御', async () => {
    const res = await editFileTool.run(makeCtx(TEST_DIR), {
      path: '../../evil.txt',
      old_str: 'x',
      new_str: 'y',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('路径超出工作区')
  })

  it('大文件拒绝编辑', async () => {
    const bigFile = join(TEST_DIR, 'big.txt')
    await writeFile(bigFile, 'x'.repeat(11 * 1024 * 1024))
    const res = await editFileTool.run(makeCtx(TEST_DIR), {
      path: 'big.txt',
      old_str: 'x',
      new_str: 'y',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('文件过大')
  })
})