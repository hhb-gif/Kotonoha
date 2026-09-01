// useKeyboard —— 对话页全局快捷键：Enter/空格推进、ESC 面板开关、L 历史记录
// 原 App.jsx 三个 keydown useEffect 迁入；page/isPlayerTurn 经 ref 读取避免频繁重挂监听。
import { useEffect, useRef, useState } from 'react'

export default function useKeyboard({ isPlayerTurn, handleDialogClick, settingsOpen, approval, page }) {
  const pageRef = useRef(page)
  useEffect(() => {
    pageRef.current = page
  }, [page])
  const isPlayerTurnRef = useRef(isPlayerTurn)
  useEffect(() => {
    isPlayerTurnRef.current = isPlayerTurn
  }, [isPlayerTurn])

  const [logOpen, setLogOpen] = useState(false)
  const [escOpen, setEscOpen] = useState(false)

  // ---- 全局 Enter / 空格：对话框停留时推进（玩家回合 / 设置面板 / ESC 面板打开时不拦截）----
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (isPlayerTurnRef.current || settingsOpen || escOpen || approval || pageRef.current !== 'dialog') return
      e.preventDefault()
      handleDialogClick()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleDialogClick, settingsOpen, escOpen, approval])

  // ---- ESC：对话页内打开/关闭角色面板（日志打开时优先关日志）----
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Escape') return
      if (pageRef.current !== 'dialog') return
      if (logOpen) {
        setLogOpen(false)
        return
      }
      setEscOpen((v) => !v)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [logOpen])

  // ---- 快捷键 L：对话页内打开历史记录 ----
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'l' && e.key !== 'L') return
      if (pageRef.current !== 'dialog') return
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
      setLogOpen((v) => !v)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return { logOpen, setLogOpen, escOpen, setEscOpen }
}
