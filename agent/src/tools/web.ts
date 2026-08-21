// ============================================================
// web.ts —— 网页工具：fetch_url / web_search（DDG html 端点解析）
// 契约：types.ts Tool / ToolDef / ToolResult
// ============================================================

import { URL } from 'node:url'

import type { Tool, ToolResult } from '../types'

const FETCH_TIMEOUT_MS = 15 * 1000
const DEFAULT_MAX_CHARS = 8000

// 伪装浏览器 UA，降低被拒概率
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function argsOf(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' ? v : undefined
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

// HTML → 纯文本：去 script/style 标签 → 去 HTML 标签 → 压缩空白
function htmlToText(html: string): string {
  let s = html
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  s = s.replace(/\s+/g, ' ')
  return s.trim()
}

interface DdgItem {
  title: string
  href: string
  snippet: string
}

// 解析 DDG html 端点：.result__a（标题+链接）与 .result__snippet（摘要）
// （导出供离线单元测试）
export function parseDdgResults(html: string, count: number): DdgItem[] {
  const blocks: string[] = []
  const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>[\s\S]*?<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null) {
    blocks.push(m[0])
  }

  const snippets: string[] = []
  const snipRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>[\s\S]*?<\/a>/gi
  while ((m = snipRe.exec(html)) !== null) {
    const inner = m[0].replace(/^<a[^>]*>/, '').replace(/<\/a>$/, '')
    snippets.push(decodeEntities(stripTags(inner)).trim())
  }

  const items: DdgItem[] = []
  for (const block of blocks) {
    if (items.length >= count) break
    const inner = block.replace(/^<a[^>]*>/, '').replace(/<\/a>$/, '')
    const title = decodeEntities(stripTags(inner)).trim()
    if (!title) continue
    const hrefMatch = /href="([^"]*)"/i.exec(block)
    let href = hrefMatch ? decodeEntities(hrefMatch[1]) : ''
    if (href.startsWith('//')) href = 'https:' + href
    items.push({ title, href, snippet: snippets[items.length] ?? '' })
  }
  return items
}

export const fetchUrlTool: Tool = {
  def: {
    name: 'fetch_url',
    description: '抓取网页并提取文本内容（HTML 会去除标签；默认最多 8000 字符）',
    parameters: {
      type: 'object',
      description: 'fetch_url 参数：目标 URL 与可选最大字符数',
      properties: {
        url: { type: 'string', description: '要抓取的 URL（仅 http/https）' },
        maxChars: { type: 'integer', description: '最多返回字符数（默认 8000）' },
      },
      required: ['url'],
    },
  },
  async run(_ctx, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const urlStr = strArg(args, 'url')
    if (!urlStr) return { ok: false, output: '', error: '缺少参数：url' }

    let parsed: URL
    try {
      parsed = new URL(urlStr)
    } catch {
      return { ok: false, output: '', error: 'URL 无效' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, output: '', error: '仅支持 http/https 协议' }
    }

    const maxChars = clampInt(args.maxChars, DEFAULT_MAX_CHARS, 1, 100000)
    try {
      const res = await fetch(parsed, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
        headers: { 'User-Agent': BROWSER_UA },
      })
      const text = await res.text()
      const contentType = res.headers.get('content-type') ?? ''
      const body = /text\/html/i.test(contentType) ? htmlToText(text) : text
      return { ok: true, output: body.slice(0, maxChars) }
    } catch (e) {
      return { ok: false, output: '', error: `请求失败：${errMessage(e)}` }
    }
  },
}

export const webSearchTool: Tool = {
  def: {
    name: 'web_search',
    description: '联网搜索（DuckDuckGo），返回标题/链接/摘要',
    parameters: {
      type: 'object',
      description: 'web_search 参数：搜索词与可选结果条数',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        count: { type: 'integer', description: '返回条数（默认 5，1-20）' },
      },
      required: ['query'],
    },
  },
  async run(_ctx, rawArgs): Promise<ToolResult> {
    const args = argsOf(rawArgs)
    const query = strArg(args, 'query')
    if (!query) return { ok: false, output: '', error: '缺少参数：query' }
    const count = clampInt(args.count, 5, 1, 20)

    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
      })
      const html = await res.text()
      const items = parseDdgResults(html, count)
      if (items.length === 0) return { ok: false, output: '', error: '搜索服务暂不可用' }
      const lines = items.map((it) => `${it.title}\n${it.href}\n${it.snippet}\n---`)
      return { ok: true, output: lines.join('\n') }
    } catch {
      return { ok: false, output: '', error: '搜索服务暂不可用' }
    }
  },
}