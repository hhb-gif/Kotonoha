// ============================================================
// settings.js —— 设置面板的桥接层：本地设置 + dsh 模型/凭据 RPC
//
// 协议：与 bridge.js 相同的 Typert RPC（POST /api/<method>，
// body { type:'client-request', rpcId, method, payload }，
// 响应 result.ok 判断成败）。本模块自带一份 api() 拷贝，不改动 bridge.js。
//
// 探测依据（2026-08-19，dsh v0.1.0-rc.7，见 E:\Kotonoha\temp\probe-settings.mjs）：
//   - session.models      payload { sessionId }
//       → value { current:{provider,model,reasoningEffort?}, routable, groups:[{id,name,models:[...]}], failures:[...] }
//   - llm.providers       payload {}
//       → value { providers:[{provider,displayName,settingsNs,settingsPath,active,declared?}] }
//   - credentials.describe payload { refs: string[] }   ← refs 为必填数组，{} 会报 bad-request
//       → value { credentials:{ <REF>:{configured,source?,writable} } }（永远不含真实值）
//   - credentials.set     payload { ref, value } → value {}（失败时 error credential-rejected）
//   - credentials.unset   payload { ref }        → value {}（幂等）
//   - ref 命名：环境变量名风格（DEEPSEEK_API_KEY / OPENCODE_API_KEY）。
//     官方 UI 的 deriveKeyRef：`${provider.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}_API_KEY`；
//     若 settings 配置里显式写了 apiKeyEnv 则优先用那个值。
// ============================================================

const SETTINGS_KEY = 'kotonoha:settings'
const SAVE_KEY = 'kotonoha:save' // 与 bridge.js 的存档位一致，用于取 sessionId
const BASE_CWD = 'E:\\Kotonoha'

// ---- 已知 provider → 凭据 ref 的显式映射（探测到的实际配置键）----
const KNOWN_REF = {
  'deepseek-official': 'DEEPSEEK_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  opencode: 'OPENCODE_API_KEY',
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

/** 取当前会话的 sessionId（复用 bridge.js 的存档位，缺失时回退 session.list / session.create）。 */
async function resolveSessionId() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw) {
      const slot = JSON.parse(raw)
      if (slot?.sessionId) return slot.sessionId
    }
  } catch {
    /* 存档损坏则走回退 */
  }
  const list = await api('session.list', {})
  const items = list?.items || []
  if (items.length > 0) return items[0].sessionId
  const created = await api('session.create', { cwd: BASE_CWD })
  return created.sessionId
}

// ---- 模型信息 ----
/**
 * 读取当前会话的模型信息 + 可配置 provider 目录。
 * @returns {Promise<{ current, groups, providers }|null>}
 *   current  当前会话模型选择 { provider, model, reasoningEffort? }
 *   groups   session.models 的 provider 分组 [{ id, name, models }]
 *   providers llm.providers 的可配置 provider 视图 [{ provider, displayName, settingsNs, settingsPath, active }]
 * 任一步解析失败返回 null 并 console.error。
 */
export async function getModelInfo() {
  try {
    const sessionId = await resolveSessionId()
    const models = await api('session.models', { sessionId })
    let providers = []
    try {
      const llm = await api('llm.providers', {})
      providers = llm?.providers || []
    } catch (err) {
      console.error('[settings] llm.providers failed:', err.message)
      // 不致命：groups 已足够提供 provider 下拉
    }
    return {
      current: models?.current || null,
      groups: models?.groups || [],
      providers,
    }
  } catch (err) {
    console.error('[settings] getModelInfo failed:', err.message)
    return null
  }
}

// ---- 凭据 ref 解析 ----
/** provider 路由 id → 环境变量名风格 ref（官方 UI 同款规则）。 */
export function deriveKeyRef(provider) {
  return `${String(provider || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * 解析 provider 对应的凭据 ref：
 * 1) KNOWN_REF 显式映射（当前已配置的 deepseek-official / opencode）
 * 2) 该 provider 在 settings 配置里的 apiKeyEnv 字段
 * 3) 兜底 deriveKeyRef(provider)
 * @param {string} provider provider 路由 id
 * @returns {Promise<string>}
 */
export async function getCredentialRef(provider) {
  const p = String(provider || '')
  if (KNOWN_REF[p]) return KNOWN_REF[p]
  const providers = await safeProviders()
  const entry = providers.find((x) => x.provider === p || x.displayName === p)
  if (entry) {
    try {
      const desc = await api('settings.describe', {})
      const ns = (desc.namespaces || []).find((n) => n.ns === entry.settingsNs)
      let node = ns?.value
      for (const seg of entry.settingsPath || []) node = node?.[seg]
      if (node && typeof node.apiKeyEnv === 'string' && node.apiKeyEnv) return node.apiKeyEnv
    } catch (err) {
      console.error('[settings] resolve apiKeyEnv failed:', err.message)
    }
  }
  return deriveKeyRef(p)
}

async function safeProviders() {
  try {
    const llm = await api('llm.providers', {})
    return llm?.providers || []
  } catch {
    return []
  }
}

// ---- 写入密钥 ----
/**
 * 通过 dsh credentials.set 写入 provider 的 API 密钥。
 * @param {string} provider provider 路由 id（如 'deepseek-official' / 'opencode'）
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
    return desc?.credentials?.[ref] || null
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