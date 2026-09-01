// panels/SavePanel.jsx —— 存档页签：会话信息 + 当前存档预览
// 自包含：story/save/sessionId 均由 props.context 推导（解析逻辑在 shared.jsx）
import { resolveSave, resolveStory, formatTime, truncateSession } from './shared'

export default function SavePanel({ active, context, messageCount = 0 }) {
  if (!active) return null
  const story = resolveStory(context?.storyName)
  const save = resolveSave()
  const sessionId = truncateSession(context?.sessionId)
  const preview = save?.preview || ''

  return (
    <section className="ep-pane">
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
  )
}
