// ============================================================
// bridge.js —— 前端与 dsh（DeepSeek Harness）之间的桥接层
//
// 协议（已验证，见 docs/verification-report.md）：
//   - HTTP POST /api/<method>  Typert RPC（client-request → server-response）
//   - WebSocket /api/events.mux  下行事件流（session/event）
// 浏览器经 Vite proxy 访问 /api，规避 dsh 的 Origin 校验。
//
// 对外事件（与 UI 层约定，保持稳定）：
//   { type: 'user',  text, name }
//   { type: 'model', delta }
//   { type: 'model:done', text, name }
//   { type: 'replay', messages }        // 历史重放（初始化/读档）
//   { type: 'status', state, detail }   // 'thinking' | 'action' | 'ready'
//   { type: 'error', message }
// ============================================================

// 角色元信息：单模型单角色，后续多模型 = 多角色，这里先写死
const CHARACTERS = {
  kotonoha: {
    id: 'kotonoha',
    name: '言叶',
    sprite: '/assets/character.png',
  },
}

const SAVE_KEY = 'kotonoha:save'
const BASE_CWD = 'E:\\Kotonoha'
// 免费模型被限流时降级到 deepseek-official（.credentials.yaml 已配 DEEPSEEK_API_KEY）
const FALLBACK_PROVIDER = 'deepseek-official'
const FALLBACK_MODEL = 'deepseek-v4-flash'

// ---- 内部状态 ----
const state = {
  ws: null,
  sessionId: null,
  busy: false,          // 有 turn 在执行
  degraded: false,      // 是否已降级模型
  pendingText: '',      // 当前 turn 的文本累积
  pendingPrompt: null,  // 当前 turn 的用户消息（429 降级后重试用）
}

// ---- 事件总线 ----
const listeners = new Set()

export function onEvent(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(event) {
  console.log('[bridge] event →', event.type, event.detail || event.state || (event.text ? event.text.slice(0, 30) : ''))
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
  const res = await fetch(`/api/${method}`, {
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

// ---- 会话存取（视觉小说式存档位）----
function readSlot() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// ---- WebSocket 事件流 ----
function connectWS() {
  // 防重：已有连接（连接中或已打开）则跳过
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return
  }
  const ws = new WebSocket(`ws://${location.host}/api/events.mux`)
  state.ws = ws
  ws.onopen = () => { console.log('[bridge] ws open'); emit({ type: 'status', state: 'ready' }) }
  ws.onmessage = (e) => {
    let frame
    try {
      frame = JSON.parse(e.data)
    } catch {
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
    // 简单自动重连（3s 后）
    setTimeout(() => {
      if (!state.ws) connectWS()
    }, 3000)
  }
  ws.onerror = () => ws.close()
}

function handleSessionEvent(ev) {
  console.log('[bridge] ws event →', ev.type)
  switch (ev.type) {
    case 'turn/start':
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
  const message = reason.message || reason.kind || '模型调用出错'
  const isRateLimit = /rate limit|429|limit/i.test(message)

  if (isRateLimit && !state.degraded) {
    // 免费模型限流 → 降级 deepseek-official 后重试当前消息
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
      // 跳过系统注入消息（runtime context / system-reminder 无 source 字段）
      if (!ev.data?.source || ev.data.source.kind !== 'user') continue
      const text = (ev.data?.content || []).map((c) => (c.type === 'text' ? c.text : '')).join('')
      if (!text) continue
      messages.push({ role: 'user', name: '你', text })
    } else if (ev.type === 'assistant/message') {
      // 真实结构：data.message.content（reasoning / tool-call / text）
      const content = ev.data?.message?.content || ev.data?.content || []
      const text = content.map((c) => (c.type === 'text' ? c.text : '')).join('')
      if (!text) continue // 跳过 reasoning / tool-call 中间步骤
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
  // 优先恢复存档位里的会话
  const slot = readSlot()
  if (slot?.sessionId) {
    try {
      await api('session.history', { sessionId: slot.sessionId })
      state.sessionId = slot.sessionId
      return
    } catch {
      // 会话已失效，走新建
    }
  }
  const created = await api('session.create', { cwd: BASE_CWD })
  state.sessionId = created.sessionId
}

// ---- 对外接口 ----

let initStarted = false

/**
 * 初始化：连接事件流 + 恢复/创建会话 + 重放历史。
 * 幂等：多次调用只执行一次（防止 React StrictMode / HMR 双跑）。
 * 结果通过事件通知（replay / status / error）。
 */
export async function init() {
  if (initStarted) return
  initStarted = true
  window.__bridgeDebug = { state, listeners: listeners.size, wsReady: state.ws ? state.ws.readyState : -1 } // 开发调试用
  connectWS()
  try {
    await ensureSession()
    await replayHistory()
    emit({ type: 'status', state: 'ready' })
  } catch (err) {
    emit({ type: 'error', message: `初始化失败：${err.message}` })
  }
}

/**
 * 发送用户消息（真实对话，模型流式回复通过 model/model:done 事件推送）。
 */
export async function sendMessage(text) {
  const trimmed = text.trim()
  console.log('[bridge] sendMessage enter', { trimmed, busy: state.busy, sessionId: state.sessionId })
  if (!trimmed || state.busy) return
  try {
    await ensureSession()
    state.pendingPrompt = trimmed
    emit({ type: 'user', text: trimmed, name: '你' })
    await api('session.prompt', {
      sessionId: state.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: trimmed }],
    })
  } catch (err) {
    emit({ type: 'error', message: `发送失败：${err.message}` })
    state.busy = false
    emit({ type: 'status', state: 'ready' })
  }
}

/** 存档：把当前会话记录到存档位（视觉小说式：项目 = 存档） */
export function saveSession() {
  if (!state.sessionId) return false
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ sessionId: state.sessionId, savedAt: Date.now() })
    )
    return true
  } catch {
    return false
  }
}

/** 读档：切回存档位里的会话并重放历史。@returns Promise<boolean> */
export async function loadSession() {
  const slot = readSlot()
  if (!slot?.sessionId) return false
  try {
    await api('session.history', { sessionId: slot.sessionId })
    state.sessionId = slot.sessionId
    state.degraded = false
    await replayHistory()
    return true
  } catch (err) {
    emit({ type: 'error', message: `读档失败：${err.message}` })
    return false
  }
}

/** 新游戏：新建一个会话（新项目） */
export async function newGame() {
  try {
    const created = await api('session.create', { cwd: BASE_CWD })
    state.sessionId = created.sessionId
    state.degraded = false
    emit({ type: 'replay', messages: [] })
    emit({ type: 'status', state: 'ready' })
    return true
  } catch (err) {
    emit({ type: 'error', message: `新建失败：${err.message}` })
    return false
  }
}

/** 清档（设置面板备用） */
export function clearSession() {
  localStorage.removeItem(SAVE_KEY)
}

export default {
  init,
  sendMessage,
  onEvent,
  saveSession,
  loadSession,
  newGame,
  clearSession,
  CHARACTERS,
}