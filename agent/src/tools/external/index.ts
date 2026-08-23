// ============================================================
// index.ts —— 配置驱动外接工具加载器（T2-external）
// 扫描目录下所有 *.tools.yaml / tool.yaml，解析配置生成 ExtendedTool
// 数组（kind:'dynamic' / group:'external'）。
// 不写核心代码即可加工具：放一个 yaml 配置即可（harness-v3-tools.md 第四节 2/3）
// 行为：
//   - 目录不存在 → 返回空结果（不抛错）
//   - 单个文件解析/校验失败 → 记入 errors，console.warn 后跳过（错误隔离）
//   - 跨文件工具重名 → 后者报错跳过
// 复用 plugins/yaml.ts 的 parseYamlSimple（列表-of-map + inline map 已支持）
// 中文注释、英文标识符
// ============================================================

import fs from 'node:fs'
import path from 'node:path'

import type { ExtendedTool } from '../protocol'
import { parseYamlSimple } from '../plugins/yaml'
import { createShellTool } from './shell-tool'
import { createHttpTool } from './http-tool'
import type { AnyExternalToolConfig, HttpToolConfig, ShellToolConfig } from './types'

/** 外接工具加载结果 */
export interface ExternalLoadResult {
  /** 生成的外接工具（已带协议字段：kind=dynamic / group=external） */
  tools: ExtendedTool[]
  /** 失败文件列表（错误隔离：单个失败不影响其它文件） */
  errors: { file: string; error: string }[]
}

/** 识别工具配置文件：tool.yaml 或 *.tools.yaml */
export function isToolsConfigFile(name: string): boolean {
  return name === 'tool.yaml' || name.endsWith('.tools.yaml')
}

/**
 * 从 yaml 配置项归一化出工具配置（类型/必填字段校验）。
 * 配置项来自 parseYamlSimple 的结果（map 对象）。
 */
function normalizeConfig(raw: Record<string, unknown>, file: string): AnyExternalToolConfig {
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ''
  if (!name) throw new Error('工具缺少 name')
  const description = typeof raw.description === 'string' ? raw.description : undefined
  const timeout = typeof raw.timeout === 'number' && raw.timeout > 0 ? raw.timeout : undefined
  const type = raw.type

  if (type === 'shell') {
    if (typeof raw.command !== 'string' || !raw.command.trim()) {
      throw new Error(`工具「${name}」缺少 command`)
    }
    return {
      name,
      description,
      type: 'shell',
      command: raw.command,
      cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
      timeout,
    }
  }

  if (type === 'http') {
    if (typeof raw.url !== 'string' || !raw.url.trim()) {
      throw new Error(`工具「${name}」缺少 url`)
    }
    const headers = isStringMap(raw.headers)
      ? (raw.headers as Record<string, string>)
      : undefined
    const body = typeof raw.body === 'object' && raw.body !== null && !Array.isArray(raw.body)
      ? (raw.body as Record<string, unknown>)
      : undefined
    return {
      name,
      description,
      type: 'http',
      method: typeof raw.method === 'string' && raw.method.trim() ? raw.method.trim() : 'GET',
      url: raw.url,
      headers,
      body,
      timeout,
    }
  }

  throw new Error(`工具「${name}」未知类型：${String(type)}（支持 shell / http）`)
}

/** 判断是否为字符串值 map（headers 用） */
function isStringMap(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v).every((x) => typeof x === 'string')
}

/**
 * 扫描并加载 dir 目录下的全部外接工具配置。
 * - 目录不存在 → 返回空结果（不抛错；无配置目录时静默）
 * - 每个文件独立 try/catch：失败只记入 errors，不中断其它文件
 */
export async function loadExternalTools(dir: string): Promise<ExternalLoadResult> {
  const result: ExternalLoadResult = { tools: [], errors: [] }

  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') && isToolsConfigFile(f))
  } catch {
    // 目录不存在 → 空结果
    return result
  }

  for (const file of files.sort()) {
    const abs = path.join(dir, file)
    try {
      const raw = parseYamlSimple(fs.readFileSync(abs, 'utf8'))
      const items = raw.tools
      if (!Array.isArray(items)) {
        throw new Error('缺少 tools 列表（顶层 tools: 下用 "- name: ..." 声明工具）')
      }
      let loaded = 0
      for (const item of items) {
        if (typeof item !== 'object' || item === null) {
          throw new Error('tools 项必须是 map（- name: ... 形态）')
        }
        const cfg = normalizeConfig(item as Record<string, unknown>, file)
        const tool =
          cfg.type === 'shell'
            ? createShellTool(cfg as ShellToolConfig, dir)
            : createHttpTool(cfg as HttpToolConfig)
        if (result.tools.some((t) => t.def.name === tool.def.name)) {
          throw new Error(`工具「${tool.def.name}」与已加载的外部工具重名`)
        }
        result.tools.push(tool)
        loaded++
      }
      console.log(`[external] 加载 ${file}：${loaded} 个工具`)
    } catch (e) {
      // 错误隔离：单个文件失败不影响其它文件与整体启动
      const message = e instanceof Error ? e.message : String(e)
      console.warn(`[external] ${file} 加载失败，已跳过：${message}`)
      result.errors.push({ file, error: message })
    }
  }
  return result
}