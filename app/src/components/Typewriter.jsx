import { useEffect, useRef, useState } from 'react'

// 打字机组件：逐字显示 text，带闪烁光标
// 支持两种输入模式：
//   1. 整句新文本 —— 从头开始逐字
//   2. 流式增量文本（text 持续变长）—— 接着已显示部分继续，不重置
// props:
//   text       要显示的文本
//   speed      每字间隔毫秒，默认 40
//   onComplete 打完回调
//   skipKey    外部跳过信号（变化即显示全文）
//   onTypeSound 打字机音效回调（每个字符触发）
export default function Typewriter({ text = '', speed = 40, onComplete, skipKey = 0, onTypeSound }) {
  const [count, setCount] = useState(0)
  const doneRef = useRef(false)
  const prevTextRef = useRef('')

  // 文本变化：区分"新句子"与"流式增量"
  useEffect(() => {
    const prevText = prevTextRef.current
    const full = Array.from(text)

    if (prevText && text.startsWith(prevText) && text !== prevText) {
      // 流式增量：接着上次位置继续
      setCount(Array.from(prevText).length)
      doneRef.current = false
    } else if (text !== prevText) {
      if (Array.from(prevText).join('') !== full.join('')) {
        // 真正的新句子：从头开始（内容相同仅引用不同 → 保持进度，避免 done 后整页重打）
        setCount(0)
        doneRef.current = false
      }
    }
    prevTextRef.current = text
  }, [text])

  // 空文本：没有可打的字，立即完成（避免空占位消息卡死打字状态）
  useEffect(() => {
    if (Array.from(text).length === 0 && !doneRef.current) {
      doneRef.current = true
      onComplete && onComplete()
    }
  }, [text, onComplete])

  // 逐字推进
  useEffect(() => {
    const chars = Array.from(text)
    if (chars.length === 0) return
    let lastCount = count
    const timer = setInterval(() => {
      setCount((c) => {
        if (c + 1 >= chars.length) {
          clearInterval(timer)
          if (!doneRef.current) {
            doneRef.current = true
            onComplete && onComplete()
          }
          return chars.length
        }
        // 触发音效（每个新字符）
        if (onTypeSound && c + 1 > lastCount) {
          onTypeSound(chars[c + 1] || '')
        }
        lastCount = c + 1
        return c + 1
      })
    }, speed)
    return () => clearInterval(timer)
  }, [text, speed, onComplete, onTypeSound])

  // 跳过：直接显示全文
  useEffect(() => {
    if (skipKey === 0) return
    setCount(Array.from(text).length)
    if (!doneRef.current) {
      doneRef.current = true
      onComplete && onComplete()
    }
  }, [skipKey, text, onComplete])

  const full = Array.from(text)
  const shown = full.slice(0, count).join('')
  const typing = count < full.length

  return (
    <span className="typewriter">
      {shown}
      <span className={`typewriter-caret ${typing ? '' : 'blink'}`} />
    </span>
  )
}