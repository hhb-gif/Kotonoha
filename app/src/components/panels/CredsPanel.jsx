// panels/CredsPanel.jsx —— 凭据页签：凭据状态（credentials.describe）+ 审批规则（rules.get，只读）
// 自包含：凭据与规则的加载、刷新
import { useEffect, useState } from 'react'
import bridge from '../../bridge/bridge'
import { RefreshIcon } from './shared'

export default function CredsPanel({ active }) {
  const [creds, setCreds] = useState(null)
  const [credsLoading, setCredsLoading] = useState(false)
  // 审批规则（rules.get 只读）
  const [rules, setRules] = useState(null)
  const [rulesLoading, setRulesLoading] = useState(false)

  // 打开凭据页时拉取审批规则（rules.get，只读展示）
  useEffect(() => {
    if (!active) return
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
  }, [active])

  // 打开凭据页时拉取凭据状态
  useEffect(() => {
    if (!active) return
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
  }, [active])

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

  if (!active) return null

  return (
    <section className="ep-pane">
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
  )
}
