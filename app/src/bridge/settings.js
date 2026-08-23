// ============================================================
// settings.js —— 设置面板的桥接层：本地设置 + harness 模型/凭据 RPC
//
// 协议：与 bridge.js 相同的 Typert RPC（POST /api/<method>，
// body { type:'client-request', rpcId, method, payload }，
// 响应 result.ok 判断成败）。本模块自带一份 api() 拷贝，不改动 bridge.js。
//
// harness 真实端点（自研 Agent Harness，2026-08-23 对齐）：
//   - providers.list   payload {}  → value { defaultId, providers:[{id,name,capabilities?,models:[{id,name?}]}] }
//   - session.list     payload {}  → value [{sessionId,cwd,label,provider,model,...}]
//   - session.selectModel payload { sessionId, provider, model } → value { ok }
//   - credentials.describe payload { refs: string[] } → value { refs:[{ref,configured,source}] }
//   - credentials.set   payload { ref, value } → value {}
//   - credentials.unset payload { ref } → value {}
// ============================================================

const SETTINGS_KEY = 'kotonoha:settings'
const BASE_CWD = 'E:\\Kotonoha'

// ---- 已知 provider → 凭据 ref 的显式映射 ----
const KNOWN_REF = {
  'deepseek-official': 'DEEPSEEK_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  agnes: 'AGNES_API_KEY',
  ollama: 'OLLAMA_API_KEY',
}

// ---- 默认设置 ----
const DEFAULTS = {
  textSpeed: 40, // ms/字，打字机速度，范围 20~120
  scene: 'bg-room', // 背景图文件名：bg-room（书房夜景）| bg-night（夜空天台）
  showCharacter: true, // 是否显示立绘
}

// ---- RPC ----
function rpcId() {
  return crypto.randomUUID()
}

// Electron 打包后无 vite proxy：preload 注入实际地址；浏览器 dev 走相对路径
const API_BASE = (typeof window !== 'undefined' && window.__KOTONOHA_API_BASE__) || ''

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
    throw e
  }
  return data.result.value
}

// ---- 本地设置 ----
/** 读取设置：localStorage 键 kotonoha:settings，缺失字段用默认值补齐。 */
export function getSettings() {
  const merged = { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) Object.assign(merged, JSON.parse(raw))
  } catch (err) {
    console.error('[settings] read settings failed:', err)
  }
  // 防脏数据：数值字段按范围夹取
  if (typeof merged.textSpeed !== 'number') merged.textSpeed = DEFAULTS.textSpeed
  merged.textSpeed = Math.min(120, Math.max(20, Math.round(merged.textSpeed)))
  if (merged.scene !== 'bg-night') merged.scene = 'bg-room'
  merged.showCharacter = merged.showCharacter !== false
  return merged
}

/** 合并写入部分设置并持久化。@returns 合并后的完整设置对象 */
export function setSettings(partial) {
  const next = { ...getSettings(), ...(partial || {}) }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch (err) {
    console.error('[settings] write settings failed:', err)
  }
  return next
}

// ---- 模型信息（harness providers.list + session.list）----
/**
 * 读取当前会话模型信息 + provider 目录（纯 harness API）。
 * @returns {Promise<{ current, groups, providers }|null>}
 *   current   最近活跃会话的 { provider, model }（无会话时为默认 provider）
 *   groups    provider 分组视图 [{ id, name, models }]（兼容旧结构，供 UI 复用）
 *   providers providers.list 原始数组
 */
export async function getModelInfo() {
  try {
    const lp = await api('providers.list', {})
    const providers = lp?.providers || []
    const defaultId = lp?.defaultId || providers[0]?.id || ''
    // 最近活跃会话的模型选择
    let current = { provider: defaultId, model: '' }
    try {
      const list = await api('session.list', {})
      const sessions = Array.isArray(list) ? list : list?.items || []
      if (sessions.length > 0) {
        const top = sessions[0]
        current = { provider: top.provider || defaultId, model: top.model || '' }
      }
    } catch {
      /* 无会话，用默认 */
    }
    const groups = providers.map((p) => ({
      id: p.id,
      name: p.name || p.id,
      models: p.models || [],
    }))
    return { current, groups, providers }
  } catch (err) {
    console.error('[settings] getModelInfo failed:', err.message)
    return null
  }
}

// ---- 凭据 ref 解析 ----
/** provider 路由 id → 环境变量名风格 ref。 */
export function deriveKeyRef(provider) {
  const known = KNOWN_REF[String(provider || '')]
  if (known) return known
  return `${String(provider || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** 解析 provider 对应的凭据 ref（KNOWN_REF 优先，兜底 deriveKeyRef）。 */
export async function getCredentialRef(provider) {
  return deriveKeyRef(provider)
}

// ---- 写入密钥 ----
/**
 * 通过 harness credentials.set 写入 provider 的 API 密钥。
 * @param {string} provider provider 路由 id（如 'deepseek-official'）
 * @param {string} apiKey  API 密钥原文
 * @returns {Promise<{ ok:boolean, ref?:string, error?:string }>}
 */
export async function setApiKey(provider, apiKey) {
  try {
    const ref = await getCredentialRef(provider)
    await api('credentials.set', { ref, value: apiKey })
    return { ok: true, ref }
  } catch (err) {
    console.error('[settings] setApiKey failed:', err.message)
    return { ok: false, ref: null, error: err.message }
  }
}

/** 查询某 ref 当前是否已配置（供 UI 显示密钥状态；值本身永不出现在响应里）。 */
export async function getCredentialState(ref) {
  try {
    const desc = await api('credentials.describe', { refs: [ref] })
    const entry = (desc?.refs || []).find((x) => x.ref === ref)
    return entry || null
  } catch (err) {
    console.error('[settings] getCredentialState failed:', err.message)
    return null
  }
}

export default {
  getSettings,
  setSettings,
  getModelInfo,
  setApiKey,
  getCredentialRef,
  getCredentialState,
  deriveKeyRef,
}