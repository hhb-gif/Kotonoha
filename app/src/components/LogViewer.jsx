// 对话记录查看器：全屏深色叠加层，展示当前对话完整历史（视觉小说「回顾」风）
// props:
//   open       boolean 显示/隐藏（true 时挂载并播放入场动画）
//   onClose    关闭回调（点遮罩 / 点 × / 按 ESC 触发）
//   messages   当前对话消息数组 [{ role:'user'|'model', name, text }]
import { useEffect } from 'react'
import { t } from '../i18n'
import './LogViewer.css'

// 轻量 markdown 清理：去掉代码块围栏 / 反引号 / ** 加粗 / # 标题符 / 链接网址，保留换行
function cleanMarkdown(text) {
  if (typeof text !== 'string') return ''
  return String(text)
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1') // 代码块 → 仅保留内容
    .replace(/`([^`]*)`/g, '$1') // 行内反引号
    .replace(/\*\*([^*]+)\*\*/g, '$1') // ** 加粗符
    .replace(/^#{1,6}\s+/gm, '') // # 标题符
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [t](u) → t
}

const MAX_STAGGER = 20 // 入场 stagger 最多 20 条以内生效

export default function LogViewer({ open = false, onClose, messages = [] }) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const count = messages.length

  return (
    <div className="log-viewer-overlay" onClick={onClose}>
      <div
        className="log-viewer-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('对话记录')}
      >
        <header className="log-viewer-head">
          <h2 className="log-viewer-title">
            <svg
              className="log-viewer-title-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M12 7.5V12l3.2 2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M6.5 5.2 8.6 7.3M17.5 5.2 15.4 7.3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <span>{t('对话记录')}</span>
          </h2>
          <span className="log-viewer-count">{t('共 {n} 条消息').replace('{n}', count)}</span>
          <button
            type="button"
            className="log-viewer-close"
            onClick={onClose}
            aria-label={t('关闭对话记录')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="log-viewer-list">
          {count === 0 ? (
            <div className="log-viewer-empty">{t('还没有对话内容')}</div>
          ) : (
            messages.map((m, i) => {
              const isUser = m.role === 'user'
              const name = isUser ? t('你') : m.name || t('模型')
              return (
                <article
                  key={i}
                  className={`log-viewer-item log-viewer-item--${isUser ? 'user' : 'model'}`}
                  style={{ animationDelay: `${Math.min(i, MAX_STAGGER) * 30}ms` }}
                >
                  <div className="log-viewer-avatar" aria-hidden="true">
                    {isUser ? t('你') : (m.name || t('模型')).charAt(0)}
                  </div>
                  <div className="log-viewer-item-body">
                    <div className="log-viewer-item-name">{name}</div>
                    <div className="log-viewer-item-text">{cleanMarkdown(m.text)}</div>
                  </div>
                </article>
              )
            })
          )}
        </div>

        <footer className="log-viewer-footer">{t('ESC 或点击 × 关闭')}</footer>
      </div>
    </div>
  )
}
