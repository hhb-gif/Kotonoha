import { useRef, useCallback, useEffect, useState } from 'react'

// 语音朗读 hook（TTS）：基于 Web Speech API（window.speechSynthesis），零新依赖
// 返回 { speak, cancel, voices, speaking }
// - speak(text, emotion) - 朗读文本：按句切分逐句入队，情绪微调 pitch
// - cancel()             - 停止朗读并清空队列
// - voices               - 系统可用语音包列表（异步加载，监听 voiceschanged）
// - speaking             - 是否正在朗读
//
// 参数：
//   enabled  - 是否启用朗读（默认 false，设置面板控制）
//   rate     - 语速 0.5~2（默认 1.0）
//   volume   - 音量 0~1（默认 0.8）
//   voiceURI - 指定语音包 voiceURI（空串 = 系统默认音色）
//
// 降级：环境无 speechSynthesis 时全部静默空操作（speak/cancel 无副作用、voices 恒为 []）
const SUPPORTED = typeof window !== 'undefined' && 'speechSynthesis' in window

// 情绪 → pitch 映射（±0.15 级微调，避免语调生硬）
const EMOTION_PITCH = {
  happy: 1.15,
  sad: 0.85,
  angry: 1.2,
  love: 1.1,
  surprise: 1.2,
  thinking: 1.0,
  neutral: 1.0,
}

// 按句切分：在 。！？!?…\n 之后断句（保留标点）；单句 >100 字再按逗号/顿号切分（长句保护）
function splitSentences(text) {
  const out = []
  for (const raw of String(text || '').split(/(?<=[。！？!?…\n])/)) {
    const s = raw.trim()
    if (!s) continue
    if (s.length > 100) {
      for (const part of s.split(/(?<=[，,、；;])/)) {
        const p = part.trim()
        if (p) out.push(p)
      }
    } else {
      out.push(s)
    }
  }
  return out
}

export default function useTTS({ enabled = false, rate = 1.0, volume = 0.8, voiceURI = '' } = {}) {
  const [voices, setVoices] = useState(() =>
    SUPPORTED ? window.speechSynthesis.getVoices() || [] : []
  )
  const [speaking, setSpeaking] = useState(false)

  // 配置同步到 ref：朗读过程中始终读最新值，不受闭包过期影响
  const enabledRef = useRef(enabled)
  const rateRef = useRef(rate)
  const volumeRef = useRef(volume)
  const voiceURIRef = useRef(voiceURI)
  const voicesRef = useRef(voices)
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])
  useEffect(() => {
    rateRef.current = rate
  }, [rate])
  useEffect(() => {
    volumeRef.current = volume
  }, [volume])
  useEffect(() => {
    voiceURIRef.current = voiceURI
  }, [voiceURI])
  useEffect(() => {
    voicesRef.current = voices
  }, [voices])

  // 朗读队列 + 当前 utterance 引用（保持引用，防止 GC 提前回收导致 onend 丢失）
  const queueRef = useRef([]) // 待朗读 [{ text, emotion }]
  const currentRef = useRef(null) // 正在播的 SpeechSynthesisUtterance
  const startTimerRef = useRef(null)
  const processNextRef = useRef(null)

  // voices 异步加载：getVoices() 首次调用常返回空数组，voiceschanged 之后才有值
  useEffect(() => {
    if (!SUPPORTED) return
    const synth = window.speechSynthesis
    const update = () => setVoices(synth.getVoices() || [])
    update()
    synth.addEventListener?.('voiceschanged', update)
    // 部分环境不触发 voiceschanged：延迟兜底再刷一次
    const fallback = setTimeout(update, 500)
    return () => {
      synth.removeEventListener?.('voiceschanged', update)
      clearTimeout(fallback)
    }
  }, [])

  // 取出队首句子朗读；播完（onend/onerror）继续下一句
  const processNext = useCallback(() => {
    if (!SUPPORTED || !enabledRef.current) {
      setSpeaking(false)
      return
    }
    const next = queueRef.current.shift()
    if (!next) {
      currentRef.current = null
      setSpeaking(false)
      return
    }
    const u = new SpeechSynthesisUtterance(next.text)
    u.pitch = EMOTION_PITCH[next.emotion] ?? 1.0
    u.rate = rateRef.current
    u.volume = volumeRef.current
    // 音色：voiceURI 精确匹配；无匹配用系统默认（不设 voice）
    const voice = (voicesRef.current || []).find((v) => v.voiceURI === voiceURIRef.current)
    if (voice) {
      u.voice = voice
      u.lang = voice.lang
    }
    u.onend = () => {
      // 身份校验：仅当仍是当前 utterance（未被 cancel/新 speak 替换）才继续队列
      if (currentRef.current === u) processNextRef.current?.()
    }
    u.onerror = () => {
      if (currentRef.current === u) processNextRef.current?.()
    }
    currentRef.current = u
    try {
      window.speechSynthesis.speak(u)
    } catch (err) {
      console.warn('[useTTS] speak failed:', err)
      currentRef.current = null
      setSpeaking(false)
    }
  }, [])
  // onend 回调里通过 ref 取最新函数，避免 useCallback 循环依赖
  useEffect(() => {
    processNextRef.current = processNext
  }, [processNext])

  // 停止朗读：清队列 + 清当前引用 + speechSynthesis.cancel() 清底层队列
  const cancel = useCallback(() => {
    queueRef.current = []
    currentRef.current = null
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current)
      startTimerRef.current = null
    }
    setSpeaking(false)
    if (SUPPORTED) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* 忽略 */
      }
    }
  }, [])

  // 朗读一段文本（新朗读替换旧队列，防叠音）
  const speak = useCallback((text, emotion) => {
    if (!SUPPORTED || !enabledRef.current) return
    const items = splitSentences(text).map((s) => ({ text: s, emotion: emotion || 'neutral' }))
    if (items.length === 0) return
    // 替换旧队列：清队列 + 取消当前播放
    queueRef.current = items
    currentRef.current = null
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* 忽略 */
    }
    setSpeaking(true)
    // Chromium 在 cancel() 后立刻 speak() 可能吞掉首句：延迟一拍再启动
    if (startTimerRef.current) clearTimeout(startTimerRef.current)
    startTimerRef.current = setTimeout(() => processNextRef.current?.(), 60)
  }, [])

  // 关闭朗读时立即停止
  useEffect(() => {
    if (!enabled) cancel()
  }, [enabled, cancel])

  // 组件卸载：清定时器 + 停止朗读
  useEffect(() => {
    return () => {
      if (startTimerRef.current) clearTimeout(startTimerRef.current)
      if (SUPPORTED) {
        try {
          window.speechSynthesis.cancel()
        } catch {
          /* 忽略 */
        }
      }
    }
  }, [])

  return { speak, cancel, voices, speaking }
}
