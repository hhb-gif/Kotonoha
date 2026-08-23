// ============================================================
// discover.ts —— 内置工具自发现：扫描 builtin/ 目录，模块导出即收录
// 契约：types.ts Tool
// 规则：
//   1. 扫描本文件同级 builtin/ 目录（dev: src/tools/builtin/*.ts；prod: dist/tools/builtin/*.js）
//   2. 模块顶层导出 Tool 形对象（def.name + run）即收录
//   3. 模块导出 register(ctx) 的，以 ctx.registerTool 收录（顶层注册模式）
//   4. 目录不存在或未发现任何工具 → 回落 FALLBACK_BUILTIN_TOOLS（现有工具手动清单）
// 中文注释、英文标识符
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import type { Tool } from '../types'

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
import { checkpointTools } from './checkpoint'

// 手动清单兜底：现有全部内置工具（14 基础 + 2 checkpoint）
// 待工具文件逐步迁入 builtin/ 目录后，此清单可整体删除
export const FALLBACK_BUILTIN_TOOLS: Tool[] = [
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
  ...checkpointTools,
]

/** 判断导出值是否形如 Tool 对象 */
function isToolLike(v: unknown): v is Tool {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const def = o.def as Record<string, unknown> | undefined
  return (
    !!def &&
    typeof def.name === 'string' &&
    typeof (o.run as unknown) === 'function'
  )
}

/** 扫描目录下所有模块（.ts dev / .js prod），收集顶层导出的工具 */
function scanDir(dir: string): Tool[] {
  let files: string[]
  try {
    files = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: Tool[] = []
  for (const f of files) {
    if (!f.endsWith('.ts') && !f.endsWith('.js')) continue
    if (f.endsWith('.d.ts')) continue
    const abs = path.join(dir, f)
    let mod: Record<string, unknown>
    try {
      // require 动态加载：dev（tsx）可加载 .ts，prod 加载 .js
      mod = require(abs) as Record<string, unknown>
    } catch (e) {
      console.warn('[discover] 跳过模块加载失败:', abs, (e as Error).message)
      continue
    }
    // 模式一：顶层导出 Tool 形对象
    for (const key of Object.keys(mod)) {
      const v = mod[key]
      if (Array.isArray(v)) {
        // 数组导出（如 checkpointTools）：逐个收录
        for (const item of v) if (isToolLike(item)) out.push(item)
      } else if (isToolLike(v)) {
        out.push(v)
      }
    }
    // 模式二：导出 register(ctx) 的模块，以 ctx.registerTool 收录（顶层注册模式）
    if (typeof mod.register === 'function') {
      try {
        ;(mod.register as (ctx: { registerTool(t: Tool): void }) => void)({
          registerTool: (t) => out.push(t),
        })
      } catch (e) {
        console.warn('[discover] 模块 register 执行失败:', abs, (e as Error).message)
      }
    }
  }
  return out
}

/**
 * 自发现内置工具：
 * 优先扫描 builtin/ 目录（导出即收录），目录缺失或一无所获时回落手动清单。
 * 新增内置工具：放入 builtin/ 目录即可自动收录，无需改注册表。
 */
export function discoverBuiltinTools(): Tool[] {
  const dir = path.join(__dirname, 'builtin')
  const found = scanDir(dir)
  if (found.length > 0) {
    return found
  }
  // 目录不存在（现状：工具平铺在 tools/）→ 手动清单兜底，保证 16 工具全量可用
  return [...FALLBACK_BUILTIN_TOOLS]
}