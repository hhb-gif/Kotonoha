// ============================================================
// registry.ts —— 工具注册表：ToolRegistry + buildDefaultTools
// 增强：register 支持来源标记，list 支持过滤，内部维护扩展元信息
//       buildDefaultTools 由 builtin/ 目录自发现（discover.ts），
//       list({checkCtx}) / listAvailable 应用 check_fn 门控
// 契约：types.ts Tool + protocol.ts ExtendedTool
// ============================================================

import type { Tool, ToolCheckContext } from '../types'
import type { ExtendedTool, ToolKind, ToolGroup, ToolRegistration } from './protocol'
import { createExtendedTool, DEFAULT_KIND } from './protocol'
import { discoverBuiltinTools } from './discover'

export type { Tool } from '../types'
export type { ExtendedTool, ToolKind, ToolGroup, ToolRegistration } from './protocol'

/** 过滤器：用于 list() 查询 */
export interface ToolFilter {
  kind?: ToolKind
  group?: ToolGroup
  readOnly?: boolean
  namePrefix?: string
}

/** 注册选项 */
export interface RegisterOptions {
  kind?: ToolKind
  group?: ToolGroup
  readOnly?: boolean
  hooks?: ExtendedTool['hooks']
  mcpConnection?: unknown
  subAgentConfig?: ExtendedTool['subAgentConfig']
  source?: 'default' | 'mcp' | 'subagent' | 'dynamic'
  allowOverride?: boolean
}

/** 构建默认工具并扩展为 ExtendedTool（来源：builtin/ 目录自发现，兜底手动清单） */
export function buildDefaultTools(): ExtendedTool[] {
  return discoverBuiltinTools().map((t) => createExtendedTool(t, { kind: DEFAULT_KIND }))
}

/** 增强版工具注册表 */
export class ToolRegistry {
  private readonly tools = new Map<string, ExtendedTool>()
  private readonly registrations = new Map<string, ToolRegistration>()

  /** 注册工具（支持来源标记、同名校验、协议字段扩展） */
  register(tool: Tool | ExtendedTool, options: RegisterOptions = {}): void {
    const name = tool.def.name

    // 同名校验
    if (this.tools.has(name) && !options.allowOverride) {
      throw new Error(`工具已存在：${name}，使用 allowOverride: true 覆盖`)
    }

    // 扩展为 ExtendedTool（若已是则保留/合并字段）
    const extended: ExtendedTool = 'kind' in tool
      ? {
          ...tool,
          kind: options.kind ?? tool.kind ?? DEFAULT_KIND,
          group: options.group ?? tool.group,
          readOnly: options.readOnly ?? tool.readOnly,
          hooks: options.hooks ?? tool.hooks,
          mcpConnection: options.mcpConnection ?? tool.mcpConnection,
          subAgentConfig: options.subAgentConfig ?? tool.subAgentConfig,
        }
      : createExtendedTool(tool, {
          kind: options.kind,
          group: options.group,
          readOnly: options.readOnly,
          hooks: options.hooks,
          mcpConnection: options.mcpConnection,
          subAgentConfig: options.subAgentConfig,
        })

    this.tools.set(name, extended)
    this.registrations.set(name, {
      tool: extended,
      registeredAt: Date.now(),
      source: options.source ?? 'dynamic',
    })
  }

  /** 批量注册 */
  registerAll(tools: (Tool | ExtendedTool)[], options: RegisterOptions = {}): void {
    for (const t of tools) this.register(t, options)
  }

  /** 获取单个工具（返回基础 Tool 兼容现有代码） */
  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  /** 获取扩展工具（包含协议字段） */
  getExtended(name: string): ExtendedTool | undefined {
    return this.tools.get(name)
  }

  /** 列出所有工具（兼容现有：返回 Tool[]；可传 checkCtx 应用同步 check_fn） */
  list(opts?: { checkCtx?: ToolCheckContext }): Tool[] {
    const all = Array.from(this.tools.values())
    if (!opts?.checkCtx) return all
    // 同步路径：只过滤同步 check（false 即隐藏）；异步 check 无法同步求值 → 保留，
    // 需要完整门控（含异步 check）时用 listAvailable
    return all.filter((t) => this.passesCheckSync(t, opts.checkCtx!))
  }

  /** 完整应用 check_fn（同步+异步）后列出；engine 组装 schema 用 */
  async listAvailable(opts?: { checkCtx?: ToolCheckContext }): Promise<ExtendedTool[]> {
    const all = Array.from(this.tools.values())
    if (!opts?.checkCtx) return all
    const out: ExtendedTool[] = []
    for (const t of all) {
      if (await this.passesCheck(t, opts.checkCtx)) out.push(t)
    }
    return out
  }

  /** check_fn 求值：无 check 视为可用；支持同步/异步返回值 */
  private async passesCheck(t: ExtendedTool, ctx: ToolCheckContext): Promise<boolean> {
    if (!t.check) return true
    try {
      const pass = await t.check(ctx)
      return pass !== false
    } catch {
      // check 抛异常按不可用处理（不阻断整体列出）
      return false
    }
  }

  /** 同步求值：仅处理非 Promise 返回值；异步 check 一律视为通过（交给 listAvailable） */
  private passesCheckSync(t: ExtendedTool, ctx: ToolCheckContext): boolean {
    if (!t.check) return true
    try {
      const pass = t.check(ctx)
      if (pass instanceof Promise) return true
      return pass !== false
    } catch {
      return false
    }
  }

  /** 列出扩展工具（含协议字段） */
  listExtended(): ExtendedTool[] {
    return Array.from(this.tools.values())
  }

  /** 带过滤器的列表查询 */
  listFiltered(filter: ToolFilter = {}): ExtendedTool[] {
    return Array.from(this.tools.values()).filter((t) => {
      if (filter.kind && t.kind !== filter.kind) return false
      if (filter.group && t.group !== filter.group) return false
      if (filter.readOnly !== undefined && t.readOnly !== filter.readOnly) return false
      if (filter.namePrefix && !t.def.name.startsWith(filter.namePrefix)) return false
      return true
    })
  }

  /** 获取只读工具（用于并行调度） */
  getReadOnlyTools(): ExtendedTool[] {
    return this.listFiltered({ readOnly: true })
  }

  /** 获取写工具（需串行+审批） */
  getWriteTools(): ExtendedTool[] {
    return this.listFiltered({ readOnly: false })
  }

  /** 按分组获取工具 */
  getByGroup(group: ToolGroup): ExtendedTool[] {
    return this.listFiltered({ group })
  }

  /** 按类型获取工具 */
  getByKind(kind: ToolKind): ExtendedTool[] {
    return this.listFiltered({ kind })
  }

  /** 检查工具是否存在 */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /** 移除工具 */
  unregister(name: string): boolean {
    this.registrations.delete(name)
    return this.tools.delete(name)
  }

  /** 清空注册表 */
  clear(): void {
    this.tools.clear()
    this.registrations.clear()
  }

  /** 获取注册元信息 */
  getRegistration(name: string): ToolRegistration | undefined {
    return this.registrations.get(name)
  }

  /** 获取所有注册元信息 */
  getAllRegistrations(): ToolRegistration[] {
    return Array.from(this.registrations.values())
  }

  /** 获取工具数量 */
  get size(): number {
    return this.tools.size
  }

  /** 创建预填充默认工具的注册表实例 */
  static createDefault(): ToolRegistry {
    const registry = new ToolRegistry()
    registry.registerAll(buildDefaultTools(), { source: 'default' })
    return registry
  }
}