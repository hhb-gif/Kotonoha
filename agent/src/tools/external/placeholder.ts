// ============================================================
// placeholder.ts —— 占位符处理：{arg} 参数 / {env:VAR} 环境变量
// 规则（与 harness-v3-tools.md 第四节一致）：
//   - {arg}         → 工具参数（自动生成 JSON Schema 字段）
//   - {env:VAR}     → 运行时从 process.env 取值（密钥不落明文配置）
// 注意：{env:...} 不会被普通 {arg} 正则匹配（冒号阻断），天然互斥。
// 中文注释、英文标识符
// ============================================================

/** 普通占位符（参数）：{name}，name 须为合法标识符 */
const ARG_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** 环境变量占位符：{env:VAR}，VAR 须为合法标识符 */
const ENV_RE = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * 收集模板中出现的 {arg} 占位符名，去重保序。
 * 用于生成 JSON Schema 的 properties / required。
 * {env:VAR} 因含冒号不会被 {arg} 正则匹配，天然排除。
 */
export function collectArgs(...templates: string[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const t of templates) {
    if (!t) continue
    ARG_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = ARG_RE.exec(t)) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1])
        names.push(m[1])
      }
    }
  }
  return names
}

/**
 * 替换字符串中全部占位符；resolve(name) 给出占位符对应的值
 * （普通参数名如 "location"；环境变量名带前缀如 "env:GITHUB_TOKEN"）。
 * {env:VAR} 先替换为哨兵占位，避免插入值被随后的 {arg} 正则二次处理。
 */
export function interpolateString(template: string, resolve: (name: string) => string): string {
  if (!template) return template
  const sentinels: string[] = []
  let out = template.replace(ENV_RE, (_m, varName: string) => {
    sentinels.push(resolve('env:' + varName))
    return `\u0000${sentinels.length - 1}\u0000`
  })
  out = out.replace(ARG_RE, (_m, name: string) => resolve(name))
  for (let i = 0; i < sentinels.length; i++) {
    out = out.split(`\u0000${i}\u0000`).join(sentinels[i])
  }
  return out
}

/**
 * 递归插值：字符串按占位符替换；对象/数组逐字段递归；其余原样返回。
 * 用于请求体（body）这类嵌套结构的整体插值。
 */
export function interpolate(value: unknown, resolve: (name: string) => string): unknown {
  if (typeof value === 'string') return interpolateString(value, resolve)
  if (Array.isArray(value)) return value.map((v) => interpolate(v, resolve))
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolate(v, resolve)
    }
    return out
  }
  return value
}