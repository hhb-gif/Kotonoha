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

export type Chunk =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta' }
  | { type: 'tool-call-delta'; toolCall: { name: string } }
  | { type: 'finish'; reason: { kind: 'stop' | 'error' | 'tool-calls'; message?: string } }

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

export interface Tool {
  def: ToolDef
  run(ctx: ToolContext, args: unknown): Promise<ToolResult>
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
  setSetting(key: string, value: string): void
  close(): void
  // 底层数据库实例（高级用法）
  _db: any
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
  }
  tools: {
    list(): Tool[]
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
  }
}

export interface EventHub {
  broadcast(frame: OutboundFrame): void
  attach(send: (frame: OutboundFrame) => void): () => void
}