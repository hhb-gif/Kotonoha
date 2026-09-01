// panels/StatsPanel.jsx —— 统计页签：会话统计 + 成本（stats.cost）+ 轨迹（session.trajectory）+ 降级记录
// 自包含：成本/轨迹/降级三类数据的加载与展示
import { useEffect, useState } from 'react'
import bridge from '../../bridge/bridge'
import { formatTime, resolveSave, truncateSession } from './shared'

export default function StatsPanel({ active, context, messageCount = 0 }) {
  // 成本（stats.cost）
  const [costStats, setCostStats] = useState(null)
  const [costLoading, setCostLoading] = useState(false)
  // 轨迹（session.trajectory）
  const [trajectory, setTrajectory] = useState(null)
  const [trajectoryLoading, setTrajectoryLoading] = useState(false)
  // 降级记录（stats.degradations，M4 后端实现中）
  const [degradations, setDegradations] = useState(null)
  const [degradationsLoading, setDegradationsLoading] = useState(false)

  const sid = context?.sessionId

  // 打开统计页时拉取成本统计（stats.cost）
  useEffect(() => {
    if (!active) return
    let alive = true
    setCostLoading(true)
    // TODO(U1): bridge.getCostStats 合入前返回 null，界面显示接口未就绪
    const p = bridge.getCostStats ? bridge.getCostStats() : Promise.resolve(null)
    p.then((res) => {
      if (alive) setCostStats(res?.ok ? res : null)
    })
      .catch(() => {
        if (alive) setCostStats(null)
      })
      .finally(() => {
        if (alive) setCostLoading(false)
      })
    return () => {
      alive = false
    }
  }, [active])

  // 打开统计页时拉取当前会话轨迹（session.trajectory，审计用）
  useEffect(() => {
    if (!active) return
    let alive = true
    setTrajectoryLoading(true)
    // TODO(U1): bridge.getTrajectory 合入前返回 null，界面显示接口未就绪
    const p = sid && bridge.getTrajectory ? bridge.getTrajectory(sid) : Promise.resolve(null)
    p.then((res) => {
      if (alive) setTrajectory(res?.ok ? res.trajectory || [] : null)
    })
      .catch(() => {
        if (alive) setTrajectory(null)
      })
      .finally(() => {
        if (alive) setTrajectoryLoading(false)
      })
    return () => {
      alive = false
    }
  }, [active, sid])

  // 打开统计页时拉取降级记录（stats.degradations，M4 后端实现中）
  useEffect(() => {
    if (!active) return
    let alive = true
    setDegradationsLoading(true)
    // TODO(M4): 后端 stats.degradations 合入前返回 null，界面显示接口未就绪
    const p = bridge.getDegradations ? bridge.getDegradations() : Promise.resolve(null)
    p.then((res) => {
      if (alive) setDegradations(res?.ok ? res.degradations || [] : null)
    })
      .catch(() => {
        if (alive) setDegradations(null)
      })
      .finally(() => {
        if (alive) setDegradationsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [active])

  if (!active) return null
  const save = resolveSave()
  const sessionId = truncateSession(context?.sessionId)
  const preview = save?.preview || ''
  // U2 派生：成本按会话列表
  const costSessions = costStats?.bySession || costStats?.sessions || []

  return (
    <section className="ep-pane">
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

      <div className="ep-card">
        <h3 className="ep-card-title">成本统计</h3>
        {costLoading ? (
          <div className="ep-model-loading">读取中…</div>
        ) : costStats ? (
          <div className="ep-cost">
            <div className="ep-cost-total">
              总费用：
              <span className="ep-cost-amount">
                ${Number(costStats.total ?? costStats.totalCost ?? 0).toFixed(4)}
              </span>
            </div>
            {costSessions.length ? (
              <div className="ep-cost-list">
                {costSessions.map((c, i) => (
                  <div key={c.sessionId || i} className="ep-cost-item">
                    <span className="ep-cost-sid ep-mono" title={c.sessionId || ''}>
                      {truncateSession(c.sessionId) || '—'}
                    </span>
                    <span className="ep-cost-tokens">
                      {c.tokens ?? c.tokenCount ?? 0} tokens
                    </span>
                    <span className="ep-cost-amount">
                      ${Number(c.cost ?? c.totalCost ?? 0).toFixed(4)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="ep-empty">成本统计接口未就绪（等待 bridge 合入）</div>
        )}
      </div>

      <div className="ep-card">
        <h3 className="ep-card-title">轨迹审计</h3>
        {trajectoryLoading ? (
          <div className="ep-model-loading">读取中…</div>
        ) : trajectory ? (
          trajectory.length ? (
            <details className="ep-details">
              <summary className="ep-details-summary">
                最近 {Math.min(trajectory.length, 20)} 条工具调用（点击展开）
              </summary>
              <div className="ep-trajectory-list">
                {trajectory.slice(0, 20).map((t, i) => {
                  const ok = t.ok === true || t.success === true || t.result?.ok === true
                  const args = t.args || t.params || t.input || null
                  return (
                    <div key={t.id || i} className="ep-trajectory-item">
                      <div className="ep-trajectory-head">
                        <span className="ep-trajectory-tool ep-mono">
                          {t.tool || t.name || '未知工具'}
                        </span>
                        {t.time || t.ts || t.timestamp ? (
                          <span className="ep-trajectory-time">
                            {formatTime(t.time || t.ts || t.timestamp)}
                          </span>
                        ) : null}
                        <span className={`ep-badge${ok ? ' on' : ''}`}>{ok ? 'ok' : '—'}</span>
                      </div>
                      {args ? (
                        <span className="ep-trajectory-args">
                          {typeof args === 'string'
                            ? args.slice(0, 80)
                            : JSON.stringify(args).slice(0, 80)}
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </details>
          ) : (
            <div className="ep-empty">暂无轨迹记录</div>
          )
        ) : (
          <div className="ep-empty">轨迹接口未就绪（等待 bridge 合入）</div>
        )}
      </div>

      <div className="ep-card">
        <h3 className="ep-card-title">降级记录</h3>
        {degradationsLoading ? (
          <div className="ep-model-loading">读取中…</div>
        ) : degradations ? (
          degradations.length ? (
            <details className="ep-details">
              <summary className="ep-details-summary">
                共 {degradations.length} 条降级（点击展开）
              </summary>
              <div className="ep-degradations-list">
                {degradations.map((d, i) => {
                  const ts = d.ts || d.time || d.timestamp || d.createdAt || null
                  return (
                    <div key={d.id || i} className="ep-degradation-item">
                      <div className="ep-degradation-head">
                        {ts ? (
                          <span className="ep-degradation-time ep-mono">
                            {formatTime(ts)}
                          </span>
                        ) : null}
                        <span className="ep-degradation-route ep-mono">
                          {d.from || '?'} → {d.to || '?'}
                        </span>
                      </div>
                      {d.reason ? (
                        <span className="ep-degradation-reason">{d.reason}</span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </details>
          ) : (
            <div className="ep-empty">暂无降级记录</div>
          )
        ) : (
          <div className="ep-empty">降级记录接口未就绪（等待 M4 后端合入）</div>
        )}
      </div>
    </section>
  )
}
