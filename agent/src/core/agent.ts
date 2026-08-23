// ============================================================
// agent.ts —— Agent Loop：流式生成 → 工具循环 → finish + 落库
// 只负责 assistant/chunk 与 finish 帧；turn/start、turn/end 由 engine 负责
// 中文注释、英文标识符
// ============================================================

import type {
  Chunk,
  ChatMessage,
  EngineDeps,
  SessionEvent,
  SessionRecord,
  ToolResult,
} from '../types'
import type { ExtendedTool } from '../tools/protocol'
import { buildSystemPrompt, historyToChatMessages } from './context'
import { createDefaultHooks, runToolWithHooks, type HookRegistry } from '../tools/hooks'
import { recordCost } from '../store/cost'
import { estimateCost } from '../providers/cost'

// 单轮内待执行的工具调用（ProviderChunk['tool-call'] 的投影）
interface PendingCall {
  id: string
  name: string
  args: string
}

// 中断哨兵错误：abort 时抛出的统一错误（catch 中据此发 finish error 'interrupted'）
class AbortTurnError extends Error {
  constructor() {
    super('interrupted')
  }
}

export class TurnRunner {
  private readonly deps: EngineDeps
  private readonly dataDir: string
  private sessionId = ''
  // 工具钩子注册表（审计轨迹 + bash 黑名单；按 db 惰性初始化）
  private hooks: HookRegistry | null = null

  constructor(opts: { deps: EngineDeps; dataDir: string }) {
    this.deps = opts.deps
    this.dataDir = opts.dataDir
  }

  /** 执行一个完整 turn：组装上下文 → 流式生成（可多轮）→ 工具循环 → finish */
  async run(session: SessionRecord, userText: string, signal?: AbortSignal): Promise<void> {
    this.sessionId = session.id

    // 1. 组装 messages：systemPrompt + 历史 + 当前用户输入
    //    契约允许 deps.systemPrompt 覆盖（如 index 层注入角色卡定制），缺省用 context.ts
    const systemPrompt = this.deps.systemPrompt
      ? this.deps.systemPrompt(session)
      : buildSystemPrompt(session, undefined, this.dataDir)
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyToChatMessages(this.deps.db.readEvents(session.id)),
      { role: 'user', content: userText },
    ]

    const provider = this.deps.providers.get(session.provider)
    if (!provider) {
      throw new Error(`provider 不存在: ${session.provider}`)
    }
    const tools = this.deps.tools.list()
    const toolDefs = tools.length > 0 ? tools.map((t) => t.def) : undefined
    console.log('[agent] run', session.id, 'provider:', session.provider, 'model:', session.model, 'tools:', tools.length)

    // 跨轮累积的完整回复文本（最终落库用；roundText 每轮重置）
    let assistantText = ''
    // 跨轮累积的 token 用量（成本落库用；openai-compat 尾部 usage 累加）
    let turnPromptTokens = 0
    let turnCompletionTokens = 0

    try {
      // 用户消息落库（进入 try 后：provider 缺失的失败 turn 不污染历史）
      this.deps.db.appendEvent(session.id, {
        type: 'user/message',
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: userText }] },
      })

      // 2. 可迭代多轮：模型可能在文本之后请求工具
      for (;;) {
        // 中断检查：abort 后不再发起新的模型请求
        this.throwIfAborted(signal)

        let roundText = ''
        let roundReasoning = ''
        const calls: PendingCall[] = []
        let done = false

        for await (const chunk of provider.streamChat({
          model: session.model,
          messages,
          tools: toolDefs,
          signal,
          thinking: { enabled: true, effort: 'medium' },
          // 流尾 usage 回调：累积本轮 token 用量（供应商不支持时静默不触发）
          onUsage: (u) => {
            turnPromptTokens += u.promptTokens
            turnCompletionTokens += u.completionTokens
          },
        })) {
          // 中断检查：收到任意 chunk 后若已 abort → 立即停止本轮
          this.throwIfAborted(signal)
          switch (chunk.kind) {
            case 'text':
              roundText += chunk.text
              assistantText += chunk.text
              this.emitChunk({ type: 'text-delta', text: chunk.text })
              break
            case 'reasoning':
              roundReasoning += chunk.text
              this.emitChunk({ type: 'reasoning-delta' })
              break
            case 'tool-call':
              calls.push({ id: chunk.id, name: chunk.name, args: chunk.args })
              this.emitChunk({ type: 'tool-call-delta', toolCall: { name: chunk.name } })
              break
            case 'done':
              done = true
              break
          }
        }
        if (!done) {
          // 流在未收到 done 前结束 → 视为异常
          throw new Error('provider 流异常结束（未收到 done）')
        }

        // 本轮无工具调用 → 结束循环
        if (calls.length === 0) break

        // 本轮有文本或工具调用 → 追加 assistant 消息（含 tool_calls + reasoning_content，thinking 模式必需回传）
        if (roundText || calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: roundText,
            toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
            reasoningContent: roundReasoning,
          })
        }

        // 工具调度：只读工具并行执行（默认 allow，免审批），写工具串行审批后执行
        // 结果统一按原始 calls 顺序回填，保证 messages 顺序稳定
        const results = new Map<string, ToolResult>()
        const readOnlyCalls = calls.filter((c) => this.isReadOnly(c.name))
        const writeCalls = calls.filter((c) => !this.isReadOnly(c.name))

        if (readOnlyCalls.length > 0) {
          // Promise.allSettled：单个失败不阻断其它并行调用
          const settled = await Promise.allSettled(
            readOnlyCalls.map((c) => this.execTool(session, c))
          )
          settled.forEach((s, i) => {
            const call = readOnlyCalls[i]
            results.set(
              call.id,
              s.status === 'fulfilled'
                ? s.value
                : { ok: false, output: '', error: '工具执行失败' }
            )
          })
        }

        // 写工具：保持现有审批流程（approver.request 可被 abort 打断）
        for (const call of writeCalls) {
          this.throwIfAborted(signal)
          const reason = `${call.name}(${call.args.slice(0, 100)})`
          const outcome = await this.waitAbortable(
            signal,
            this.deps.approver.request(session.id, call.name, call.id, reason)
          )
          results.set(
            call.id,
            outcome === 'rejected'
              ? { ok: false, output: '', error: '用户拒绝了该工具调用' }
              : await this.execTool(session, call)
          )
        }

        // 按原始调用顺序回填 tool 消息（与 assistant.toolCalls 顺序一致）
        for (const call of calls) {
          const result = results.get(call.id) ?? { ok: false, output: '', error: '工具执行失败' }
          messages.push({ role: 'tool', content: JSON.stringify(result), toolCallId: call.id })
        }
        // 清空本轮累积（roundText/calls 随作用域重置）→ 继续下一轮 streamChat
      }

      // 3. 正常结束：finish stop + 落库 assistant/message
      this.emitChunk({ type: 'finish', reason: { kind: 'stop' } })
      if (assistantText) {
        this.deps.db.appendEvent(session.id, {
          type: 'assistant/message',
          data: {
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: assistantText }],
            },
          },
        })
      }
    } catch (err) {
      // 4. 异常（provider throw / 网络 / 中断等）：finish error，不落库
      //    中断时统一报 'interrupted'（即使底层抛的是网络/流错误）
      const interrupted = signal?.aborted || err instanceof AbortTurnError
      const message = interrupted
        ? 'interrupted'
        : err instanceof Error
          ? err.message
          : String(err)
      this.emitChunk({ type: 'finish', reason: { kind: 'error', message } })
    } finally {
      // 5. 刷新 last_active_at
      this.deps.db.updateSession(session.id, {})
      // 6. 成本落库：本轮有 token 消耗才记录（含异常 turn）
      if (turnPromptTokens > 0 || turnCompletionTokens > 0) {
        try {
          recordCost(this.deps.db, {
            sessionId: session.id,
            providerId: session.provider,
            modelId: session.model,
            promptTokens: turnPromptTokens,
            completionTokens: turnCompletionTokens,
            costUsd: estimateCost(session.provider, session.model, turnPromptTokens, turnCompletionTokens),
          })
        } catch (e) {
          // 成本落库失败不阻断 turn（仅记录告警）
          console.warn('[agent] cost record failed:', (e as Error).message)
        }
      }
    }
  }

  /** 工具是否只读（依据 ExtendedTool.readOnly；未扩展协议字段的工具按写工具处理） */
  private isReadOnly(name: string): boolean {
    const tool = this.deps.tools.get(name)
    if (!tool) return false
    if ('readOnly' in tool && typeof (tool as ExtendedTool).readOnly === 'boolean') {
      return (tool as ExtendedTool).readOnly
    }
    return false
  }

  /** abort 时抛 AbortTurnError；未 abort 时静默通过 */
  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AbortTurnError()
  }

  /** 等待 Promise，但 abort 时立即以 interrupted 结束（用于审批等待可被中断） */
  private waitAbortable<T>(signal: AbortSignal | undefined, p: Promise<T>): Promise<T> {
    if (!signal) return p
    if (signal.aborted) return Promise.reject(new AbortTurnError())
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(new AbortTurnError())
      signal.addEventListener('abort', onAbort, { once: true })
      p.then(
        (v) => {
          signal.removeEventListener('abort', onAbort)
          resolve(v)
        },
        (e) => {
          signal.removeEventListener('abort', onAbort)
          reject(e)
        }
      )
    })
  }

  /** 审批通过后执行单个工具调用；未知工具 / 参数解析失败 / 运行异常 → ok:false */
  private async execTool(session: SessionRecord, call: PendingCall): Promise<ToolResult> {
    const tool = this.deps.tools.get(call.name)
    if (!tool) return { ok: false, output: '', error: '未知工具' }
    const ctx = {
      cwd: session.cwd,
      sessionId: session.id,
      approve: (toolName: string, callId: string, reason: string) =>
        this.deps.approver.request(session.id, toolName, callId, reason),
      emit: (ev: SessionEvent) => this.emit(ev),
    }
    try {
      const args: unknown = JSON.parse(call.args)
      // 经钩子执行：before（bash 黑名单门禁等）→ tool.run → after（审计轨迹落库）
      this.hooks ??= createDefaultHooks(this.deps.db)
      return await runToolWithHooks(this.hooks, tool, ctx, args)
    } catch (err) {
      return {
        ok: false,
        output: '',
        error:
          err instanceof SyntaxError
            ? '参数解析失败'
            : err instanceof Error
              ? err.message
              : '工具执行失败',
      }
    }
  }

  /** 向事件总线广播 assistant 帧（协议格式：session/event 双层包裹） */
  private emit(ev: SessionEvent): void {
    this.deps.broadcast({
      type: 'session/event',
      payload: { type: 'session/event', sessionId: this.sessionId, event: ev },
    })
  }

  private emitChunk(chunk: Chunk): void {
    this.emit({ type: 'assistant/chunk', data: { chunk } })
  }
}