// 角色立绘：支持 7 种情绪表情切换 + idle 呼吸动画
// props:
//   emotion  情绪状态（neutral/thinking/happy/sad/love/angry/surprise），默认 'neutral'
//   src      立绘图片路径（向后兼容，优先级低于 emotion 映射）
//   name     角色名（悬浮提示）
// 实现逻辑：
//   1. 加载 character.json 映射表（状态→文件名/CSS filter）
//   2. 尝试加载 emotion 对应的独立图片文件
//   3. 若文件不存在（404），降级到 base 图 + CSS filter/transform 近似
//   4. 切换时 CSS transition 淡入淡出（opacity 200ms）
//   5. 持续循环 idle 呼吸动画（CSS animation）

import { useState, useEffect, useRef } from 'react'

// 情绪映射表（内联兜底，避免异步加载失败时无样式）
const FALLBACK_MAP = {
  neutral: { cssFilter: 'none', cssTransform: 'none' },
  thinking: { cssFilter: 'saturate(0.7) brightness(0.92) hue-rotate(-10deg)', cssTransform: 'none' },
  happy: { cssFilter: 'saturate(1.15) brightness(1.05) hue-rotate(8deg)', cssTransform: 'scale(1.03)' },
  sad: { cssFilter: 'saturate(0.6) brightness(0.88) hue-rotate(-15deg)', cssTransform: 'translateY(4px)' },
  love: { cssFilter: 'saturate(1.2) brightness(1.08) hue-rotate(12deg)', cssTransform: 'none' },
  angry: { cssFilter: 'saturate(1.1) brightness(0.95) hue-rotate(-8deg) contrast(1.05)', cssTransform: 'none' },
  surprise: { cssFilter: 'saturate(1.1) brightness(1.08)', cssTransform: 'scale(1.06)' },
}

const BASE_IMAGE = 'assets/character.png'

export default function CharacterSprite({ emotion = 'neutral', src, name = '' }) {
  const [mapping, setMapping] = useState(null)  // character.json 内容
  const [imgReady, setImgReady] = useState(false) // 当前情绪图片是否加载成功
  const [displaySrc, setDisplaySrc] = useState(src || BASE_IMAGE)
  const prevEmotionRef = useRef(emotion)
  const imgRef = useRef(null)

  // 加载 character.json 映射表（仅一次）
  useEffect(() => {
    fetch('assets/character.json')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setMapping(data) })
      .catch(() => {})
  }, [])

  // 情绪切换时：尝试加载对应图片文件，失败则降级
  useEffect(() => {
    setImgReady(false)
    const state = mapping?.states?.[emotion]
    const base = mapping?.base || 'character.png'

    // 若有独立图片文件，预加载检测
    if (state?.image && state.image !== base) {
      const testImg = new Image()
      testImg.onload = () => {
        setDisplaySrc(`assets/${state.image}`)
        setImgReady(true)
      }
      testImg.onerror = () => {
        // 文件不存在 → 降级到 base 图 + CSS filter
        setDisplaySrc(`assets/${base}`)
        setImgReady(false)
      }
      testImg.src = `assets/${state.image}`
    } else {
      // neutral 或无映射 → 使用 base
      setDisplaySrc(src || `assets/${base}`)
      setImgReady(true)
    }

    prevEmotionRef.current = emotion
  }, [emotion, mapping, src])

  // 获取当前情绪的 CSS filter/transform
  const state = mapping?.states?.[emotion]
  const fallback = FALLBACK_MAP[emotion] || FALLBACK_MAP.neutral
  // 是否使用了独立图片（若图片存在则不叠加 filter）
  const useFilter = !imgReady || displaySrc === (src || BASE_IMAGE)

  const filterStyle = useFilter
    ? {
        filter: state?.cssFilter || fallback.cssFilter,
        transform: state?.cssTransform || fallback.cssTransform,
      }
    : {}

  // 情绪 CSS 类名
  const emotionClass = `character-${emotion}`

  return (
    <div className={`character-sprite ${emotionClass}`} title={name}>
      <img
        ref={imgRef}
        src={displaySrc}
        alt={name || '角色立绘'}
        draggable="false"
        style={filterStyle}
      />
    </div>
  )
}
