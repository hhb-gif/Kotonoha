// 设置面板：文本速度 / 背景 / 立绘 / 模型与密钥管理
// props:
//   open      是否显示（全屏遮罩 modal）
//   onClose   关闭回调（点遮罩或 × 触发）
//   settings  当前设置对象 { textSpeed, scene, showCharacter }（由父组件持有）
//   onChange(partial)  设置变更回调，父组件负责 setSettings 持久化
import { useEffect, useRef, useState } from 'react'
import bridge from '../bridge/bridge'
import {
  getModelInfo,
  setApiKey,
  getCredentialRef,
  getCredentialState,
} from '../bridge/settings'

const SCENES = [
  { id: 'bg-room', label: '书房夜景' },
  { id: 'bg-night', label: '夜空天台' },
]

export default function SettingsPanel({ open = false, onClose, settings, onChange }) {
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

  const current = modelInfo?.current
  const providerOptions = providers.length
    ? providers.map((p) => ({ id: p.id, label: p.name || p.id }))
    : (modelInfo?.groups || []).map((g) => ({ id: g.id, label: g.name || g.id }))

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

        {notice && (
          <div className={`settings-notice ${notice.kind}`} role="status">
            {notice.text}
          </div>
        )}
      </div>
    </div>
  )
}