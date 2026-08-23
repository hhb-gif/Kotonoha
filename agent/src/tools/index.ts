// ============================================================
// index.ts —— 工具模块统一导出
// ============================================================

export {
  buildDefaultTools,
  ToolRegistry,
  type ToolFilter,
  type RegisterOptions,
} from './registry'
export type { Tool } from './registry'
export type { ExtendedTool, ToolKind, ToolGroup, ToolRegistration, ToolHooks } from './protocol'
export { createExtendedTool, PROTOCOL_VERSION } from './protocol'

// T1-toolsets：工具集门类（定义/解析/校验/默认激活）
export {
  BUILTIN_TOOLSETS,
  DEFAULT_ACTIVE_TOOLSETS,
  listToolsets,
  resolveToolsets,
  validateToolsetNames,
  toolsetOf,
  type Toolset,
} from './toolsets'

// 内置工具自发现（builtin/ 目录扫描 + 手动清单兜底）
export { discoverBuiltinTools, FALLBACK_BUILTIN_TOOLS } from './discover'

// 工具钩子（M2-2.3）：HookRegistry + 内置审计/黑名单 + 执行器
export {
  HookRegistry,
  createAuditHook,
  createBashBlacklistHook,
  createDefaultHooks,
  runToolWithHooks,
  getTrajectory,
  summarizeArgs,
  type Hook,
  type BeforeHook,
  type AfterHook,
  type TrajectoryEntry,
} from './hooks'

// 内置工具导出（供外部直接引用）
export { readFileTool, writeFileTool } from './file'
export { editFileTool } from './file-edit'
export { globTool } from './glob'
export { grepTool } from './grep'
export { taskTool } from './task'
export { bashTool } from './bash'
export { runCommandTool } from './terminal'
export { gitStatusTool, gitCommitTool, gitLogTool } from './git'
export { fetchUrlTool, webSearchTool } from './web'
export { executeSkillTool } from './skills'

// 插件系统（T3-plugins）：扫描加载 + 协议类型
export { loadPlugins, type PluginLoadResult, type PluginError } from './plugins/loader'
export type { PluginManifest, PluginContext, PluginModule } from './plugins/types'

// 配置驱动外接工具（T2-external）：tool.yaml → shell/HTTP 工具
export {
  loadExternalTools,
  isToolsConfigFile,
  type ExternalLoadResult,
} from './external'
export { createShellTool } from './external/shell-tool'
export { createHttpTool } from './external/http-tool'
export type {
  ExternalToolConfig,
  ShellToolConfig,
  HttpToolConfig,
  AnyExternalToolConfig,
} from './external/types'