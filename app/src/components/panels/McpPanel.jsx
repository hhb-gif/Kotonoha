// panels/McpPanel.jsx —— MCP 页签：服务器连接状态（mcp.status，失败回退旧 mcp.list）
// 自包含：MCP 状态的加载与展示
import { useEffect, useState } from 'react'
import bridge from '../../bridge/bridge'

export default function McpPanel({ active }) {
  const [mcpInfo, setMcpInfo] = useState(null)
  const [mcpLoading, setMcpLoading] = useState(false)

  // 打开 MCP 页时拉取 MCP 服务器状态（mcp.status；失败回退旧 mcp.list）
  useEffect(() => {
    if (!active) return
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
  }, [active])

  if (!active) return null

  return (
    <section className="ep-pane">
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
  )
}
