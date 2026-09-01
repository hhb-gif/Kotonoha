// 设置面板：文本速度 / 背景 / 打字机音效 / 背景音乐 / 立绘 / 语音朗读 / 模型与密钥管理 / 检查更新
// props:
//   open      是否显示（全屏遮罩 modal）
//   onClose   关闭回调（点遮罩或 × 触发）
//   settings  当前设置对象（由父组件持有）
//   onChange(partial)  设置变更回调，父组件负责 setSettings 持久化
//   ttsVoices 系统可用语音包列表（SpeechSynthesisVoice[]，由父组件 useTTS 提供）
import { useEffect, useRef, useState } from 'react'
import bridge from '../bridge/bridge'
import {
  getModelInfo,
  setApiKey,
  getCredentialRef,
  getCredentialState,
} from '../bridge/settings'
import {
  updateCapable,
  checkUpdate,
  downloadUpdate,
  quitAndInstall,
  onUpdateStatus,
} from '../bridge/update'

const SCENES = [
  { id: 'bg-room', label: '书房夜景' },
  { id: 'bg-night', label: '夜空天台' },
]

export default function SettingsPanel({ open = false, onClose, settings, onChange, ttsVoices = [] }) {
  const [modelInfo, setModelInfo] = useState(null) // { current, groups, providers } | null
  const [modelState, setModelState] = useState('loading') // loading | ready | error
  // provider 目录（providers.list 填充）+ 当前选中 provider 的模型下拉
  const [providers, setProviders] = useState([]) // [{ id, name, capabilities?, models:[{id,name?}] }]
  const [providersState, setProvidersState] = useState('loading') // loading | ready | error
  const [models, setModels] = useState([]) // 当前选中 provider 的模型列表
  const [model, setModel] = useState('') // 当前选中的模型 id
  const [provider, setProvider] = useState('')
  const [apiKey, setApiKeyValue] = useState('')
  const [keyRef, setKeyRef] = useState('')
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [keyBusy, setKeyBusy] = useState(false)
  const [notice, setNotice] = useState(null) // { kind: 'ok' | 'err', text }
  const noticeTimer = useRef(null)
  // 更新状态（主进程 update:status 推送 + 手动检查结果驱动）
  // idle | checking | latest | available | downloading | downloaded | error | portable-available | dev
  const [updState, setUpdState] = useState('idle')
  const [updVersion, setUpdVersion] = useState('')
  const [updPercent, setUpdPercent] = useState(0)
  const updBusyRef = useRef(false)

  // 订阅主进程更新状态推送（启动后自动检查 / 下载进度 / 下载完成等）
  useEffect(() => {
    const off = onUpdateStatus((payload) => {
      if (!payload || !payload.state) return
      setUpdState(payload.state)
      if (payload.version) setUpdVersion(payload.version)
      if (payload.state === 'downloading') setUpdPercent(payload.percent || 0)
    })
    return off
  }, [])

  // 打开时异步加载模型信息 + provider 目录（providers.list）
  useEffect(() => {
    if (!open) return
    let stale = false
    setModelState('loading')
    setProvidersState('loading')
    setNotice(null)
    ;(async () => {
      // ① provider 目录（providers.list，替代旧 llm.providers）
      let provs = []
      try {
        const lp = await bridge.listProviders()
        if (!stale) {
          provs = lp?.ok ? lp.providers || [] : []
          setProviders(provs)
          setProvidersState(provs.length ? 'ready' : 'error')
        }
      } catch {
        if (!stale) {
          setProviders([])
          setProvidersState('error')
        }
      }
      // ② 当前会话模型信息（session.models）
      let info = null
      try {
        info = await getModelInfo()
      } catch {
        info = null
      }
      if (stale) return
      setModelInfo(info)
      setModelState(info ? 'ready' : 'error')
      const cur = info?.current || {}
      // 决定初始 provider：当前会话的 provider（若在目录内）→ defaultId → 第一个 provider
      let initProvider = ''
      if (cur.provider && provs.some((x) => x.id === cur.provider)) initProvider = cur.provider
      if (!initProvider) {
        const defId = lp?.defaultId || provs[0]?.id
        if (defId && provs.some((x) => x.id === defId)) initProvider = defId
        else if (provs.length) initProvider = provs[0].id
      }
      // 模型下拉默认选中当前模型；不在列表则默认选第一个（新用户开箱即用）
      if (initProvider) {
        setProvider(initProvider)
        const list = provs.find((x) => x.id === initProvider)?.models || []
        if (list.some((m) => m.id === cur.model)) setModel(cur.model)
        else if (list.length > 0) setModel(list[0].id)
      }
    })()
    return () => {
      stale = true
    }
  }, [open])

  // provider 变化时：刷新该 provider 的模型下拉，并解析凭据 ref 与已配置状态
  useEffect(() => {
    if (!open || !provider) return
    let stale = false
    setKeyRef('')
    setKeyConfigured(false)
    const list = providers.find((x) => x.id === provider)?.models || []
    setModels(list)
    setModel((prev) => (list.some((m) => m.id === prev) ? prev : ''))
    ;(async () => {
      try {
        const ref = await getCredentialRef(provider)
        if (stale) return
        setKeyRef(ref)
        const state = await getCredentialState(ref)
        if (stale) return
        setKeyConfigured(state?.configured === true)
      } catch {
        if (!stale) setKeyRef('')
      }
    })()
    return () => {
      stale = true
    }
  }, [open, provider])

  if (!open) return null

  function showNotice(kind, text) {
    setNotice({ kind, text })
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 3000)
  }

  async function handleSaveKey() {
    const key = apiKey.trim()
    if (!provider) {
      showNotice('err', '请选择 provider')
      return
    }
    if (!key && !model) {
      showNotice('err', '请输入密钥或选择模型')
      return
    }
    setKeyBusy(true)
    let savedRef = keyRef
    const parts = []
    // ① 保存密钥（有输入时才写）
    if (key) {
      const result = await setApiKey(provider, key)
      if (!result.ok) {
        setKeyBusy(false)
        showNotice('err', `密钥保存失败：${result.error}`)
        return
      }
      savedRef = result.ref || keyRef
      setApiKeyValue('')
      setKeyConfigured(true)
      parts.push(`密钥已保存（${savedRef}）`)
    }
    // ② 切换模型（选中了模型才切）
    if (model) {
      const hasSession = !!(window.__bridgeDebug?.state?.sessionId)
      const mr = await bridge.selectModel(provider, model)
      if (mr.ok) {
        parts.push(`已切换 ${provider}/${model}`)
      } else if (mr.error === '会话未就绪' || !hasSession) {
        // 新用户尚无会话：selectModel 会因「会话未就绪」失败。
        // 这里仅保存密钥，模型选择在进入对话后生效，不报错。
        parts.push('密钥已保存，模型将在进入对话后生效')
      } else {
        setKeyBusy(false)
        showNotice('err', `模型切换失败：${mr.error}`)
        return
      }
    }
    setKeyBusy(false)
    setKeyRef(savedRef)
    showNotice('ok', parts.join('，'))
  }

  // ---- 检查更新 ----

  async function handleCheckUpdate() {
    if (updBusyRef.current) return
    updBusyRef.current = true
    setUpdState('checking')
    const res = await checkUpdate()
    updBusyRef.current = false
    if (!res.ok) {
      // 浏览器 dev 等不支持环境：静默回退，不打扰
      setUpdState('error')
      return
    }
    // NSIS 触发后立即返回 checking，后续状态由 update:status 事件推送；
    // portable / dev 直接返回最终状态，这里兜底同步一次
    if (res.state && res.state !== 'checking') {
      setUpdState(res.state)
      if (res.version) setUpdVersion(res.version)
    }
  }

  async function handleDownload() {
    if (updBusyRef.current) return
    updBusyRef.current = true
    const res = await downloadUpdate()
    updBusyRef.current = false
    if (!res.ok) {
      setUpdState('error')
      return
    }
    if (res.url) {
      // portable：已打开 Release 页，保持当前状态（portable-available）
    } else {
      // NSIS：进入下载中（进度由 download-progress 事件推送）
      setUpdState('downloading')
      setUpdPercent(0)
    }
  }

  async function handleQuitInstall() {
    if (updBusyRef.current) return
    updBusyRef.current = true
    await quitAndInstall()
    updBusyRef.current = false
  }

  function renderUpdStatus() {
    switch (updState) {
      case 'checking':
        return '检查中…'
      case 'latest':
        return `已是最新版本 v${updVersion || ''}`
      case 'available':
        return `发现新版本 v${updVersion}`
      case 'downloading':
        return `下载中 ${updPercent}%`
      case 'downloaded':
        return `新版本 v${updVersion} 已下载，重启后生效`
      case 'portable-available':
        return `发现新版本 v${updVersion}（便携版需手动下载）`
      case 'dev':
        return '开发模式，不检查更新'
      case 'error':
        return '检查失败，请稍后重试'
      default:
        return '点击检查更新'
    }
  }

  function renderUpdAction() {
    if (updBusyRef.current) return null
    switch (updState) {
      case 'idle':
      case 'latest':
      case 'error':
        return (
          <button type="button" className="btn upd-btn" onClick={handleCheckUpdate}>
            检查更新
          </button>
        )
      case 'available':
      case 'portable-available':
        return (
          <button
            type="button"
            className="btn upd-btn upd-btn-primary"
            onClick={handleDownload}
          >
            {updState === 'portable-available' ? '前往下载' : '下载更新'}
          </button>
        )
      case 'downloaded':
        return (
          <button
            type="button"
            className="btn upd-btn upd-btn-primary"
            onClick={handleQuitInstall}
          >
            重启并安装
          </button>
        )
      default:
        // checking / downloading：无操作按钮，仅显示状态文本
        return null
    }
  }

  const current = modelInfo?.current
  const providerOptions = providers.length
    ? providers.map((p) => ({ id: p.id, label: p.name || p.id }))
    : (modelInfo?.groups || []).map((g) => ({ id: g.id, label: g.name || g.id }))

  // ---- 语音朗读：音色选项优先中文语音包（zh*），无中文时列出全部系统语音 ----
  const ttsVoiceList = Array.isArray(ttsVoices) ? ttsVoices : []
  const zhVoices = ttsVoiceList.filter(
    (v) => v.lang && String(v.lang).toLowerCase().startsWith('zh')
  )
  const ttsVoiceOptions = zhVoices.length > 0 ? zhVoices : ttsVoiceList
  const ttsVoiceURI = settings?.ttsVoiceURI || ''
  // 存储的音色不在当前列表（语音包被卸载等）→ 回落系统默认显示（hook 内同样按默认朗读）
  const ttsVoiceValue = ttsVoiceOptions.some((v) => v.voiceURI === ttsVoiceURI) ? ttsVoiceURI : ''
  const ttsRate = settings?.ttsRate ?? 1.0
  const ttsVolumePct = Math.round((settings?.ttsVolume ?? 0.8) * 100)

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="设置"
      >
        <button className="settings-close" onClick={onClose} aria-label="关闭设置">×</button>

        <h2 className="settings-title">设置</h2>

        {/* 区块一：文本速度 */}
        <section className="settings-section">
          <h3 className="settings-section-title">文本速度</h3>
          <div className="settings-row">
            <input
              type="range"
              className="settings-slider"
              min="20"
              max="120"
              step="1"
              value={settings?.textSpeed ?? 40}
              onChange={(e) => onChange({ textSpeed: Number(e.target.value) })}
            />
            <span className="settings-value">{settings?.textSpeed ?? 40} ms/字</span>
          </div>
        </section>

        {/* 区块二：背景切换 */}
        <section className="settings-section">
          <h3 className="settings-section-title">背景</h3>
          <div className="settings-row">
            {SCENES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`btn settings-scene-btn${settings?.scene === s.id ? ' active' : ''}`}
                onClick={() => onChange({ scene: s.id })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        {/* 区块二点五：打字机音效 */}
        <section className="settings-section">
          <h3 className="settings-section-title">打字机音效</h3>
          <div className="settings-row">
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings?.typeSound !== false}
                onChange={(e) => onChange({ typeSound: e.target.checked })}
              />
              <span className="settings-switch-track" />
              <span className="settings-switch-thumb" />
            </label>
            <span className="settings-value">
              {settings?.typeSound !== false ? '开启' : '关闭'}
            </span>
          </div>
        </section>

        {/* 区块二点六：背景音乐 */}
        <section className="settings-section">
          <h3 className="settings-section-title">背景音乐</h3>
          <div className="settings-row">
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings?.bgm !== false}
                onChange={(e) => onChange({ bgm: e.target.checked })}
              />
              <span className="settings-switch-track" />
              <span className="settings-switch-thumb" />
            </label>
            <span className="settings-value">
              {settings?.bgm !== false ? '开启' : '关闭'}
            </span>
          </div>
          {settings?.bgm !== false && (
            <div className="settings-row" style={{ marginTop: '8px' }}>
              <input
                type="range"
                className="settings-slider"
                min="0"
                max="100"
                step="1"
                value={settings?.bgmVolume ?? 50}
                onChange={(e) => onChange({ bgmVolume: Number(e.target.value) })}
              />
              <span className="settings-value">{settings?.bgmVolume ?? 50}%</span>
            </div>
          )}
        </section>

        {/* 区块三：立绘显示 */}
        <section className="settings-section">
          <h3 className="settings-section-title">立绘显示</h3>
          <div className="settings-row">
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings?.showCharacter !== false}
                onChange={(e) => onChange({ showCharacter: e.target.checked })}
              />
              <span className="settings-switch-track" />
              <span className="settings-switch-thumb" />
            </label>
            <span className="settings-value">
              {settings?.showCharacter !== false ? '显示' : '隐藏'}
            </span>
          </div>
        </section>

        {/* 区块三点五：语音朗读 */}
        <section className="settings-section">
          <h3 className="settings-section-title">语音朗读</h3>
          <div className="settings-row">
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings?.ttsEnabled === true}
                onChange={(e) => onChange({ ttsEnabled: e.target.checked })}
              />
              <span className="settings-switch-track" />
              <span className="settings-switch-thumb" />
            </label>
            <span className="settings-value">
              {settings?.ttsEnabled === true ? '开启' : '关闭'}
            </span>
          </div>
          {settings?.ttsEnabled === true && (
            <>
              <div className="settings-row" style={{ marginTop: '8px' }}>
                <select
                  className="settings-select"
                  value={ttsVoiceValue}
                  onChange={(e) => onChange({ ttsVoiceURI: e.target.value })}
                  disabled={ttsVoiceOptions.length === 0}
                >
                  {ttsVoiceOptions.length === 0 && (
                    <option value="">系统无可用语音</option>
                  )}
                  <option value="">系统默认音色</option>
                  {ttsVoiceOptions.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name}（{v.lang}）
                    </option>
                  ))}
                </select>
              </div>
              {ttsVoiceOptions.length === 0 && (
                <div className="settings-key-note">系统无可用语音，朗读不可用</div>
              )}
              {ttsVoiceOptions.length > 0 && zhVoices.length === 0 && (
                <div className="settings-key-note">未找到中文语音包，已列出全部系统语音</div>
              )}
              <div className="settings-row" style={{ marginTop: '8px' }}>
                <input
                  type="range"
                  className="settings-slider"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={ttsRate}
                  onChange={(e) => onChange({ ttsRate: Number(e.target.value) })}
                />
                <span className="settings-value">{Number(ttsRate).toFixed(1)}x</span>
              </div>
              <div className="settings-row" style={{ marginTop: '8px' }}>
                <input
                  type="range"
                  className="settings-slider"
                  min="0"
                  max="100"
                  step="1"
                  value={ttsVolumePct}
                  onChange={(e) => onChange({ ttsVolume: Number(e.target.value) / 100 })}
                />
                <span className="settings-value">{ttsVolumePct}%</span>
              </div>
            </>
          )}
        </section>

        {/* 区块四：模型与密钥管理 */}
        <section className="settings-section">
          <h3 className="settings-section-title">模型与密钥</h3>

          <div className="settings-model-info">
            {modelState === 'loading' && <span className="settings-muted">加载中…</span>}
            {modelState === 'error' && (
              <span className="settings-muted settings-error">模型信息加载失败</span>
            )}
            {modelState === 'ready' && (
              <div className="settings-model-current">
                {current ? (
                  <span className="settings-model-chip">
                    当前会话 · {current.provider} / {current.model}
                    {current.reasoningEffort ? `（${current.reasoningEffort}）` : ''}
                  </span>
                ) : (
                  <span className="settings-muted">当前会话暂无模型信息</span>
                )}
              </div>
            )}
          </div>

          <div className="settings-row settings-key-row">
            <select
              className="settings-select"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value)
                setKeyRef('')
                setKeyConfigured(false)
                setModel('')
              }}
              disabled={providersState !== 'ready' || providerOptions.length === 0}
            >
              {providerOptions.length === 0 && (
                <option value="">{providersState === 'loading' ? '加载中…' : '无可用 provider'}</option>
              )}
              {providerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              className="settings-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!provider || models.length === 0}
            >
              {!provider || models.length === 0 ? (
                <option value="">模型由本地服务提供</option>
              ) : (
                models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))
              )}
            </select>
            <input
              type="password"
              className="settings-input"
              placeholder="API 密钥（sk-…）"
              value={apiKey}
              onChange={(e) => setApiKeyValue(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className="btn settings-save-btn"
              onClick={handleSaveKey}
              disabled={keyBusy}
            >
              {keyBusy ? '保存中…' : '保存'}
            </button>
          </div>

          <div className="settings-ref-line">
            <span className="settings-muted">
              凭据引用：{keyRef || '—'}
              {keyRef ? (keyConfigured ? '（已配置）' : '（未配置）') : ''}
            </span>
          </div>
          <div className="settings-key-note">密钥只存在本机（加密存储），不会上传。</div>
        </section>

        {/* 区块五：检查更新 */}
        <section className="settings-section">
          <h3 className="settings-section-title">检查更新</h3>
          {updateCapable() ? (
            <div className="upd-row">
              <span className={`upd-status ${updState}`}>{renderUpdStatus()}</span>
              {renderUpdAction()}
            </div>
          ) : (
            <span className="settings-muted">当前环境不支持自动更新</span>
          )}
        </section>

        {notice && (
          <div className={`settings-notice ${notice.kind}`} role="status">
            {notice.text}
          </div>
        )}
      </div>
    </div>
  )
}