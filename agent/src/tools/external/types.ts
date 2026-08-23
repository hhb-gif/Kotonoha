// ============================================================
// types.ts —— 配置驱动外接工具（T2-external）配置类型
// 与 *.tools.yaml / tool.yaml 的字段一一对应（harness-v3-tools.md 第四节 2/3）
// 中文注释、英文标识符
// ============================================================

/** 工具配置公共字段 */
export interface ExternalToolConfig {
  /** 工具名（必填，唯一标识） */
  name: string
  /** 工具描述（可选，缺省按类型生成） */
  description?: string
  /** 工具类型：shell（执行命令）/ http（调用 API） */
  type: 'shell' | 'http'
  /** 超时秒数（可选，缺省 60s） */
  timeout?: number
}

/** shell 工具配置：`command: "python scripts/weather.py {location}"` */
export interface ShellToolConfig extends ExternalToolConfig {
  type: 'shell'
  /** 命令模板，{arg} 占位符自动生成参数（{env:VAR} 也可用） */
  command: string
  /** 工作目录（相对配置文件目录，可选，缺省为配置目录本身） */
  cwd?: string
}

/** http 工具配置：url/headers/body 中的 {arg} 生成参数，{env:VAR} 取环境变量 */
export interface HttpToolConfig extends ExternalToolConfig {
  type: 'http'
  /** 请求方法（GET/POST/PUT/DELETE...），可选，缺省 GET */
  method: string
  /** 请求 URL 模板（可含 {arg} 占位符） */
  url: string
  /** 请求头（值可含 {arg} / {env:VAR} 占位符） */
  headers?: Record<string, string>
  /** 请求体（值可含 {arg} / {env:VAR} 占位符；GET/HEAD 不发送） */
  body?: Record<string, unknown>
}

/** 任意外接工具配置（loader 归一化后的结果） */
export type AnyExternalToolConfig = ShellToolConfig | HttpToolConfig