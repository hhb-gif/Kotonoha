// ============================================================
// types.ts —— Agent Harness M0 契约源（所有模块以此为接口准绳）
// 协议与 dsh 完全兼容（见 docs/plans/agent-harness-m0.md 第 1 节）
// 中文注释、英文标识符
// ============================================================

// ---- RPC 协议 ----

export interface RpcRequest {
  type: 'client-request'
  rpcId: string
  method: string
  payload: Record<string, unknown>
}

export interface RpcSuccess {
  ok: true
  value: unknown
}

export interface RpcError {
  ok: false
  error: { code: string; message: string; details?: unknown }
}

export interface RpcResponse {
  type: 'server-response'
  rpcId: string
  result: RpcSuccess | RpcError
}

export interface ApprovalRespondBody {
  type: 'client-response'
  rpcId: string
  result: {
    ok: true
    value: { sessionId: string; approvalId: string; outcome: 'allowed-once' | 'rejected' }
  }
}

// ---- 事件流帧（WS /api/events.mux）----

export interface SessionEventFrame {
  type: 'session/event'
  payload: { type: 'session/event'; sessionId: string; event: SessionEvent }
}

export interface ApprovalRequestFrame {
  type: 'server-request'
  method: 'approval/requested'
  rpcId: string
  payload: {
    sessionId: string
    approvalId: string
    toolName: string
    callId: string
    reason: string
  }
}

export type OutboundFrame = SessionEventFrame | ApprovalRequestFrame

// ---- 会话事件（bridge.js 解析格式）----

export type SessionEvent =
  | { type: 'turn/start' }
  | { type: 'assistant/chunk'; data: { chunk: Chunk } }
  | { type: 'turn/end' }

// finish 结束原因：stop/tool-calls/error 为既有语义；
// degraded 为 M4 新增：主 provider 失败自动切降级链时的通知帧（turn 未结束，后续 chunk 来自降级 provider）
export type FinishReason =
  | { kind: 'stop' | 'tool-calls'; message?: string }
  | { kind: 'error'; message?: string }
  | { kind: 'degraded'; from: string; to: string; message?: string }

export type Chunk =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta' }
  | { type: 'tool-call-delta'; toolCall: { name: string } }
  | { type: 'emotion-change'; emotion: string }
  | { type: 'finish'; reason: FinishReason }

// ---- 历史事件（session.history 返回，bridge historyToMessages 解析）----

export interface HistoryTextContent {
  type: 'text'
  text: string
}

export type HistoryEvent =
  | {
      type: 'user/message'
      data: { source: { kind: 'user' }; content: HistoryTextContent[] }
    }
  | {
      type: 'assistant/message'
      data: {
        message: { role: 'assistant'; content: HistoryTextContent[] }
      }
    }

// ---- Provider（模型供应商）----

export type ProviderChunk =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool-call'; id: string; name: string; args: string } // args 为 JSON 字符串
  | { kind: 'done' }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: { id: string; name: string; args: string }[]
  // DeepSeek thinking 模式：带 tools 参数时必须原样回传 reasoning_content，否则 API 400
  reasoningContent?: string
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
}

export interface StreamParams {
  model: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  signal?: AbortSignal
  // 可选：thinking 模式开关与强度（DeepSeek V4：thinking.type enabled/disabled + reasoning_effort low/medium/high/xhigh/max）
  thinking?: { enabled?: boolean; effort?: string }
  // 可选：流式响应尾部 usage 回调（SSE 解析到 prompt_tokens/completion_tokens 时触发，用于成本落库）
  onUsage?: (usage: { promptTokens: number; completionTokens: number }) => void
}

export type ProviderCapability = 'chat' | 'reasoning' | 'tool-calls' | 'image' | 'video'

export interface ModelProvider {
  id: string
  name: string
  capabilities: ProviderCapability[]
  listModels(): Promise<{ id: string; name?: string }[]>
  streamChat(p: StreamParams): AsyncGenerator<ProviderChunk>
  estimateCost(promptTokens: number, completionTokens: number): number
  healthCheck(): Promise<boolean>
}

export interface ProviderRegistry {
  get(id: string): ModelProvider | undefined
  list(): ModelProvider[]
  defaultId(): string
  register(provider: ModelProvider): void
  unregister(id: string): void
  setFallbackChain(chain: string[]): void
  getFallbackChain(): string[]
}

// ---- Tool（工具）----

export interface ToolContext {
  cwd: string
  sessionId: string
  approve(
    toolName: string,
    callId: string,
    reason: string
  ): Promise<'allowed-once' | 'rejected'>
  emit(ev: SessionEvent): void
}

export interface ToolResult {
  ok: boolean
  output: string
  error?: string
}

// check_fn 门控上下文：传给 Tool.check 做可用性判断（如 git 工具在非 git 目录隐藏）
export interface ToolCheckContext {
  cwd?: string
  sessionId?: string
}

export interface Tool {
  def: ToolDef
  run(ctx: ToolContext, args: unknown): Promise<ToolResult>
  // check_fn：环境/平台门控，false 则不出现在模型 schema（可选，默认可用）
  check?(ctx?: ToolCheckContext): boolean | Promise<boolean>
}

// ---- Store（持久化）----

export interface SessionRecord {
  id: string
  cwd: string
  label: string
  provider: string
  model: string
  createdAt: number
  lastActiveAt: number
  // 会话级激活工具集（渐进披露；缺省时用 toolsets.DEFAULT_ACTIVE_TOOLSETS）
  toolsets?: string[]
}

export interface Db {
  // 会话
  createSession(rec: SessionRecord): void
  getSession(id: string): SessionRecord | null
  listSessions(): SessionRecord[]
  listAllSessions(includeArchived?: boolean): SessionRecord[]
  updateSession(id: string, patch: Partial<SessionRecord>): void
  deleteSession(id: string): void
  // 事件
  appendEvent(sessionId: string, ev: HistoryEvent): void
  readEvents(sessionId: string): HistoryEvent[]
  deleteEvents(sessionId: string): void
  // 设置
  getSetting(key: string): string | null
  // value 可为任意 JSON 值（内部序列化存储），调用方自行断言类型
  setSetting(key: string, value: unknown): void
  // 语义记忆（Hermes 模式 semantic 层）
  insertMemory(
    sessionId: string,
    entity: string,
    relation: string,
    detail: string,
    confidence: number
  ): void
  getMemoriesBySession(sessionId: string): MemoryEntry[]
  searchMemories(query: string, limit: number): MemoryEntry[]
  // 程序性技能（procedural 层）
  insertSkill(
    name: string,
    trigger: string,
    content: string,
    status: 'pending' | 'approved' | 'rejected'
  ): number
  getSkillsByStatus(status: 'pending' | 'approved' | 'rejected'): SkillEntry[]
  getSkillById(id: number): SkillEntry | null
  updateSkillStatus(id: number, status: 'pending' | 'approved' | 'rejected'): void
  close(): void
  // 底层数据库实例（高级用法）
  _db: any
}

/** 语义记忆条目（memories 表行） */
export interface MemoryEntry {
  id: number
  session_id: string
  entity: string
  relation: string
  detail: string
  confidence: number
  created_at: number
}

/** 技能条目（skills 表行） */
export interface SkillEntry {
  id: number
  name: string
  trigger: string
  content: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: number
  approved_at: number | null
}

/** 降级记录（M4）：主 provider 失败切降级链的一次事件，落 settings 表 key `degradations` */
export interface DegradationEntry {
  ts: number
  from: string
  to: string
  reason: string
}

export interface SecretsStore {
  get(ref: string): string | undefined
  has(ref: string): boolean
  describe(refs: string[]): { ref: string; configured: boolean; source: string | null }[]
  set(ref: string, value: string, source?: string): void
  remove(ref: string): void
}

// ---- Engine（会话引擎）----

export interface EngineDeps {
  db: Db
  providers: {
    get(id: string): ModelProvider | undefined
    list(): ModelProvider[]
    defaultId(): string
    // M4：降级链（未注入时无降级，行为与单一 provider 一致）
    getFallbackChain?(): string[]
    // M4：健康状态查询（未注入时视为可用；false = 从降级链临时剔除）
    isHealthy?(id: string): boolean
  }
  tools: {
    // 同步列出（可传 checkCtx：同步 check_fn 立即生效，异步 check_fn 由 listAvailable 处理）
    list(opts?: { checkCtx?: ToolCheckContext }): Tool[]
    // 完整应用 check_fn（同步+异步）后列出；engine 组装 schema 用
    listAvailable(opts?: { checkCtx?: ToolCheckContext }): Promise<Tool[]>
    get(name: string): Tool | undefined
  }
  approver: {
    request(
      sessionId: string,
      toolName: string,
      callId: string,
      reason: string
    ): Promise<'allowed-once' | 'rejected'>
    respond(rpcId: string, outcome: 'allowed-once' | 'rejected'): boolean
  }
  secrets: SecretsStore
  broadcast(frame: OutboundFrame): void
  systemPrompt(session: SessionRecord): string
}

export interface SessionEngine {
  create(cwd: string): SessionRecord
  prompt(sessionId: string, text: string): { accepted: boolean }
  /** 中断会话正在进行的 turn（幂等：无活动 turn 也返回 ok） */
  interrupt(sessionId: string): { ok: boolean }
  history(sessionId: string): { events: { event: HistoryEvent }[] }
  selectModel(sessionId: string, provider: string, model: string): { ok: boolean }
  list(): SessionRecord[]
  rename(sessionId: string, label: string): { ok: boolean }
  fork(sessionId: string): SessionRecord
  delete(sessionId: string): { ok: boolean }
}

// ---- API 层（index.ts / rpc.ts / events.ts 用）----

export interface RpcHandlerContext {
  engine: SessionEngine
  approver: {
    request(
      sessionId: string,
      toolName: string,
      callId: string,
      reason: string
    ): Promise<'allowed-once' | 'rejected'>
    respond(rpcId: string, outcome: 'allowed-once' | 'rejected'): boolean
  }
  secrets: SecretsStore
  // Round-2 扩展能力（H2：可选注入，未注入时对应 RPC 返回 METHOD_NOT_FOUND）
  ops?: {
    listTools: () => { name: string; description: string }[]
    listProviders: () => Promise<{
      id: string
      name: string
      capabilities?: string[]
      models: { id: string; name?: string }[]
    }[]>
    providerDefaultId: () => string
    exportSession: (id: string, format: 'json' | 'markdown') => Promise<string>
    importSession: (data: string, format: 'json' | 'markdown') => Promise<{ sessionId: string }>
    compressSession: (
      id: string,
      opts: { keepRecent: number }
    ) => Promise<{ originalEvents: number; compressedEvents: number; summary: string }>
    archiveSession: (id: string) => Promise<void>
    unarchiveSession: (id: string) => Promise<void>
    listArchivedSessions: () => SessionRecord[]
    isSessionArchived: (id: string) => boolean
    getRules: () => { tool: string; level: 'allow' | 'ask' | 'deny' }[]
    setRules: (rules: { tool: string; level: 'allow' | 'ask' | 'deny' }[]) => void
    listMcpServers: () => { id: string; type: string; status: string; tools?: string[] }[]
    // T1-toolsets：工具集门类（渐进披露 + 会话级激活）
    listToolsets?: () => { name: string; description: string; tools: string[] }[]
    getActiveToolsets?: (sessionId: string) => string[]
    setActiveToolsets?: (sessionId: string, names: string[]) => void
    // C-memory2（Hermes 三层记忆）：语义记忆 + 程序性技能
    listMemories: (sessionId?: string) => MemoryEntry[]
    searchMemories: (query: string, limit: number) => MemoryEntry[]
    listSkills: (status: 'pending' | 'approved' | 'rejected') => SkillEntry[]
    approveSkill: (id: number) => SkillEntry | null
    rejectSkill: (id: number) => SkillEntry | null
    // E-ops（M4-4.1 成本 / M3-3.3 搜索 / M3-3.4 轨迹）：可选注入
    getSessionCost?: (sessionId: string) => {
      sessionId: string
      records: unknown[]
      tokens: { prompt: number; completion: number }
      costUsd: number
    }
    getTotalCost?: () => {
      totalCostUsd: number
      totalTokens: number
      bySession: Record<string, { sessionId: string; tokens: number; costUsd: number }>
    }
    exportCostCsv?: () => string
    searchEvents?: (
      sessionId: string,
      query: string,
      limit?: number
    ) => { id: number; sessionId: string; seq: number; payload: unknown; snippet?: string }[]
    getTrajectory?: (
      sessionId: string
    ) => { ts: number; tool: string; args: string; ok: boolean; error?: string; sessionId: string }[]
    // M4（4.2 provider 可靠性）：降级记录 / 供应商健康状态
    getDegradations?: () => DegradationEntry[]
    getProviderHealth?: () => { id: string; name: string; healthy: boolean }[]
    // v0.2.2 羁绊系统：好感度视图（bond.get RPC）
    getBond?: () => {
      points: number
      level: number
      levelName: string
      interactions: number
      todayGain: number
      lastTurnAt: number
    }
  }
}

export interface EventHub {
  broadcast(frame: OutboundFrame): void
  attach(send: (frame: OutboundFrame) => void): () => void
}