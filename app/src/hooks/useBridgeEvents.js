// useBridgeEvents —— bridge.onEvent 事件流的集中处理（原 App.jsx 内联大回调迁移）
// 负责 user / model / model:done / replay / status / emotion / error / degraded
//   / approval(+approval:done) 全部分支，以及事件回调所需的样板 ref。
// 返回：对话展示层所需的状态 + setter + 事件回调使用的 ref + 调试 log。
import { useEffect, useRef, useState } from 'react'
import bridge from '../bridge/bridge'

export default function useBridgeEvents(showToast) {
  // ---- 对话状态（事件驱动）----
  const [messages, setMessages] = useState([])
  const [shownIndex, setShownIndex] = useState(0)   // 当前展示到第几条
  const [typing, setTyping] = useState(false)       // 是否正在打字
  const [status, setStatus] = useState('ready')     // ready | thinking | action
  const [actionDetail, setActionDetail] = useState('') // 当前技能名（action 状态）
  const [streamingText, setStreamingText] = useState('') // 模型流式输出累积
  const [emotion, setEmotion] = useState('neutral')     // 立绘情绪（E2-sprite：7 种表情）
  // 越界审批弹窗（待用户选择：允许一次 / 始终允许 / 拒绝）
  const [approval, setApproval] = useState(null) // { rpcId, sessionId, approvalId, toolName, reason }

  // 事件回调里需要读取最新状态，用 ref 同步
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  const shownIndexRef = useRef(shownIndex)
  useEffect(() => {
    shownIndexRef.current = shownIndex
  }, [shownIndex])
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  }, [status])
  const typingRef = useRef(typing)
  useEffect(() => {
    typingRef.current = typing
  }, [typing])
  const streamingTextRef = useRef(streamingText)
  useEffect(() => {
    streamingTextRef.current = streamingText
  }, [streamingText])

  // 开发调试：事件时间线（window.__appLog，配合 App 的 __appDebug 快照使用）
  const log = (tag, extra) => {
    window.__appLog = window.__appLog || []
    window.__appLog.push({ t: Date.now(), tag, ...extra })
    if (window.__appLog.length > 200) window.__appLog.shift()
  }

  // ---- 桥接层事件订阅 ----
  useEffect(() => {
    const off = bridge.onEvent((ev) => {
      if (ev.type === 'user') {
        // 用户消息：整句入列并展示
        const next = [...messagesRef.current, { role: 'user', name: ev.name, text: ev.text }]
        log('user', { len: next.length, setIdx: next.length - 1 })
        setMessages(next)
        setShownIndex(next.length - 1)
        setTyping(true)
      } else if (ev.type === 'model') {
        // 模型流式增量：累积到 streamingText，由对话框实时渲染。
        // 若正处于「技能旁白」状态，切回正常流式展示
        if (statusRef.current === 'action') {
          setStatus('thinking')
          setActionDetail('')
        }
        setStreamingText((prev) => prev + ev.delta)
      } else if (ev.type === 'model:done') {
        // 模型回复完成：把尾部占位消息补全为完整文本。
        // Typewriter 识别「完整文本 startsWith 已显示部分」继续打完剩余，不重复。
        log('model:done', { textLen: (ev.text || '').length })
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          const text = ev.text || '……'
          if (last && last.role === 'model') next[next.length - 1] = { ...last, text }
          else next.push({ role: 'model', name: ev.name, text })
          return next
        })
        setStreamingText('')
        // 补全完成后从当前页继续（流式期间已按页显示，无全文闪现跳变）
        setTyping(false)
        bridge.updateSavePreview(ev.text || '')
      } else if (ev.type === 'replay') {
        // 历史重放（初始化/读档/新游戏）：整批替换
        const msgs = ev.messages || []
        log('replay', { count: msgs.length })
        setMessages(msgs)
        setShownIndex(Math.max(0, msgs.length - 1))
        setStreamingText('')
        setTyping(msgs.length > 0) // 空历史不需要打字，直接进入玩家回合
      } else if (ev.type === 'status') {
        log('status', { state: ev.state, detail: ev.detail || '' })
        if (ev.state === 'thinking' || ev.state === 'action') {
          // 模型开始回应：在尾部追加「空占位」消息（等待流式文本填充）
          const curLen = messagesRef.current.length
          const tailEmpty = (() => {
            const last = messagesRef.current[curLen - 1]
            return !!(last && last.role === 'model' && last.text === '')
          })()
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.role === 'model' && last.text === '') return prev
            return [...prev, { role: 'model', name: '言叶', text: '' }]
          })
          log('status:placeholder', { curLen, tailEmpty, typing: typingRef.current, streaming: streamingTextRef.current })
          // 上一句若已展示完（无打字中消息），直接切到占位位置
          if (!typingRef.current && !streamingTextRef.current) {
            // 占位已在尾部（本次或上次追加过）→ 目标索引 = curLen-1；否则追加后占位索引 = curLen
            setShownIndex(tailEmpty ? curLen - 1 : curLen)
            setTyping(true)
          }
        }
        setStatus(ev.state)
        setActionDetail(ev.detail || '')
        if (ev.state === 'thinking' || ev.state === 'action') setTyping(true)
      } else if (ev.type === 'emotion') {
        // E1 后端情绪协议：后端 emit { type:'emotion', state:'happy'|'thinking'|... }
        // E1 合入后无缝切换，此处直接设置 emotion
        if (ev.state) setEmotion(ev.state)
      } else if (ev.type === 'error') {
        // 出错：撤掉尾部空占位，回到可输入状态
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'model' && last.text === '') return prev.slice(0, -1)
          return prev
        })
        showToast(ev.message)
      } else if (ev.type === 'degraded') {
        // 主 provider 失败，后端已切 fallback 重试：toast 提示，对话保持进行
        showToast(`模型降级：${ev.from || '?'} → ${ev.to || '?'}`)
      } else if (ev.type === 'approval') {
        if (ev.pending) {
          // 待用户裁决：弹出审批 UI（允许一次 / 始终允许 / 拒绝）
          setApproval({
            rpcId: ev.rpcId,
            sessionId: ev.sessionId,
            approvalId: ev.approvalId,
            toolName: ev.toolName,
            reason: ev.reason,
          })
        } else {
          // 自动裁决（技能硬关拒绝）：toast 提示
          const label = ev.decision === 'deny' ? '已拒绝' : '已放行'
          showToast(`越界操作「${ev.toolName || '未知'}」${label}`)
        }
      } else if (ev.type === 'approval:done') {
        // 审批超时兜底已自动放行 → 关闭弹窗
        setApproval(null)
      }
    })
    return off
  }, [showToast])

  return {
    messages,
    setMessages,
    shownIndex,
    setShownIndex,
    typing,
    setTyping,
    status,
    actionDetail,
    streamingText,
    setStreamingText,
    emotion,
    setEmotion,
    approval,
    setApproval,
    messagesRef,
    shownIndexRef,
    typingRef,
    streamingTextRef,
    log,
  }
}
