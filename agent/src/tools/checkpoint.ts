// ============================================================
// checkpoint.ts —— Git checkpoint：工具执行前自动 commit（git 即 undo）
// 契约：types.ts ToolContext / ToolResult
// ============================================================

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

import type { ToolContext, ToolResult } from '../types'

const execP = promisify(exec)

const CHECKPOINT_PREFIX = 'kotonoha: checkpoint before '
const UNDO_PREFIX = 'kotonoha: undo '
const GIT_TIMEOUT_MS = 30 * 1000
const GIT_MAX_BUFFER = 1024 * 1024

interface GitExecResult {
  stdout: string
  stderr: string
}

async function gitExec(cwd: string, command: string): Promise<GitExecResult> {
  const { stdout, stderr } = await execP(command, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  })
  return { stdout, stderr }
}

function isGitRepo(cwd: string): Promise<boolean> {
  return fs
    .access(path.join(cwd, '.git'))
    .then(() => true)
    .catch(() => false)
}

function hasUncommittedChanges(stdout: string): boolean {
  return stdout.trim().length > 0
}

function isKotonohaCheckpointCommit(message: string): boolean {
  return message.startsWith(CHECKPOINT_PREFIX) || message.startsWith(UNDO_PREFIX)
}

/**
 * 确保在工具执行前创建 checkpoint
 * - 若目录是 git 仓库且有未提交改动 → 自动 `git add -A && git commit -m "kotonoha: checkpoint before <tool>"`
 * - 非 git 目录 → 返回 {ok:false, reason:'not-git'}，降级为无 checkpoint
 * - 无改动 → 返回 {ok:true, reason:'no-changes'}，不创建空 commit
 */
export async function ensureCheckpoint(cwd: string, toolName: string): Promise<CheckpointResult> {
  const isRepo = await isGitRepo(cwd)
  if (!isRepo) {
    return { ok: false, reason: 'not-git', commitHash: null }
  }

  // 检查是否有未提交改动
  const status = await gitExec(cwd, 'git status --porcelain')
  if (!hasUncommittedChanges(status.stdout)) {
    return { ok: true, reason: 'no-changes', commitHash: null }
  }

  // 创建 checkpoint commit
  const message = `${CHECKPOINT_PREFIX}${toolName}`
  const safeMsg = message.replace(/"/g, '\\"')
  try {
    await gitExec(cwd, `git add -A && git commit -m "${safeMsg}"`)
    // 获取刚创建的 commit hash
    const log = await gitExec(cwd, 'git rev-parse HEAD')
    return { ok: true, reason: 'checkpoint-created', commitHash: log.stdout.trim() }
  } catch (e) {
    const err = e as Error
    return { ok: false, reason: 'commit-failed', commitHash: null, error: err.message }
  }
}

/**
 * 撤销最后一个 kotonoha checkpoint
 * - 仅对 kotonoha 自己的 checkpoint commit 生效（检查 commit message 前缀）
 * - `git reset --hard HEAD~1` 恢复工作区
 */
export async function undoLast(cwd: string): Promise<UndoResult> {
  const isRepo = await isGitRepo(cwd)
  if (!isRepo) {
    return { ok: false, reason: 'not-git' }
  }

  // 检查最新 commit 是否为 kotonoha checkpoint
  const log = await gitExec(cwd, 'git log -1 --pretty=format:%s')
  const lastMessage = log.stdout.trim()

  if (!isKotonohaCheckpointCommit(lastMessage)) {
    return { ok: false, reason: 'not-kotonoha-checkpoint', lastCommitMessage: lastMessage }
  }

  try {
    await gitExec(cwd, 'git reset --hard HEAD~1')
    return { ok: true, reason: 'undone', restoredCommit: lastMessage }
  } catch (e) {
    const err = e as Error
    return { ok: false, reason: 'reset-failed', error: err.message }
  }
}

/**
 * 获取当前分支最近的 kotonoha checkpoint 列表（用于调试/UI）
 */
export async function listCheckpoints(cwd: string, limit = 10): Promise<CheckpointInfo[]> {
  const isRepo = await isGitRepo(cwd)
  if (!isRepo) return []

  const log = await gitExec(cwd, `git log --oneline -n ${limit * 3}`)
  const lines = log.stdout.trim().split('\n').filter(Boolean)

  const checkpoints: CheckpointInfo[] = []
  for (const line of lines) {
    const [hash, ...msgParts] = line.split(' ')
    const message = msgParts.join(' ')
    if (isKotonohaCheckpointCommit(message)) {
      checkpoints.push({ hash, message, isUndo: message.startsWith(UNDO_PREFIX) })
      if (checkpoints.length >= limit) break
    }
  }
  return checkpoints
}

// ===== 结果类型 =====

export interface CheckpointResult {
  ok: boolean
  reason: 'not-git' | 'no-changes' | 'checkpoint-created' | 'commit-failed'
  commitHash: string | null
  error?: string
}

export interface UndoResult {
  ok: boolean
  reason: 'not-git' | 'not-kotonoha-checkpoint' | 'undone' | 'reset-failed'
  lastCommitMessage?: string
  restoredCommit?: string
  error?: string
}

export interface CheckpointInfo {
  hash: string
  message: string
  isUndo: boolean
}

// ===== 内置工具定义（供注册表使用）=====

import type { Tool, ToolDef } from '../types'
import type { ExtendedTool } from './protocol'
import { createExtendedTool } from './protocol'

const CHECKPOINT_TOOL_DEF: ToolDef = {
  name: 'kotonoha_checkpoint',
  description: '手动创建 Git checkpoint（git add -A && git commit），供模型在关键节点调用',
  parameters: {
    type: 'object',
    description: 'kotonoha_checkpoint 参数：可选的工具名标识',
    properties: {
      tool: { type: 'string', description: '关联的工具名（用于 commit message）' },
    },
    required: [],
  },
}

const UNDO_TOOL_DEF: ToolDef = {
  name: 'kotonoha_undo',
  description: '撤销最近一次 kotonoha checkpoint（git reset --hard HEAD~1），仅对 kotonoha 自身创建的 checkpoint 生效',
  parameters: {
    type: 'object',
    description: 'kotonoha_undo 无参数',
    properties: {},
    required: [],
  },
}

export const kotonohaCheckpointTool: ExtendedTool = createExtendedTool(
  {
    def: CHECKPOINT_TOOL_DEF,
    async run(ctx: ToolContext, rawArgs: unknown): Promise<ToolResult> {
      const args = rawArgs as Record<string, unknown>
      const toolName = typeof args.tool === 'string' ? args.tool : 'manual'
      const result = await ensureCheckpoint(ctx.cwd, toolName)

      if (!result.ok) {
        if (result.reason === 'not-git') {
          return { ok: true, output: '非 git 仓库，跳过 checkpoint' }
        }
        if (result.reason === 'no-changes') {
          return { ok: true, output: '无未提交改动，无需 checkpoint' }
        }
        return { ok: false, output: '', error: `创建 checkpoint 失败：${result.reason}` }
      }

      return { ok: true, output: `Checkpoint 已创建：${result.commitHash}` }
    },
  },
  { group: 'checkpoint', readOnly: false }
)

export const kotonohaUndoTool: ExtendedTool = createExtendedTool(
  {
    def: UNDO_TOOL_DEF,
    async run(ctx: ToolContext): Promise<ToolResult> {
      const result = await undoLast(ctx.cwd)

      if (!result.ok) {
        if (result.reason === 'not-git') {
          return { ok: false, output: '', error: '非 git 仓库，无法 undo' }
        }
        if (result.reason === 'not-kotonoha-checkpoint') {
          return { ok: false, output: '', error: `最近提交非 kotonoha checkpoint：${result.lastCommitMessage}` }
        }
        return { ok: false, output: '', error: `撤销失败：${result.reason}` }
      }

      return { ok: true, output: `已撤销 checkpoint：${result.restoredCommit}` }
    },
  },
  { group: 'checkpoint', readOnly: false }
)

/** 两个 checkpoint 工具数组，供 buildDefaultTools 或手动注册使用 */
export const checkpointTools: ExtendedTool[] = [kotonohaCheckpointTool, kotonohaUndoTool]