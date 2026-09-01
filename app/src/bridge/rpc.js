// ============================================================
// rpc.js —— Round-2 / Harness v2-v3 RPC 方法 + 面板扩展（凭据/MCP 等）
//
// 契约见 docs/plans/rpc-contract-round2.md、docs/plans/frontend-v2v3.md。
// 全部复用 api()（rpc-core）：成功返回 { ok:true, ...数据 }，失败返回 { ok:false, error }。
// 简单直通的 RPC 由 makeApi 工厂一行生成；需要入参校验/会话 ID 兜底的保留薄包装。
// 导出签名与原 bridge.js 完全一致（App/Panel 零改动）。
// ============================================================

import { api, makeApi, needSid, needId } from './rpc-core'

// bridge.js 初始化时注入内部 state（会话 ID 兜底用；同一对象引用，状态实时可见）
let bridgeState = null

/** bridge.js 调用：注入内部 state。 */
export function bindBridgeState(state) {
  bridgeState = state
}

// ---- 工具 / Provider ----
/** 工具目录（tools.list）：value { tools:[{name,description}] }。 */
export const listTools = makeApi('tools.list', { map: (v) => ({ tools: v?.tools || [] }) })

/** Provider 目录（providers.list）：value { defaultId, providers:[{id,name,capabilities?,models:[{id,name?}]}] }。 */
export const listProviders = makeApi('providers.list', { map: (v) => ({ defaultId: v?.defaultId || null, providers: v?.providers || [] }) })

// ---- 会话操作 ----
const renameRpc = makeApi('session.rename')
/** 重命名当前会话（dsh session.rename）。 */
export async function sessionRename(label) {
  if (!bridgeState?.sessionId) return { ok: false, error: '会话未就绪' }
  const name = (label || '').trim()
  if (!name) return { ok: false, error: '名称不能为空' }
  return renameRpc({ sessionId: bridgeState.sessionId, label: name })
}

/** Fork 当前会话（dsh session.fork）：返回新会话 ID。 */
export async function sessionFork() {
  if (!bridgeState?.sessionId) return { ok: false, error: '会话未就绪' }
  try {
    const value = await api('session.fork', { sessionId: bridgeState.sessionId })
    const id = value?.sessionId || value?.id || null
    return id ? { ok: true, sessionId: id } : { ok: false, error: 'fork 返回异常' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

const exportSessionRpc = makeApi('session.export', { guard: needSid, map: (v) => ({ filename: v?.filename || '', content: v?.content || '' }) })
/** 导出会话（session.export）：payload { sessionId, format:'json'|'markdown' } → value { filename, content }。 */
export const exportSession = (sessionId, format) =>
  exportSessionRpc({ sessionId, format: format === 'markdown' ? 'markdown' : 'json' })

const importSessionRpc = makeApi('session.import', { guard: (p) => (p?.content ? null : '缺少会话内容'), map: (v) => ({ sessionId: v?.sessionId || null }) })
/** 导入会话（session.import）：payload { content, format:'json' } → value { sessionId }。 */
export const importSession = (content) => importSessionRpc({ content, format: 'json' })

const archiveRpc = makeApi('session.archive', { guard: needSid })
const unarchiveRpc = makeApi('session.unarchive', { guard: needSid })
/** 归档会话（session.archive）：payload { sessionId } → value { ok:true }。 */
export const archiveSession = (sessionId) => archiveRpc({ sessionId })
/** 恢复归档会话（session.unarchive）：payload { sessionId } → value { ok:true }。 */
export const unarchiveSession = (sessionId) => unarchiveRpc({ sessionId })

/** 已归档会话列表（session.listArchived）：value { sessions:[SessionRecord…] }。 */
export const listArchivedSessions = makeApi('session.listArchived', { map: (v) => ({ sessions: v?.sessions || [] }) })

const compressRpc = makeApi('session.compress', { guard: needSid, map: (v) => ({ summary: v?.summary || null }) })
/** 压缩会话（session.compress）：payload { sessionId, keepRecent?=5 } → value { ok:true, summary? }。 */
export function compressSession(sessionId, keepRecent) {
  const payload = { sessionId }
  if (keepRecent !== undefined && keepRecent !== null) payload.keepRecent = keepRecent
  return compressRpc(payload)
}

// ---- 审批规则 ----
/** 审批规则（rules.get）：value { rules:[{tool,level}] }。 */
export const getRules = makeApi('rules.get', { map: (v) => ({ rules: v?.rules || [] }) })

const setRulesRpc = makeApi('rules.set')
/** 写入审批规则（rules.set）：payload { rules:[{tool,level}] } → value { ok:true }。 */
export const setRules = (rules) => setRulesRpc({ rules: rules || [] })

// ---- MCP / 凭据 / 模型 ----
/** MCP 服务器状态（mcp.status）：value { servers:[{id,type,status,tools?}] }（不自动连接）。 */
export const mcpStatus = makeApi('mcp.status', { map: (v) => ({ servers: v?.servers || [] }) })

const selectModelRpc = makeApi('session.selectModel', { guard: needSid })
/** 切换会话模型（session.selectModel）：payload { sessionId, provider, model }。 */
export function selectModel(provider, model, sessionId) {
  return selectModelRpc({ sessionId: sessionId || bridgeState?.sessionId, provider, model })
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

// ---- Harness v2/v3：工具集 ----
/** 工具集目录（toolsets.list）：value { toolsets:[{name,description,tools}] }。 */
export const listToolsets = makeApi('toolsets.list', { map: (v) => ({ toolsets: v?.toolsets || [] }) })

const activeToolsetsRpc = makeApi('toolsets.active', { guard: needSid, map: (v) => ({ toolsets: v?.toolsets || v?.active || [] }) })
/** 当前会话激活的工具集（toolsets.active）：value 兼容 {toolsets:[...]} / {active:[...]}。 */
export function getActiveToolsets(sessionId) {
  return activeToolsetsRpc({ sessionId: sessionId || bridgeState?.sessionId })
}

const setToolsetsRpc = makeApi('toolsets.set', { guard: needSid })
/** 设置当前会话激活的工具集（toolsets.set）：payload { sessionId, names } → value { ok }。 */
export function setActiveToolsets(sessionId, names) {
  return setToolsetsRpc({ sessionId: sessionId || bridgeState?.sessionId, names: names || [] })
}

// ---- Harness v2/v3：搜索 / 中断 ----
const searchRpc = makeApi('session.search', { map: (v) => ({ results: v?.results || [] }) })
/** 搜索会话历史（session.search）：payload { sessionId, query, limit? } → value { results:[...] }。 */
export function searchSession(sessionId, query, limit) {
  const sid = sessionId || bridgeState?.sessionId
  if (!sid) return { ok: false, error: '会话未就绪' }
  if (!query) return { ok: false, error: '缺少搜索关键词' }
  const payload = { sessionId: sid, query }
  if (limit !== undefined && limit !== null) payload.limit = limit
  return searchRpc(payload)
}

const interruptRpc = makeApi('session.interrupt', { guard: needSid })
/** 中断当前生成（session.interrupt）：payload { sessionId } → value { ok }。 */
export function interruptSession(sessionId) {
  return interruptRpc({ sessionId: sessionId || bridgeState?.sessionId })
}

// ---- 羁绊（v0.2.2 M6c）----
/** 羁绊状态（bond.get）：value { points, interactions, level(0-3), levelName, todayGain }。
 *  后端 B1 并行实现中；未就绪时返回 { ok:false }，面板容错显示。 */
export const getBond = makeApi('bond.get', {
  map: (v) => ({
    points: v?.points ?? 0,
    interactions: v?.interactions ?? 0,
    level: v?.level ?? 0,
    levelName: v?.levelName || '',
    todayGain: v?.todayGain ?? 0,
  }),
})

// ---- Harness v2/v3：统计 / 记忆 / 技能 ----
/** 成本统计（stats.cost）：value { total, bySession }。 */
export const getCostStats = makeApi('stats.cost', { map: (v) => ({ total: v?.total || 0, bySession: v?.bySession || v?.sessions || {} }) })

/** 降级记录（stats.degradations，M4 后端实现中）：value { degradations:[{ts, from, to, reason}] }。 */
export const getDegradations = makeApi('stats.degradations', { map: (v) => ({ degradations: v?.degradations || [] }) })

const memoriesRpc = makeApi('memory.list', { map: (v) => ({ memories: v?.memories || [] }) })
/** 语义记忆列表（memory.list）：payload { sessionId? } → value { memories:[...] }。 */
export const listMemories = (sessionId) => memoriesRpc(sessionId ? { sessionId } : {})

/** 技能列表（skills.list）：value { skills:[...] }（含 pending 项）。 */
export const listSkills = makeApi('skills.list', { map: (v) => ({ skills: v?.skills || [] }) })

const approveRpc = makeApi('skills.approve', { guard: needId })
const rejectRpc = makeApi('skills.reject', { guard: needId })
/** 批准技能（skills.approve）：payload { id } → value { ok }。 */
export const approveSkill = (id) => approveRpc({ id })
/** 拒绝技能（skills.reject）：payload { id } → value { ok }。 */
export const rejectSkill = (id) => rejectRpc({ id })

const trajectoryRpc = makeApi('session.trajectory', { guard: needSid, map: (v) => ({ trajectory: v?.trajectory || [] }) })
/** 会话轨迹（session.trajectory）：payload { sessionId } → value { trajectory:[...] }。 */
export function getTrajectory(sessionId) {
  return trajectoryRpc({ sessionId: sessionId || bridgeState?.sessionId })
}
