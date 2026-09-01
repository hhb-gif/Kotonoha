// panels/BondPanel.jsx —— 羁绊页签（v0.2.2 M6c）：好感度 + 互动数据 + 共同回忆时间线
// 数据来源：bridge.getBond()（bond.get，B1 后端并行实现中，未就绪时容错显示）
//          bridge.listMemories()（memory.list，按 created_at 升序展示）
// 升级仪式感：localStorage 记 kotonoha:bond-last-level，进面板发现等级提升 → 顶部「✨ 羁绊提升了！」徽章
import { useEffect, useRef, useState } from 'react'
import bridge from '../../bridge/bridge'
import { formatTime } from './shared'
import { t } from '../../i18n'

// 等级阈值与名称（与后端 bond.ts 的 4 档划分一致：0-24/25-59/60-89/90-100）
// 名称存中文原文（即 i18n key），渲染时经 t() 翻译
const LEVEL_NAMES = ['陌生', '熟悉', '信赖', '羁绊']
const LEVEL_THRESHOLDS = [25, 60, 90]
// localStorage 键：记录上次见到的好感度等级（升级徽章用）
const BOND_LAST_LEVEL_KEY = 'kotonoha:bond-last-level'

// 防御式取记忆条目的时间戳（兼容 created_at / createdAt / ts）
function memoryTime(m) {
  return m?.created_at || m?.createdAt || m?.ts || m?.timestamp || 0
}

export default function BondPanel({ active }) {
  // 羁绊状态 { points, interactions, level, levelName, todayGain }；null=接口未就绪
  const [bond, setBond] = useState(null)
  // 共同回忆列表；null=加载失败/未就绪，[]=空态
  const [memories, setMemories] = useState(null)
  const [loading, setLoading] = useState(false)
  // 升级徽章显示开关（显示 8s 后自动消失）
  const [showBadge, setShowBadge] = useState(false)
  const badgeTimer = useRef(null)

  // 面板激活时拉取羁绊状态 + 共同回忆
  useEffect(() => {
    if (!active) return
    let alive = true
    setLoading(true)

    // ---- 好感度（bond.get；后端未就绪时 res 为 null/ok:false，容错显示）----
    const p = bridge.getBond ? bridge.getBond() : Promise.resolve(null)
    p.then((res) => {
      if (!alive) return
      if (res?.ok && res.points != null) {
        const level = res.level ?? 0
        setBond({
          points: res.points ?? 0,
          interactions: res.interactions ?? 0,
          level,
          levelName: res.levelName || LEVEL_NAMES[level] || '陌生',
          todayGain: res.todayGain ?? 0,
        })
        // ---- 升级仪式感：对比 localStorage 记录的上次等级 ----
        try {
          const raw = localStorage.getItem(BOND_LAST_LEVEL_KEY)
          const last = raw === null ? null : Number(raw)
          // 有记录且当前等级更高 → 显示「羁绊提升了！」徽章；首次使用只写记录不提示
          if (last !== null && Number.isFinite(last) && level > last) setShowBadge(true)
          localStorage.setItem(BOND_LAST_LEVEL_KEY, String(level))
        } catch {
          /* localStorage 不可用时静默跳过（隐私模式等） */
        }
      } else {
        setBond(null)
      }
    }).catch(() => {
      if (alive) setBond(null)
    })

    // ---- 共同回忆（memory.list → created_at 升序：旧→新）----
    const pm = bridge.listMemories ? bridge.listMemories() : Promise.resolve(null)
    pm.then((res) => {
      if (!alive) return
      const list = res?.ok ? res.memories || [] : null
      setMemories(list ? [...list].sort((a, b) => memoryTime(a) - memoryTime(b)) : null)
    }).catch(() => {
      if (alive) setMemories(null)
    })

    return () => {
      alive = false
    }
  }, [active])

  // 徽章显示 8s 后自动消失
  useEffect(() => {
    if (!showBadge) return
    badgeTimer.current = setTimeout(() => setShowBadge(false), 8000)
    return () => clearTimeout(badgeTimer.current)
  }, [showBadge])

  if (!active) return null

  // 好感度进度（0~100，防御式 clamp）
  const points = Math.min(100, Math.max(0, Number(bond?.points) || 0))
  // 距下一等级提示：满级显示「羁绊已达最深」（模板串 {name}/{n} 占位，en/ja 语序由语言包控制）
  const nextHint = bond
    ? bond.level >= 3 || points >= 100
      ? t('羁绊已达最深')
      : t('距离『{name}』还差 {n} 点')
          .replace('{name}', t(LEVEL_NAMES[bond.level + 1] || '熟悉'))
          .replace('{n}', (LEVEL_THRESHOLDS[bond.level] ?? 25) - points)
    : null

  return (
    <section className="ep-pane">
      {/* 升级徽章（顶部横幅，8s 自动消失） */}
      {showBadge && bond && <div className="ep-bond-badge">{t('✨ 羁绊提升了！')}</div>}

      {/* ---- 好感度区 ---- */}
      <div className="ep-card">
        <h3 className="ep-card-title">{t('好感度')}</h3>
        {loading && !bond ? (
          <div className="ep-model-loading">{t('读取中…')}</div>
        ) : bond ? (
          <>
            {/* 等级大字（按等级换色：陌生=灰 / 熟悉=蓝 / 信赖=紫 / 羁绊=金粉渐变） */}
            <div className="ep-bond-level-wrap">
              <span className={`ep-bond-level ep-bond-lv${bond.level}`}>{t(bond.levelName)}</span>
            </div>
            {/* 进度条（points / 100） */}
            <div className="ep-bond-bar" role="progressbar" aria-valuenow={points} aria-valuemin={0} aria-valuemax={100}>
              <div className="ep-bond-bar-fill" style={{ width: `${points}%` }} />
            </div>
            <div className="ep-bond-bar-meta">
              <span className="ep-mono">{points} / 100</span>
              {nextHint && <span className="ep-bond-next">{nextHint}</span>}
            </div>
          </>
        ) : (
          <div className="ep-empty">{t('羁绊接口未就绪（等待后端合入）')}</div>
        )}
      </div>

      {/* ---- 互动数据 ---- */}
      <div className="ep-card">
        <h3 className="ep-card-title">{t('互动数据')}</h3>
        {bond ? (
          <div className="ep-bond-stats">
            <div className="ep-bond-stat">
              <span className="ep-bond-stat-num">{bond.interactions}</span>
              <span className="ep-bond-stat-label">{t('累计对话轮数')}</span>
            </div>
            <div className="ep-bond-stat">
              <span className="ep-bond-stat-num">+{bond.todayGain}</span>
              <span className="ep-bond-stat-label">{t('今日增长')}</span>
            </div>
          </div>
        ) : (
          <div className="ep-empty">—</div>
        )}
      </div>

      {/* ---- 共同回忆时间线 ---- */}
      <div className="ep-card">
        <h3 className="ep-card-title">{t('共同回忆')}</h3>
        {memories === null ? (
          <div className="ep-empty">{t('回忆接口未就绪（等待后端合入）')}</div>
        ) : memories.length ? (
          // 竖向时间线：左侧竖线+节点圆点，右侧日期 + 「entity · relation」 + detail（旧→新）
          <div className="ep-bond-timeline">
            {memories.map((m, i) => {
              const entity = m?.entity || m?.subject || t('言叶')
              const relation = m?.relation || ''
              const detail = m?.detail || m?.content || ''
              return (
                <div className="ep-bond-tl-item" key={m?.id || i}>
                  <span className="ep-bond-tl-dot" />
                  <div className="ep-bond-tl-body">
                    <div className="ep-bond-tl-head">
                      <span className="ep-bond-tl-date">{formatTime(memoryTime(m)) || '—'}</span>
                      <span className="ep-bond-tl-title">
                        {entity}
                        {relation ? ` · ${relation}` : ''}
                      </span>
                    </div>
                    {detail && <div className="ep-bond-tl-detail">{detail}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="ep-empty">{t('还没有共同回忆，多聊聊就会有的～')}</div>
        )}
      </div>
    </section>
  )
}
