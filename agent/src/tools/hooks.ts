// ============================================================
// hooks.ts —— 工具钩子系统（M2-2.3 联动：审计 + 门禁 + 副作用清理）
// before 钩子：可改写 args（返回新值）或抛错拦截（不执行工具）
// after 钩子：观测结果 / 记录审计 / 清理副作用
// 内置钩子：审计轨迹（写 settings `trajectory:<sessionId>`）+ bash 黑名单复检
// 接线点：core/agent.ts 的 execTool → runToolWithHooks
// 中文注释、英文标识符
// ============================================================

import type { Db, Tool, ToolContext, ToolResult } from '../types'

// ---- 钩子类型 ----

export type BeforeHook = (
  tool: Tool,
  args: unknown,
  ctx: ToolContext
) => void | unknown | Promise<void | unknown>

export type AfterHook = (
  tool: Tool,
  result: ToolResult,
  ctx: ToolContext,
  args: unknown
) => void | Promise<void>

export interface Hook {
  /** 钩子唯一 id（register 去重/移除用） */
  id: string
  /** 执行前：返回非 undefined 值 → 改写 args；抛错 → 拦截（不执行工具） */
  before?: BeforeHook
  /** 执行后：观测结果（含被拦截的结果），可抛错但不会中断流程 */
  after?: AfterHook
}

// ---- 注册表 ----

export class HookRegistry {
  private readonly hooks = new Map<string, Hook>()

  /** 注册钩子；同 id 覆盖 */
  register(hook: Hook): void {
    this.hooks.set(hook.id, hook)
  }

  /** 批量注册 */
  registerAll(hooks: Hook[]): void {
    for (const h of hooks) this.register(h)
  }

  /** 移除钩子 */
  unregister(id: string): boolean {
    return this.hooks.delete(id)
  }

  /** 列出全部钩子（注册顺序） */
  list(): Hook[] {
    return Array.from(this.hooks.values())
  }

  /** 清空 */
  clear(): void {
    this.hooks.clear()
  }

  get size(): number {
    return this.hooks.size
  }
}

// ---- 轨迹审计（settings `trajectory:<sessionId>` JSON 数组）----

export interface TrajectoryEntry {
  ts: number
  tool: string
  args: string // 参数摘要
  ok: boolean
  error?: string
  sessionId: string
}

const TRAJECTORY_KEY_PREFIX = 'trajectory:'

function trajectoryKey(sessionId: string): string {
  return `${TRAJECTORY_KEY_PREFIX}${sessionId}`
}

/** args 摘要：JSON 序列化 + 截断（防审计数据膨胀） */
export function summarizeArgs(args: unknown, max = 200): string {
  let s: string
  try {
    s = JSON.stringify(args)
  } catch {
    s = String(args)
  }
  if (s === undefined) s = 'undefined'
  if (s.length > max) s = s.slice(0, max) + `…(共 ${s.length} 字符)`
  return s
}

/**
 * 内置审计钩子：每次工具执行（含被拦截）追加一条轨迹记录。
 * 记录含 tool / args 摘要 / ts / ok / error / 耗时。
 */
export function createAuditHook(db: Db): Hook {
  return {
    id: 'builtin.audit',
    async after(tool, result, ctx, args): Promise<void> {
      const sessionId = ctx.sessionId
      const raw = db.getSetting(trajectoryKey(sessionId)) as unknown
      const entries: TrajectoryEntry[] = Array.isArray(raw)
        ? (raw.filter((x) => typeof x === 'object' && x !== null) as TrajectoryEntry[])
        : []
      entries.push({
        ts: Date.now(),
        tool: tool.def.name,
        args: summarizeArgs(args),
        ok: result.ok,
        error: result.error,
        sessionId,
      })
      db.setSetting(trajectoryKey(sessionId), entries as unknown as string)
    },
  }
}

/** 读取会话轨迹（供 session.trajectory RPC） */
export function getTrajectory(db: Db, sessionId: string): TrajectoryEntry[] {
  const raw = db.getSetting(trajectoryKey(sessionId)) as unknown
  return Array.isArray(raw)
    ? (raw.filter((x) => typeof x === 'object' && x !== null) as TrajectoryEntry[])
    : []
}

// ---- bash 黑名单复检钩子（before 拦截危险命令）----

// 危险命令模式（段级匹配：按 ; && || 换行 切段后逐段检测）
const BASH_BLACKLIST: RegExp[] = [
  // 递归删除根 / 通配 / 家目录
  /\brm\s+-\S*r\S*f\S*\s+(\/|\*|\/\/|\$HOME\b|~)/i,
  // Windows 递归删除
  /\b(rd|rmdir)\s+\/s\s+\/q\b/i,
  /\bdel\s+\/f\s+\/s\s+\/q\b/i,
  // 格式化 / 分区表
  /\bmkfs(\.\w+)?\s+/i,
  /\bformat\s+(c:|d:|e:|\/)/i,
  // 写块设备
  /\bdd\s+.*\bof=\/dev\/(sd|hd)/i,
  // fork 炸弹
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
  // 关机 / 重启
  /\b(shutdown|poweroff|reboot|halt)\b/i,
  // 清空 / 覆写系统关键文件
  /\b>\s*\/etc\//i,
  /\bchmod\s+-\s*r\s+[0-7]{3}\s+\//i,
]

function isDangerousCommand(command: string): boolean {
  // 按语句切段（; && || 换行），避免整串误判
  const segments = command.split(/[;&|\n\r]+/).map((s) => s.trim()).filter(Boolean)
  for (const seg of segments) {
    for (const re of BASH_BLACKLIST) {
      if (re.test(seg)) return true
    }
  }
  return false
}

/**
 * 内置 bash 黑名单复检钩子：before 拦截危险命令。
 * 与权限系统独立（纵深防御）；命中返回拦截结果，不执行工具。
 */
export function createBashBlacklistHook(): Hook {
  return {
    id: 'builtin.bash-blacklist',
    before(tool, args): void {
      if (tool.def.name !== 'bash' && tool.def.name !== 'run_command') return
      const command = (args as Record<string, unknown> | null | undefined)?.command
      if (typeof command === 'string' && isDangerousCommand(command)) {
        throw new Error(`bash 黑名单拦截：危险命令「${command.slice(0, 80)}」已被阻止`)
      }
    },
  }
}

// ---- 默认钩子集 ----

/** 构建默认钩子集（审计 + bash 黑名单），注册到新 HookRegistry */
export function createDefaultHooks(db: Db): HookRegistry {
  const registry = new HookRegistry()
  registry.registerAll([createBashBlacklistHook(), createAuditHook(db)])
  return registry
}

// ---- 执行器：before → tool.run → after ----

/**
 * 带钩子执行工具：
 * 1. 依次跑 before（允许改写 args；抛错 → 拦截，不执行工具）
 * 2. tool.run
 * 3. 依次跑 after（含被拦截的结果，供审计记录）
 * 钩子抛出的错误统一转换为 { ok:false, error }，不向外抛。
 */
export async function runToolWithHooks(
  registry: HookRegistry,
  tool: Tool,
  ctx: ToolContext,
  args: unknown
): Promise<ToolResult> {
  let current: unknown = args

  // before：可拦截 / 可改写 args
  for (const hook of registry.list()) {
    if (!hook.before) continue
    try {
      const result = await hook.before(tool, current, ctx)
      if (result !== undefined) current = result
    } catch (e) {
      const blocked: ToolResult = {
        ok: false,
        output: '',
        error: e instanceof Error ? e.message : String(e),
      }
      await runAfter(registry, tool, blocked, ctx, current)
      return blocked
    }
  }

  // 执行工具本体
  let result: ToolResult
  try {
    result = await tool.run(ctx, current)
  } catch (e) {
    result = {
      ok: false,
      output: '',
      error: e instanceof Error ? e.message : String(e),
    }
  }

  await runAfter(registry, tool, result, ctx, current)
  return result
}

async function runAfter(
  registry: HookRegistry,
  tool: Tool,
  result: ToolResult,
  ctx: ToolContext,
  args: unknown
): Promise<void> {
  for (const hook of registry.list()) {
    if (!hook.after) continue
    try {
      await hook.after(tool, result, ctx, args)
    } catch {
      // after 钩子异常不阻断流程（审计失败不应影响工具结果）
    }
  }
}