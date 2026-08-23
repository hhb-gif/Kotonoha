// ============================================================
// shell-tool.ts —— 配置驱动 Shell 工具（T2-external）
// 由 tool.yaml 配置生成：command 模板的 {arg} 占位符 → JSON Schema 参数
// 执行：child_process exec（promisify），cwd 相对配置文件目录，
//       stdout 为 ToolResult.output，非零退出码 → ok:false
// 契约：types.ts Tool / protocol.ts ExtendedTool
// 中文注释、英文标识符
// ============================================================

import { exec } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import type { ToolResult } from '../../types'
import type { ExtendedTool } from '../protocol'
import { createExtendedTool } from '../protocol'
import { collectArgs, interpolateString } from './placeholder'
import type { ShellToolConfig } from './types'

const execP = promisify(exec)

const DEFAULT_TIMEOUT_SEC = 60
const MAX_BUFFER = 10 * 1024 * 1024 // 10MB 输出上限

/** 把原始参数转为字符串（缺省为空串） */
function argValue(args: Record<string, unknown>, name: string): string {
  const v = args[name]
  return v === undefined || v === null ? '' : String(v)
}

/**
 * 由配置创建 shell 工具。
 * @param cfg     归一化后的工具配置（来自 tool.yaml）
 * @param baseDir 配置文件所在目录（cwd 相对此目录解析）
 */
export function createShellTool(cfg: ShellToolConfig, baseDir: string): ExtendedTool {
  // 从命令模板提取 {arg} 占位符 → JSON Schema（properties 全 string，可编辑）
  const argNames = collectArgs(cfg.command)
  const properties: Record<string, unknown> = {}
  for (const name of argNames) {
    properties[name] = { type: 'string', description: `命令占位符 ${name}` }
  }

  return createExtendedTool(
    {
      def: {
        name: cfg.name,
        description: cfg.description ?? `shell 命令工具：${cfg.command}`,
        parameters: {
          type: 'object',
          description: `${cfg.name} 参数（来自命令中的 {arg} 占位符，全部为字符串）`,
          properties,
          required: argNames,
        },
      },
      async run(_ctx, rawArgs): Promise<ToolResult> {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        // 插值：{arg} 取调用参数（缺省空串），{env:VAR} 取环境变量（缺失抛错）
        const command = interpolateString(cfg.command, (name) => {
          if (name.startsWith('env:')) {
            const varName = name.slice(4)
            const v = process.env[varName]
            if (v === undefined) throw new Error(`环境变量未设置：${varName}`)
            return v
          }
          return argValue(args, name)
        })
        const cwd = path.resolve(baseDir, cfg.cwd ?? '.')
        const timeoutMs = (cfg.timeout ?? DEFAULT_TIMEOUT_SEC) * 1000
        try {
          const { stdout, stderr } = await execP(command, {
            cwd,
            timeout: timeoutMs,
            maxBuffer: MAX_BUFFER,
          })
          const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '')
          return { ok: true, output }
        } catch (e) {
          // 非零退出码 / 超时 / 命令不存在：均视为失败
          const err = e as { code?: number | null; killed?: boolean; stdout?: string; stderr?: string; message?: string }
          const detail = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n')
          const reason = err.killed
            ? `命令超时（>${cfg.timeout ?? DEFAULT_TIMEOUT_SEC}s）`
            : `命令退出（code=${err.code ?? 'unknown'}）`
          return { ok: false, output: '', error: `${reason}：${detail}` }
        }
      },
    },
    // 配置驱动工具：kind=dynamic / group=external；shell 可改动系统 → 非只读
    { kind: 'dynamic', group: 'external', readOnly: false }
  )
}