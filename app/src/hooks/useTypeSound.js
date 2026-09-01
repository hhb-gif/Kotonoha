import { useRef, useCallback, useEffect } from 'react'

// 打字机音效 hook：轻量级，基于 Web Audio API 合成 click 音
// 返回 { play, preload }
// play(char) - 播放一个字符的打字音效（字符参数用于未来扩展不同音色）
// preload() - 预加载音效（可选，用于首次交互前预热 AudioContext）
//
// 参数：
//   enabled - 是否启用音效（默认 true）
//   volume  - 音量 0-1（默认 0.3）
export default function useTypeSound(enabled = true, volume = 0.3) {
  const audioContextRef = useRef(null)
  const bufferRef = useRef(null)
  const enabledRef = useRef(enabled)
  const volumeRef = useRef(volume)

  // 同步 ref
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  // 创建或获取 AudioContext（懒加载，避免自动播放策略问题）
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)()
      } catch (e) {
        console.warn('[useTypeSound] Web Audio API 不可用:', e)
        return null
      }
    }
    // 如果上下文被挂起，尝试恢复（用户交互后）
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
    return audioContextRef.current
  }, [])

  // 生成 click 音效的 AudioBuffer（一次性合成，复用）
  const generateClickBuffer = useCallback(() => {
    const ctx = getAudioContext()
    if (!ctx) return null

    // 如果已缓存，直接返回
    if (bufferRef.current) return bufferRef.current

    // 合成参数：短促 click 音
    const sampleRate = ctx.sampleRate
    const duration = 0.02 // 20ms
    const frequency = 1800 // 高频 1800Hz
    const bufferLength = Math.ceil(sampleRate * duration)

    // 创建单声道 buffer
    const buffer = ctx.createBuffer(1, bufferLength, sampleRate)
    const data = buffer.getChannelData(0)

    // 正弦波 + 指数衰减 envelope
    for (let i = 0; i < bufferLength; i++) {
      const t = i / sampleRate
      const envelope = Math.exp(-t * 200) // 快速衰减
      data[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.5
    }

    bufferRef.current = buffer
    return buffer
  }, [getAudioContext])

  // 播放 click 音效
  const play = useCallback((char) => {
    if (!enabledRef.current) return

    const ctx = getAudioContext()
    if (!ctx) return

    const buffer = generateClickBuffer()
    if (!buffer) return

    try {
      // 创建音源
      const source = ctx.createBufferSource()
      source.buffer = buffer

      // 音量控制
      const gainNode = ctx.createGain()
      gainNode.gain.value = volumeRef.current

      // 连接音频图：source → gain → destination
      source.connect(gainNode)
      gainNode.connect(ctx.destination)

      // 播放
      source.start(0)
    } catch (e) {
      // 静默失败，不影响主流程
      console.warn('[useTypeSound] 播放失败:', e)
    }
  }, [getAudioContext, generateClickBuffer])

  // 预加载：初始化 AudioContext 并生成 buffer（用于用户首次交互前预热）
  const preload = useCallback(() => {
    getAudioContext()
    generateClickBuffer()
  }, [getAudioContext, generateClickBuffer])

  return { play, preload }
}