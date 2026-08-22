// ============================================================
// file-edit.ts —— 文件编辑工具：edit_file（精确字符串替换）
// 契约：types.ts Tool / ToolDef / ToolResult
// ============================================================

import * as path from 'node:path'
import { readFile, writeFile, stat } from 'node:fs/promises'

import type { Tool, ToolResult } from '../types'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

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

function assertInWorkspace(cwd: string, resolved: string): string | null {
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
    return '路径超出工作区'
  }
  return null
}

export const editFileTool: Tool = {
  def: {
    name: 'edit_file',
    description: '在工作区文件中精确替换字符串（需完全匹配 old_str，支持多处替换）',
    parameters: {
      type: 'object',
      description: 'edit_file 参数：文件路径、旧字符串、新字符串',
      properties: {
        path: { type: 'string', description: '相对工作区的文件路径' },
        old_str: { type: 'string', description: '要被替换的原字符串（需完全匹配）' },
        new_str: { type: 'string', description: '替换后的新字符串' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  async run(ctx, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const p = strArg(args, 'path')
    const oldStr = strArg(args, 'old_str')
    const newStr = strArg(args, 'new_str')

    if (!p) return { ok: false, output: '', error: '缺少参数：path' }
    if (oldStr === undefined) return { ok: false, output: '', error: '缺少参数：old_str' }
    if (newStr === undefined) return { ok: false, output: '', error: '缺少参数：new_str' }

    const resolved = path.resolve(ctx.cwd, p)
    const sandboxErr = assertInWorkspace(ctx.cwd, resolved)
    if (sandboxErr) return { ok: false, output: '', error: sandboxErr }

    let st
    try {
      st = await stat(resolved)
    } catch {
      return { ok: false, output: '', error: `文件不存在：${p}` }
    }
    if (st.isDirectory()) {
      return { ok: false, output: '', error: `是目录：${p}` }
    }
    if (st.size > MAX_FILE_SIZE) {
      return { ok: false, output: '', error: `文件过大（>10MB），拒绝编辑：${p}` }
    }

    try {
      const content = await readFile(resolved, 'utf8')

      if (!content.includes(oldStr)) {
        return { ok: false, output: '', error: '未找到匹配的 old_str' }
      }

      const newContent = content.split(oldStr).join(newStr)

      if (newContent === content) {
        return { ok: true, output: '内容无变化' }
      }

      await writeFile(resolved, newContent, 'utf8')
      const changed = (content.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
      return { ok: true, output: `已替换 ${changed} 处` }
    } catch (e) {
      return { ok: false, output: '', error: `编辑失败：${errMessage(e)}` }
    }
  },
}