// ============================================================
// registry.ts —— 工具注册表：ToolRegistry + buildDefaultTools
// 契约：types.ts Tool
// ============================================================

import type { Tool } from '../types'

export type { Tool } from '../types'

import { readFileTool, writeFileTool } from './file'
import { editFileTool } from './file-edit'
import { globTool } from './glob'
import { grepTool } from './grep'
import { taskTool } from './task'
import { bashTool } from './bash'

// 保留原有工具导出（供其它模块按需引用）
export { runCommandTool } from './terminal'
export { gitStatusTool, gitCommitTool, gitLogTool } from './git'
export { fetchUrlTool, webSearchTool } from './web'
export { executeSkillTool } from './skills'

// 7 核心工具：read_file, write_file, edit_file, glob, grep, task, bash
export function buildDefaultTools(): Tool[] {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    globTool,
    grepTool,
    taskTool,
    bashTool,
  ]
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>()

  register(t: Tool): void {
    this.tools.set(t.def.name, t)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  list(): Tool[] {
    return Array.from(this.tools.values())
  }
}