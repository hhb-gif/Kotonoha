// ============================================================
// yaml.ts —— 最小 YAML 子集解析器（plugin.yaml / *.tools.yaml 共用）
// 为何手写：避免新增 yaml 依赖（harness-v3-tools.md 风险节明确要求）
// 支持范围：
//   - 平铺 `key: value`（注释/引号/布尔/数字/空串）
//   - 列表 `key:` + `- item`（标量列表）
//   - 列表 of map：`- key: value` + 更深缩进的 `key: value` 续行（tools: 配置形态）
//   - inline map：`key: { k1: v1, k2: v2 }`（headers/body 配置形态）
//   - 值内含 {arg}/{env:VAR} 占位符时请用引号包裹（如 "Bearer {env:TOKEN}"）
// 不支持：非内联嵌套 map、map 内嵌套列表、多行字符串、锚点等（用不到）
// 中文注释、英文标识符
// ============================================================

export interface YamlDoc {
  [key: string]: unknown
}

/** 去掉首尾空白与成对引号（'xx' / "xx"） */
function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2) {
    const first = t[0]
    const last = t[t.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return t.slice(1, -1)
    }
  }
  return t
}

/** 标量类型推断：数字 / 布尔 / null 之外的均视为字符串 */
function toScalar(s: string): unknown {
  const t = unquote(s)
  if (t === '') return t
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null' || t === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  return t
}

/**
 * 查找字符串中引号外、{} / [] 嵌套外的第一个 `:`（返回下标，-1 表示无）。
 * 用于从 `key: value` 行取键名；值内如 "https://..." 的冒号在引号内会被跳过。
 */
function findTopColon(s: string): number {
  let quote: '"' | "'" | null = null
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '{' || c === '[') {
      depth++
      continue
    }
    if (c === '}' || c === ']') {
      depth--
      continue
    }
    if (c === ':' && depth === 0) return i
  }
  return -1
}

/** 按顶层分隔符切分（跳过引号包裹与 {} / [] 嵌套），用于 inline map 解析 */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = []
  let quote: '"' | "'" | null = null
  let depth = 0
  let cur = ''
  for (const c of s) {
    if (quote) {
      cur += c
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (c === '{' || c === '[') {
      depth++
      cur += c
      continue
    }
    if (c === '}' || c === ']') {
      depth--
      cur += c
      continue
    }
    if (c === sep && depth === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/**
 * 解析内联值：
 *   - `{ k1: v1, k2: v2 }` → 对象（键值递归解析）
 *   - 其余 → 标量（数字/布尔/字符串）
 * 注意：占位符 `{env:VAR}` / `{arg}` 需用引号包裹（如 "{env:TOKEN}"），
 *       否则会被当作 inline map 解析。
 */
function parseInlineValue(s: string): unknown {
  const t = s.trim()
  if (t.startsWith('{') && t.endsWith('}')) {
    const obj: YamlDoc = {}
    for (const part of splitTopLevel(t.slice(1, -1), ',')) {
      const ci = findTopColon(part)
      if (ci <= 0) continue
      const key = part.slice(0, ci).trim()
      if (!key) continue
      obj[key] = parseInlineValue(part.slice(ci + 1))
    }
    return obj
  }
  return toScalar(t)
}

/**
 * 解析 YAML 文本（子集）。
 * 逐行处理，支持：
 *   - 空行 / # 注释 → 跳过
 *   - `key:`（冒号后无值）→ 开启列表（后续 `- item` / `- key: value` 归入）
 *   - `key: value` → 标量或 inline map
 *   - `- item`（标量列表项，需处于已开启的列表上下文）
 *   - `- key: value`（map 列表项）+ 更深缩进的 `key: value` 续行
 * 返回平铺对象；格式不合法时抛错（由 loader 做错误隔离）。
 */
export function parseYamlSimple(text: string): YamlDoc {
  const doc: YamlDoc = {}
  let listKey: string | null = null
  let list: unknown[] | null = null
  let mapList: YamlDoc[] | null = null
  let currentMap: YamlDoc | null = null
  let listItemIndent = -1

  const lines = text.split(/\r?\n/)

  /** 下一个非空行（跳过空行/注释），无则 null */
  const nextMeaningful = (from: number): string | null => {
    for (let j = from; j < lines.length; j++) {
      const t = lines[j].trim()
      if (t && !t.startsWith('#')) return t
    }
    return null
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const indent = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // ---- 列表项 ----
    if (trimmed.startsWith('- ')) {
      const rest = trimmed.slice(2).trim()
      const ci = findTopColon(rest)
      if (ci > 0) {
        // map 列表项：`- key: value`。若列表以标量列表开启，首个 map 项触发升级
        if (!mapList) {
          if (list) {
            // 把已开启的标量列表原地升级为 map 列表（丢弃已 push 的标量，属畸形配置）
            mapList = []
            if (listKey !== null) doc[listKey] = mapList
            list = null
            listKey = null
          } else {
            throw new Error(`yaml 第 ${i + 1} 行：map 列表项 "- ${rest}" 前缺少键声明`)
          }
        }
        const key = rest.slice(0, ci).trim()
        if (!key) {
          throw new Error(`yaml 第 ${i + 1} 行：map 列表项键名为空`)
        }
        const val = rest.slice(ci + 1).trim()
        const map: YamlDoc = {}
        if (val) map[key] = parseInlineValue(val)
        mapList.push(map)
        currentMap = map
        listItemIndent = indent
      } else {
        // 标量列表项：必须处于已开启的列表上下文，否则视为格式错误
        if (!list) {
          throw new Error(`yaml 第 ${i + 1} 行：列表项 "- ${rest}" 前缺少键声明`)
        }
        list.push(parseInlineValue(rest))
        currentMap = null
      }
      continue
    }

    // ---- 键值对 ----
    const ci = findTopColon(trimmed)
    if (ci <= 0) {
      throw new Error(`yaml 第 ${i + 1} 行：无法解析「${trimmed.slice(0, 40)}」（要求 key: value 或 key:）`)
    }
    const key = trimmed.slice(0, ci).trim()
    if (!key) {
      throw new Error(`yaml 第 ${i + 1} 行：键名为空`)
    }
    const rawValue = trimmed.slice(ci + 1).trim()

    // 更深缩进的 `key: value` → 归属当前 map 列表项
    if (currentMap && indent > listItemIndent) {
      if (rawValue === '') {
        throw new Error(`yaml 第 ${i + 1} 行：map 项内空值键「${key}」暂不支持（嵌套列表/子 map 请用 inline 写法）`)
      }
      currentMap[key] = parseInlineValue(rawValue)
      continue
    }

    // ---- 顶层键 ----
    if (rawValue === '') {
      const nxt = nextMeaningful(i + 1)
      const nxtTrim = nxt === null ? null : nxt.trim()
      if (nxtTrim !== null && nxtTrim.startsWith('- ')) {
        // 后续是列表项 → 开启列表
        list = []
        listKey = key
        doc[key] = list
        mapList = null
        currentMap = null
      } else if (nxt !== null && nxt.length - nxt.trimStart().length > 0) {
        // 后续是更深缩进的键值 → 非内联嵌套 map，暂不支持
        throw new Error(
          `yaml 第 ${i + 1} 行：键「${key}」后跟缩进键值，暂不支持嵌套 map（可用 inline 写法 { k: v }）`
        )
      } else {
        // 无后续内容或后续是顶层键 → 空列表（兼容旧行为）
        list = []
        listKey = key
        doc[key] = list
        mapList = null
        currentMap = null
      }
    } else {
      doc[key] = parseInlineValue(rawValue)
      list = null
      listKey = null
      mapList = null
      currentMap = null
    }
  }
  return doc
}