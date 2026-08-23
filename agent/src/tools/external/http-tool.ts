// ============================================================
// http-tool.ts —— 配置驱动 HTTP API 工具（T2-external）
// 由 tool.yaml 配置生成：url/headers/body 的 {arg} 占位符 → JSON Schema 参数，
// {env:VAR} → 运行时从 process.env 取值（密钥不落明文配置）
// 执行：fetch；JSON 响应美化输出，非 2xx → ok:false
// 契约：types.ts Tool / protocol.ts ExtendedTool
// 中文注释、英文标识符
// ============================================================

import type { ToolResult } from '../../types'
import type { ExtendedTool } from '../protocol'
import { createExtendedTool } from '../protocol'
import { collectArgs, interpolate, interpolateString } from './placeholder'
import type { HttpToolConfig } from './types'

const DEFAULT_TIMEOUT_SEC = 60

/** GET/HEAD/OPTIONS 只读（用于 readOnly 标记） */
const READONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** 把原始参数转为字符串（缺省为空串） */
function argValue(args: Record<string, unknown>, name: string): string {
  const v = args[name]
  return v === undefined || v === null ? '' : String(v)
}

/**
 * 由配置创建 HTTP 工具。
 * @param cfg 归一化后的工具配置（来自 tool.yaml）
 */
export function createHttpTool(cfg: HttpToolConfig): ExtendedTool {
  // 从 url / headers / body 提取 {arg} 占位符 → JSON Schema（{env:...} 不入 schema）
  const argNames = collectArgs(
    cfg.url,
    JSON.stringify(cfg.headers ?? {}),
    JSON.stringify(cfg.body ?? {})
  )
  const properties: Record<string, unknown> = {}
  for (const name of argNames) {
    properties[name] = { type: 'string', description: `请求占位符 ${name}` }
  }

  return createExtendedTool(
    {
      def: {
        name: cfg.name,
        description: cfg.description ?? `${cfg.method} ${cfg.url}`,
        parameters: {
          type: 'object',
          description: `${cfg.name} 参数（来自 url/headers/body 中的 {arg} 占位符，全部为字符串）`,
          properties,
          required: argNames,
        },
      },
      async run(_ctx, rawArgs): Promise<ToolResult> {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        // 统一解析器：{arg} 取调用参数（缺省空串）；{env:VAR} 取环境变量（缺失抛错）
        const resolve = (name: string): string => {
          if (name.startsWith('env:')) {
            const varName = name.slice(4)
            const v = process.env[varName]
            if (v === undefined) throw new Error(`环境变量未设置：${varName}`)
            return v
          }
          return argValue(args, name)
        }
        try {
          const url = interpolateString(cfg.url, resolve)
          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(cfg.headers ?? {})) {
            headers[k] = interpolateString(v, resolve)
          }
          const method = (cfg.method || 'GET').toUpperCase()
          const isBodyless = method === 'GET' || method === 'HEAD'
          const body =
            cfg.body !== undefined && !isBodyless
              ? JSON.stringify(interpolate(cfg.body, resolve))
              : undefined
          const timeoutMs = (cfg.timeout ?? DEFAULT_TIMEOUT_SEC) * 1000

          const resp = await fetch(url, {
            method,
            headers,
            body,
            signal: AbortSignal.timeout(timeoutMs),
          })
          const text = await resp.text()
          // JSON 响应 → 美化输出；其余原样文本
          let output = text
          if ((resp.headers.get('content-type') ?? '').includes('application/json')) {
            try {
              output = JSON.stringify(JSON.parse(text), null, 2)
            } catch {
              output = text
            }
          }
          if (!resp.ok) {
            return {
              ok: false,
              output: '',
              error: `HTTP ${resp.status} ${resp.statusText}\n${text.slice(0, 2000)}`,
            }
          }
          return { ok: true, output }
        } catch (e) {
          // 网络错误 / 超时 / 环境变量缺失 / 请求构建失败
          return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) }
        }
      },
    },
    // 配置驱动工具：kind=dynamic / group=external；GET 类只读，其余视为写
    {
      kind: 'dynamic',
      group: 'external',
      readOnly: READONLY_METHODS.has((cfg.method || 'GET').toUpperCase()),
    }
  )
}