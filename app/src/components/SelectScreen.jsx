// 选择界面：左右分割 —— 左列「故事」（工作区），右列「存档」（对话记录）
// props:
//   mode              'new'：可新建故事 / 存档；'load'：只能载入已有
//   onPickSave(storyId, saveId)  载入存档（返回 Promise）
//   onNewSave(storyId, saveName) 新建存档 = 新游戏（返回 Promise）
//   onBack()                     返回主界面
// 数据层为同步 localStorage 操作（bridge/stories），组件内无异步 I/O
import { useState } from 'react'
import * as stories from '../bridge/stories'

const DEFAULT_PATH = 'E:\\Kotonoha'
const DEFAULT_SAVE_NAME = '对话 1'

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function truncate(text, max) {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

export default function SelectScreen({ mode, onPickSave, onNewSave, onBack }) {
  const [storyList, setStoryList] = useState(() => stories.listStories())
  const [selectedId, setSelectedId] = useState(() => {
    const list = stories.listStories()
    return list.length ? list[0].id : null
  })
  const [storyName, setStoryName] = useState('')
  const [storyPath, setStoryPath] = useState(DEFAULT_PATH)
  const [saveName, setSaveName] = useState(DEFAULT_SAVE_NAME)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const selectedStory = storyList.find((s) => s.id === selectedId) || null
  const saves = selectedId ? stories.listSaves(selectedId) : []

  // 新建故事：写入数据层 → 刷新列表 → 自动选中新故事
  function handleCreateStory() {
    setError('')
    try {
      const story = stories.createStory({ name: storyName, path: storyPath })
      setStoryList(stories.listStories())
      setSelectedId(story.id)
      setStoryName('')
      setSaveName(DEFAULT_SAVE_NAME)
    } catch (err) {
      setError(err.message || '创建故事失败')
    }
  }

  // 新游戏：以存档名新建存档，由父组件进入对话
  function handleNewSave() {
    if (!selectedId || busy) return
    const name = saveName.trim() || DEFAULT_SAVE_NAME
    setBusy(true)
    onNewSave(selectedId, name).finally(() => setBusy(false))
  }

  // 载入存档（与 mode 无关，均为载入）
  function handlePickSave(saveId) {
    if (busy) return
    setBusy(true)
    onPickSave(selectedId, saveId).finally(() => setBusy(false))
  }

  function pickStory(id) {
    setSelectedId(id)
    setError('')
  }

  return (
    <div className="select-screen">
      <header className="select-screen-header">
        <button type="button" className="select-back" onClick={onBack}>
          ← 返回
        </button>
        <h2 className="select-screen-title">{mode === 'new' ? '新游戏' : '载入'}</h2>
        <div className="select-header-spacer" />
      </header>

      <div className="select-screen-body">
        {/* ---- 左列：故事 ---- */}
        <aside className="select-screen-left">
          <h3 className="select-section-title">故事</h3>

          {storyList.length === 0 ? (
            <div className="select-empty">
              {mode === 'new' ? '创建一个新故事开始吧' : '还没有任何故事'}
            </div>
          ) : (
            <div className="select-list">
              {storyList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`select-item${s.id === selectedId ? ' selected' : ''}`}
                  onClick={() => pickStory(s.id)}
                >
                  <span className="select-item-name">{s.name}</span>
                  <span className="select-item-path">{s.path}</span>
                  <span className="select-item-meta">最近活动 {formatTime(s.lastActiveAt)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="select-pane-footer">
            {mode === 'new' ? (
              <>
                <form
                  className="select-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleCreateStory()
                  }}
                >
                  <input
                    className="select-input"
                    placeholder="故事名称"
                    value={storyName}
                    onChange={(e) => setStoryName(e.target.value)}
                    maxLength={30}
                  />
                  <input
                    className="select-input"
                    placeholder="工作区路径"
                    value={storyPath}
                    onChange={(e) => setStoryPath(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="select-btn primary"
                    disabled={!storyName.trim()}
                  >
                    新建故事
                  </button>
                </form>
                {error && <div className="select-error">{error}</div>}
              </>
            ) : (
              <p className="select-hint">选择已有故事</p>
            )}
          </div>
        </aside>

        {/* ---- 右列：存档 ---- */}
        <section className="select-screen-right">
          <h3 className="select-section-title">存档</h3>

          {!selectedStory ? (
            <div className="select-empty">
              {mode === 'new' ? '请先创建一个故事' : '在左侧选择一个故事'}
            </div>
          ) : saves.length === 0 ? (
            <div className="select-empty">暂无存档</div>
          ) : (
            <div className="select-list">
              {saves.map((sv) => (
                <button
                  key={sv.id}
                  type="button"
                  className="select-item"
                  onClick={() => handlePickSave(sv.id)}
                  disabled={busy}
                >
                  <span className="select-item-name">{sv.name}</span>
                  {sv.preview && (
                    <span className="select-item-preview">{truncate(sv.preview, 60)}</span>
                  )}
                  <span className="select-item-meta">更新于 {formatTime(sv.lastActiveAt)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="select-pane-footer">
            {mode === 'new' && selectedStory ? (
              <form
                className="select-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  handleNewSave()
                }}
              >
                <input
                  className="select-input"
                  placeholder="存档名称"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  maxLength={40}
                />
                <button type="submit" className="select-btn primary" disabled={busy}>
                  新游戏
                </button>
              </form>
            ) : mode === 'load' ? (
              <p className="select-hint">选择存档以载入</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
