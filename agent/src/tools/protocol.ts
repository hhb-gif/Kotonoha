// ============================================================
// protocol.ts —— 统一工具协议：内置 / MCP / 子 agent 三类工具同一接口
// 契约：types.ts Tool 为基础，本文件提供扩展接口，不破坏现有 Tool
// ============================================================

import type { Tool, ToolContext, ToolResult } from '../types'

// 工具类型：内置 / MCP / 子 agent / 配置驱动（external，动态生成）
export type ToolKind = 'builtin' | 'mcp' | 'subagent' | 'dynamic'

// 工具分组：用于并行调度、权限、UI 分类
export type ToolGroup =
  | 'fs'          // 文件系统
  | 'terminal'    // 终端/命令
  | 'git'         // Git 操作
  | 'web'         // 网络/搜索
  | 'skill'       // 技能执行
  | 'mcp'         // MCP 工具
  | 'subagent'    // 子 agent 编排
  | 'checkpoint'  // 检查点工具
  | 'plugin'      // 插件注册的工具（toolsets 集 plugins:<name> 的成员）
  | 'external'    // 配置驱动外接工具（tool.yaml：shell / HTTP）

// Hook 定义
export interface ToolHooks {
  /** 执行前钩子：可拦截（抛出错误即拦截），可修改 args（返回新 args） */
  before?: (tool: Tool, args: unknown, ctx: ToolContext) => void | Promise<void | unknown>
  /** 执行后钩子：可观测结果、记录审计、清理副作用 */
  after?: (tool: Tool, result: ToolResult, ctx: ToolContext) => void | Promise<void>
}

// 扩展工具接口：在 Tool 基础上新增协议字段
// 注意：不修改 types.ts 的 Tool，而是定义扩展接口供注册表/运行时使用
export interface ExtendedTool extends Tool {
  /** 工具来源类型 */
  kind: ToolKind
  /** 工具分组 */
  group: ToolGroup
  /** 是否只读（不修改文件系统/状态），用于并行调度判断 */
  readOnly: boolean
  /** 生命周期钩子 */
  hooks?: ToolHooks
  /** MCP 专用：原始连接引用（用于资源/提示词访问） */
  mcpConnection?: unknown
  /** 子 agent 专用：子会话配置 */
  subAgentConfig?: {
    maxTurns?: number
    allowedTools?: string[]
  }
}

// 类型守卫
export function isExtendedTool(t: Tool): t is ExtendedTool {
  return 'kind' in t && 'group' in t && 'readOnly' in t
}

// 默认分组映射（按工具名推断）
export const DEFAULT_GROUP_MAP: Record<string, ToolGroup> = {
  read_file: 'fs',
  write_file: 'fs',
  edit_file: 'fs',
  glob: 'fs',
  grep: 'fs',
  bash: 'terminal',
  run_command: 'terminal',
  git_status: 'git',
  git_commit: 'git',
  git_log: 'git',
  fetch_url: 'web',
  web_search: 'web',
  execute_skill: 'skill',
  task: 'subagent',
  kotonoha_checkpoint: 'checkpoint',
  kotonoha_undo: 'checkpoint',
}

// 默认只读判断
export const DEFAULT_READONLY_MAP: Record<string, boolean> = {
  read_file: true,
  glob: true,
  grep: true,
  git_status: true,
  git_log: true,
  fetch_url: true,
  web_search: true,
  execute_skill: true,
  kotonoha_checkpoint: false, // 写入 git
  kotonoha_undo: false,       // 写入 git
  write_file: false,
  edit_file: false,
  bash: false,
  run_command: false,
  git_commit: false,
  task: false,
}

// 默认 kind
export const DEFAULT_KIND: ToolKind = 'builtin'

// 创建扩展工具的辅助函数
export function createExtendedTool(
  baseTool: Tool,
  options: {
    kind?: ToolKind
    group?: ToolGroup
    readOnly?: boolean
    hooks?: ToolHooks
    mcpConnection?: unknown
    subAgentConfig?: ExtendedTool['subAgentConfig']
    // check_fn 门控（缺省透传 baseTool.check）
    check?: ExtendedTool['check']
  } = {}
): ExtendedTool {
  const name = baseTool.def.name
  return {
    ...baseTool,
    kind: options.kind ?? DEFAULT_KIND,
    group: options.group ?? DEFAULT_GROUP_MAP[name] ?? 'fs',
    readOnly: options.readOnly ?? DEFAULT_READONLY_MAP[name] ?? false,
    hooks: options.hooks,
    mcpConnection: options.mcpConnection,
    subAgentConfig: options.subAgentConfig,
    check: options.check ?? baseTool.check,
  }
}

// 工具注册元信息（用于注册表内部记录来源）
export interface ToolRegistration {
  tool: ExtendedTool
  registeredAt: number
  source: 'default' | 'mcp' | 'subagent' | 'dynamic'
}

// 协议版本（用于兼容性检查）
export const PROTOCOL_VERSION = '2.0.0'