// ESC 角色面板（重构版）：左侧竖排分类页签 + 右侧内容区
// 分类：存档 / 模型 / 技能 / 统计（页签式切换，内容 fade+slide）
// props:
//   open           是否显示（全屏遮罩 modal）
//   onClose        关闭回调（点遮罩 / × / 关闭按钮触发）
//   context        当前故事上下文 { storyName, saveName, sessionId }（字段可能为 null）
//   modelInfo      模型信息 { current:{provider,model,reasoningEffort?}, groups, providers } | null（初始值）
//   skills         技能开关状态 { 'file-read':bool, ..., approval:bool }
//   skillCatalog   技能目录 [{ id, name, icon, desc, tools }]
//   onToggleSkill(id, on)  技能开关回调
//   messageCount   当前对话消息条数
//   onSave         保存到当前存档
//   onBackToMenu   返回主界面
import { useCallback, useEffect, useRef, useState } from 'react'
import bridge from '../bridge/bridge'
import { getModelInfo } from '../bridge/settings'
import * as stories from '../bridge/stories'
import './EscapePanel.css'

const svgProps = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function BookmarkIcon() {
  return (
    <svg {...svgProps}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ChipIcon() {
  return (
    <svg {...svgProps}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg {...svgProps}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg {...svgProps}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg {...svgProps}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function GitBranchIcon() {
  return (
    <svg {...svgProps}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function PlugIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 17l6-6-6-6" />
      <path d="M12 19h8" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  )
}

function ForkIcon() {
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

const TABS = [
  { id: 'save', label: '存档', icon: <BookmarkIcon /> },
  { id: 'model', label: '模型', icon: <ChipIcon /> },
  { id: 'skills', label: '技能', icon: <ShieldIcon /> },
  { id: 'session', label: '会话', icon: <MessageIcon /> },
  { id: 'git', label: 'Git', icon: <GitBranchIcon /> },
  { id: 'mcp', label: 'MCP', icon: <PlugIcon /> },
  { id: 'commands', label: '命令', icon: <TerminalIcon /> },
  { id: 'creds', label: '凭据', icon: <KeyIcon /> },
  { id: 'stats', label: '统计', icon: <ChartIcon /> },
]

const COMMANDS = [
  { cmd: '/help', desc: '显示命令帮助' },
  { cmd: '/new', desc: '开始新对话' },
  { cmd: '/save [名称]', desc: '保存当前对话' },
  { cmd: '/load', desc: '返回主界面载入' },
  { cmd: '/model', desc: '打开模型设置' },
  { cmd: '/skills', desc: '打开技能面板' },
  { cmd: '/log', desc: '查看对话记录' },
  { cmd: '/continue', desc: '回到最近上下文' },
]

// 会话 ID 过长时截断为 20 位
function truncateSession(id) {
  if (!id) return null
  const s = String(id)
  return s.length > 20 ? `${s.slice(0, 20)}…` : s
}

function formatTime(ts) {
  if (!ts) return null
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 触发浏览器下载文本文件（导出会话用）
function downloadText(filename, content) {
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
function resolveStory(storyName) {
  if (!storyName) return null
  return stories.listStories().find((s) => s.name === storyName) || null
}

// 当前存档（取 preview / createdAt / lastActiveAt）
function resolveSave() {
  const ctx = stories.getContext()
  if (!ctx?.storyId || !ctx?.saveId) return null
  return stories.getSave(ctx.storyId, ctx.saveId) || null
}

export default function EscapePanel({
  open = false,
  onClose,
  context,
  modelInfo: modelInfoProp = null,
  skills = {},
  skillCatalog = [],
  onToggleSkill,
  messageCount = 0,
  onSave,
  onBackToMenu,
}) {
  const [tab, setTab] = useState('save')
  // 初始值用 props.modelInfo；打开时若 props 已更新则同步
  const [modelInfo, setModelInfo] = useState(modelInfoProp)
  const [refreshing, setRefreshing] = useState(false)
  // 轻量提示条（绝对定位底部，2.5s 消失）
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  // 会话页
  const [forking, setForking] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  // Git 页
  const [gitLoading, setGitLoading] = useState(false)
  const [gitBusy, setGitBusy] = useState(false)
  const [gitOutput, setGitOutput] = useState('')
  const [gitError, setGitError] = useState('')
  // MCP 页
  const [mcpInfo, setMcpInfo] = useState(null)
  const [mcpLoading, setMcpLoading] = useState(false)
  // 凭据页
  const [creds, setCreds] = useState(null)
  const [credsLoading, setCredsLoading] = useState(false)
  // 技能页：后端工具目录（tools.list）+ 启停占位
  const [tools, setTools] = useState(null)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [toolToggles, setToolToggles] = useState({})
  // 会话页：导出 / 归档 / 压缩 操作
  const [sessionBusy, setSessionBusy] = useState(null) // null | 'export-md' | 'export-json' | 'archive' | 'compress'
  // 凭据页：审批规则（rules.get 只读）
  const [rules, setRules] = useState(null)
  const [rulesLoading, setRulesLoading] = useState(false)

  const showMsg = useCallback((msg) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }, [])

  useEffect(() => {
    if (!open) {
      setToast(null)
      return
    }
    setModelInfo(modelInfoProp)
  }, [open, modelInfoProp])

  // 打开 MCP 页时拉取 MCP 服务器状态（mcp.status；失败回退旧 mcp.list）
  useEffect(() => {
    if (!open || tab !== 'mcp') return
    let alive = true
    setMcpLoading(true)
    bridge
      .mcpStatus()
      .then(async (res) => {
        if (!alive) return
        if (res?.ok) {
          setMcpInfo({ items: res.servers || [] })
        } else {
          // 旧接口兜底（mcp.list）
          const legacy = await bridge.getMcpInfo().catch(() => null)
          if (alive) setMcpInfo(legacy)
        }
      })
      .catch(() => {
        if (alive) setMcpInfo(null)
      })
      .finally(() => {
        if (alive) setMcpLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, tab])

  // 打开技能页时拉取后端工具目录（tools.list）
  useEffect(() => {
    if (!open || tab !== 'skills') return
    let alive = true
    setToolsLoading(true)
    bridge
      .listTools()
      .then((res) => {
        if (!alive) return
        if (res?.ok) {
          const items = res.tools || []
          setTools(items)
          // 初始化启停占位：默认全开（仅本地预览，不落库）
          setToolToggles((prev) => {
            const next = { ...prev }
            for (const t of items) if (next[t.name] === undefined) next[t.name] = true
            return next
          })
        } else {
          setTools(null)
        }
      })
      .catch(() => {
        if (alive) setTools(null)
      })
      .finally(() => {
        if (alive) setToolsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, tab])

  // 打开凭据页时拉取审批规则（rules.get，只读展示）
  useEffect(() => {
    if (!open || tab !== 'creds') return
    let alive = true
    setRulesLoading(true)
    bridge
      .getRules()
      .then((res) => {
        if (alive) setRules(res?.ok ? res.rules || [] : null)
      })
      .catch(() => {
        if (alive) setRules(null)
      })
      .finally(() => {
        if (alive) setRulesLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, tab])

  // 打开凭据页时拉取凭据状态
  useEffect(() => {
    if (!open || tab !== 'creds') return
    let alive = true
    setCredsLoading(true)
    bridge
      .getCredentialsStatus()
      .then((s) => {
        if (alive) setCreds(s)
      })
      .catch(() => {
        if (alive) setCreds(null)
      })
      .finally(() => {
        if (alive) setCredsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, tab])

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  if (!open) return null

  const story = resolveStory(context?.storyName)
  const workspacePath = context?.path || story?.path || '-'
  const save = resolveSave()
  const sessionId = truncateSession(context?.sessionId)
  const current = modelInfo?.current
  const groups = modelInfo?.groups || []
  const preview = save?.preview || ''

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const info = await getModelInfo()
      setModelInfo(info)
    } catch {
      /* 刷新失败保留上次结果 */
    } finally {
      setRefreshing(false)
    }
  }

  async function handleFork() {
    setForking(true)
    try {
      const res = await bridge.sessionFork()
      if (res?.ok && res.sessionId) {
        showMsg(`已 Fork 新会话：${res.sessionId}`)
      } else {
        showMsg(`Fork 失败：${res?.error || '未知错误'}`)
      }
    } catch (err) {
      showMsg(`Fork 失败：${err.message}`)
    } finally {
      setForking(false)
    }
  }

  async function handleRename() {
    const name = newName.trim()
    if (!name) {
      showMsg('请输入新会话名称')
      return
    }
    setRenaming(true)
    try {
      const res = await bridge.sessionRename(name)
      if (res?.ok) {
        showMsg('会话已重命名')
        setNewName('')
      } else {
        showMsg(`重命名失败：${res?.error || '未知错误'}`)
      }
    } catch (err) {
      showMsg(`重命名失败：${err.message}`)
    } finally {
      setRenaming(false)
    }
  }

  async function handleGitStatus() {
    setGitLoading(true)
    setGitOutput('')
    setGitError('')
    try {
      const res = await bridge.getGitStatus()
      if (res?.ok) {
        setGitOutput(res.output || '（无改动）')
      } else {
        setGitError(res?.error || '无法获取 Git 状态')
      }
    } catch (err) {
      setGitError(err.message)
    } finally {
      setGitLoading(false)
    }
  }

  async function handleGitCommit() {
    setGitBusy(true)
    try {
      await bridge.sendCommandToAgent(
        '请执行 git add -A 并提交，提交信息简洁描述当前改动，先 git status 和 git diff 看看改了什么'
      )
      showMsg('已交给言叶执行提交，结果将显示在对话中')
    } catch (err) {
      showMsg(`发送失败：${err.message}`)
    } finally {
      setGitBusy(false)
    }
  }

  async function handleGitLog() {
    setGitBusy(true)
    try {
      await bridge.sendCommandToAgent('请执行 git log --oneline -10 并简要汇报')
      showMsg('已交给言叶，最近提交将显示在对话中')
    } catch (err) {
      showMsg(`发送失败：${err.message}`)
    } finally {
      setGitBusy(false)
    }
  }

  async function handleCredsRefresh() {
    setCredsLoading(true)
    try {
      setCreds(await bridge.getCredentialsStatus())
    } catch {
      setCreds(null)
    } finally {
      setCredsLoading(false)
    }
  }

  // 导出当前会话（format: 'markdown' | 'json'）
  async function handleExport(format) {
    const sid = context?.sessionId
    if (!sid) {
      showMsg('会话未就绪，无法导出')
      return
    }
    const tag = format === 'markdown' ? 'export-md' : 'export-json'
    setSessionBusy(tag)
    try {
      const res = await bridge.exportSession(sid, format)
      if (res?.ok && res.content) {
        const ext = format === 'markdown' ? 'md' : 'json'
        downloadText(res.filename || `session-export.${ext}`, res.content)
        showMsg(`已导出 ${res.filename || `session-export.${ext}`}`)
      } else {
        showMsg(`导出失败：${res?.error || '无内容返回'}`)
      }
    } catch (err) {
      showMsg(`导出失败：${err.message}`)
    } finally {
      setSessionBusy(null)
    }
  }

  // 归档当前会话
  async function handleArchive() {
    const sid = context?.sessionId
    if (!sid) {
      showMsg('当前会话不可归档')
      return
    }
    setSessionBusy('archive')
    try {
      const res = await bridge.archiveSession(sid)
      showMsg(res?.ok ? '会话已归档' : `归档失败：${res?.error || '未知错误'}`)
    } catch (err) {
      showMsg(`归档失败：${err.message}`)
    } finally {
      setSessionBusy(null)
    }
  }

  // 压缩当前会话（保留最近 5 轮）
  async function handleCompress() {
    const sid = context?.sessionId
    if (!sid) {
      showMsg('当前会话不可压缩')
      return
    }
    setSessionBusy('compress')
    try {
      const res = await bridge.compressSession(sid, 5)
      if (res?.ok) {
        showMsg(res.summary ? `会话已压缩：${res.summary}` : '会话已压缩（保留最近 5 轮）')
      } else {
        showMsg(`压缩失败：${res?.error || '未知错误'}`)
      }
    } catch (err) {
      showMsg(`压缩失败：${err.message}`)
    } finally {
      setSessionBusy(null)
    }
  }

  return (
    <div className="ep-overlay" onClick={onClose}>
      <div
        className="ep-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="角色面板"
      >
        <header className="ep-head">
          <h2 className="ep-title">角色面板</h2>
          <button type="button" className="ep-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="ep-body">
          <nav className="ep-nav" aria-label="面板分类">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`ep-nav-btn${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          <div className="ep-content">
            {tab === 'save' && (
              <section className="ep-pane" key="save">
                <div className="ep-card">
                  <h3 className="ep-card-title">会话信息</h3>
                  <div className="ep-row">
                    <span className="ep-label">故事</span>
                    <span className="ep-value">{context?.storyName || '—'}</span>
                  </div>
                  <div className="ep-row">
                    <span className="ep-label">工作区</span>
                    <span className="ep-value ep-path">{story?.path || '—'}</span>
                  </div>
                  <div className="ep-row">
                    <span className="ep-label">存档</span>
                    <span className="ep-value">{context?.saveName || '—'}</span>
                  </div>
                  <div className="ep-row">
                    <span className="ep-label">会话 ID</span>
                    <span className="ep-value ep-mono" title={context?.sessionId || ''}>
                      {sessionId || '—'}
                    </span>
                  </div>
                  <div className="ep-row">
                    <span className="ep-label">最后活动</span>
                    <span className="ep-value">{formatTime(save?.lastActiveAt) || '—'}</span>
                  </div>
                  <div className="ep-row">
                    <span className="ep-label">消息数</span>
                    <span className="ep-value">{messageCount} 条</span>
                  </div>
                </div>

                <div className="ep-card">
                  <h3 className="ep-card-title">当前存档预览</h3>
                  {preview ? (
                    <div className="ep-preview">{preview}</div>
                  ) : (
                    <div className="ep-empty">—</div>
                  )}
                </div>
              </section>
            )}

            {tab === 'model' && (
              <section className="ep-pane" key="model">
                <div className="ep-card">
                  <h3 className="ep-card-title">当前模型</h3>
                  <div className="ep-model-display">
                    <div className="ep-model-current">
                      {current ? (
                        <>
                          <div className="ep-model-provider">{current.provider}</div>
                          <div className="ep-model-name">{current.model}</div>
                          {current.reasoningEffort ? (
                            <div className="ep-model-reasoning">推理档位：{current.reasoningEffort}</div>
                          ) : null}
                        </>
                      ) : (
                        <div className={modelInfo ? 'ep-empty' : 'ep-model-loading'}>
                          {modelInfo ? '暂无模型信息' : '读取中…'}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="ep-refresh-btn"
                      onClick={handleRefresh}
                      disabled={refreshing}
                    >
                      <RefreshIcon />
                      {refreshing ? '刷新中…' : '刷新'}
                    </button>
                  </div>
                </div>

                <div className="ep-card">
                  <h3 className="ep-card-title">可用 Provider</h3>
                  {groups.length > 0 ? (
                    <div className="ep-groups">
                      {groups.map((g) => (
                        <span key={g.id || g.name} className="ep-group-chip">
                          {g.name || g.id || '—'}
                          {g.models?.length ? <small>{g.models.length} 个模型</small> : null}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="ep-empty">—</div>
                  )}
                </div>
              </section>
            )}

            {tab === 'skills' && (
              <section className="ep-pane" key="skills">
                <div className="ep-skills-grid">
                  {skillCatalog.map((s) => {
                    const on = skills[s.id] === true
                    const disabled = skills[s.id] === undefined
                    return (
                      <div key={s.id} className={`ep-skill-card${disabled ? ' disabled' : ''}`}>
                        <div className="ep-skill-head">
                          <span className="ep-skill-icon">{s.icon}</span>
                          <span className="ep-skill-name">{s.name}</span>
                          <label className={`ep-toggle${disabled ? ' disabled' : ''}`}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={disabled}
                              onChange={(e) => onToggleSkill(s.id, e.target.checked)}
                            />
                            <span className="ep-toggle-track" />
                            <span className="ep-toggle-thumb" />
                          </label>
                        </div>
                        <div className="ep-skill-desc">{s.desc}</div>
                        {s.id === 'approval' && (
                          <div className="ep-skill-note">越界操作审批：开=自动放行，关=自动拒绝</div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="ep-card">
                  <h3 className="ep-card-title">工具目录（后端）</h3>
                  {toolsLoading ? (
                    <div className="ep-model-loading">读取中…</div>
                  ) : tools && tools.length ? (
                    <div className="ep-tools-list">
                      {tools.map((t) => (
                        <div key={t.name} className="ep-tools-item">
                          <label className="ep-toggle">
                            <input
                              type="checkbox"
                              checked={toolToggles[t.name] !== false}
                              onChange={(e) =>
                                setToolToggles((prev) => ({ ...prev, [t.name]: e.target.checked }))
                              }
                            />
                            <span className="ep-toggle-track" />
                            <span className="ep-toggle-thumb" />
                          </label>
                          <div className="ep-tools-body">
                            <span className="ep-tools-name ep-mono">{t.name}</span>
                            {t.description ? (
                              <span className="ep-tools-desc">{t.description}</span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="ep-empty">后端未提供工具列表接口</div>
                  )}
                  <div className="ep-note">工具启停开关为占位展示，仅本地预览，不写入后端。</div>
                </div>
              </section>
            )}

            {tab === 'session' && (
              <section className="ep-pane" key="session">
                <div className="ep-card">
                  <h3 className="ep-card-title">当前会话</h3>
                  <div className="ep-row">
                    <span className="ep-label">会话 ID</span>
                    <span className="ep-value ep-mono" title={context?.sessionId || ''}>
                      {sessionId || '—'}
                    </span>
                  </div>
                  <div className="ep-row">
                    <span className="ep-label">状态</span>
                    <span className="ep-value">{context?.sessionId ? '进行中' : '未开始'}</span>
                  </div>
                  <div className="ep-act-row">
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={handleFork}
                      disabled={forking}
                    >
                      <ForkIcon />
                      {forking ? '处理中…' : 'Fork 新会话'}
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={() => showMsg('请返回主界面选择新对话')}
                    >
                      新对话
                    </button>
                  </div>
                </div>

                <div className="ep-card">
                  <h3 className="ep-card-title">重命名会话</h3>
                  <div className="ep-inline-form">
                    <input
                      className="ep-input"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="输入新会话名称"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename()
                      }}
                    />
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={handleRename}
                      disabled={renaming}
                    >
                      {renaming ? '处理中…' : '重命名'}
                    </button>
                  </div>
                </div>

                <div className="ep-card">
                  <h3 className="ep-card-title">会话操作</h3>
                  <div className="ep-act-row">
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={() => handleExport('markdown')}
                      disabled={!context?.sessionId || sessionBusy !== null}
                    >
                      {sessionBusy === 'export-md' ? '导出中…' : '导出 MD'}
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={() => handleExport('json')}
                      disabled={!context?.sessionId || sessionBusy !== null}
                    >
                      {sessionBusy === 'export-json' ? '导出中…' : '导出 JSON'}
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={handleArchive}
                      disabled={!context?.sessionId || sessionBusy !== null}
                    >
                      {sessionBusy === 'archive' ? '处理中…' : '归档'}
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={handleCompress}
                      disabled={!context?.sessionId || sessionBusy !== null}
                    >
                      {sessionBusy === 'compress' ? '压缩中…' : '压缩（保留5轮）'}
                    </button>
                  </div>
                  <div className="ep-note">归档/压缩仅对当前会话可用；导出为 Markdown/JSON 文件下载。</div>
                </div>
              </section>
            )}

            {tab === 'git' && (
              <section className="ep-pane" key="git">
                <div className="ep-card">
                  <h3 className="ep-card-title">Git 控制</h3>
                  <div className="ep-row">
                    <span className="ep-label">工作区</span>
                    <span className="ep-value ep-path">{workspacePath}</span>
                  </div>
                  <div className="ep-act-row">
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={handleGitStatus}
                      disabled={gitLoading || gitBusy}
                    >
                      {gitLoading ? '读取中…' : 'Git 状态'}
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={handleGitCommit}
                      disabled={gitBusy || gitLoading}
                    >
                      {gitBusy ? '处理中…' : '提交当前改动'}
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={handleGitLog}
                      disabled={gitBusy || gitLoading}
                    >
                      查看最近提交
                    </button>
                  </div>
                  <div className="ep-note">
                    「提交当前改动」与「查看最近提交」会交给言叶在会话中执行，结果显示在对话里。
                  </div>
                </div>

                {(gitOutput || gitError) && (
                  <div className="ep-card">
                    <h3 className="ep-card-title">Git 状态输出</h3>
                    {gitError ? (
                      <pre className="ep-output ep-output-err">{gitError}</pre>
                    ) : (
                      <pre className="ep-output">{gitOutput}</pre>
                    )}
                  </div>
                )}
              </section>
            )}

            {tab === 'mcp' && (
              <section className="ep-pane" key="mcp">
                <div className="ep-card">
                  <h3 className="ep-card-title">MCP 服务器</h3>
                  {mcpLoading ? (
                    <div className="ep-model-loading">读取中…</div>
                  ) : mcpInfo?.items?.length ? (
                    <div className="ep-mcp-list">
                      {mcpInfo.items.map((it, i) => {
                        const name = it.name || it.serverName || it.id || `服务器 #${i + 1}`
                        const connected =
                          it.connected === true || it.status === 'connected' || it.ok === true
                        return (
                          <div key={it.id || it.name || i} className="ep-mcp-item">
                            <div className="ep-mcp-info">
                              <span className="ep-mcp-name ep-mono">{name}</span>
                              {it.type ? <span className="ep-mcp-type">{it.type}</span> : null}
                            </div>
                            <span className={`ep-mcp-state${connected ? ' on' : ''}`}>
                              {connected ? '已连接' : it.status || '未知'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="ep-empty">当前环境未提供 MCP 服务接口</div>
                  )}
                </div>

                <div className="ep-card">
                  <h3 className="ep-card-title">说明</h3>
                  <div className="ep-note">MCP 服务器配置由 dsh 侧管理，此处仅显示连接状态。</div>
                </div>
              </section>
            )}

            {tab === 'commands' && (
              <section className="ep-pane" key="commands">
                <div className="ep-card">
                  <h3 className="ep-card-title">/ 命令速查</h3>
                  <div className="ep-commands">
                    {COMMANDS.map((c) => (
                      <div key={c.cmd} className="ep-command-row">
                        <code className="ep-command-key">{c.cmd}</code>
                        <span className="ep-command-desc">{c.desc}</span>
                      </div>
                    ))}
                  </div>
                  <div className="ep-note">在输入框输入以 / 开头的命令即可使用</div>
                </div>
              </section>
            )}

            {tab === 'creds' && (
              <section className="ep-pane" key="creds">
                <div className="ep-card">
                  <div className="ep-creds-head">
                    <h3 className="ep-card-title">凭据状态</h3>
                    <button
                      type="button"
                      className="ep-btn ep-act-btn"
                      onClick={handleCredsRefresh}
                      disabled={credsLoading}
                    >
                      <RefreshIcon />
                      {credsLoading ? '刷新中…' : '刷新'}
                    </button>
                  </div>
                  {credsLoading ? (
                    <div className="ep-model-loading">读取中…</div>
                  ) : creds && Object.keys(creds).length ? (
                    <div className="ep-creds-list">
                      {Object.entries(creds).map(([ref, info]) => (
                        <div key={ref} className="ep-creds-item">
                          <span className="ep-creds-ref ep-mono">{ref}</span>
                          <span className={`ep-badge${info?.configured ? ' on' : ''}`}>
                            {info?.configured ? '已配置' : '未配置'}
                          </span>
                          {info?.source ? (
                            <span className="ep-creds-source">
                              {typeof info.source === 'string'
                                ? info.source
                                : JSON.stringify(info.source)}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="ep-empty">无凭据信息</div>
                  )}
                </div>

                <div className="ep-card">
                  <h3 className="ep-card-title">审批规则（只读）</h3>
                  {rulesLoading ? (
                    <div className="ep-model-loading">读取中…</div>
                  ) : rules && rules.length ? (
                    <div className="ep-rules-list">
                      {rules.map((r, i) => (
                        <div key={i} className="ep-rules-item">
                          <span className="ep-rules-tool ep-mono">
                            {r.tool === '*' ? '默认（*）' : r.tool}
                          </span>
                          <span className={`ep-badge${r.level === 'allow' ? ' on' : ''}`}>
                            {r.level === 'allow' ? '允许' : r.level === 'ask' ? '询问' : r.level === 'deny' ? '拒绝' : r.level}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="ep-empty">后端未提供审批规则接口</div>
                  )}
                </div>
              </section>
            )}

            {tab === 'stats' && (
              <section className="ep-pane" key="stats">
                <div className="ep-card">
                  <h3 className="ep-card-title">会话统计</h3>
                  <div className="ep-row">
                    <span className="ep-label">消息条数</span>
                    <span className="ep-value">{messageCount} 条</span>
                  </div>
                  <div className="ep-row">
                    <span className="ep-label">预览字数</span>
                    <span className="ep-value">{preview.length} 字</span>
                  </div>
                  <div className="ep-row">
                    <span className="ep-label">会话 ID</span>
                    <span className="ep-value ep-mono" title={context?.sessionId || ''}>
                      {sessionId || '—'}
                    </span>
                  </div>
                  <div className="ep-row">
                    <span className="ep-label">创建时间</span>
                    <span className="ep-value">{formatTime(save?.createdAt) || '—'}</span>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>

        {toast && (
          <div className="ep-toast" role="status">
            {toast}
          </div>
        )}

        <footer className="ep-actions">
          <button type="button" className="ep-btn ep-btn-primary" onClick={onSave}>
            保存当前进度
          </button>
          <button type="button" className="ep-btn ep-btn-secondary" onClick={onBackToMenu}>
            返回主界面
          </button>
          <button type="button" className="ep-btn ep-btn-text" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}