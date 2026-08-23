// ============================================================
// bridge.js —— 前端与 dsh（DeepSeek Harness）之间的桥接层
//
// 协议（已验证，见 docs/verification-report.md）：
//   - HTTP POST /api/<method>  Typert RPC（client-request → server-response）
//   - WebSocket /api/events.mux  下行事件流（session/event + approval/requested）
// 浏览器经 Vite proxy 访问 /api；Electron 下由 preload 注入 __KOTONOHA_API_BASE__。
//
// 对外事件（与 UI 层约定，保持稳定）：
//   { type: 'user',  text, name }
//   { type: 'model', delta }
//   { type: 'model:done', text, name }
//   { type: 'replay', messages }        // 历史重放（初始化/读档）
//   { type: 'status', state, detail }   // 'thinking' | 'action' | 'ready'
//   { type: 'approval', decision, toolName, reason, approvalId } // 越界审批自动裁决
//   { type: 'error', message }
//
// 会话管理：故事(工作区)/存档(会话) 见 stories.js；技能调控见 skills.js。
// ============================================================

import * as stories from './stories'
import * as skills from './skills'

// 角色元信息：单模型单角色，后续多模型 = 多角色，这里先写死
const CHARACTERS = {
  kotonoha: {
    id: 'kotonoha',
    name: '言叶',
    sprite: 'assets/character.png',
  },
}

// Electron 打包后无 vite proxy：preload 注入实际地址；浏览器 dev 走相对路径
const API_BASE = (typeof window !== 'undefined' && window.__KOTONOHA_API_BASE__) || ''
const WS_BASE =
  (typeof window !== 'undefined' && window.__KOTONOHA_WS_BASE__) ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

const BASE_CWD = 'E:\\Kotonoha'
// 免费模型被限流时降级到 deepseek-official（.credentials.yaml 已配 DEEPSEEK_API_KEY）
const FALLBACK_PROVIDER = 'deepseek-official'
const FALLBACK_MODEL = 'deepseek-v4-flash'

// ---- 内部状态 ----
const state = {
  ws: null,
  sessionId: null,
  cwd: BASE_CWD,
  busy: false,          // 有 turn 在执行
  degraded: false,      // 是否已降级模型
  pendingText: '',      // 当前 turn 的文本累积
  pendingPrompt: null,  // 当前 turn 的用户消息（429 降级后重试用）
  turnWatchdog: null,   // 发送后等待 turn/start 的超时器（防界面停留）
  pendingApproval: null, // 待用户裁决的越界审批（{ rpcId, sessionId, approvalId, callId, toolName, reason, timer }）
}

// ---- 事件总线 ----
const listeners = new Set()

export function onEvent(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(event) {
  console.log('[bridge] event →', event.type, event.detail || event.state || event.decision || (event.text ? event.text.slice(0, 30) : ''))
  listeners.forEach((cb) => {
    try {
      cb(event)
    } catch (err) {
      console.error('[bridge] listener error:', err)
    }
  })
}

// ---- RPC ----
function rpcId() {
  return crypto.randomUUID()
}

async function api(method, payload) {
  const res = await fetch(`${API_BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: rpcId(), method, payload }),
  })
  const data = await res.json()
  if (!data.result || data.result.ok !== true) {
    const err = data.result?.error || {}
    const e = new Error(err.message || `${method} failed`)
    e.code = err.code
    e.details = err.details
    console.error('[bridge] api error', method, e.code, e.message)
    throw e
  }
  return data.result.value
}

// ---- WebSocket 事件流 ----
function connectWS() {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return
  }
  const ws = new WebSocket(`${WS_BASE}/api/events.mux`)
  state.ws = ws
  ws.onopen = () => {
    console.log('[bridge] ws open')
    // 重连成功后：若此前 busy 卡住（未收到 turn/end 就断线），复位避免后续消息被吞
    if (state.busy) {
      state.busy = false
      state.pendingText = ''
      state.pendingPrompt = null
      console.warn('[bridge] WS 重连，复位卡住的 busy 状态')
    }
    emit({ type: 'status', state: 'ready' })
  }
  ws.onmessage = (e) => {
    let frame
    try {
      frame = JSON.parse(e.data)
    } catch {
      return
    }
    if (frame.type === 'server-request' && frame.method === 'approval/requested') {
      handleApprovalRequest(frame)
      return
    }
    const payload = frame.payload
    if (!payload || payload.type !== 'session/event' || !payload.event) return
    // events.mux 是全局事件流（所有会话广播），只处理当前会话的事件
    if (payload.sessionId && payload.sessionId !== state.sessionId) return
    handleSessionEvent(payload.event)
  }

  ws.onclose = () => {
    state.ws = null
    setTimeout(() => {
      if (!state.ws) connectWS()
    }, 3000)
  }
  ws.onerror = () => ws.close()
}

// ---- 审批裁决（技能硬调控 + 审批弹窗，实测见 docs/records/approval-probe-2026-08-20.md）----

const APPROVAL_TIMEOUT_MS = 15000 // 审批弹窗无操作时的兜底超时

/** 向 dsh 应答审批结果（allowed-once | always | rejected）。 */
function respondOutcome(rpcId_, sessionId, approvalId, outcome) {
  fetch(`${API_BASE}/api/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-response',
      rpcId: rpcId_,
      result: { ok: true, value: { sessionId, approvalId, outcome } },
    }),
  }).catch((err) => console.error('[bridge] approval respond failed:', err.message))
}

async function handleApprovalRequest(frame) {
  const { rpcId: rpcId_ = '', payload } = frame || {}
  const { sessionId, approvalId, toolName, callId, reason } = payload || {}
  if (!rpcId_ || !sessionId || !approvalId) return
  // 只裁决当前会话的审批；其他会话（如 dsh web 自己开的）由对应端应答
  if (state.sessionId && sessionId !== state.sessionId) return
  const decision = skills.decideApproval(skills.getSkillState(), toolName)

  // 拒绝决策：技能硬关，不弹 UI，直接拒绝
  if (decision === 'deny') {
    emit({ type: 'approval', decision, toolName, reason: reason || '', approvalId, callId })
    respondOutcome(rpcId_, sessionId, approvalId, 'rejected')
    return
  }

  // 放行决策：弹审批 UI 等用户选择（允许一次 / 始终允许 / 拒绝）。
  // 用户无操作时按原自动放行兜底，避免审批挂起阻塞会话（后端审批无超时）。
  const pending = { rpcId: rpcId_, sessionId, approvalId, callId, toolName, reason: reason || '' }
  if (state.pendingApproval) {
    const old = state.pendingApproval
    clearTimeout(old.timer)
    // 旧审批尚未应答 → 兜底放行，避免后端挂起
    respondOutcome(old.rpcId, old.sessionId, old.approvalId, 'allowed-once')
    emit({ type: 'approval:done', approvalId: old.approvalId, decision: 'allow' })
  }
  state.pendingApproval = pending
  pending.timer = setTimeout(() => {
    if (state.pendingApproval !== pending) return
    state.pendingApproval = null
    respondOutcome(rpcId_, sessionId, approvalId, 'allowed-once')
    emit({ type: 'approval:done', approvalId, decision: 'allow' })
  }, APPROVAL_TIMEOUT_MS)
  emit({
    type: 'approval',
    decision,
    toolName,
    reason: reason || '',
    approvalId,
    callId,
    pending: true,
    rpcId: rpcId_,
    sessionId,
  })
}

/** 审批弹窗应答：用户点击「允许一次 / 始终允许 / 拒绝」（outcome 直传后端）。 */
export async function respondApproval({ rpcId, sessionId, approvalId, outcome }) {
  const pending = state.pendingApproval
  if (pending && pending.approvalId === approvalId) {
    clearTimeout(pending.timer)
    state.pendingApproval = null
  }
  try {
    const res = await fetch(`${API_BASE}/api/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'client-response',
        rpcId: rpcId || pending?.rpcId || '',
        result: { ok: true, value: { sessionId, approvalId, outcome } },
      }),
    })
    const data = await res.json()
    console.log('[bridge] approval respond →', outcome, data)
    return { ok: data?.accepted === true }
  } catch (err) {
    console.error('[bridge] approval respond failed:', err.message)
    return { ok: false, error: err.message }
  }
}

function handleSessionEvent(ev) {
  console.log('[bridge] ws event →', ev.type)
  switch (ev.type) {
    case 'turn/start':
      if (state.turnWatchdog) {
        clearTimeout(state.turnWatchdog)
        state.turnWatchdog = null
      }
      state.busy = true
      state.pendingText = ''
      emit({ type: 'status', state: 'thinking' })
      break

    case 'assistant/chunk': {
      const chunk = ev.data?.chunk
      if (!chunk) return
      if (chunk.type === 'text-delta') {
        state.pendingText += chunk.text
        emit({ type: 'model', delta: chunk.text })
      } else if (chunk.type === 'reasoning-delta') {
        emit({ type: 'status', state: 'thinking', detail: '思考中…' })
      } else if (chunk.type === 'tool-call-delta') {
        const name = chunk.toolCall?.name || '技能'
        emit({ type: 'status', state: 'action', detail: name })
      } else if (chunk.type === 'finish') {
        handleFinish(chunk.reason)
      }
      break
    }

    case 'turn/end':
      if (state.turnWatchdog) {
        clearTimeout(state.turnWatchdog)
        state.turnWatchdog = null
      }
      state.busy = false
      state.pendingText = ''
      state.pendingPrompt = null
      emit({ type: 'status', state: 'ready' })
      break
  }
}

async function handleFinish(reason) {
  if (!reason) return
  if (reason.kind === 'stop') {
    const text = state.pendingText
    state.pendingText = ''
    emit({ type: 'model:done', text, name: CHARACTERS.kotonoha.name })
  } else if (reason.kind === 'error') {
    state.pendingText = ''
    await handleTurnError(reason)
  }
  // reason.kind === 'tool-calls'：工具调用后还会继续出 block，保持 thinking，不动
}

async function handleTurnError(reason) {
  if (state.turnWatchdog) {
    clearTimeout(state.turnWatchdog)
    state.turnWatchdog = null
  }
  const message = reason.message || reason.kind || '模型调用出错'
  const isRateLimit = /rate limit|429|limit/i.test(message)

  if (isRateLimit && !state.degraded) {
    emit({ type: 'status', state: 'thinking', detail: '模型限流，正在切换备用模型…' })
    try {
      await api('session.selectModel', {
        sessionId: state.sessionId,
        provider: FALLBACK_PROVIDER,
        model: FALLBACK_MODEL,
      })
      state.degraded = true
      emit({ type: 'error', message: '免费模型限流，已自动切换备用模型' })
      if (state.pendingPrompt) {
        await api('session.prompt', {
          sessionId: state.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: state.pendingPrompt }],
        })
      }
    } catch (e) {
      emit({ type: 'error', message: `模型切换失败：${e.message}` })
      state.busy = false
      emit({ type: 'status', state: 'ready' })
    }
  } else {
    emit({ type: 'error', message })
    state.busy = false
    emit({ type: 'status', state: 'ready' })
  }
}

// ---- 历史重建 ----
function historyToMessages(events) {
  const messages = []
  for (const item of events || []) {
    const ev = item.event || item
    if (ev.type === 'user/message') {
      if (!ev.data?.source || ev.data.source.kind !== 'user') continue
      const text = (ev.data?.content || []).map((c) => (c.type === 'text' ? c.text : '')).join('')
      if (!text) continue
      messages.push({ role: 'user', name: '你', text })
    } else if (ev.type === 'assistant/message') {
      const content = ev.data?.message?.content || ev.data?.content || []
      const text = content.map((c) => (c.type === 'text' ? c.text : '')).join('')
      if (!text) continue
      messages.push({ role: 'model', name: CHARACTERS.kotonoha.name, text })
    }
  }
  return messages
}

async function replayHistory() {
  const hist = await api('session.history', { sessionId: state.sessionId })
  const messages = historyToMessages(hist?.events)
  emit({ type: 'replay', messages })
}

async function ensureSession() {
  if (state.sessionId) return
  const created = await api('session.create', { cwd: state.cwd })
  state.sessionId = created.sessionId
}

// ---- 故事 / 存档 会话入口（供 UI 主界面 / 选择界面调用）----

/** 进入故事下的一个存档（载入）。saveId 为空时自动建新会话。 */
export async function enterStory(storyId, saveId) {
  const story = stories.getStory(storyId)
  if (!story) return { ok: false, error: '故事不存在' }
  let sessionId = null
  if (saveId) {
    const save = stories.getSave(storyId, saveId)
    if (save?.sessionId) {
      try {
        const h = await api('session.history', { sessionId: save.sessionId })
        if (h?.ok) sessionId = save.sessionId
      } catch {
        // 会话已失效 → 新建
      }
    }
  }
  if (!sessionId) {
    const created = await api('session.create', { cwd: story.path })
    sessionId = created.sessionId
    if (saveId) {
      // 存档失效，原地重建同名存档
      stories.createSave(storyId, { name: stories.getSave(storyId, saveId)?.name || '对话', sessionId })
    }
  }
  state.sessionId = sessionId
  state.cwd = story.path
  state.degraded = false
  state.pendingText = ''
  state.pendingPrompt = null
  stories.setContext(storyId, saveId || null)
  stories.updateStory(storyId, { lastActiveAt: Date.now() })
  if (saveId) stories.updateSave(storyId, saveId, { lastActiveAt: Date.now() })
  await replayHistory()
  emit({ type: 'status', state: 'ready' })
  return { ok: true }
}

/** 新建存档：在故事下开启新会话（新游戏）。 */
export async function newSave(storyId, saveName) {
  const story = stories.getStory(storyId)
  if (!story) return { ok: false, error: '故事不存在' }
  const created = await api('session.create', { cwd: story.path })
  const { save } = stories.createSave(storyId, { name: saveName, sessionId: created.sessionId })
  state.sessionId = created.sessionId
  state.cwd = story.path
  state.degraded = false
  state.pendingText = ''
  state.pendingPrompt = null
  stories.setContext(storyId, save.id)
  stories.updateStory(storyId, { lastActiveAt: Date.now() })
  emit({ type: 'replay', messages: [] })
  emit({ type: 'status', state: 'ready' })
  return { ok: true, save }
}

/** 对话中保存：覆盖当前存档 / 另存为新名（同名即覆盖）。 */
export async function saveNow(name) {
  if (!state.sessionId) return { ok: false, error: '会话未就绪' }
  const ctx = stories.getContext()
  if (!ctx?.storyId) return { ok: false, error: '未处于任何故事中' }
  const { save } = stories.createSave(ctx.storyId, { name, sessionId: state.sessionId })
  stories.setContext(ctx.storyId, save.id)
  return { ok: true, save }
}

/** 模型回复完成时刷新当前存档预览（主界面「继续」卡片显示）。 */
export function updateSavePreview(text) {
  const ctx = stories.getContext()
  if (!ctx?.storyId || !ctx?.saveId) return
  stories.updateSave(ctx.storyId, ctx.saveId, { preview: text, lastActiveAt: Date.now() })
}

/** 离开对话（回主界面）：不销毁会话，保留 context 供「继续」。 */
export function leaveDialog() {
  // 仅断开 UI 绑定，会话保留在 dsh；再次进入由 enterStory 恢复
}

// ---- 对话 ----
/** 发送用户消息（真实对话，模型流式回复通过 model/model:done 事件推送）。 */
export async function sendMessage(text) {
  const trimmed = text.trim()
  console.log('[bridge] sendMessage enter', { trimmed, busy: state.busy, sessionId: state.sessionId })
  if (!trimmed || state.busy) return
  try {
    await ensureSession()
    state.pendingPrompt = trimmed
    emit({ type: 'user', text: trimmed, name: '你' })
    // 技能硬调控软层：按开关注入约束段
    const constraint = skills.buildConstraintSegment(skills.getSkillState())
    const content = [{ type: 'text', text: trimmed }]
    if (constraint) content.push({ type: 'text', text: constraint })
    await api('session.prompt', {
      sessionId: state.sessionId,
      mode: 'queue',
      content,
    })
    // 看门狗：prompt 已接受但 12s 内未收到 turn/start（WS 断连/后端挂起），复位 busy 并提示，
    // 避免界面永久停留在输入画面。收到 turn/start 后由 handleSessionEvent 清除。
    state.turnWatchdog = setTimeout(() => {
      if (state.busy) {
        state.busy = false
        state.pendingText = ''
        state.pendingPrompt = null
        console.warn('[bridge] 发送后未收到 turn/start，复位 busy')
        emit({ type: 'error', message: '对话无响应，请重试' })
        emit({ type: 'status', state: 'ready' })
      }
    }, 12000)
  } catch (err) {
    emit({ type: 'error', message: `发送失败：${err.message}` })
    state.busy = false
    emit({ type: 'status', state: 'ready' })
  }
}

// ---- Agent 面板扩展方法（ESC 面板 会话/Git/MCP/凭据 页签使用）----

/** Fork 当前会话（dsh session.fork）：返回新会话 ID。 */
export async function sessionFork() {
  if (!state.sessionId) return { ok: false, error: '会话未就绪' }
  try {
    const value = await api('session.fork', { sessionId: state.sessionId })
    const id = value?.sessionId || value?.id || null
    return id ? { ok: true, sessionId: id } : { ok: false, error: 'fork 返回异常' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 重命名当前会话（dsh session.rename）。 */
export async function sessionRename(label) {
  if (!state.sessionId) return { ok: false, error: '会话未就绪' }
  const name = (label || '').trim()
  if (!name) return { ok: false, error: '名称不能为空' }
  try {
    await api('session.rename', { sessionId: state.sessionId, label: name })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** Git 状态：dsh 无 shell 接口（探测确认），改为请言叶在会话内执行并回显到对话。 */
export async function getGitStatus() {
  if (state.busy) return { ok: false, output: '', error: '模型正在回复中，稍后再试' }
  try {
    await sendMessage('请执行 git status --short -b，并简要汇报当前工作区状态')
    return { ok: true, output: '已请言叶执行「git status --short -b」——输出将出现在对话中' }
  } catch (err) {
    return { ok: false, output: '', error: err.message }
  }
}

/** 给当前会话发一条消息（ESC 面板「请言叶执行…」按钮用，效果等同普通发送）。 */
export async function sendCommandToAgent(text) {
  if (state.busy) return { ok: false, error: '模型正在回复中，稍后再试' }
  try {
    await sendMessage(text)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 凭据状态（dsh credentials.describe，结构防御式解析；失败返回 null）。 */
export async function getCredentialsStatus() {
  const refs = ['DEEPSEEK_API_KEY', 'OPENCODE_API_KEY']
  try {
    const value = await api('credentials.describe', { refs })
    const list = value?.refs || value?.items || value || []
    const out = {}
    for (const item of list) {
      if (!item) continue
      const ref = item.ref || item.name || item.key
      if (!ref) continue
      out[ref] = {
        configured: !!item.configured || !!item.set || !!item.present,
        source: item.source || item.provider || null,
      }
    }
    return out
  } catch (err) {
    return null
  }
}

/** MCP 服务器列表（dsh mcp.list；不存在则返回 null）。 */
export async function getMcpInfo() {
  try {
    const value = await api('mcp.list', {})
    const items = value?.servers || value?.items || value?.mcpServers || []
    return { items }
  } catch {
    return null
  }
}

// ---- Round-2 扩展方法（契约见 docs/plans/rpc-contract-round2.md）----
// 全部复用 api()，成功返回 { ok:true, ...数据 }，失败返回 { ok:false, error }。

/** 工具目录（tools.list）：value { tools:[{name,description}] }。 */
export async function listTools() {
  try {
    const value = await api('tools.list', {})
    return { ok: true, tools: value?.tools || [] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** Provider 目录（providers.list）：value { defaultId, providers:[{id,name,capabilities?,models:[{id,name?}]}] }。 */
export async function listProviders() {
  try {
    const value = await api('providers.list', {})
    return { ok: true, defaultId: value?.defaultId || null, providers: value?.providers || [] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 导出会话（session.export）：payload { sessionId, format:'json'|'markdown' } → value { filename, content }。 */
export async function exportSession(sessionId, format) {
  if (!sessionId) return { ok: false, error: '会话未就绪' }
  try {
    const value = await api('session.export', { sessionId, format: format === 'markdown' ? 'markdown' : 'json' })
    return { ok: true, filename: value?.filename || '', content: value?.content || '' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 导入会话（session.import）：payload { content, format:'json' } → value { sessionId }。 */
export async function importSession(content) {
  if (!content) return { ok: false, error: '缺少会话内容' }
  try {
    const value = await api('session.import', { content, format: 'json' })
    return { ok: true, sessionId: value?.sessionId || null }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 归档会话（session.archive）：payload { sessionId } → value { ok:true }。 */
export async function archiveSession(sessionId) {
  if (!sessionId) return { ok: false, error: '会话未就绪' }
  try {
    await api('session.archive', { sessionId })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 恢复归档会话（session.unarchive）：payload { sessionId } → value { ok:true }。 */
export async function unarchiveSession(sessionId) {
  if (!sessionId) return { ok: false, error: '会话未就绪' }
  try {
    await api('session.unarchive', { sessionId })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 已归档会话列表（session.listArchived）：value { sessions:[SessionRecord…] }。 */
export async function listArchivedSessions() {
  try {
    const value = await api('session.listArchived', {})
    return { ok: true, sessions: value?.sessions || [] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 压缩会话（session.compress）：payload { sessionId, keepRecent?=5 } → value { ok:true, summary? }。 */
export async function compressSession(sessionId, keepRecent) {
  if (!sessionId) return { ok: false, error: '会话未就绪' }
  try {
    const payload = { sessionId }
    if (keepRecent !== undefined && keepRecent !== null) payload.keepRecent = keepRecent
    const value = await api('session.compress', payload)
    return { ok: true, summary: value?.summary || null }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 审批规则（rules.get）：value { rules:[{tool,level}] }。 */
export async function getRules() {
  try {
    const value = await api('rules.get', {})
    return { ok: true, rules: value?.rules || [] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 写入审批规则（rules.set）：payload { rules:[{tool,level}] } → value { ok:true }。 */
export async function setRules(rules) {
  try {
    await api('rules.set', { rules: rules || [] })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** MCP 服务器状态（mcp.status）：value { servers:[{id,type,status,tools?}] }（不自动连接）。 */
export async function mcpStatus() {
  try {
    const value = await api('mcp.status', {})
    return { ok: true, servers: value?.servers || [] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 切换会话模型（session.selectModel）：payload { sessionId, provider, model }。 */
export async function selectModel(provider, model, sessionId) {
  const sid = sessionId || state.sessionId
  if (!sid) return { ok: false, error: '会话未就绪' }
  try {
    await api('session.selectModel', { sessionId: sid, provider, model })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// ---- 初始化 ----
let initStarted = false

/**
 * 初始化：连接事件流 + 迁移旧存档。
 * 注意：不再自动建会话——由 UI 主界面驱动（进入故事/存档时再建）。
 */
export async function init() {
  if (initStarted) return
  initStarted = true
  stories.migrateLegacy()
  connectWS()
  window.__bridgeDebug = { state, listeners: listeners.size, wsReady: state.ws ? state.ws.readyState : -1 }
}

export default {
  init,
  sendMessage,
  onEvent,
  enterStory,
  newSave,
  saveNow,
  updateSavePreview,
  leaveDialog,
  sessionFork,
  sessionRename,
  getGitStatus,
  sendCommandToAgent,
  getCredentialsStatus,
  getMcpInfo,
  listTools,
  listProviders,
  exportSession,
  importSession,
  archiveSession,
  unarchiveSession,
  listArchivedSessions,
  compressSession,
  getRules,
  setRules,
  mcpStatus,
  selectModel,
  respondApproval,
  CHARACTERS,
}