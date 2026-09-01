// ============================================================
// cli.ts —— Kotonoha 终端 CLI 入口（v0.2.4 任务 A）
// 两种模式：chat 单条消息（流式输出后退出）/ repl 交互循环（readline）
// 复用 bootstrap 组装（引擎/db/providers/tools/auth 全套），自建 hub，
// 事件流直接映射到 stdout；审批走终端问询（同进程直调 approver.respond）。
// 不启动 HTTP server，与 server 模式（dist/index.js）互不干扰；
// SQLite WAL 支持多进程，CLI 默认新建自己的会话（label 'CLI'）。
// 中文注释、英文标识符
// ============================================================

import readline from 'node:readline'

import { makeEventHub } from './api/events'
import { bootstrap } from './bootstrap'
import type { ApprovalRequestFrame, OutboundFrame, RpcHandlerContext } from './types'

// ---- ANSI 修饰（简单加色；不支持颜色的终端也只是原样输出转义符，无副作用） ----
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

// ---- CLI 运行状态（渲染器与模式循环共享） ----
interface CliState {
  /** 当前会话 id（渲染器按此过滤事件；/new 时更新指向） */
  sessionId: string
  /** 最近一次 finish 的 kind（chat 模式据此决定退出码） */
  lastFinishKind: string | null
  /** turn 是否进行中（SIGINT 判断：进行中则中断而非退出） */
  turnRunning: boolean
}

// ---- CLI 依赖包（bootstrap 组装结果 + hub） ----
interface CliDeps {
  hub: ReturnType<typeof makeEventHub>
  engine: Awaited<ReturnType<typeof bootstrap>>['engine']
  approver: Awaited<ReturnType<typeof bootstrap>>['approver']
  ops?: RpcHandlerContext['ops']
  healthStop?: () => void
}

// ============================================================
// 参数解析（手写，零依赖）
// ============================================================

interface ParsedArgs {
  mode: 'chat' | 'repl' | 'help'
  message: string
  sessionId?: string
}

function parseArgs(argv: string[]): ParsedArgs {
  let mode: ParsedArgs['mode'] | null = null
  let sessionId: string | undefined
  const messageParts: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h' || a === 'help') {
      mode = 'help'
    } else if (a === 'chat') {
      if (!mode) mode = 'chat'
    } else if (a === 'repl') {
      if (!mode) mode = 'repl'
    } else if (a === '--session') {
      const v = argv[++i]
      if (!v) throw new Error('--session 需要一个会话 id 参数')
      sessionId = v
    } else if (a.startsWith('--session=')) {
      const v = a.slice('--session='.length)
      if (!v) throw new Error('--session 需要一个会话 id 参数')
      sessionId = v
    } else if (a.startsWith('-')) {
      throw new Error(`未知选项: ${a}（node dist/cli.js --help 查看用法）`)
    } else {
      messageParts.push(a)
    }
  }

  const message = messageParts.join(' ').trim()
  if (!mode) {
    // 未显式给命令：有消息文本 → 视为 chat；否则显示帮助
    mode = message ? 'chat' : 'help'
  }
  if (mode === 'chat' && !message) {
    throw new Error('chat 模式需要一条消息：node dist/cli.js chat "消息"')
  }
  return { mode, message, sessionId }
}

function printHelp(): void {
  console.log(`Kotonoha CLI —— 终端形态（chat 单条 / repl 交互）

用法:
  node dist/cli.js chat "消息"     单条模式：新建会话 → 发送 → 流式输出 → 退出
  node dist/cli.js repl            交互模式：readline 循环对话
  node dist/cli.js "消息"          等价于 chat（省略命令时按 chat 处理）
  node dist/cli.js --help          显示本帮助

选项:
  --session <id>                   复用已有会话（缺省每次新建，label 为 CLI）

repl 内置命令:
  /exit                            退出 repl
  /new                             新建会话
  /tools                           列出可用工具
  /help                            显示 repl 帮助

说明:
  CLI 为独立进程（独立事件流 hub），不启动 HTTP server；
  与 server 模式（node dist/index.js）可同时运行，互不影响。`)
}

// ============================================================
// 通用工具
// ============================================================

/** readline question 包装为 Promise（stdin 关闭时以空串结算，避免悬挂）——审批问询用 */
function ask(rl: readline.Interface, promptText: string): Promise<string> {
  return new Promise((resolve) => {
    let done = false
    const finish = (answer: string) => {
      if (done) return
      done = true
      rl.removeListener('close', onClose)
      resolve(answer)
    }
    const onClose = () => finish('')
    rl.on('close', onClose)
    try {
      rl.question(promptText, (answer) => finish(answer))
    } catch {
      // readline 已关闭（如管道输入已耗尽）→ 视为空输入结算，不悬挂
      finish('')
    }
  })
}

/**
 * 行队列（repl 主循环用）：缓存「turn 进行中 / 无问询挂起时」到达的输入行，
 * 下一次取行时按 FIFO 消费。管道输入（全部一次性到达）与交互式提前输入均可保留。
 * 与 ask()（rl.question）共存：Node readline 内部在问询挂起时把行给问询回调、
 * 不发 'line' 事件，两条通道互不抢占。
 */
function makeLineQueue(rl: readline.Interface): {
  next(): Promise<string>
  isClosed(): boolean
} {
  const queue: string[] = []
  let notify: (() => void) | null = null
  let closed = false
  rl.on('line', (line: string) => {
    queue.push(line)
    const n = notify
    notify = null
    n?.()
  })
  rl.on('close', () => {
    closed = true
    const n = notify
    notify = null
    n?.()
  })
  return {
    next() {
      if (queue.length > 0) return Promise.resolve(queue.shift()!)
      if (closed) return Promise.resolve('')
      return new Promise<string>((resolve) => {
        notify = () => resolve(queue.length > 0 ? queue.shift()! : '')
      })
    },
    isClosed: () => closed,
  }
}

/** 解析会话：--session 复用已有（不存在则报错），缺省新建（label 'CLI'，cwd=当前目录） */
function resolveSession(deps: CliDeps, reuseId?: string): string {
  if (reuseId) {
    const found = deps.engine.list().find((s) => s.id === reuseId)
    if (!found) throw new Error(`会话不存在: ${reuseId}`)
    return found.id
  }
  const rec = deps.engine.create(process.cwd())
  deps.engine.rename(rec.id, 'CLI') // 标记为 CLI 会话（与 server 活跃会话区分）
  return rec.id
}

/** 等待 stdout 缓冲排空（管道输出为异步写，避免 process.exit 截断尾部） */
function flushStdout(): Promise<void> {
  return new Promise((resolve) => {
    if (process.stdout.writableLength === 0) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, 50) // 兜底：stdout 异常时也不至于卡死
    timer.unref?.()
    process.stdout.once('drain', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

// ============================================================
// 渲染器：hub 事件 → stdout（按 sessionId 过滤，只渲染当前会话）
// ============================================================

// ---- 情绪标签显示过滤（流式分片可能把 [emotion:xxx] 拆到多个 text-delta） ----
// 约定：模型回复末尾附一行情绪标签；引擎落库时已剥离（extractEmotion），
// CLI 渲染同样剥离——策略是尾部暂存，finish 时确认是标签则丢弃、否则原样补写
const EMOTION_TAG_RE = /\[emotion:(happy|sad|thinking|love|angry|surprise|neutral)\]\s*$/i
const EMOTION_CANDIDATES = ['happy', 'sad', 'thinking', 'love', 'angry', 'surprise', 'neutral'].flatMap(
  (e) => [`\n[emotion:${e}]`, `[emotion:${e}]`]
)

/** 计算尾部需暂存的长度：完整标签，或可能是被分片拆开的标签前缀 */
function emotionHoldbackLen(tail: string): number {
  if (EMOTION_TAG_RE.test(tail)) {
    return (tail.match(EMOTION_TAG_RE) as RegExpMatchArray)[0].length
  }
  const maxLen = EMOTION_CANDIDATES.reduce((m, c) => Math.max(m, c.length), 0)
  const window = tail.slice(Math.max(0, tail.length - maxLen))
  for (let len = window.length; len > 0; len--) {
    const suffix = window.slice(window.length - len)
    if (EMOTION_CANDIDATES.some((c) => c.startsWith(suffix))) return len
  }
  return 0
}

/** 渲染器持有的尾部缓冲（当前会话 text-delta 用） */
interface TailBuffer {
  buf: string
}

/** text-delta 写入：先吐出可确认安全的部分，暂存疑似标签的尾部 */
function tailWrite(tail: TailBuffer, text: string): void {
  tail.buf += text
  const hold = emotionHoldbackLen(tail.buf)
  if (tail.buf.length > hold) {
    process.stdout.write(tail.buf.slice(0, tail.buf.length - hold))
    tail.buf = tail.buf.slice(tail.buf.length - hold)
  }
}

/** 冲刷尾部缓冲：dropTag=true（turn 结束）时剥离确认的情绪标签 */
function tailFlush(tail: TailBuffer, dropTag: boolean): void {
  if (!tail.buf) return
  if (dropTag) {
    const m = tail.buf.match(EMOTION_TAG_RE)
    if (m) tail.buf = tail.buf.slice(0, tail.buf.length - m[0].length)
  }
  if (tail.buf) process.stdout.write(tail.buf)
  tail.buf = ''
}

function attachRenderer(
  hub: CliDeps['hub'],
  opts: {
    state: CliState
    askApproval: (frame: ApprovalRequestFrame) => void
    onTurnEnd: () => void
  }
): void {
  const tail: TailBuffer = { buf: '' }

  hub.attach((frame: OutboundFrame) => {
    // server-request 帧：审批问询（只处理当前会话）
    if (frame.type === 'server-request') {
      if (frame.method === 'approval/requested' && frame.payload.sessionId === opts.state.sessionId) {
        opts.askApproval(frame)
      }
      return
    }

    const payload = frame.payload
    if (payload.sessionId !== opts.state.sessionId) return // 只渲染当前会话
    const event = payload.event

    switch (event.type) {
      case 'turn/start':
        opts.state.turnRunning = true
        break

      case 'assistant/chunk': {
        const chunk = event.data.chunk
        switch (chunk.type) {
          case 'text-delta':
            tailWrite(tail, chunk.text) // 直接写，不换行（尾部标签缓冲见上）
            break
          case 'tool-call-delta':
            tailFlush(tail, false) // 先冲刷暂存（保持输出顺序），再打工具行
            process.stdout.write(`\n${DIM}[tool] ${chunk.toolCall.name}${RESET}\n`)
            break
          case 'finish':
            tailFlush(tail, true) // turn 结束：剥离情绪标签后补写残余
            opts.state.lastFinishKind = chunk.reason.kind
            if (chunk.reason.kind === 'stop') {
              process.stdout.write('\n')
            } else if (chunk.reason.kind === 'error') {
              process.stdout.write(`\n${RED}[error] ${chunk.reason.message ?? '未知错误'}${RESET}\n`)
            } else if (chunk.reason.kind === 'degraded') {
              process.stdout.write(`\n${DIM}[degraded] ${chunk.reason.from} → ${chunk.reason.to}${RESET}\n`)
            }
            // tool-calls：turn 还会继续（下一轮流式输出接在原处），不额外换行
            break
          default:
            // reasoning-delta / emotion-change：忽略
            break
        }
        break
      }

      case 'turn/end':
        opts.state.turnRunning = false
        opts.onTurnEnd()
        break
    }
  })
}

// ============================================================
// 审批问询：终端 Y/n（同进程直调 approver.respond，不走 HTTP）
// ============================================================

async function askApproval(
  rl: readline.Interface,
  deps: Pick<CliDeps, 'approver'>,
  frame: ApprovalRequestFrame
): Promise<void> {
  const { rpcId, payload } = frame
  const summary = payload.reason || payload.toolName // reason 已含 "tool(args摘要)"

  let outcome: 'allowed-once' | 'rejected' = 'allowed-once'
  let answered = false
  // Y/n 以外的输入重问，最多 3 次，最终默认 Y
  for (let attempt = 1; attempt <= 3 && !answered; attempt++) {
    const answer = (await ask(rl, `[审批] ${summary} 允许？(Y/n) `)).trim().toLowerCase()
    if (answer === '' || answer === 'y' || answer === 'yes') {
      outcome = 'allowed-once'
      answered = true
    } else if (answer === 'n' || answer === 'no') {
      outcome = 'rejected'
      answered = true
    } else {
      process.stdout.write(`${DIM}无效输入（Y/回车=允许，n=拒绝），请重新回答${RESET}\n`)
    }
  }
  deps.approver.respond(rpcId, outcome)
}

// ============================================================
// chat 模式：单条消息 → 流式输出 → 退出
// ============================================================

async function runChat(parsed: ParsedArgs, deps: CliDeps): Promise<number> {
  const state: CliState = {
    sessionId: resolveSession(deps, parsed.sessionId),
    lastFinishKind: null,
    turnRunning: false,
  }

  // 审批问询用 readline：仅 stdin 为 TTY 时可交互确认，否则自动拒绝（安全默认）
  let approvalRl: readline.Interface | null = null
  const interactive = Boolean(process.stdin.isTTY)
  if (interactive) {
    approvalRl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  }

  let turnEndResolve: (() => void) | null = null
  const turnEndPromise = new Promise<void>((resolve) => {
    turnEndResolve = resolve
  })

  attachRenderer(deps.hub, {
    state,
    askApproval: (frame) => {
      if (!approvalRl) {
        // 非交互 stdin：无法确认 → 自动拒绝（防止挂起/误放行）
        process.stdout.write(`${DIM}[审批] 非交互终端，已自动拒绝 ${frame.payload.toolName}${RESET}\n`)
        deps.approver.respond(frame.rpcId, 'rejected')
        return
      }
      void askApproval(approvalRl, deps, frame)
    },
    onTurnEnd: () => turnEndResolve?.(),
  })

  // 先注册 turnEnd 等待，再触发 turn（避免 turn/end 早于监听注册）
  deps.engine.prompt(state.sessionId, parsed.message)
  await turnEndPromise

  approvalRl?.close()
  await flushStdout()
  return state.lastFinishKind === 'error' ? 1 : 0
}

// ============================================================
// repl 模式：readline 交互循环
// ============================================================

function printReplHelp(): void {
  console.log(`repl 命令:
  /exit    退出
  /new     新建会话
  /tools   列出可用工具
  /help    显示本帮助
其他输入将作为消息发送给言叶。`)
}

async function runRepl(parsed: ParsedArgs, deps: CliDeps): Promise<number> {
  const state: CliState = {
    sessionId: resolveSession(deps, parsed.sessionId),
    lastFinishKind: null,
    turnRunning: false,
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  let turnEndResolve: (() => void) | null = null
  const waitTurnEnd = (): Promise<void> =>
    new Promise<void>((resolve) => {
      turnEndResolve = resolve
    })

  attachRenderer(deps.hub, {
    state,
    askApproval: (frame) => {
      void askApproval(rl, deps, frame)
    },
    onTurnEnd: () => turnEndResolve?.(),
  })

  // Ctrl+C：turn 进行中 → 中断当前轮；空闲 → 退出 repl
  rl.on('SIGINT', () => {
    if (state.turnRunning) {
      deps.engine.interrupt(state.sessionId)
      process.stdout.write(`\n${DIM}（已中断当前对话轮）${RESET}\n`)
    } else {
      rl.close()
      process.stdout.write('\n再见\n')
      void flushStdout().then(() => process.exit(0))
    }
  })

  console.log(`${DIM}Kotonoha REPL —— 直接输入开始对话，/help 查看命令，/exit 退出${RESET}`)

  const nextLine = makeLineQueue(rl)

  while (true) {
    process.stdout.write('你> ') // 手写提示符（行队列不经 rl.question）
    const line = await nextLine.next()
    if (line === '' && nextLine.isClosed()) break // stdin 结束（Ctrl+D / 管道结束）→ 视同 /exit
    const text = line.trim()
    if (text === '') continue

    if (text === '/exit' || text === '/quit' || text === '/q') break

    if (text === '/new') {
      const rec = deps.engine.create(process.cwd())
      deps.engine.rename(rec.id, 'CLI')
      state.sessionId = rec.id
      console.log(`${DIM}已新建会话 ${rec.id}${RESET}`)
      continue
    }

    if (text === '/tools') {
      const tools = deps.ops?.listTools() ?? []
      if (tools.length === 0) {
        console.log(`${DIM}（无可用工具）${RESET}`)
      } else {
        for (const t of tools) console.log(`${DIM}${t.name}${RESET}  ${t.description}`)
        console.log(`${DIM}共 ${tools.length} 个工具${RESET}`)
      }
      continue
    }

    if (text === '/help') {
      printReplHelp()
      continue
    }

    if (text.startsWith('/')) {
      console.log(`未知命令 ${text.split(/\s+/)[0]}（输入 /help 查看可用命令）`)
      continue
    }

    // 普通消息 → 发送并等待 turn 结束（流式输出由渲染器完成）
    const waiter = waitTurnEnd()
    try {
      deps.engine.prompt(state.sessionId, text)
    } catch (e) {
      process.stdout.write(`${RED}[error] ${(e as Error).message}${RESET}\n`)
      continue
    }
    await waiter
  }

  rl.close()
  await flushStdout()
  return 0
}

// ============================================================
// 入口
// ============================================================

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.mode === 'help') {
    printHelp()
    process.exit(0)
  }

  const hub = makeEventHub()
  const boot = await bootstrap(hub)
  const deps: CliDeps = {
    hub,
    engine: boot.engine,
    approver: boot.approver,
    ops: boot.ops,
    healthStop: boot.healthStop,
  }

  let exitCode = 0
  try {
    if (parsed.mode === 'chat') {
      exitCode = await runChat(parsed, deps)
    } else {
      exitCode = await runRepl(parsed, deps)
    }
  } catch (e) {
    process.stdout.write(`${RED}[fatal] ${(e as Error).message}${RESET}\n`)
    await flushStdout()
    exitCode = 1
  } finally {
    deps.healthStop?.() // 关闭健康监控调度（进程退出前清理）
  }
  process.exit(exitCode)
}

main().catch((e) => {
  console.error(`[fatal] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
