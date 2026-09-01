// ============================================================
// rpc-core.js —— Typert RPC 底层（bridge 域拆分：底层协议 + 直通工厂）
//
// 协议：POST /api/<method>，body { type:'client-request', rpcId, method, payload }，
// 响应 result.ok 判断成败（失败抛错，带 code/details）。
// Electron 打包后无 vite proxy：preload 注入实际地址；浏览器 dev 走相对路径。
// ============================================================

export const API_BASE = (typeof window !== 'undefined' && window.__KOTONOHA_API_BASE__) || ''

export function rpcId() {
  return crypto.randomUUID()
}

/** 发起一次 RPC；result.ok !== true 时抛错（带 code/details）。 */
export async function api(method, payload) {
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

/**
 * 直通 RPC 工厂：guard(payload) 返回错误文案则短路；map(value) 规整响应字段（默认原样展开）。
 * 成功 → { ok:true, ...value }；失败 → { ok:false, error }。
 */
export function makeApi(method, { guard, map } = {}) {
  return async (payload = {}) => {
    const bad = guard ? guard(payload) : null
    if (bad) return { ok: false, error: bad }
    try {
      const value = await api(method, payload)
      return { ok: true, ...(map ? map(value) : value) }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }
}

// 入参守卫：会话 ID / 技能 ID
export const needSid = (p) => (p?.sessionId ? null : '会话未就绪')
export const needId = (p) => (p?.id ? null : '缺少技能 ID')
