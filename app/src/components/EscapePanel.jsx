// ESC 角色面板：存档信息 / 模型配置 / 技能开关 / 统计
// props:
//   open           是否显示（全屏遮罩 modal）
//   onClose        关闭回调（点遮罩或 × 触发）
//   context        当前故事上下文 { storyName, saveName, sessionId }（字段可能为 null）
//   modelInfo      模型信息 { current:{provider,model}, groups, providers } | null（初始值）
//   skills         技能开关状态 { 'file-read':bool, ..., approval:bool }
//   skillCatalog   技能目录 [{ id, name, icon, desc, tools }]
//   onToggleSkill(id, on)  技能开关回调
//   messageCount   当前对话消息条数
//   onSave         保存到当前存档
//   onBackToMenu   返回主界面
import { useEffect, useState } from 'react'
import { getModelInfo } from '../bridge/settings'

function truncateSession(id) {
  if (!id) return null
  const s = String(id)
  return s.length > 20 ? `${s.slice(0, 20)}…` : s
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
  // 初始值用 props.modelInfo；打开时若 props 已更新则同步
  const [modelInfo, setModelInfo] = useState(modelInfoProp)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!open) return
    setModelInfo(modelInfoProp)
  }, [open, modelInfoProp])

  if (!open) return null

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const info = await getModelInfo()
      setModelInfo(info)
    } finally {
      setRefreshing(false)
    }
  }

  const current = modelInfo?.current
  const sessionId = truncateSession(context?.sessionId)

  return (
    <div className="esc-panel-overlay" onClick={onClose}>
      <div
        className="esc-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="角色面板"
      >
        <div className="esc-panel-head">
          <h2 className="esc-panel-title">角色面板</h2>
          <button type="button" className="esc-panel-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <section className="esc-panel-section">
          <h3 className="esc-panel-section-title">存档信息</h3>
          <div className="esc-info-row">
            <span className="esc-info-label">故事</span>
            <span className="esc-info-value">{context?.storyName || '—'}</span>
          </div>
          <div className="esc-info-row">
            <span className="esc-info-label">存档</span>
            <span className="esc-info-value">{context?.saveName || '—'}</span>
          </div>
          <div className="esc-info-row">
            <span className="esc-info-label">会话</span>
            <span className="esc-info-value esc-info-mono">{sessionId || '—'}</span>
          </div>
        </section>

        <section className="esc-panel-section">
          <h3 className="esc-panel-section-title">模型配置</h3>
          <div className="esc-model-line">
            {current ? (
              <span className="esc-model-current">
                {current.provider} / {current.model}
                {current.reasoningEffort ? `（${current.reasoningEffort}）` : ''}
              </span>
            ) : (
              <span className="esc-model-loading">读取中…</span>
            )}
            <button
              type="button"
              className="esc-model-refresh"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? '刷新中…' : '刷新'}
            </button>
          </div>
        </section>

        <section className="esc-panel-section">
          <h3 className="esc-panel-section-title">技能 / 道具</h3>
          <ul className="esc-skill-list">
            {skillCatalog.map((s) => {
              const on = skills[s.id] === true
              const disabled = skills[s.id] === undefined
              return (
                <li key={s.id} className="esc-skill-item">
                  <span className="esc-skill-icon">{s.icon}</span>
                  <div className="esc-skill-body">
                    <div className="esc-skill-name">{s.name}</div>
                    <div className="esc-skill-desc">{s.desc}</div>
                    {s.id === 'approval' && (
                      <div className="esc-skill-note">
                        越界操作自动放行：开=自动放行，关=自动拒绝
                      </div>
                    )}
                  </div>
                  <label className={`esc-toggle${disabled ? ' disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled}
                      onChange={(e) => onToggleSkill(s.id, e.target.checked)}
                    />
                    <span className="esc-toggle-track" />
                    <span className="esc-toggle-thumb" />
                  </label>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="esc-panel-section">
          <h3 className="esc-panel-section-title">统计</h3>
          <div className="esc-info-row">
            <span className="esc-info-label">消息</span>
            <span className="esc-info-value">{messageCount} 条</span>
          </div>
        </section>

        <div className="esc-panel-actions">
          <button type="button" className="esc-btn esc-btn-primary" onClick={onSave}>
            保存
          </button>
          <button type="button" className="esc-btn esc-btn-danger" onClick={onBackToMenu}>
            返回主界面
          </button>
        </div>
      </div>
    </div>
  )
}
