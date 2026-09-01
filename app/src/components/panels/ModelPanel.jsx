// panels/ModelPanel.jsx —— 模型页签：当前模型 + Provider 分组
// 自包含：modelInfo 状态（初始取 props，打开页签时同步；刷新按钮重新拉取 providers.list）
import { useEffect, useState } from 'react'
import { getModelInfo } from '../../bridge/settings'
import { RefreshIcon } from './shared'

export default function ModelPanel({ active, modelInfo: modelInfoProp = null }) {
  const [modelInfo, setModelInfo] = useState(modelInfoProp)
  const [refreshing, setRefreshing] = useState(false)

  // 打开模型页签时同步 props.modelInfo（原壳层同步 effect 迁入）
  useEffect(() => {
    if (!active) return
    setModelInfo(modelInfoProp)
  }, [active, modelInfoProp])

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

  if (!active) return null
  const current = modelInfo?.current
  const groups = modelInfo?.groups || []

  return (
    <section className="ep-pane">
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
  )
}
