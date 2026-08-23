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