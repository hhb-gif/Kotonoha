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
import { buildSystemPrompt, historyToChatMessages } from './context'

// 单轮内待执行的工具调用（ProviderChunk['tool-call'] 的投影）
interface PendingCall {
  id: string
  name: string
  args: string
}

export class TurnRunner {
  private readonly deps: EngineDeps
  private readonly dataDir: string
  private sessionId = ''

  constructor(opts: { deps: EngineDeps; dataDir: string }) {
    this.deps = opts.deps
    this.dataDir = opts.dataDir
  }

  /** 执行一个完整 turn：组装上下文 → 流式生成（可多轮）→ 工具循环 → finish */
  async run(session: SessionRecord, userText: string): Promise<void> {
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

    try {
      // 用户消息落库（进入 try 后：provider 缺失的失败 turn 不污染历史）
      this.deps.db.appendEvent(session.id, {
        type: 'user/message',
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: userText }] },
      })

      // 2. 可迭代多轮：模型可能在文本之后请求工具
      for (;;) {
        let roundText = ''
        const calls: PendingCall[] = []
        let done = false

        for await (const chunk of provider.streamChat({
          model: session.model,
          messages,
          tools: toolDefs,
        })) {
          switch (chunk.kind) {
            case 'text':
              roundText += chunk.text
              assistantText += chunk.text
              this.emitChunk({ type: 'text-delta', text: chunk.text })
              break
            case 'reasoning':
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

        // 本轮有文本或工具调用 → 追加 assistant 消息（含 tool_calls）进上下文
        if (roundText || calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: roundText,
            toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
          })
        }

        // 逐个审批并执行工具调用
        for (const call of calls) {
          const reason = `${call.name}(${call.args.slice(0, 100)})`
          const outcome = await this.deps.approver.request(
            session.id,
            call.name,
            call.id,
            reason
          )
          const result: ToolResult =
            outcome === 'rejected'
              ? { ok: false, output: '', error: '用户拒绝了该工具调用' }
              : await this.execTool(session, call)
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
      // 4. 异常（provider throw / 网络等）：finish error，不落库
      const message = err instanceof Error ? err.message : String(err)
      this.emitChunk({ type: 'finish', reason: { kind: 'error', message } })
    } finally {
      // 5. 刷新 last_active_at
      this.deps.db.updateSession(session.id, {})
    }
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
      return await tool.run(ctx, args)
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