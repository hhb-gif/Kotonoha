import { useRef, useCallback, useEffect, useState } from 'react'

// 背景音乐 hook：管理场景 BGM 的加载、播放、切换
// 返回 { play, stop, setScene }
// - play() - 播放当前场景的 BGM
// - stop() - 停止播放
// - setScene(scene) - 切换场景（自动切换 BGM）
//
// 参数：
//   enabled - 是否启用 BGM（默认 false，设置面板控制）
//   volume  - 音量 0-1（默认 0.5）
//
// 约定：
//   - BGM 文件放在 public/assets/bgm/ 目录下
//   - 文件名格式：bgm-{scene}.mp3（如 bgm-bg-room.mp3、bgm-bg-night.mp3）
//   - 文件不存在时静默不报错（保持打包体积小）
//   - 不引入新 npm 依赖（Audio API 原生）
export default function useBGM(enabled = false, volume = 0.5) {
  const audioRef = useRef(null)
  const audioContextRef = useRef(null)
  const gainNodeRef = useRef(null)
  const sourceNodeRef = useRef(null)
  const [currentScene, setCurrentScene] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const enabledRef = useRef(enabled)
  const volumeRef = useRef(volume)

  // 同步 ref
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  // 获取或创建 AudioContext（Web Audio API 用于音量控制）
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)()
      } catch (e) {
        console.warn('[useBGM] Web Audio API 不可用:', e)
        return null
      }
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
    return audioContextRef.current
  }, [])

  // 获取 BGM 文件路径
  const getBGMPath = useCallback((scene) => {
    if (!scene) return null
    return `assets/bgm/bgm-${scene}.mp3`
  }, [])

  // 加载并播放 BGM
  const loadAndPlay = useCallback((scene) => {
    if (!enabledRef.current || !scene) return

    const bgmPath = getBGMPath(scene)
    if (!bgmPath) return

    // 停止当前播放
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect()
      sourceNodeRef.current = null
    }

    setIsLoading(true)

    // 创建 Audio 元素加载 BGM
    const audio = new Audio()
    audio.crossOrigin = 'anonymous' // 允许跨域加载
    audio.loop = true // 循环播放

    // 尝试加载 BGM 文件
    audio.src = bgmPath
    
    // 加载失败时静默处理（文件可能不存在）
    audio.onerror = () => {
      console.warn(`[useBGM] BGM 加载失败（文件可能不存在）: ${bgmPath}`)
      setIsLoading(false)
      audioRef.current = null
    }

    audio.oncanplaythrough = () => {
      setIsLoading(false)
      audioRef.current = audio

      // 使用 Web Audio API 控制音量
      const ctx = getAudioContext()
      if (ctx) {
        try {
          const source = ctx.createMediaElementSource(audio)
          const gainNode = ctx.createGain()
          gainNode.gain.value = volumeRef.current

          source.connect(gainNode)
          gainNode.connect(ctx.destination)

          sourceNodeRef.current = source
          gainNodeRef.current = gainNode
        } catch (e) {
          // 可能已经创建过 source，忽略
          console.warn('[useBGM] Web Audio 节点创建失败:', e)
        }
      }

      // 播放
      audio.play().catch((e) => {
        console.warn('[useBGM] 自动播放被阻止:', e)
      })
    }

    // 加载失败或超时
    audio.onstalled = () => {
      setIsLoading(false)
    }
  }, [getAudioContext, getBGMPath])

  // 播放当前场景的 BGM
  const play = useCallback(() => {
    if (!enabledRef.current || !currentScene) return
    loadAndPlay(currentScene)
  }, [currentScene, loadAndPlay])

  // 停止播放
  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect()
      sourceNodeRef.current = null
    }
  }, [])

  // 切换场景（自动切换 BGM）
  const setScene = useCallback((scene) => {
    setCurrentScene(scene)
  }, [])

  // 音量变化时更新
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume
    }
  }, [volume])

  // 启用/禁用 BGM
  useEffect(() => {
    if (enabled && currentScene) {
      loadAndPlay(currentScene)
    } else {
      stop()
    }
  }, [enabled, currentScene, loadAndPlay, stop])

  // 场景切换时自动切换 BGM
  useEffect(() => {
    if (enabled && currentScene) {
      loadAndPlay(currentScene)
    }
  }, [currentScene, enabled, loadAndPlay])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect()
        sourceNodeRef.current = null
      }
    }
  }, [])

  return { play, stop, setScene }
}