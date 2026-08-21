// ============================================================
// terminal.ts —— 终端工具：run_command（危险命令黑名单 + 超时）
// 契约：types.ts Tool / ToolDef / ToolResult
// ============================================================

import { exec } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'

import type { Tool, ToolResult } from '../types'

const execP = promisify(exec)

const CMD_TIMEOUT_MS = 60 * 1000
const CMD_MAX_BUFFER = 1024 * 1024
const MAX_OUTPUT_CHARS = 32 * 1024

// 危险命令黑名单（小写化后子串匹配）
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'rm -rf ~',
  'format ',
  'del /s',
  'shutdown',
  'reboot',
  'mkfs',
  ':{(',
]

function isDangerous(command: string): boolean {
  const lower = command.toLowerCase()
  return DANGEROUS_PATTERNS.some((p) => lower.includes(p))
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `...(已截断，共 ${s.length} 字符)` : s
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

interface ExecFailure {
  message?: string
  stdout?: string
  stderr?: string
  killed?: boolean
}

export const runCommandTool: Tool = {
  def: {
    name: 'run_command',
    description:
      '在工作区（或其子目录）执行终端命令，60 秒超时；危险命令（删除系统目录/格式化/关机/重启等）会被拦截',
    parameters: {
      type: 'object',
      description: 'run_command 参数：要执行的命令与可选工作目录',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        cwd: { type: 'string', description: '相对工作区的子目录（可选，默认工作区根）' },
      },
      required: ['command'],
    },
  },
  async run(ctx, rawArgs): Promise<ToolResult> {
    const args = rawArgs as Record<string, unknown>
    const command = typeof args.command === 'string' ? args.command : undefined
    if (!command) return { ok: false, output: '', error: '缺少参数：command' }
    if (isDangerous(command)) {
      return { ok: false, output: '', error: '命令被拒绝：命中危险命令黑名单' }
    }

    const cwd =
      typeof args.cwd === 'string' && args.cwd ? path.resolve(ctx.cwd, args.cwd) : ctx.cwd

    try {
      const { stdout, stderr } = await execP(command, {
        cwd,
        timeout: CMD_TIMEOUT_MS,
        maxBuffer: CMD_MAX_BUFFER,
        windowsHide: true,
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
        detail = `命令超时（${CMD_TIMEOUT_MS / 1000} 秒）：${detail}`
      }
      if (typeof err.stderr === 'string' && err.stderr.trim()) {
        detail = detail + '\n[stderr] ' + err.stderr.trim()
      }
      return { ok: false, output: '', error: truncate(detail, MAX_OUTPUT_CHARS) }
    }
  },
}