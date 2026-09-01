// ============================================================
// store/mcp-config.ts —— MCP 用户服务器配置持久化（settings 表）
// 存储格式：settings key `mcp:servers` = JSON 数组
//   [{ id, type:'stdio'|'sse', command?, args?, url?, headers?, enabled }]
// builtin 3 个内置服务器不走此表（mcp/index.ts 硬编码），此处只管用户添加的
// 中文注释、英文标识符
// ============================================================

import type { Db } from './db'

/** 用户 MCP 服务器配置项（settings 表持久化格式） */
export interface McpServerConfigEntry {
  id: string
  type: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  enabled: boolean
}

const MCP_SERVERS_KEY = 'mcp:servers'

/** 配置项合法性检查：id 非空、type 合法、stdio 有 command、sse 有 url */
function isValidEntry(v: unknown): v is McpServerConfigEntry {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  if (typeof e.id !== 'string' || !e.id.trim()) return false
  if (e.type !== 'stdio' && e.type !== 'sse') return false
  if (e.type === 'stdio' && (typeof e.command !== 'string' || !e.command.trim())) return false
  if (e.type === 'sse' && (typeof e.url !== 'string' || !e.url.trim())) return false
  return true
}

/** 读取用户 MCP 服务器配置（坏数据静默丢弃，返回空数组兜底） */
export function loadMcpServerConfigs(db: Db): McpServerConfigEntry[] {
  // db.getSetting 内部已 JSON.parse 一次；防御历史数据双重序列化的情况
  let parsed: unknown = db.getSetting(MCP_SERVERS_KEY)
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isValidEntry)
}

/** 保存用户 MCP 服务器配置（整体覆盖写） */
export function saveMcpServerConfigs(db: Db, entries: McpServerConfigEntry[]): void {
  db.setSetting(MCP_SERVERS_KEY, entries)
}
