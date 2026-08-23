// ============================================================
// toolsets.ts —— 工具集定义与解析（门类化 + 渐进披露）
// 契约：types.ts Tool；与 registry.ts 解耦（只依赖 Tool.def.name）
// 中文注释、英文标识符
// ============================================================

/** 工具集定义：一组工具的命名组合 */
export interface Toolset {
  name: string
  description: string
  /** 工具名或通配：'*' 匹配全部；'prefix:*' 匹配前缀（如 mcp:、plugins:，为外接工具预留） */
  tools: string[]
}

// 内置工具集（规划 harness-v3-tools.md 第三节门类划分）
// core/dev/web/memory 为会话默认激活（全开，不破坏现有工具可用性）
export const BUILTIN_TOOLSETS: readonly Toolset[] = [
  {
    name: 'core',
    description: '通用基础：文件读取、搜索、命令执行、任务编排、技能、检查点',
    tools: [
      'read_file',
      'grep',
      'glob',
      'bash',
      'task',
      'execute_skill',
      'kotonoha_checkpoint',
      'kotonoha_undo',
    ],
  },
  {
    name: 'dev',
    description: '开发工作：文件写入、编辑、终端命令、Git 操作',
    tools: ['write_file', 'edit_file', 'run_command', 'git_status', 'git_commit', 'git_log'],
  },
  {
    name: 'web',
    description: '联网：抓取网页、网络搜索',
    tools: ['fetch_url', 'web_search'],
  },
  {
    name: 'memory',
    description: '记忆与技能：自定义技能执行（与 core 的 execute_skill 重叠，独立成集便于单独关闭）',
    tools: ['execute_skill'],
  },
]

/** 会话默认激活工具集（全开，不破坏现有行为；切换是增量优化） */
export const DEFAULT_ACTIVE_TOOLSETS: readonly string[] = ['core', 'dev', 'web', 'memory']

/** 列出全部内置工具集（返回副本，防外部篡改） */
export function listToolsets(): Toolset[] {
  return BUILTIN_TOOLSETS.map((t) => ({ ...t, tools: [...t.tools] }))
}

/** 工具名是否匹配工具集条目（精确名 / '*' / 'prefix:*' 前缀通配） */
function matchPattern(pattern: string, toolName: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith(':*')) {
    return toolName.startsWith(pattern.slice(0, -1))
  }
  return pattern === toolName
}

/**
 * 按激活工具集过滤工具列表（渐进披露：engine 组装 schema 前调用）。
 * - 保序、按工具出现顺序去重（一个工具可属于多个集，只保留一次）
 * - 未知工具集名忽略；空激活列表 → 返回 []
 */
export function resolveToolsets<T extends { def: { name: string } }>(
  tools: T[],
  activeNames: string[]
): T[] {
  if (activeNames.length === 0) return []
  const patterns = new Set<string>()
  for (const name of activeNames) {
    const set = BUILTIN_TOOLSETS.find((s) => s.name === name)
    if (!set) continue // 未知工具集：忽略
    for (const p of set.tools) patterns.add(p)
  }
  if (patterns.size === 0) return []
  const patternList = [...patterns]
  const seen = new Set<string>()
  const out: T[] = []
  for (const t of tools) {
    const n = t.def.name
    if (seen.has(n)) continue
    if (patternList.some((p) => matchPattern(p, n))) {
      seen.add(n)
      out.push(t)
    }
  }
  return out
}

/**
 * 校验工具集名：剔除未知集名、去重、保序。
 * 返回规范化后的激活列表（供 toolsets.set 持久化）。
 */
export function validateToolsetNames(names: string[]): string[] {
  const known = new Set(BUILTIN_TOOLSETS.map((s) => s.name))
  const out: string[] = []
  for (const n of names) {
    if (known.has(n) && !out.includes(n)) out.push(n)
  }
  return out
}

/** 获取工具所属的工具集名（用于 UI 展示/调试） */
export function toolsetOf(toolName: string): string[] {
  return BUILTIN_TOOLSETS.filter((s) => s.tools.some((p) => matchPattern(p, toolName))).map(
    (s) => s.name
  )
}