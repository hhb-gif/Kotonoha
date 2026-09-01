// panels/shared.jsx —— 各页签面板共享的图标与小工具
// 从原 EscapePanel.jsx 内联实现集中迁移：图标（svgProps 统一描边风格）、
// formatTime / truncateSession / downloadText、story·save 解析、工具来源徽章。
import * as stories from '../../bridge/stories'

export const svgProps = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function BookmarkIcon() {
  return (
    <svg {...svgProps}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function ChipIcon() {
  return (
    <svg {...svgProps}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </svg>
  )
}

export function ShieldIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

export function ChartIcon() {
  return (
    <svg {...svgProps}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

export function RefreshIcon() {
  return (
    <svg {...svgProps}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

export function MessageIcon() {
  return (
    <svg {...svgProps}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function GitBranchIcon() {
  return (
    <svg {...svgProps}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

export function PlugIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z" />
    </svg>
  )
}

export function TerminalIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 17l6-6-6-6" />
      <path d="M12 19h8" />
    </svg>
  )
}

export function KeyIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  )
}

export function ForkIcon() {
  return (
    <svg {...svgProps} width={14} height={14}>
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
      <path d="M12 12v3" />
    </svg>
  )
}

// 心形图标（羁绊页签用，v0.2.2 M6c）
export function HeartIcon() {
  return (
    <svg {...svgProps}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

// 会话 ID 过长时截断为 20 位
export function truncateSession(id) {
  if (!id) return null
  const s = String(id)
  return s.length > 20 ? `${s.slice(0, 20)}…` : s
}

export function formatTime(ts) {
  if (!ts) return null
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 触发浏览器下载文本文件（导出会话用）
export function downloadText(filename, content) {
  try {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || 'session-export.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('[escape] download failed:', err)
  }
}

// context 里没有 path：按故事名反查 stories 索引拿工作区路径
export function resolveStory(storyName) {
  if (!storyName) return null
  return stories.listStories().find((s) => s.name === storyName) || null
}

// 当前存档（取 preview / createdAt / lastActiveAt）
export function resolveSave() {
  const ctx = stories.getContext()
  if (!ctx?.storyId || !ctx?.saveId) return null
  return stories.getSave(ctx.storyId, ctx.saveId) || null
}

// ---- U2 新增：工具来源徽章（后端返回 kind 时优先，否则按名称前缀启发式判断）----
export const SOURCE_META = {
  builtin: { label: '内置', cls: 'ep-src-builtin' },
  checkpoint: { label: 'checkpoint', cls: 'ep-src-checkpoint' },
  external: { label: '外接', cls: 'ep-src-external' },
  plugin: { label: '插件', cls: 'ep-src-plugin' },
}

// 推断工具来源：kotonoha_=checkpoint / ext_=外接 / example_=插件 / 其余=内置
export function toolSourceKind(tool) {
  if (tool?.kind && SOURCE_META[tool.kind]) return tool.kind
  const name = tool?.name || ''
  if (name.startsWith('kotonoha_')) return 'checkpoint'
  if (name.startsWith('ext_')) return 'external'
  if (name.startsWith('example_')) return 'plugin'
  return 'builtin'
}

// 工具来源徽章（工具列表行内小标签）
export function ToolSourceBadge({ tool }) {
  const kind = toolSourceKind(tool)
  const meta = SOURCE_META[kind] || SOURCE_META.builtin
  return <span className={`ep-src-badge ${meta.cls}`}>{meta.label}</span>
}
