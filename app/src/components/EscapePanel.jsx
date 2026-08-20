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
import { useEffect, useState } from 'react'
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

const TABS = [
  { id: 'save', label: '存档', icon: <BookmarkIcon /> },
  { id: 'model', label: '模型', icon: <ChipIcon /> },
  { id: 'skills', label: '技能', icon: <ShieldIcon /> },
  { id: 'stats', label: '统计', icon: <ChartIcon /> },
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

  useEffect(() => {
    if (!open) return
    setModelInfo(modelInfoProp)
  }, [open, modelInfoProp])

  if (!open) return null

  const story = resolveStory(context?.storyName)
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