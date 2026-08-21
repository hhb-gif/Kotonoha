// ============================================================
// git.ts —— Git 工具：git_status / git_commit / git_log
// 契约：types.ts Tool / ToolDef / ToolResult
// ============================================================

import { exec } from 'node:child_process'
import { promisify } from 'node:util'

import type { Tool, ToolResult } from '../types'

const execP = promisify(exec)

const GIT_TIMEOUT_MS = 30 * 1000
const GIT_MAX_BUFFER = 1024 * 1024
const MAX_OUTPUT_CHARS = 32 * 1024

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `...(已截断，共 ${s.length} 字符)` : s
}

function isNotGitRepo(stderr: string): boolean {
  return /not a git repository/i.test(stderr)
}

interface ExecFailure {
  message?: string
  stdout?: string
  stderr?: string
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

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

// 公共执行：沙箱内（cwd=ctx.cwd）、30s 超时；非 git 仓库统一报错
async function runGit(command: string, cwd: string): Promise<ToolResult> {
  try {
    const { stdout } = await execP(command, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
    })
    return { ok: true, output: truncate(stdout, MAX_OUTPUT_CHARS) }
  } catch (e) {
    const err = e as ExecFailure
    const stderr = typeof err.stderr === 'string' ? err.stderr : ''
    if (isNotGitRepo(stderr)) return { ok: false, output: '', error: '不是 git 仓库' }
    if (/does not have any commits/i.test(stderr)) {
      return { ok: true, output: '（无提交记录）' }
    }
    return {
      ok: false,
      output: '',
      error: truncate(stderr.trim() || err.message || String(e), MAX_OUTPUT_CHARS),
    }
  }
}

export const gitStatusTool: Tool = {
  def: {
    name: 'git_status',
    description: '查看当前 git 仓库状态（短格式 + 分支信息）',
    parameters: {
      type: 'object',
      description: 'git_status 无参数',
      properties: {},
      required: [],
    },
  },
  async run(ctx): Promise<ToolResult> {
    return runGit('git status --short -b', ctx.cwd)
  },
}

export const gitCommitTool: Tool = {
  def: {
    name: 'git_commit',
    description: '暂存全部改动并提交（git add -A && git commit）；无改动时返回提示',
    parameters: {
      type: 'object',
      description: 'git_commit 参数：提交信息',
      properties: {
        message: { type: 'string', description: '提交信息' },
      },
      required: ['message'],
    },
  },
  async run(ctx, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const message = strArg(args, 'message')
    if (!message) return { ok: false, output: '', error: '缺少参数：message' }

    const safeMsg = message.replace(/"/g, '\\"')
    const cmd = `git add -A && git commit -m "${safeMsg}"`
    try {
      const { stdout } = await execP(cmd, {
        cwd: ctx.cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
      })
      return { ok: true, output: truncate(stdout, MAX_OUTPUT_CHARS) }
    } catch (e) {
      const err = e as ExecFailure
      const stderr = typeof err.stderr === 'string' ? err.stderr : ''
      const stdout = typeof err.stdout === 'string' ? err.stdout : ''
      // 新版 git 把「无改动可提交」输出到 stdout，旧版到 stderr —— 两者都检测
      if (/nothing to commit|no changes added/i.test(stderr + '\n' + stdout)) {
        return { ok: true, output: '无改动可提交' }
      }
      if (isNotGitRepo(stderr)) return { ok: false, output: '', error: '不是 git 仓库' }
      return {
        ok: false,
        output: '',
        error: truncate(stderr.trim() || err.message || String(e), MAX_OUTPUT_CHARS),
      }
    }
  },
}

export const gitLogTool: Tool = {
  def: {
    name: 'git_log',
    description: '查看最近提交历史（--oneline 单行格式）',
    parameters: {
      type: 'object',
      description: 'git_log 参数：查看条数（可选）',
      properties: {
        count: { type: 'integer', description: '显示条数（默认 10，1-100）' },
      },
      required: [],
    },
  },
  async run(ctx, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const count = clampInt(args.count, 10, 1, 100)
    return runGit(`git log --oneline -n ${count}`, ctx.cwd)
  },
}