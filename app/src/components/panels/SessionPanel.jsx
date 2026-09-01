// panels/SessionPanel.jsx —— 会话页签：搜索 / 当前会话（fork·停止）/ 重命名 / 导出·归档·压缩·时间线
// 自包含：fork/rename/export/archive/compress/search/interrupt 的状态与操作
// 时间线（v0.2.5 D1）：「会话操作」排入口按钮 → 全屏弹层 TimelinePanel 回放当前会话历史
import { useState } from 'react'
import bridge from '../../bridge/bridge'
import { downloadText, formatTime, truncateSession, ForkIcon } from './shared'
import TimelinePanel from './TimelinePanel'

export default function SessionPanel({ active, context, busy = false, showMsg }) {
  const [forking, setForking] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  // 导出 / 归档 / 压缩 操作
  const [sessionBusy, setSessionBusy] = useState(null) // null | 'export-md' | 'export-json' | 'archive' | 'compress'
  // 搜索（session.search）
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  // 对话历史回放时间线（v0.2.5 D1）
  const [openTimeline, setOpenTimeline] = useState(false)

  const sessionId = truncateSession(context?.sessionId)

  async function handleFork() {
    setForking(true)
    try {
      const res = await bridge.sessionFork()
      if (res?.ok && res.sessionId) {
        showMsg(`已 Fork 新会话：${res.sessionId}`)
      } else {
        showMsg(`Fork 失败：${res?.error || '未知错误'}`)
      }
    } catch (err) {
      showMsg(`Fork 失败：${err.message}`)
    } finally {
      setForking(false)
    }
  }

  async function handleRename() {
    const name = newName.trim()
    if (!name) {
      showMsg('请输入新会话名称')
      return
    }
    setRenaming(true)
    try {
      const res = await bridge.sessionRename(name)
      if (res?.ok) {
        showMsg('会话已重命名')
        setNewName('')
      } else {
        showMsg(`重命名失败：${res?.error || '未知错误'}`)
      }
    } catch (err) {
      showMsg(`重命名失败：${err.message}`)
    } finally {
      setRenaming(false)
    }
  }

  // 导出当前会话（format: 'markdown' | 'json'）
  async function handleExport(format) {
    const sid = context?.sessionId
    if (!sid) {
      showMsg('会话未就绪，无法导出')
      return
    }
    const tag = format === 'markdown' ? 'export-md' : 'export-json'
    setSessionBusy(tag)
    try {
      const res = await bridge.exportSession(sid, format)
      if (res?.ok && res.content) {
        const ext = format === 'markdown' ? 'md' : 'json'
        downloadText(res.filename || `session-export.${ext}`, res.content)
        showMsg(`已导出 ${res.filename || `session-export.${ext}`}`)
      } else {
        showMsg(`导出失败：${res?.error || '无内容返回'}`)
      }
    } catch (err) {
      showMsg(`导出失败：${err.message}`)
    } finally {
      setSessionBusy(null)
    }
  }

  // 归档当前会话
  async function handleArchive() {
    const sid = context?.sessionId
    if (!sid) {
      showMsg('当前会话不可归档')
      return
    }
    setSessionBusy('archive')
    try {
      const res = await bridge.archiveSession(sid)
      showMsg(res?.ok ? '会话已归档' : `归档失败：${res?.error || '未知错误'}`)
    } catch (err) {
      showMsg(`归档失败：${err.message}`)
    } finally {
      setSessionBusy(null)
    }
  }

  // 压缩当前会话（保留最近 5 轮）
  async function handleCompress() {
    const sid = context?.sessionId
    if (!sid) {
      showMsg('当前会话不可压缩')
      return
    }
    setSessionBusy('compress')
    try {
      const res = await bridge.compressSession(sid, 5)
      if (res?.ok) {
        showMsg(res.summary ? `会话已压缩：${res.summary}` : '会话已压缩（保留最近 5 轮）')
      } else {
        showMsg(`压缩失败：${res?.error || '未知错误'}`)
      }
    } catch (err) {
      showMsg(`压缩失败：${err.message}`)
    } finally {
      setSessionBusy(null)
    }
  }

  // 搜索当前会话（session.search）
  async function handleSearch() {
    const sid = context?.sessionId
    const q = searchQuery.trim()
    if (!sid) {
      showMsg('会话未就绪，无法搜索')
      return
    }
    if (!q) {
      showMsg('请输入搜索内容')
      return
    }
    if (!bridge.searchSession) {
      showMsg('会话搜索接口未就绪（等待 bridge 合入）')
      return
    }
    setSearching(true)
    try {
      const res = await bridge.searchSession(sid, q, 20)
      setSearchResults(res?.ok ? res.results || [] : [])
      if (!res?.ok) showMsg(`搜索失败：${res?.error || '未知错误'}`)
    } catch (err) {
      setSearchResults([])
      showMsg(`搜索失败：${err.message}`)
    } finally {
      setSearching(false)
    }
  }

  // 清空搜索结果
  function handleSearchClear() {
    setSearchQuery('')
    setSearchResults(null)
  }

  // 停止当前生成（session.interrupt）
  async function handleInterrupt() {
    const sid = context?.sessionId
    if (!sid) {
      showMsg('会话未就绪')
      return
    }
    if (!bridge.interruptSession) {
      showMsg('停止接口未就绪（等待 bridge 合入）')
      return
    }
    try {
      const res = await bridge.interruptSession(sid)
      showMsg(res?.ok ? '已发送停止指令' : `停止失败：${res?.error || '未知错误'}`)
    } catch (err) {
      showMsg(`停止失败：${err.message}`)
    }
  }

  if (!active) return null

  return (
    <section className="ep-pane">
      <div className="ep-card">
        <h3 className="ep-card-title">会话搜索</h3>
        <div className="ep-search-form">
          <input
            className="ep-input ep-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话中的事件（工具调用 / 消息摘要）"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch()
            }}
          />
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={handleSearch}
            disabled={searching || !context?.sessionId}
          >
            {searching ? '搜索中…' : '搜索'}
          </button>
          {searchResults ? (
            <button type="button" className="ep-btn ep-btn-text" onClick={handleSearchClear}>
              清空
            </button>
          ) : null}
        </div>
        {searchResults && (
          <div className="ep-search-results">
            <div className="ep-search-head">
              <span className="ep-search-count">找到 {searchResults.length} 条结果</span>
            </div>
            {searchResults.length ? (
              <div className="ep-search-list">
                {searchResults.map((r, i) => {
                  const ts = r.time || r.ts || r.timestamp || r.createdAt || null
                  const type = r.type || r.eventType || r.kind || ''
                  const text = String(r.text || r.summary || r.snippet || r.content || '')
                  return (
                    <div key={r.id || i} className="ep-search-item">
                      <div className="ep-search-meta">
                        {ts ? (
                          <span className="ep-search-time ep-mono">{formatTime(ts)}</span>
                        ) : null}
                        {type ? <span className="ep-search-type">{type}</span> : null}
                      </div>
                      <span className="ep-search-text">{text.slice(0, 80)}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="ep-empty">无匹配结果</div>
            )}
          </div>
        )}
      </div>

      <div className="ep-card">
        <h3 className="ep-card-title">当前会话</h3>
        <div className="ep-row">
          <span className="ep-label">会话 ID</span>
          <span className="ep-value ep-mono" title={context?.sessionId || ''}>
            {sessionId || '—'}
          </span>
        </div>
        <div className="ep-row">
          <span className="ep-label">状态</span>
          <span className="ep-value">{context?.sessionId ? '进行中' : '未开始'}</span>
        </div>
        <div className="ep-act-row">
          {busy && context?.sessionId ? (
            <button type="button" className="ep-btn ep-stop" onClick={handleInterrupt}>
              ■ 停止生成
            </button>
          ) : null}
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={handleFork}
            disabled={forking}
          >
            <ForkIcon />
            {forking ? '处理中…' : 'Fork 新会话'}
          </button>
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={() => showMsg('请返回主界面选择新对话')}
          >
            新对话
          </button>
        </div>
      </div>

      <div className="ep-card">
        <h3 className="ep-card-title">重命名会话</h3>
        <div className="ep-inline-form">
          <input
            className="ep-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="输入新会话名称"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
            }}
          />
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={handleRename}
            disabled={renaming}
          >
            {renaming ? '处理中…' : '重命名'}
          </button>
        </div>
      </div>

      <div className="ep-card">
        <h3 className="ep-card-title">会话操作</h3>
        <div className="ep-act-row">
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={() => handleExport('markdown')}
            disabled={!context?.sessionId || sessionBusy !== null}
          >
            {sessionBusy === 'export-md' ? '导出中…' : '导出 MD'}
          </button>
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={() => handleExport('json')}
            disabled={!context?.sessionId || sessionBusy !== null}
          >
            {sessionBusy === 'export-json' ? '导出中…' : '导出 JSON'}
          </button>
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={handleArchive}
            disabled={!context?.sessionId || sessionBusy !== null}
          >
            {sessionBusy === 'archive' ? '处理中…' : '归档'}
          </button>
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={handleCompress}
            disabled={!context?.sessionId || sessionBusy !== null}
          >
            {sessionBusy === 'compress' ? '压缩中…' : '压缩（保留5轮）'}
          </button>
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={() => setOpenTimeline(true)}
            disabled={!context?.sessionId}
          >
            时间线
          </button>
        </div>
        <div className="ep-note">归档/压缩仅对当前会话可用；导出为 Markdown/JSON 文件下载；时间线回放当前会话历史。</div>
      </div>

      {/* 对话历史回放时间线（全屏弹层，v0.2.5 D1） */}
      <TimelinePanel
        open={openTimeline}
        onClose={() => setOpenTimeline(false)}
        sessionId={context?.sessionId || null}
        sessionLabel={context?.storyName || sessionId || ''}
      />
    </section>
  )
}
