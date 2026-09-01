// panels/TimelinePanel.jsx —— 对话历史回放时间线（v0.2.5 任务 A / D1-timeline）
// 全屏弹层（复用 settings-overlay 模式：fixed 遮罩 + 居中大卡片）：
//   竖向时间轴（左圆点+竖线，右卡片），用户/言叶消息按轮次回放，>120 字折叠可展开。
// 数据：bridge.getSessionHistory(sessionId)（session.history，value { events:[{event:...}] }）。
// i18n: 待 D2 框架合入后，把下方本地 t() 替换为 import { t } from '../../i18n'（调用点无需改动）。
import { useEffect, useState } from 'react'
import bridge from '../../bridge/bridge'
import EXTRA_I18N from '../../i18n/extras'

// 本地 t() 回落：key 查 extras 包（D2 合并后自动多语言），缺 key 显示 key 本身（中文文案即 key）
const t = (key) => EXTRA_I18N?.[key] || key

// 摘要截断长度（超过则折叠，点「展开」看全文）
const SUMMARY_LEN = 120

// 解析 session.history events → 时间线消息列表
// 口径与 bridge.historyToMessages 保持一致：
//   user/message（source.kind==='user'，过滤系统注入）→ { role:'user', text }
//   assistant/message → { role:'model', text }（data.message.content || data.content 兼容）
// 轮次：一对 user+assistant = 一轮；user 消息触发轮号递增，后续 assistant 沿用当前轮号
function parseHistory(events) {
  const list = []
  let round = 0
  for (const item of events || []) {
    const ev = item?.event || item
    if (!ev?.type) continue
    if (ev.type === 'user/message') {
      // 只收真实用户输入（kind==='user'），与 bridge 历史重建口径一致
      if (!ev.data?.source || ev.data.source.kind !== 'user') continue
      const text = (ev.data?.content || [])
        .filter((c) => c?.type === 'text')
        .map((c) => c?.text || '')
        .join('')
      if (!text) continue
      round += 1
      list.push({ id: list.length, role: 'user', round, text })
    } else if (ev.type === 'assistant/message') {
      const content = ev.data?.message?.content || ev.data?.content || []
      const text = content
        .filter((c) => c?.type === 'text')
        .map((c) => c?.text || '')
        .join('')
      if (!text) continue
      if (round === 0) round = 1 // 防御：assistant 先于 user 出现时也算第 1 轮
      list.push({ id: list.length, role: 'model', round, text })
    }
  }
  return list
}

export default function TimelinePanel({ open, onClose, sessionId, sessionLabel = '' }) {
  // 加载状态机：idle（未打开）| loading | error | done
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  // 解析后的消息列表（按时间升序）
  const [messages, setMessages] = useState([])
  // 展开全文的消息 id 集合（组件内 state 切换）
  const [expanded, setExpanded] = useState(() => new Set())

  // 弹层激活时拉取历史（open && sessionId 才请求；alive 防竞态）
  useEffect(() => {
    if (!open) {
      setStatus('idle')
      return
    }
    if (!sessionId) {
      setStatus('error')
      setError('会话未就绪')
      return
    }
    let alive = true
    setStatus('loading')
    setError('')
    setMessages([])
    setExpanded(new Set())
    bridge
      .getSessionHistory(sessionId)
      .then((res) => {
        if (!alive) return
        if (res?.ok) {
          setMessages(parseHistory(res.events))
          setStatus('done')
        } else {
          setError(res?.error || '未知错误')
          setStatus('error')
        }
      })
      .catch((err) => {
        if (!alive) return
        setError(err?.message || '未知错误')
        setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [open, sessionId])

  // ESC 关闭弹层
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // 切换某条消息的展开/收起
  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 总轮数 = 最后一条消息的轮号（events 升序，防御式取 0）
  const rounds = messages.length ? messages[messages.length - 1].round : 0

  return (
    <div className="ep-tl-overlay" onClick={onClose}>
      <div
        className="ep-tl-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="对话回放"
      >
        {/* 顶部栏：标题 + 会话名 + 共 N 轮 + 关闭 */}
        <header className="ep-tl-head">
          <div className="ep-tl-head-info">
            <h3 className="ep-tl-title">{t('对话回放')}</h3>
            <span className="ep-tl-meta">
              {sessionLabel || '—'}
              {status === 'done' ? ` · 共 ${rounds} 轮` : ''}
            </span>
          </div>
          <button type="button" className="ep-tl-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        {/* 内容区：加载 / 失败 / 空态 / 时间轴 四种分支 */}
        <div className="ep-tl-body">
          {status === 'loading' && <div className="ep-tl-state">{t('读取中…')}</div>}

          {status === 'error' && (
            <div className="ep-tl-state ep-tl-state-error">
              {t('历史加载失败')}：{error}
            </div>
          )}

          {status === 'done' && !messages.length && (
            <div className="ep-tl-state">{t('还没有对话记录')}</div>
          )}

          {status === 'done' && messages.length > 0 && (
            <div className="ep-tl-timeline">
              {messages.map((m) => {
                const isLong = m.text.length > SUMMARY_LEN
                const collapsed = isLong && !expanded.has(m.id)
                return (
                  <div key={m.id} className={`ep-tl-item ep-tl-item-${m.role}`}>
                    <span className="ep-tl-dot" />
                    <div className="ep-tl-card">
                      <div className="ep-tl-card-head">
                        <span className={`ep-tl-role ep-tl-role-${m.role}`}>
                          {m.role === 'user' ? t('你') : t('言叶')}
                        </span>
                        <span className="ep-tl-round">第 {m.round} 轮</span>
                      </div>
                      <div className="ep-tl-text">
                        {collapsed ? `${m.text.slice(0, SUMMARY_LEN)}…` : m.text}
                      </div>
                      {isLong && (
                        <button
                          type="button"
                          className="ep-tl-expand"
                          onClick={() => toggleExpand(m.id)}
                        >
                          {collapsed ? t('展开') : t('收起')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
