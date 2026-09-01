// 选择界面：左列「项目」（工作区），右列「对话」（存档）
// props:
//   mode              'new'：可新建项目 / 对话；'load'：只能载入已有
//   onPickSave(storyId, saveId)  载入存档（返回 Promise）
//   onNewSave(storyId, saveName) 新建对话 = 新游戏（返回 Promise）
//   onBack()                     返回主界面
// 数据层为同步 localStorage 操作（bridge/stories），组件内无异步 I/O（浏览目录除外）
import { useState } from 'react'
import * as stories from '../bridge/stories'
import { t } from '../i18n'
import './SelectScreen.css'

const DEFAULT_PATH = 'E:\\Kotonoha'
const QUICK_PATHS = ['E:\\Kotonoha', 'D:\\', 'E:\\']

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

// ---- 内联 SVG 图标（stroke 24x24，禁止 emoji） ----
const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function FolderIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.6 0-3.1-.4-4.4-1.2L3 21l1.7-5.1A8.5 8.5 0 1 1 21 12z" />
      <path d="M8.5 10.5h7M8.5 13.5h4" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg {...ICON_PROPS} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export default function SelectScreen({ mode, onPickSave, onNewSave, onBack }) {
  const [storyList, setStoryList] = useState(() => stories.listStories())
  const [selectedId, setSelectedId] = useState(() => {
    const list = stories.listStories()
    return list.length ? list[0].id : null
  })
  // 新建项目表单
  const [showStoryForm, setShowStoryForm] = useState(false)
  const [storyName, setStoryName] = useState('')
  const [storyPath, setStoryPath] = useState(DEFAULT_PATH)
  const [storyError, setStoryError] = useState('')
  const [browseBusy, setBrowseBusy] = useState(false)
  // 新对话表单
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)

  const selectedStory = storyList.find((s) => s.id === selectedId) || null
  const saves = selectedId ? stories.listSaves(selectedId) : []
  // 默认对话名（模板串 {n} 占位，en/ja 语序由语言包控制）
  const defaultSaveName = t('对话 {n}').replace('{n}', saves.length + 1)
  const canBrowse = typeof window !== 'undefined' && typeof window.__KOTONOHA_PICK_DIR__ === 'function'

  function pickStory(id) {
    setSelectedId(id)
    setShowSaveForm(false)
    setStoryError('')
  }

  // ---- 新建项目 ----
  function openStoryForm() {
    setShowStoryForm(true)
    setStoryError('')
  }

  async function handleBrowse() {
    if (browseBusy || !canBrowse) return
    setBrowseBusy(true)
    setStoryError('')
    try {
      const picked = await window.__KOTONOHA_PICK_DIR__()
      if (picked) setStoryPath(String(picked))
    } catch {
      setStoryError(t('选择目录失败'))
    } finally {
      setBrowseBusy(false)
    }
  }

  function handleCreateStory() {
    setStoryError('')
    try {
      const story = stories.createStory({ name: storyName, path: storyPath })
      setStoryList(stories.listStories())
      setSelectedId(story.id)
      setStoryName('')
      setShowStoryForm(false)
      // 新项目尚无存档 → 默认名「对话 1」，自动展开新对话输入
      setShowSaveForm(true)
      setSaveName(t('对话 {n}').replace('{n}', 1))
    } catch (err) {
      setStoryError(err.message || t('创建项目失败'))
    }
  }

  // ---- 新对话 ----
  function openSaveForm() {
    setSaveName(defaultSaveName)
    setSaveError('')
    setShowSaveForm(true)
  }

  function handleNewSave() {
    if (!selectedId || busy) return
    const name = saveName.trim() || defaultSaveName
    setBusy(true)
    onNewSave(selectedId, name)
      .catch(() => setSaveError(t('开始对话失败')))
      .finally(() => setBusy(false))
  }

  // ---- 载入对话 ----
  function handlePickSave(saveId) {
    if (busy) return
    setBusy(true)
    onPickSave(selectedId, saveId).finally(() => setBusy(false))
  }

  return (
    <div className="select-screen">
      <div className="sel-panel">
        <header className="select-screen-header">
          <button type="button" className="select-back" onClick={onBack}>
            {t('← 主菜单')}
          </button>
          <h2 className="select-screen-title">{mode === 'new' ? t('选择项目') : t('载入存档')}</h2>
          <div className="select-header-spacer" />
        </header>

        <div className="select-screen-body">
          {/* ---- 左列：项目 ---- */}
          <aside className="select-screen-left">
            <div className="sel-col-head">
              <h3 className="select-section-title">{t('项目')}</h3>
              {mode === 'new' && !showStoryForm && (
                <button type="button" className="sel-new-btn" onClick={openStoryForm}>
                  <PlusIcon />
                  {t('新建项目')}
                </button>
              )}
            </div>

            {storyList.length === 0 ? (
              <div className="select-empty">
                {mode === 'new' ? t('还没有项目，点击左上角新建') : t('还没有任何项目')}
              </div>
            ) : (
              <div className="select-list">
                {storyList.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`select-item sel-story-item${s.id === selectedId ? ' selected' : ''}`}
                    style={{ animationDelay: `${i * 45}ms` }}
                    onClick={() => pickStory(s.id)}
                  >
                    <span className="sel-card-icon">
                      <FolderIcon />
                    </span>
                    <span className="sel-card-main">
                      <span className="select-item-name">{s.name}</span>
                      <span className="select-item-path">{s.path}</span>
                    </span>
                    <span className="sel-card-side">
                      <span className="sel-count">
                        {t('{n} 存档').replace('{n}', stories.listSaves(s.id).length)}
                      </span>
                      <span className="select-item-meta">
                        {t('最近 {t}').replace('{t}', formatTime(s.lastActiveAt))}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* 新建项目表单卡片（展开式，非必填流程） */}
            {mode === 'new' && showStoryForm && (
              <div className="sel-form-card">
                <div className="sel-form-row">
                  <label className="sel-form-label">{t('项目名称')}</label>
                  <input
                    className="select-input"
                    placeholder={t('如：我的故事')}
                    value={storyName}
                    onChange={(e) => setStoryName(e.target.value)}
                    maxLength={30}
                    autoFocus
                  />
                </div>

                <div className="sel-form-row">
                  <label className="sel-form-label">{t('工作区路径')}</label>
                  {canBrowse ? (
                    <div className="sel-path-row">
                      <input
                        className="select-input"
                        placeholder={t('工作区路径')}
                        value={storyPath}
                        onChange={(e) => setStoryPath(e.target.value)}
                      />
                      <button type="button" className="sel-browse" onClick={handleBrowse} disabled={browseBusy}>
                        {browseBusy ? t('选择中…') : t('浏览目录')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        className="select-input"
                        placeholder={t('浏览器环境请手动输入路径')}
                        value={storyPath}
                        onChange={(e) => setStoryPath(e.target.value)}
                      />
                      <p className="sel-path-hint">{t('浏览器环境请手动输入路径')}</p>
                    </>
                  )}
                  <div className="sel-quick-paths">
                    {QUICK_PATHS.map((p) => (
                      <button key={p} type="button" className="sel-quick-path" onClick={() => setStoryPath(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {storyError && <div className="select-error">{storyError}</div>}

                <div className="sel-form-actions">
                  <button type="button" className="sel-cancel" onClick={() => setShowStoryForm(false)}>
                    {t('取消')}
                  </button>
                  <button
                    type="button"
                    className="select-btn primary"
                    disabled={!storyName.trim() || !storyPath.trim()}
                    onClick={handleCreateStory}
                  >
                    {t('创建')}
                  </button>
                </div>
              </div>
            )}
          </aside>

          {/* ---- 右列：对话 ---- */}
          <section className="select-screen-right">
            <div className="sel-col-head">
              <h3 className="select-section-title">{t('对话')}</h3>
            </div>

            {!selectedStory ? (
              <div className="select-empty">{t('在左侧选择一个项目')}</div>
            ) : saves.length === 0 ? (
              <div className="select-empty">
                {mode === 'new' ? t('该项目还没有对话，点击下方开始新对话') : t('该项目暂无对话')}
              </div>
            ) : (
              <div className="select-list">
                {saves.map((sv, i) => (
                  <button
                    key={sv.id}
                    type="button"
                    className="select-item sel-save-item"
                    style={{ animationDelay: `${i * 45}ms` }}
                    onClick={() => handlePickSave(sv.id)}
                    disabled={busy}
                  >
                    <span className="sel-card-icon violet">
                      <ChatIcon />
                    </span>
                    <span className="sel-card-main">
                      <span className="select-item-name">{sv.name}</span>
                      {sv.preview && (
                        <span className="select-item-preview">{truncate(sv.preview, 60)}</span>
                      )}
                    </span>
                    <span className="sel-save-time">
                      {t('更新于 {t}').replace('{t}', formatTime(sv.lastActiveAt))}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="select-pane-footer">
              {mode === 'new' ? (
                selectedStory &&
                (showSaveForm ? (
                  <div className="sel-form-card compact">
                    <div className="sel-form-row">
                      <input
                        className="select-input"
                        placeholder={t('对话名称')}
                        value={saveName}
                        onChange={(e) => setSaveName(e.target.value)}
                        maxLength={40}
                        autoFocus
                      />
                    </div>
                    {saveError && <div className="select-error">{saveError}</div>}
                    <div className="sel-form-actions">
                      <button type="button" className="sel-cancel" onClick={() => setShowSaveForm(false)}>
                        {t('取消')}
                      </button>
                      <button
                        type="button"
                        className="select-btn primary"
                        disabled={busy || !saveName.trim()}
                        onClick={handleNewSave}
                      >
                        {t('开始对话')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="sel-new-btn wide" onClick={openSaveForm}>
                    <PlusIcon />
                    {t('新对话')}
                  </button>
                ))
              ) : (
                <p className="select-hint">{t('选择已有的项目与对话')}</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}