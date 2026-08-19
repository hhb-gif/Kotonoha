// 设置面板：文本速度 / 背景 / 立绘 / 模型与密钥管理
// props:
//   open      是否显示（全屏遮罩 modal）
//   onClose   关闭回调（点遮罩或 × 触发）
//   settings  当前设置对象 { textSpeed, scene, showCharacter }（由父组件持有）
//   onChange(partial)  设置变更回调，父组件负责 setSettings 持久化
import { useEffect, useRef, useState } from 'react'
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
  const [provider, setProvider] = useState('')
  const [apiKey, setApiKeyValue] = useState('')
  const [keyRef, setKeyRef] = useState('')
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [keyBusy, setKeyBusy] = useState(false)
  const [notice, setNotice] = useState(null) // { kind: 'ok' | 'err', text }
  const noticeTimer = useRef(null)

  // 打开时异步加载模型信息
  useEffect(() => {
    if (!open) return
    let stale = false
    setModelState('loading')
    setNotice(null)
    getModelInfo().then((info) => {
      if (stale) return
      setModelInfo(info)
      setModelState(info ? 'ready' : 'error')
      if (info?.current) setProvider(info.current.provider)
    })
    return () => {
      stale = true
    }
  }, [open])

  // provider 变化时解析凭据 ref 并查询已配置状态
  useEffect(() => {
    if (!open || !provider) return
    let stale = false
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
    if (!provider || !key) {
      showNotice('err', '请选择 provider 并输入密钥')
      return
    }
    setKeyBusy(true)
    const result = await setApiKey(provider, key)
    setKeyBusy(false)
    if (result.ok) {
      setApiKeyValue('')
      setKeyConfigured(true)
      setKeyRef(result.ref || keyRef)
      showNotice('ok', `密钥已保存（${result.ref}）`)
    } else {
      showNotice('err', `保存失败：${result.error}`)
    }
  }

  const current = modelInfo?.current
  const providerOptions = modelInfo?.providers?.length
    ? modelInfo.providers.map((p) => ({ id: p.provider, label: p.displayName || p.provider }))
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
                  <span>
                    当前：{current.provider} / {current.model}
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
              }}
              disabled={modelState !== 'ready' || providerOptions.length === 0}
            >
              {providerOptions.length === 0 && <option value="">无可用 provider</option>}
              {providerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
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