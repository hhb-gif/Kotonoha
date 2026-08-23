// ============================================================
// types.ts —— 插件协议（T3-plugins）
// 用户不写核心代码即可加工具：一个目录（plugin.yaml + index.ts）即一个插件
// 契约：types.ts Tool / protocol.ts ExtendedTool / hooks.ts Hook
// 中文注释、英文标识符
// ============================================================

import type { Tool } from '../../types'
import type { ExtendedTool } from '../protocol'
import type { Hook } from '../hooks'

/** 插件清单（plugin.yaml 内容） */
export interface PluginManifest {
  /** 插件名（必填，唯一标识；同时是 toolsets 集名 plugins:<name> 的组成部分） */
  name: string
  /** 插件版本（可选） */
  version?: string
  /** 插件描述（可选，展示用） */
  description?: string
  /** 声明本插件提供的工具名列表（可选，用于披露/校验） */
  tools?: string[]
  /** 声明本插件提供的钩子 id 列表（可选，用于披露/校验） */
  hooks?: string[]
}

/**
 * 插件上下文（ctx）：register() 收到的唯一参数。
 * 插件通过 ctx API 注册工具 / 钩子，与内置工具走同一注册路径。
 */
export interface PluginContext {
  /** 本插件清单（来自 plugin.yaml；无 yaml 时由 loader 以目录名兜底） */
  manifest: PluginManifest
  /** 注册一个工具：Tool（自动补协议字段）或 ExtendedTool（保留完整字段）均可 */
  registerTool(tool: Tool | ExtendedTool): void
  /** 注册一个钩子（before 拦截/改写 args，after 观测审计），同 id 覆盖 */
  registerHook(hook: Hook): void
  /** 插件所在目录（相对 cwd 语义与内置工具一致：插件自身资源读取用绝对路径） */
  cwd: string
}

/**
 * 插件模块形态：index.ts 的导出约定。
 * 支持两种导出方式：
 *   1. 具名导出：`export const manifest` + `export function register`
 *   2. 默认导出：`export default { manifest, register }`
 * manifest 为可选——有 plugin.yaml 时以 yaml 为准，缺 yaml 时回退 module.manifest / 目录名
 */
export interface PluginModule {
  manifest?: PluginManifest
  register(ctx: PluginContext): void | Promise<void>
}