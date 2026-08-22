// ============================================================
// grep.ts —— 文件内容搜索工具：grep（正则/固定串/上下文行）
// 契约：types.ts Tool / ToolDef / ToolResult
// ============================================================

import * as path from 'node:path'
import { readFile, readdir, stat } from 'node:fs/promises'

import type { Tool, ToolResult } from '../types'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_MATCHES = 500
const DEFAULT_CONTEXT = 2

interface GrepMatch {
  file: string
  line: number
  match: string
  contextBefore: string[]
  contextAfter: string[]
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

function boolArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key]
  return typeof v === 'boolean' ? v : undefined
}

function intArg(args: Record<string, unknown>, key: string, def: number): number {
  const v = args[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return def
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

async function walkFiles(
  dir: string,
  matches: GrepMatch[],
  regex: RegExp,
  contextLines: number,
  filePattern: RegExp | undefined,
  workspaceRoot: string
): Promise<void> {
  if (matches.length >= MAX_MATCHES) return

  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (matches.length >= MAX_MATCHES) break

    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/')

    if (entry.isDirectory()) {
      // 跳过常见忽略目录
      if (['node_modules', '.git', 'dist', 'build', '.turbo', '.next', 'coverage'].includes(entry.name)) {
        continue
      }
      await walkFiles(fullPath, matches, regex, contextLines, filePattern, workspaceRoot)
    } else if (entry.isFile()) {
      if (filePattern && !filePattern.test(entry.name)) continue

      let st
      try {
        st = await stat(fullPath)
      } catch {
        continue
      }
      if (st.size > MAX_FILE_SIZE) continue

      try {
        const content = await readFile(fullPath, 'utf8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= MAX_MATCHES) break
          if (regex.test(lines[i])) {
            const start = Math.max(0, i - contextLines)
            const end = Math.min(lines.length, i + contextLines + 1)
            matches.push({
              file: relPath,
              line: i + 1,
              match: lines[i],
              contextBefore: lines.slice(start, i),
              contextAfter: lines.slice(i + 1, end),
            })
          }
        }
      } catch {
        // 忽略二进制文件或读取错误
      }
    }
  }
}

export const grepTool: Tool = {
  def: {
    name: 'grep',
    description: '在工作区文件中搜索内容（支持正则、固定字符串、大小写、上下文行）',
    parameters: {
      type: 'object',
      description: 'grep 参数：模式与搜索选项',
      properties: {
        pattern: { type: 'string', description: '搜索模式（正则或固定字符串）' },
        path: { type: 'string', description: '相对工作区的搜索目录（可选，默认工作区根）' },
        fixed: { type: 'boolean', description: '按固定字符串匹配（默认 false，按正则）' },
        ignoreCase: { type: 'boolean', description: '忽略大小写（默认 false）' },
        filePattern: { type: 'string', description: '文件名过滤正则（如 "\\.ts$"）' },
        context: { type: 'integer', description: '上下文行数（默认 2，0-10）' },
      },
      required: ['pattern'],
    },
  },
  async run(ctx, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const pattern = strArg(args, 'pattern')
    const searchPath = strArg(args, 'path')
    const fixed = boolArg(args, 'fixed') ?? false
    const ignoreCase = boolArg(args, 'ignoreCase') ?? false
    const filePatternStr = strArg(args, 'filePattern')
    const contextLines = Math.min(10, Math.max(0, intArg(args, 'context', DEFAULT_CONTEXT)))

    if (!pattern) return { ok: false, output: '', error: '缺少参数：pattern' }

    const baseDir = searchPath ? path.resolve(ctx.cwd, searchPath) : ctx.cwd
    const sandboxErr = assertInWorkspace(ctx.cwd, baseDir)
    if (sandboxErr) return { ok: false, output: '', error: sandboxErr }

    let regex: RegExp
    try {
      if (fixed) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        regex = new RegExp(escaped, ignoreCase ? 'i' : '')
      } else {
        regex = new RegExp(pattern, ignoreCase ? 'i' : '')
      }
    } catch (e) {
      return { ok: false, output: '', error: `正则无效：${errMessage(e)}` }
    }

    let filePattern: RegExp | undefined
    if (filePatternStr) {
      try {
        filePattern = new RegExp(filePatternStr)
      } catch {
        return { ok: false, output: '', error: 'filePattern 正则无效' }
      }
    }

    const matches: GrepMatch[] = []
    try {
      await walkFiles(baseDir, matches, regex, contextLines, filePattern, ctx.cwd)
    } catch (e) {
      return { ok: false, output: '', error: `搜索失败：${errMessage(e)}` }
    }

    if (matches.length === 0) {
      return { ok: true, output: '未找到匹配' }
    }

    // 格式化输出
    const output = matches
      .map((m) => {
        const ctxBefore = m.contextBefore.map((l, idx) => `  ${m.line - m.contextBefore.length + idx} | ${l}`).join('\n')
        const ctxAfter = m.contextAfter.map((l, idx) => `  ${m.line + 1 + idx} | ${l}`).join('\n')
        const parts = []
        if (ctxBefore) parts.push(ctxBefore)
        parts.push(`> ${m.file}:${m.line} | ${m.match}`)
        if (ctxAfter) parts.push(ctxAfter)
        return parts.join('\n')
      })
      .join('\n---\n')

    return { ok: true, output: output + (matches.length >= MAX_MATCHES ? '\n...(已达上限 500 条)' : '') }
  },
}