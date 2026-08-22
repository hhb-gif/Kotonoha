// ============================================================
// bash.ts —— Bash 工具：bash（执行 shell 命令，支持超时/信号）
// 契约：types.ts Tool / ToolDef / ToolResult
// ============================================================

import { exec } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'

import type { Tool, ToolResult } from '../types'

const execP = promisify(exec)

const BASH_TIMEOUT_MS = 120 * 1000 // 2分钟默认
const BASH_MAX_BUFFER = 1024 * 1024 // 1MB
const MAX_OUTPUT_CHARS = 32 * 1024

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

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `...(已截断，共 ${s.length} 字符)` : s
}

interface ExecFailure {
  message?: string
  stdout?: string
  stderr?: string
  killed?: boolean
  signal?: string | null
}

export const bashTool: Tool = {
  def: {
    name: 'bash',
    description: '在工作区执行 Bash 命令（可指定超时，默认 120 秒；非零退出码视为失败）',
    parameters: {
      type: 'object',
      description: 'bash 参数：命令、可选工作目录与超时',
      properties: {
        command: { type: 'string', description: '要执行的 Bash 命令' },
        cwd: { type: 'string', description: '相对工作区的子目录（可选）' },
        timeout: { type: 'integer', description: '超时毫秒数（默认 120000，最大 600000）' },
      },
      required: ['command'],
    },
  },
  async run(ctx, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const command = strArg(args, 'command')
    const cwdArg = strArg(args, 'cwd')
    const timeout = Math.min(600000, Math.max(1000, intArg(args, 'timeout', BASH_TIMEOUT_MS)))

    if (!command) return { ok: false, output: '', error: '缺少参数：command' }

    const cwd = cwdArg ? path.resolve(ctx.cwd, cwdArg) : ctx.cwd

    // 安全校验：cwd 必须在工作区内
    if (cwd !== ctx.cwd && !cwd.startsWith(ctx.cwd + path.sep)) {
      return { ok: false, output: '', error: 'cwd 超出工作区' }
    }

    // Windows 下使用 cmd.exe /c，Unix 下使用 bash -c
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
    const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command]

    try {
      const { stdout, stderr } = await execP(command, {
        cwd,
        timeout,
        maxBuffer: BASH_MAX_BUFFER,
        windowsHide: true,
        shell,
      })

      let out = stdout
      if (stderr.trim()) {
        out = out + (out ? '\n' : '') + `[stderr] ${stderr.trim()}`
      }
      return { ok: true, output: truncate(out, MAX_OUTPUT_CHARS) }
    } catch (e) {
      const err = e as ExecFailure
      let detail = err.message ?? errMessage(e)
      if (err.killed) {
        detail = `命令超时（${timeout / 1000} 秒）：${detail}`
      }
      if (err.signal) {
        detail = `命令被信号终止（${err.signal}）：${detail}`
      }
      if (typeof err.stderr === 'string' && err.stderr.trim()) {
        detail = detail + '\n[stderr] ' + err.stderr.trim()
      }
      if (typeof err.stdout === 'string' && err.stdout.trim()) {
        detail = detail + '\n[stdout] ' + err.stdout.trim()
      }
      return { ok: false, output: '', error: truncate(detail, MAX_OUTPUT_CHARS) }
    }
  },
}