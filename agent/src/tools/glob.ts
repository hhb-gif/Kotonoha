// ============================================================
// glob.ts —— 文件模式匹配工具：glob（原生实现，支持 ** / ! / {a,b}）
// 契约：types.ts Tool / ToolDef / ToolResult
// ============================================================

import * as path from 'node:path'
import { readdir } from 'node:fs/promises'

import type { Tool, ToolResult } from '../types'

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

function arrArg(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key]
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return undefined
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

// 将 glob 模式转为正则（支持 *, **, ?, [...], {a,b}）
function patternToRegex(pattern: string): RegExp {
  let regexStr = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]

    if (ch === '*' && i + 1 < pattern.length && pattern[i + 1] === '*') {
      // ** 匹配任意层级目录（包括零层）
      regexStr += '(?:.*/)?'
      i += 2
      // 如果 ** 后面紧跟 /，跳过它（已被 (?:.*/)? 覆盖）
      if (i < pattern.length && pattern[i] === '/') {
        i++
      }
    } else if (ch === '*') {
      // * 匹配单层非斜杠字符
      regexStr += '[^/]*'
      i++
    } else if (ch === '?') {
      regexStr += '[^/]'
      i++
    } else if (ch === '{') {
      // 处理 {a,b,c}
      let j = i + 1
      let depth = 1
      while (j < pattern.length && depth > 0) {
        if (pattern[j] === '{') depth++
        else if (pattern[j] === '}') depth--
        j++
      }
      if (depth === 0) {
        const inner = pattern.slice(i + 1, j - 1)
        const options = inner.split(',').map(o => o.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        regexStr += `(?:${options.join('|')})`
        i = j
      } else {
        regexStr += '\\{'
        i++
      }
    } else if (ch === '[') {
      // 字符类 [...]
      let j = i + 1
      while (j < pattern.length && pattern[j] !== ']') j++
      if (j < pattern.length) {
        regexStr += '[' + pattern.slice(i + 1, j) + ']'
        i = j + 1
      } else {
        regexStr += '\\['
        i++
      }
    } else if (/[.+^$()|\\]/.test(ch)) {
      regexStr += '\\' + ch
      i++
    } else {
      regexStr += ch
      i++
    }
  }

  return new RegExp(`^${regexStr}$`)
}

function isNegated(pattern: string): boolean {
  return pattern.startsWith('!') || pattern.startsWith('^')
}

function stripNegation(pattern: string): string {
  return pattern.replace(/^[!^]/, '')
}

async function walkGlob(
  dir: string,
  patterns: string[],
  ignorePatterns: string[],
  nodir: boolean,
  dot: boolean,
  results: string[],
  baseDir: string,
  workspaceRoot: string
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (!dot && entry.name.startsWith('.')) continue

    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/')

    const isDir = entry.isDirectory()

    // 检查忽略模式（目录也要检查，决定是否递归）
    let ignored = false
    for (const ig of ignorePatterns) {
      const igRegex = patternToRegex(stripNegation(ig))
      if (igRegex.test(relPath) || (isDir && igRegex.test(relPath + '/'))) {
        ignored = true
        break
      }
    }
    if (ignored) continue

    // 检查匹配模式（支持否定）
    let matched = false
    for (const pat of patterns) {
      const negated = isNegated(pat)
      const cleanPat = stripNegation(pat)
      const regex = patternToRegex(cleanPat)
      if (regex.test(relPath) || (isDir && regex.test(relPath + '/'))) {
        if (negated) {
          matched = false
          break
        }
        matched = true
      }
    }

    if (matched && !isDir) {
      results.push(relPath)
    }

    // 无论 nodir，目录都要递归（除非被忽略）
    if (isDir) {
      await walkGlob(fullPath, patterns, ignorePatterns, nodir, dot, results, baseDir, workspaceRoot)
    }
  }
}

export const globTool: Tool = {
  def: {
    name: 'glob',
    description: '按模式查找工作区文件（支持 ** 递归、! 否定、{a,b} 大括号展开）',
    parameters: {
      type: 'object',
      description: 'glob 参数：模式与选项',
      properties: {
        pattern: { type: 'string', description: 'glob 模式（如 "src/**/*.ts"）' },
        cwd: { type: 'string', description: '相对工作区的子目录（可选）' },
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: '忽略模式数组（如 ["**/node_modules/**"]）',
        },
        nodir: { type: 'boolean', description: '仅返回文件（默认 true）' },
        dot: { type: 'boolean', description: '包含隐藏文件（默认 false）' },
      },
      required: ['pattern'],
    },
  },
  async run(ctx, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const pattern = strArg(args, 'pattern')
    const cwdArg = strArg(args, 'cwd')
    const ignore = arrArg(args, 'ignore') ?? []
    const nodir = boolArg(args, 'nodir') ?? true
    const dot = boolArg(args, 'dot') ?? false

    if (!pattern) return { ok: false, output: '', error: '缺少参数：pattern' }

    const baseCwd = cwdArg ? path.resolve(ctx.cwd, cwdArg) : ctx.cwd

    const sandboxErr = assertInWorkspace(ctx.cwd, baseCwd)
    if (sandboxErr) return { ok: false, output: '', error: sandboxErr }

    const patterns = pattern.split(',').map((p) => p.trim()).filter(Boolean)
    const results: string[] = []

    try {
      await walkGlob(baseCwd, patterns, ignore, nodir, dot, results, baseCwd, ctx.cwd)
      results.sort()
      return { ok: true, output: JSON.stringify(results, null, 2) }
    } catch (e) {
      return { ok: false, output: '', error: `glob 失败：${errMessage(e)}` }
    }
  },
}