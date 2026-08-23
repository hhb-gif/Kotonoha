// ============================================================
// loader.ts —— 插件扫描加载器（T3-plugins）
// 扫描 dir/*/plugin.yaml + 同名 index.ts（开发期源码）或 index.js（dist 编译后）
// 读取 manifest → 动态 import 入口 → 调 register(ctx) → 收集工具/钩子
// 错误隔离：单个插件失败（yaml 损坏 / import 失败 / register 抛错）只记入 errors，
//           console.warn 后跳过，不影响其它插件与启动
// 中文注释、英文标识符
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Tool } from '../../types'
import type { ExtendedTool } from '../protocol'
import { createExtendedTool, isExtendedTool } from '../protocol'
import type { Hook } from '../hooks'
import type { PluginContext, PluginManifest, PluginModule } from './types'
import { parseYamlSimple } from './yaml'

/** 单个插件的加载错误（不中断整体加载） */
export interface PluginError {
  /** 插件目录名（无 manifest 时用目录名标识） */
  name: string
  error: string
}

/** 插件加载结果 */
export interface PluginLoadResult {
  /** 已注册的插件工具（已扩展协议字段：kind=builtin / group=plugin） */
  tools: ExtendedTool[]
  /** 已注册的插件钩子（与内置钩子共存，注册顺序在插件加载时确定） */
  hooks: Hook[]
  /** 加载失败的插件列表（错误隔离：单个失败不影响其它） */
  errors: PluginError[]
}

/** 插件入口文件名（TS 优先——开发期源码；JS 兜底——dist 编译后） */
const ENTRY_CANDIDATES = ['index.ts', 'index.js']

/** 把插件注册的工具统一扩展为 ExtendedTool（纯 Tool 补协议字段，已扩展的保留） */
function toExtendedTool(tool: Tool | ExtendedTool): ExtendedTool {
  if (isExtendedTool(tool)) return tool
  return createExtendedTool(tool, { kind: 'builtin', group: 'plugin', readOnly: false })
}

/** 从 module 取 register（支持具名导出 / 默认导出两种形态） */
function getRegister(mod: unknown): PluginModule['register'] | null {
  const m = mod as Partial<PluginModule> | undefined
  if (typeof m?.register === 'function') return m.register
  const d = (mod as { default?: Partial<PluginModule> } | undefined)?.default
  if (typeof d?.register === 'function') return d.register
  return null
}

/**
 * 加载单个插件目录。
 * 流程：找 plugin.yaml → 解析 manifest → 定位入口（index.ts/index.js）→
 *       import → 构造 ctx → register(ctx)。
 * 任何一步失败都抛出，由 loadPlugins 捕获做错误隔离。
 */
async function loadPlugin(dir: string, dirName: string): Promise<{
  manifest: PluginManifest
  tools: ExtendedTool[]
  hooks: Hook[]
}> {
  // 1. manifest：plugin.yaml 优先；缺 yaml 时宽松模式（目录名兜底，warn 提示）
  const yamlPath = path.join(dir, 'plugin.yaml')
  let manifest: PluginManifest
  if (fs.existsSync(yamlPath)) {
    const raw = parseYamlSimple(fs.readFileSync(yamlPath, 'utf8'))
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ''
    if (!name) {
      throw new Error(`plugin.yaml 缺少 name（目录 ${dirName}）`)
    }
    manifest = {
      name,
      version: typeof raw.version === 'string' ? raw.version : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      tools: Array.isArray(raw.tools) ? raw.tools.filter((x): x is string => typeof x === 'string') : undefined,
      hooks: Array.isArray(raw.hooks) ? raw.hooks.filter((x): x is string => typeof x === 'string') : undefined,
    }
  } else {
    manifest = { name: dirName, description: '（无 plugin.yaml，宽松模式加载）' }
    console.warn(`[plugins] ${dirName}：缺少 plugin.yaml，按目录名「${dirName}」宽松加载`)
  }

  // 2. 入口：index.ts 优先（开发期），index.js 兜底（dist 编译后）
  const entry = ENTRY_CANDIDATES.map((f) => path.join(dir, f)).find((f) => fs.existsSync(f))
  if (!entry) {
    throw new Error(`目录缺少入口文件（${ENTRY_CANDIDATES.join(' / ')}）`)
  }

  // 3. 动态加载入口（CJS 用 require，ESM 用 import；dist 产物是 CJS）
  //    开发期（tsx）加载 .ts 源码；dist 编译后加载 .js
  const mod: unknown = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const req = require as unknown as (id: string) => unknown
      return req(entry)
    } catch {
      // require 失败（如 ESM 入口）→ 退回 import()
    }
    return import(pathToFileURL(entry).href)
  })()
  const register = getRegister(mod)
  if (!register) {
    throw new Error('入口模块未导出 register(ctx)（应为具名导出或 default.register）')
  }

  // 4. 构造 ctx 并调用 register：插件注册的工具/钩子全部收集（重复注册由集成侧做重名处理）
  const tools: ExtendedTool[] = []
  const hooks: Hook[] = []
  const ctx: PluginContext = {
    manifest,
    registerTool(tool: Tool | ExtendedTool): void {
      tools.push(toExtendedTool(tool))
    },
    registerHook(hook: Hook): void {
      hooks.push(hook)
    },
    cwd: dir,
  }
  await register(ctx)

  // 5. 披露一致性校验（manifest 声明 vs 实际注册）：不一致仅 warn，不阻断
  if (manifest.tools) {
    for (const declared of manifest.tools) {
      if (!tools.some((t) => t.def.name === declared)) {
        console.warn(`[plugins] ${manifest.name}：manifest 声明工具「${declared}」但未注册`)
      }
    }
  }
  if (manifest.hooks) {
    for (const declared of manifest.hooks) {
      if (!hooks.some((h) => h.id === declared)) {
        console.warn(`[plugins] ${manifest.name}：manifest 声明钩子「${declared}」但未注册`)
      }
    }
  }

  return { manifest, tools, hooks }
}

/**
 * 扫描并加载 dir 目录下各子目录中的全部插件。
 * - 目录不存在 → 返回空结果（不抛错；dist 未复制插件资源时静默）
 * - 每个插件目录独立 try/catch：失败只记入 errors，不中断其它插件
 */
export async function loadPlugins(dir: string): Promise<PluginLoadResult> {
  const result: PluginLoadResult = { tools: [], hooks: [], errors: [] }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    // 目录不存在（如 dist 未构建插件）→ 空结果
    return result
  }

  for (const entry of entries) {
    const pluginDir = path.join(dir, entry.name)
    try {
      const loaded = await loadPlugin(pluginDir, entry.name)
      result.tools.push(...loaded.tools)
      result.hooks.push(...loaded.hooks)
      console.log(
        '[plugins] 加载 ' +
          loaded.manifest.name +
          (loaded.manifest.version ? '@' + loaded.manifest.version : '') +
          '：' +
          loaded.tools.length +
          ' 工具 / ' +
          loaded.hooks.length +
          ' 钩子'
      )
    } catch (e) {
      // 错误隔离：单个插件失败不影响其它插件与整体启动
      const message = e instanceof Error ? e.message : String(e)
      console.warn('[plugins] 插件「' + entry.name + '」加载失败，已跳过：' + message)
      result.errors.push({ name: entry.name, error: message })
    }
  }
  return result
}