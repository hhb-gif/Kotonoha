// panels/McpPanel.jsx —— MCP 页签：服务器连接状态 + 用户服务器配置化（v0.2.4 任务 B）
// 内置（builtin）服务器只读展示（mcp.status 运行态）；
// 用户服务器走 mcp.servers.*（列表/添加/连接断开/删除），配置持久化在 settings 表
// 自包含：MCP 状态的加载、展示与操作
import { useCallback, useEffect, useState } from 'react'
import bridge from '../../bridge/bridge'
import { t } from '../../i18n'

// 添加表单初始值（type 决定渲染 stdio 字段组还是 sse url 字段）
const EMPTY_FORM = { id: '', type: 'stdio', command: '', args: '', url: '' }

/** 运行态 status → 文案（经 t() 翻译，未收录状态原样回落） */
function statusText(status) {
  if (status === 'connected') return t('已连接')
  if (status === 'connecting') return t('连接中')
  if (status === 'error') return t('错误')
  if (status === 'disconnected') return t('未连接')
  return t(status || '未知')
}

export default function McpPanel({ active }) {
  // 内置/非用户域服务器（mcp.status 运行态，过滤掉用户注册过的 registry id）
  const [builtinServers, setBuiltinServers] = useState(null)
  // 用户配置服务器（mcp.servers.list，配置 + 运行态合并）
  const [userServers, setUserServers] = useState([])
  const [mcpLoading, setMcpLoading] = useState(false)
  // 添加表单
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  // 操作互斥锁（添加/切换/删除共用，防重复点击）
  const [busy, setBusy] = useState(false)
  // 轻提示 { kind: 'ok'|'err', text }（3 秒自动消失）
  const [toast, setToast] = useState(null)

  // toast 自动消失
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  // 加载列表：mcp.servers.list（用户配置，失败回退纯 mcp.status → 旧 mcp.list）
  const loadLists = useCallback(async () => {
    setMcpLoading(true)
    try {
      const statusRes = await bridge.mcpStatus()
      let allRuntime = statusRes?.ok ? statusRes.servers || [] : null
      if (allRuntime === null) {
        // 旧接口兜底（mcp.list）
        const legacy = await bridge.getMcpInfo().catch(() => null)
        allRuntime = legacy?.items || []
      }
      const confRes = await bridge.listMcpServers().catch(() => null)
      if (confRes?.ok) {
        setUserServers(confRes.servers || [])
        // 用户服务器对应的 registry 运行态 id → 从「内置区」剔除
        const managed = new Set(confRes.managedRegistryIds || [])
        setBuiltinServers(allRuntime.filter((s) => !managed.has(s.id)))
      } else {
        // 旧后端兜底：无配置化接口时全部按只读运行态展示
        setUserServers([])
        setBuiltinServers(allRuntime)
      }
    } catch {
      setBuiltinServers([])
      setUserServers([])
    } finally {
      setMcpLoading(false)
    }
  }, [])

  // 打开 MCP 页时拉取
  useEffect(() => {
    if (active) loadLists()
  }, [active, loadLists])

  // ---- 添加服务器 ----
  const submitAdd = async () => {
    const id = form.id.trim()
    // 必填校验，错误就地提示
    if (!id) {
      setFormError(t('请填写服务器 id'))
      return
    }
    if (form.type === 'stdio' && !form.command.trim()) {
      setFormError(t('stdio 类型必须填写 command'))
      return
    }
    if (form.type === 'sse' && !form.url.trim()) {
      setFormError(t('sse 类型必须填写 url'))
      return
    }
    setFormError('')
    setBusy(true)
    const server = { id, type: form.type }
    if (form.type === 'stdio') {
      server.command = form.command.trim()
      const args = form.args.trim().split(/\s+/).filter(Boolean)
      if (args.length > 0) server.args = args
    } else {
      server.url = form.url.trim()
    }
    const res = await bridge.addMcpServer(server)
    setBusy(false)
    if (res?.ok) {
      setForm(EMPTY_FORM)
      setFormOpen(false)
      setToast({ kind: 'ok', text: `服务器「${id}」已添加` })
    } else {
      // 添加失败（校验/注册/连接）→ 表单内展示错误
      setFormError(res?.error || t('添加失败'))
    }
    loadLists()
  }

  // ---- 连接/断开切换 ----
  const handleToggle = async (srv) => {
    setBusy(true)
    const res = await bridge.toggleMcpServer(srv.id, !srv.enabled)
    setBusy(false)
    if (res?.ok) {
      setToast({ kind: 'ok', text: `服务器「${srv.id}」已${srv.enabled ? '断开' : '连接'}` })
    } else {
      setToast({ kind: 'err', text: `切换失败：${res?.error || '未知错误'}` })
    }
    loadLists()
  }

  // ---- 删除（confirm 后执行）----
  const handleRemove = async (srv) => {
    if (!window.confirm(`确定删除服务器「${srv.id}」？其配置将从设置中移除。`)) return
    setBusy(true)
    const res = await bridge.removeMcpServer(srv.id)
    setBusy(false)
    if (res?.ok) {
      setToast({ kind: 'ok', text: `服务器「${srv.id}」已删除` })
    } else {
      setToast({ kind: 'err', text: `删除失败：${res?.error || '未知错误'}` })
    }
    loadLists()
  }

  if (!active) return null

  const showLegacyEmpty = builtinServers === null && userServers.length === 0

  return (
    <section className="ep-pane">
      {/* 操作轻提示（成功金色 / 失败红色，3 秒自动消失） */}
      {toast && (
        <div
          className="ep-note"
          style={{
            color: toast.kind === 'err' ? '#e0716f' : '#e8c97a',
            marginTop: 0,
            paddingTop: 0,
            borderTop: 'none',
          }}
        >
          {toast.text}
        </div>
      )}

      <div className="ep-card">
        <h3 className="ep-card-title">{t('我的 MCP 服务器')}</h3>

        {/* 添加入口 + 折叠表单 */}
        <div className="ep-act-row">
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={() => {
              setFormOpen(!formOpen)
              setFormError('')
            }}
            disabled={busy}
          >
            {formOpen ? t('收起表单') : t('＋ 添加服务器')}
          </button>
        </div>

        {formOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '10px 0' }}>
            <div className="ep-inline-form">
              <input
                className="ep-input"
                placeholder={t('服务器 id（必填，如 my-filesystem）')}
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
              />
              <select
                className="ep-input"
                style={{ flex: '0 0 110px' }}
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
              </select>
            </div>
            {form.type === 'stdio' ? (
              <>
                <div className="ep-inline-form">
                  <input
                    className="ep-input"
                    placeholder={t('command（必填，如 npx）')}
                    value={form.command}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                  />
                </div>
                <div className="ep-inline-form">
                  <input
                    className="ep-input"
                    placeholder={t('args（空格分隔，可空，如 -y @modelcontextprotocol/server-filesystem E:/dir）')}
                    value={form.args}
                    onChange={(e) => setForm({ ...form, args: e.target.value })}
                  />
                </div>
              </>
            ) : (
              <div className="ep-inline-form">
                <input
                  className="ep-input"
                  placeholder={t('url（必填，如 http://localhost:3000/sse）')}
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </div>
            )}
            {formError && <div style={{ color: '#e0716f', fontSize: 12 }}>{formError}</div>}
            <div className="ep-inline-form">
              <button
                type="button"
                className="ep-btn ep-act-btn"
                onClick={submitAdd}
                disabled={busy}
              >
                {busy ? t('处理中…') : t('添加并连接')}
              </button>
            </div>
          </div>
        )}

        {/* 用户服务器列表：状态徽章 + 连接/断开 + 删除 */}
        {mcpLoading ? (
          <div className="ep-model-loading">{t('读取中…')}</div>
        ) : userServers.length > 0 ? (
          <div className="ep-mcp-list">
            {userServers.map((srv) => {
              const connected = srv.status === 'connected'
              return (
                <div key={srv.id} className="ep-mcp-item">
                  <div className="ep-mcp-info">
                    <span className="ep-mcp-name ep-mono">{srv.id}</span>
                    <span className="ep-mcp-type">{srv.type}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      className={`ep-mcp-state${connected ? ' on' : ''}`}
                      title={srv.status === 'error' && srv.error ? srv.error : undefined}
                    >
                      {srv.enabled === false ? t('已停用') : statusText(srv.status)}
                      {srv.tools?.length > 0 ? ` · ${t('{n} 工具').replace('{n}', srv.tools.length)}` : ''}
                    </span>
                    <button
                      type="button"
                      className="ep-btn ep-btn-text"
                      onClick={() => handleToggle(srv)}
                      disabled={busy}
                    >
                      {srv.enabled === false ? t('连接') : t('断开')}
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-btn-text"
                      style={{ color: '#e0716f' }}
                      onClick={() => handleRemove(srv)}
                      disabled={busy}
                    >
                      {t('删除')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="ep-empty">{t('还没有添加自定义服务器')}</div>
        )}
        <div className="ep-note">
          {t('配置保存在本地 settings 表；连接失败的服务器下次启动会自动重试。')}
        </div>
      </div>

      <div className="ep-card">
        <h3 className="ep-card-title">{t('内置服务器（只读）')}</h3>
        {mcpLoading ? (
          <div className="ep-model-loading">{t('读取中…')}</div>
        ) : builtinServers?.length ? (
          <div className="ep-mcp-list">
            {builtinServers.map((it, i) => {
              const name = it.name || it.serverName || it.id || t('服务器 #{n}').replace('{n}', i + 1)
              const connected =
                it.connected === true || it.status === 'connected' || it.ok === true
              return (
                <div key={it.id || it.name || i} className="ep-mcp-item">
                  <div className="ep-mcp-info">
                    <span className="ep-mcp-name ep-mono">{name}</span>
                    {it.type ? <span className="ep-mcp-type">{it.type}</span> : null}
                  </div>
                  <span className={`ep-mcp-state${connected ? ' on' : ''}`}>
                    {connected ? t('已连接') : statusText(it.status)}
                  </span>
                </div>
              )
            })}
          </div>
        ) : showLegacyEmpty ? (
          <div className="ep-empty">{t('当前环境未提供 MCP 服务接口')}</div>
        ) : (
          <div className="ep-empty">{t('无内置服务器运行态')}</div>
        )}
      </div>
    </section>
  )
}
