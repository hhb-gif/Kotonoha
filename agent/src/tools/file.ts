// ============================================================
// file.ts —— 文件工具：read_file / write_file（cwd 沙箱）
// 契约：types.ts Tool / ToolDef / ToolResult
// ============================================================

import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import * as path from 'node:path'

import type { Tool, ToolResult } from '../types'

const MAX_READ_BYTES = 32 * 1024

// 沙箱校验：resolved 必须位于 cwd 内（或等于 cwd）
function assertInWorkspace(cwd: string, resolved: string): string | null {
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
    return '路径超出工作区'
  }
  return null
}

function argsOf(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' ? v : undefined
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// UTF-8 安全截断：回退到多字节字符边界，避免截出乱码
function truncateUtf8(buf: Buffer, max: number): string {
  let end = max
  while (end > 0 && (buf[end - 1] & 0xc0) === 0x80) end--
  if (end > 0 && (buf[end - 1] & 0xc0) === 0xc0) end--
  return buf.subarray(0, end).toString('utf8')
}

export const readFileTool: Tool = {
  def: {
    name: 'read_file',
    description: '读取工作区内的文件内容（超过 32KB 时截断并提示）',
    parameters: {
      type: 'object',
      description: 'read_file 参数：要读取的文件路径',
      properties: {
        path: { type: 'string', description: '相对工作区的文件路径' },
      },
      required: ['path'],
    },
  },
  async run(ctx, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const p = strArg(args, 'path')
    if (!p) return { ok: false, output: '', error: '缺少参数：path' }

    const resolved = path.resolve(ctx.cwd, p)
    const sandboxErr = assertInWorkspace(ctx.cwd, resolved)
    if (sandboxErr) return { ok: false, output: '', error: sandboxErr }

    let st: Stats
    try {
      st = await stat(resolved)
    } catch {
      return { ok: false, output: '', error: `文件不存在：${p}` }
    }
    if (st.isDirectory()) {
      return { ok: false, output: '', error: `是目录：${p}` }
    }

    try {
      if (st.size > MAX_READ_BYTES) {
        const fh = await open(resolved, 'r')
        try {
          const buf = Buffer.alloc(MAX_READ_BYTES)
          const { bytesRead } = await fh.read(buf, 0, MAX_READ_BYTES, 0)
          const content = truncateUtf8(buf.subarray(0, bytesRead), bytesRead)
          return { ok: true, output: content + `\n...(已截断，共 ${st.size} 字节)` }
        } finally {
          await fh.close()
        }
      }
      const content = await readFile(resolved, 'utf8')
      return { ok: true, output: content }
    } catch (e) {
      return { ok: false, output: '', error: `读取失败：${errMessage(e)}` }
    }
  },
}

export const writeFileTool: Tool = {
  def: {
    name: 'write_file',
    description: '写入（或覆盖）工作区内的文件；父目录不存在时自动创建',
    parameters: {
      type: 'object',
      description: 'write_file 参数：文件路径与内容',
      properties: {
        path: { type: 'string', description: '相对工作区的文件路径' },
        content: { type: 'string', description: '要写入的文件内容' },
      },
      required: ['path', 'content'],
    },
  },
  async run(ctx, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const p = strArg(args, 'path')
    const content = strArg(args, 'content')
    if (!p) return { ok: false, output: '', error: '缺少参数：path' }
    if (content === undefined) return { ok: false, output: '', error: '缺少参数：content' }

    const resolved = path.resolve(ctx.cwd, p)
    const sandboxErr = assertInWorkspace(ctx.cwd, resolved)
    if (sandboxErr) return { ok: false, output: '', error: sandboxErr }

    try {
      await mkdir(path.dirname(resolved), { recursive: true })
      const bytes = Buffer.byteLength(content, 'utf8')
      await writeFile(resolved, content, 'utf8')
      return { ok: true, output: `已写入 ${p}（${bytes} 字节）` }
    } catch (e) {
      return { ok: false, output: '', error: `写入失败：${errMessage(e)}` }
    }
  },
}