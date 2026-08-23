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
import { runCommandTool } from './terminal'
import { gitStatusTool, gitCommitTool, gitLogTool } from './git'
import { fetchUrlTool, webSearchTool } from './web'
import { executeSkillTool } from './skills'

// 全部工具（核心 7 + 遗留工具，供注册表/前端清单使用）
export function buildDefaultTools(): Tool[] {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    globTool,
    grepTool,
    taskTool,
    bashTool,
    runCommandTool,
    gitStatusTool,
    gitCommitTool,
    gitLogTool,
    fetchUrlTool,
    webSearchTool,
    executeSkillTool,
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