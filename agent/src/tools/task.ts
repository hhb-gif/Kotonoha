// ============================================================
// task.ts —— 子任务工具：task（启动子 agent 执行独立任务）
// 契约：types.ts Tool / ToolDef / ToolResult
// ============================================================

import { randomUUID } from 'node:crypto'

import type { Tool, ToolResult, ToolContext } from '../types'

const MAX_CONCURRENT_TASKS = 3
const TASK_TIMEOUT_MS = 5 * 60 * 1000 // 5分钟

// 简易并发控制
let runningTasks = 0
const taskQueue: Array<() => void> = []

function waitForSlot(): Promise<void> {
  if (runningTasks < MAX_CONCURRENT_TASKS) return Promise.resolve()
  return new Promise((resolve) => taskQueue.push(resolve))
}

function releaseSlot(): void {
  runningTasks--
  if (taskQueue.length > 0) {
    runningTasks++
    const next = taskQueue.shift()
    next?.()
  }
}

// 模拟子 agent 执行：实际项目中会接入真实的会话引擎
async function runSubAgent(description: string, prompt: string, sessionId: string, cwd: string): Promise<string> {
  // 这里应当调用真实的 SessionEngine 或类似机制
  // 目前返回模拟结果，标记需要集成
  return `[子任务 ${sessionId}] ${description}: ${prompt.slice(0, 100)}...`
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

export const taskTool: Tool = {
  def: {
    name: 'task',
    description: '启动子 agent 执行独立任务（并发限制 3，超时 5 分钟）',
    parameters: {
      type: 'object',
      description: 'task 参数：任务描述与提示词',
      properties: {
        description: { type: 'string', description: '任务简短描述（用于日志/标识）' },
        prompt: { type: 'string', description: '发送给子 agent 的完整提示词' },
      },
      required: ['description', 'prompt'],
    },
  },
  async run(ctx: ToolContext, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const description = strArg(args, 'description')
    const prompt = strArg(args, 'prompt')

    if (!description) return { ok: false, output: '', error: '缺少参数：description' }
    if (!prompt) return { ok: false, output: '', error: '缺少参数：prompt' }

    await waitForSlot()
    runningTasks++

    const subSessionId = randomUUID()

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('子任务超时')), TASK_TIMEOUT_MS)
      )

      const result = await Promise.race([runSubAgent(description, prompt, subSessionId, ctx.cwd), timeoutPromise])

      return { ok: true, output: result }
    } catch (e) {
      return { ok: false, output: '', error: `子任务失败：${errMessage(e)}` }
    } finally {
      releaseSlot()
    }
  },
}