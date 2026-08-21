// ============================================================
// registry.ts —— 工具注册表：buildDefaultTools / ToolRegistry
// 契约：types.ts Tool
// ============================================================

import type { Tool } from '../types'

import { readFileTool, writeFileTool } from './file'
import { runCommandTool } from './terminal'
import { gitCommitTool, gitLogTool, gitStatusTool } from './git'
import { fetchUrlTool, webSearchTool } from './web'
import { executeSkillTool } from './skills'

// M0 九个工具：文件 2 + 终端 1 + git 3 + 网页 2 + 技能 1
export function buildDefaultTools(): Tool[] {
  return [
    readFileTool,
    writeFileTool,
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