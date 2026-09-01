import { useState, useEffect } from 'react'

// 全屏背景层：背景图 + 暗色遮罩，保证对话框可读性
// 支持场景切换过渡动画（fade-in）
// props:
//   src          背景图路径（如 assets/bg-room.png）
//   transition   过渡类型：'fade'|'slide'|'none'（默认 fade）
//   scene        当前场景 id（用于触发过渡）
export default function Background({
  src = 'assets/bg-room.png',
  transition = 'fade',
  scene = 'bg-room',
}) {
  const [prevSrc, setPrevSrc] = useState(src)
  const [currentSrc, setCurrentSrc] = useState(src)
  const [isTransitioning, setIsTransitioning] = useState(false)

  // 场景切换时触发过渡
  useEffect(() => {
    if (src !== currentSrc) {
      // 保留旧图，开始过渡
      setPrevSrc(currentSrc)
      setCurrentSrc(src)
      setIsTransitioning(true)
    }
  }, [src, currentSrc])

  // 过渡完成后移除旧图
  const handleTransitionEnd = () => {
    if (isTransitioning) {
      setIsTransitioning(false)
      setPrevSrc(null)
    }
  }

  // 过渡类型对应的 CSS 类名
  const getTransitionClass = () => {
    if (transition === 'none') return ''
    return `bg-transition-${transition}`
  }

  return (
    <div className="background">
      {/* 旧背景图（保留直到过渡完成） */}
      {isTransitioning && prevSrc && (
        <img
          key={`prev-${prevSrc}`}
          src={prevSrc}
          alt="背景"
          className="background-image background-image-prev"
        />
      )}
      {/* 新背景图（带过渡动画） */}
      <img
        key={currentSrc}
        src={currentSrc}
        alt="背景"
        className={`background-image ${getTransitionClass()}`}
        onAnimationEnd={handleTransitionEnd}
      />
      <div className="background-veil" />
    </div>
  )
}