// ============================================================
// bridge.js —— 前端与 dsh（DeepSeek Harness）之间的桥接层（核心：会话/对话/事件流）
//
// 协议（已验证，见 docs/verification-report.md）：
//   - HTTP POST /api/<method>  Typert RPC（client-request → server-response）→ rpc-core.js
//   - WebSocket /api/events.mux  下行事件流（session/event + approval/requested）
// 浏览器经 Vite proxy 访问 /api；Electron 下由 preload 注入 __KOTONOHA_API_BASE__。
//
// 对外事件（与 UI 层约定，保持稳定，分发见 events.js）：
//   { type: 'user',  text, name }
//   { type: 'model', delta }
//   { type: 'model:done', text, name }
//   { type: 'replay', messages }        // 历史重放（初始化/读档）
//   { type: 'status', state, detail }   // 'thinking' | 'action' | 'ready'
//   { type: 'approval', decision, toolName, reason, approvalId } // 越界审批自动裁决
//   { type: 'error', message }
//
// 域拆分：RPC 方法 → rpc.js；底层协议/工厂 → rpc-core.js；事件总线 → events.js；
//         审批裁决 → approval.js。故事/存档数据层见 stories.js；技能调控见 skills.js。
// ============================================================

import * as stories from './stories'
import * as skills from './skills'
import { api } from './rpc-core'
import { emit } from './events'
import * as rpc from './rpc'
import { createApproval } from './approval'

// 角色元信息：单模型单角色，后续多模型 = 多角色，这里先写死
const CHARACTERS = {
  kotonoha: {
    id: 'kotonoha',
    name: '言叶',
    sprite: 'assets/character.png',
  },
}

// Electron 打包后无 vite proxy：preload 注入实际地址；浏览器 dev 走相对路径
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
  degradedTimer: null,  // 降级后「无后续 chunk 则按错误处理」的 3s 兜底定时器
  pendingApproval: null, // 待用户裁决的越界审批（{ rpcId, sessionId, approvalId, callId, toolName, reason, timer }）
}

// RPC 方法域 + 审批域接线（共享同一 state 对象）
// bindBridgeState 为内部接线方法，从导出面剥离（默认导出只展开 rpcMethods）
const { bindBridgeState, ...rpcMethods } = rpc
bindBridgeState(state)
const { handleApprovalRequest, respondApproval } = createApproval({ state })

// 降级兼容常量：收到 degraded 帧后若 3s 内无任何新 chunk，
// 说明后端以 degraded 作为最终 finish（无 fallback 重试流），按错误处理复位界面
const DEGRADED_TIMEOUT_MS = 3000

/** 清除降级兜底定时器（后续有流式 chunk / 正常 finish / turn 结束时调用）。 */
function clearDegradedTimer() {
  if (state.degradedTimer) {
    clearTimeout(state.degradedTimer)
    state.degradedTimer = null
  }
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
      // 任何新 chunk 都证明降级后仍在流式（fallback 重试成功）→ 取消 3s 兜底定时器
      clearDegradedTimer()
      if (chunk.type === 'text-delta') {
        state.pendingText += chunk.text
        emit({ type: 'model', delta: chunk.text })
      } else if (chunk.type === 'reasoning-delta') {
        emit({ type: 'status', state: 'thinking', detail: '思考中…' })
      } else if (chunk.type === 'emotion-change') {
        // 情绪状态变化：传递给 App 驱动立绘切换
        emit({ type: 'emotion', state: chunk.emotion || 'neutral' })
      } else if (chunk.type === 'tool-call-delta') {
        const name = chunk.toolCall?.name || '技能'
        emit({ type: 'status', state: 'action', detail: name })
      } else if (chunk.type === 'finish') {
        handleFinish(chunk.reason)
      }
      break
    }

    case 'turn/end':
      clearDegradedTimer()
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
    clearDegradedTimer()
    const text = state.pendingText
    state.pendingText = ''
    emit({ type: 'model:done', text, name: CHARACTERS.kotonoha.name })
  } else if (reason.kind === 'error') {
    clearDegradedTimer()
    state.pendingText = ''
    await handleTurnError(reason)
  } else if (reason.kind === 'degraded') {
    // 降级帧：主 provider 失败 → 已切 fallback 重试整个流。
    // 不结束对话、不发 model:done、不清 busy（保持等待状态，后续应有 text-delta）。
    emit({ type: 'degraded', from: reason.from, to: reason.to, message: reason.message || '' })
    // 兼容「degraded 作为最终 finish」的后端实现：3s 内无新 chunk 则按错误处理复位界面
    state.degradedTimer = setTimeout(() => {
      state.degradedTimer = null
      if (!state.busy) return
      state.busy = false
      state.pendingText = ''
      state.pendingPrompt = null
      console.warn('[bridge] 降级后 3s 无后续响应，按错误处理复位')
      emit({ type: 'error', message: `模型降级后无响应（${reason.from || '?'} → ${reason.to || '?'}）` })
      emit({ type: 'status', state: 'ready' })
    }, DEGRADED_TIMEOUT_MS)
  }
  // reason.kind === 'tool-calls'：工具调用后还会继续出 block，保持 thinking，不动
  // 注：tool-calls 分支不主动清 degradedTimer——若降级后紧跟工具调用，
  // 后续 text-delta/finish 到来时会在 chunk 入口统一清除。
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
      await api('session.selectModel', { sessionId: state.sessionId, provider: FALLBACK_PROVIDER, model: FALLBACK_MODEL })
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
  if (!trimmed || state.busy) return
  try {
    await ensureSession()
    state.pendingPrompt = trimmed
    emit({ type: 'user', text: trimmed, name: '你' })
    // 技能硬调控软层：按开关注入约束段
    const constraint = skills.buildConstraintSegment(skills.getSkillState())
    const content = [{ type: 'text', text: trimmed }]
    if (constraint) content.push({ type: 'text', text: constraint })
    await api('session.prompt', { sessionId: state.sessionId, mode: 'queue', content })
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

// ---- Agent 面板扩展（ESC 面板 Git 页签用；其余面板方法见 rpc.js）----

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
  window.__bridgeDebug = { state, listeners: listenerCount(), wsReady: state.ws ? state.ws.readyState : -1 }
}

// ---- 导出面（与原 bridge.js 完全一致）----
// RPC 方法域从 rpc.js 具名再导出（保持既有 named import 兼容）
export {
  listTools, listProviders, exportSession, importSession, archiveSession, unarchiveSession,
  listArchivedSessions, compressSession, getRules, setRules, mcpStatus, selectModel,
  listToolsets, getActiveToolsets, setActiveToolsets, searchSession, interruptSession,
  getCostStats, getDegradations, listMemories, listSkills, approveSkill, rejectSkill, getTrajectory,
  getBond,
  sessionFork, sessionRename, getCredentialsStatus, getMcpInfo,
} from './rpc'
export { onEvent } from './events'
export { respondApproval }

export default {
  // 基础
  init,
  sendMessage,
  onEvent,
  // 故事/存档
  enterStory, newSave, saveNow, updateSavePreview, leaveDialog,
  // 面板扩展（Git 走会话消息，其余面板方法在 rpc.js）
  getGitStatus, sendCommandToAgent,
  // Round-2 / Harness v2-v3（rpcMethods = rpc.js 全部导出，剔除内部 bindBridgeState）
  ...rpcMethods,
  // 审批
  respondApproval,
  CHARACTERS,
}
