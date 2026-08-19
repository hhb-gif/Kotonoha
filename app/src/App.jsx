import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import bridge from './bridge/bridge'
import { getSettings, setSettings } from './bridge/settings'
import Background from './components/Background'
import CharacterSprite from './components/CharacterSprite'
import DialogBox from './components/DialogBox'
import PlayerInput from './components/PlayerInput'
import ChoiceList from './components/ChoiceList'
import TopBar from './components/TopBar'
import InputBar from './components/InputBar'
import SettingsPanel from './components/SettingsPanel'

// 选择肢：本次仅预留骨架，不激活
const DUMMY_CHOICES = []

const SCENE_LABELS = {
  'bg-room': '书房夜景',
  'bg-night': '夜空天台',
}

// 轻量清理 markdown 符号：保留文字、去掉 `**` ` 反引号 # 标题符号等，避免「大小粗细不一」的乱码观感
function cleanMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}

// 把长文本切成「页」：每页最多 maxLines 行；单行超过 maxChars 按标点切段
function splitIntoPages(text, maxLines = 2, maxChars = 80) {
  text = cleanMarkdown(text)
  if (!text) return []
  const pages = []
  let cur = ''
  let lines = 0
  const pushLine = (line) => {
    if (!line) return
    if (cur && lines >= maxLines) {
      pages.push(cur)
      cur = ''
      lines = 0
    }
    cur = cur ? cur + '\n' + line : line
    lines++
  }
  for (const line of text.split('\n')) {
    let rest = line.trim()
    while (rest.length > maxChars) {
      let cut = -1
      for (let i = Math.min(maxChars, rest.length); i > 0; i--) {
        if ('。！？；，、.!?;,'.includes(rest[i - 1])) {
          cut = i
          break
        }
      }
      if (cut < 0) cut = maxChars
      pushLine(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    if (rest) pushLine(rest)
  }
  if (cur) pages.push(cur)
  return pages.length ? pages : [text]
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [shownIndex, setShownIndex] = useState(0)   // 当前展示到第几条
  const [pageIndex, setPageIndex] = useState(0)     // 当前展示到该条的第几页
  const [pageDone, setPageDone] = useState(false)   // 当前页是否打完（等待 Enter 确认）
  const [typing, setTyping] = useState(false)       // 是否正在打字
  const [status, setStatus] = useState('ready')     // ready | thinking | action
  const [actionDetail, setActionDetail] = useState('') // 当前技能名（action 状态）
  const [skipCounter, setSkipCounter] = useState(0) // 点击跳过信号
  const [streamingText, setStreamingText] = useState('') // 模型流式输出累积
  const [savedAt, setSavedAt] = useState(null)
  const [toast, setToast] = useState('')
  const [settings, setSettingsState] = useState(() => getSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)

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
  const pageIndexRef = useRef(pageIndex)
  useEffect(() => {
    pageIndexRef.current = pageIndex
  }, [pageIndex])
  const pageDoneRef = useRef(pageDone)
  useEffect(() => {
    pageDoneRef.current = pageDone
  }, [pageDone])

  // 开发调试：暴露实时状态 + 关键状态转换日志
  window.__appLog = window.__appLog || []
  const log = (tag, extra) => {
    window.__appLog.push({ t: Date.now(), tag, ...extra })
    if (window.__appLog.length > 200) window.__appLog.shift()
  }
  useEffect(() => {
    window.__appDebug = {
      messages: messages.map((m) => ({ role: m.role, text: (m.text || '').slice(0, 60) })),
      shownIndex, pageIndex, pageDone, typing, status, actionDetail,
      streamingText: streamingText.slice(0, 60), skipCounter, savedAt,
    }
  })

  // 短暂提示（存档/读档/错误反馈）
  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }, [])

  const current = messages[shownIndex] || null
  // 当前消息的分页（消息切换时自动重新切分；流式期间用 streamingText 动态切分）
  const pages = useMemo(() => (current ? splitIntoPages(current.text) : []), [current])
  const pagesRef = useRef(pages)
  useEffect(() => {
    pagesRef.current = pages
  }, [pages])
  const streamingPages = useMemo(() => splitIntoPages(streamingText), [streamingText])
  // 当前展示的页列表：流式进行中优先用流式文本切分，否则用已补全消息的切分
  const curPages = streamingText ? streamingPages : pages
  const curPagesRef = useRef(curPages)
  useEffect(() => {
    curPagesRef.current = curPages
  }, [curPages])
  // 消息切换：重置到第一页
  useEffect(() => {
    setPageIndex(0)
    setPageDone(false)
  }, [shownIndex])
  // 全文补全后防止推进越界（流式期间推进过快）
  useEffect(() => {
    if (!streamingText && pages.length > 0) {
      setPageIndex((i) => Math.min(i, pages.length - 1))
    }
  }, [pages, streamingText])

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
      } else if (ev.type === 'replay') {
        // 历史重放（初始化/读档/新游戏）：整批替换
        const msgs = ev.messages || []
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
      } else if (ev.type === 'error') {
        // 出错：撤掉尾部空占位，回到可输入状态
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'model' && last.text === '') return prev.slice(0, -1)
          return prev
        })
        showToast(ev.message)
      }
    })
    return off
  }, [showToast])

  // ---- 初始化：连接 dsh + 恢复会话 ----
  useEffect(() => {
    bridge.init()
  }, [])

  // ---- 打字完成：玩家自己的话打完直接切到模型回复；模型的话分页停留等待 Enter ----
  // 注意：onComplete 可能在流式期间触发（占位空文本/流式页打完），
  // 此时绝不设 pageDone（否则 skipSignal 联动会把打字动画直接拉满成"一次性呈现"）
  const handleTypeComplete = useCallback(() => {
    log('type:complete', { shown: shownIndexRef.current, len: messagesRef.current.length })
    setTimeout(() => {
      setTyping(false)
      const curMsg = messagesRef.current[shownIndexRef.current]
      const isUserMsg = curMsg && curMsg.role === 'user'
      const isLastPage = pageIndexRef.current >= curPagesRef.current.length - 1
      if (isUserMsg && isLastPage && shownIndexRef.current < messagesRef.current.length - 1) {
        // 玩家的话最后一页打完 → 不等确认，直接切到下一条（模型回复）
        setShownIndex((i) => i + 1)
        setTyping(true)
      } else if (curPagesRef.current.length > 0 && !streamingTextRef.current) {
        // 模型的话打完当前页（且无流式残留）→ 停留等待 Enter
        setPageDone(true)
      }
      log('type:complete:after', { shown: shownIndexRef.current, len: messagesRef.current.length, pages: pagesRef.current.length, pageIndex: pageIndexRef.current, isUserMsg, isLastPage, streaming: streamingTextRef.current })
    }, 0)
  }, [])

  // ---- 点击对话框 / Enter：打字中=跳过并直接推进，打完=下一页，页尽=下一条，全部=玩家回合 ----
  const handleDialogClick = useCallback(() => {
    const curPagesLen = curPagesRef.current.length
    if (typing || streamingText) {
      // 打字中：跳过本页，并直接推进到下一页/下一条/玩家回合（按一次即可）
      setSkipCounter((c) => c + 1)
      if (pageIndex < curPagesLen - 1) {
        setPageIndex((i) => i + 1)
        setPageDone(false)
        setTyping(true)
      } else if (shownIndex < messages.length - 1) {
        setShownIndex((i) => i + 1)
        setTyping(true)
      } else {
        setPageDone(false)
      }
    } else if (pageIndex < curPagesLen - 1) {
      setPageIndex((i) => i + 1)
      setPageDone(false)
      setTyping(true)
    } else if (shownIndex < messages.length - 1) {
      setShownIndex((i) => i + 1)
      setTyping(true)
    } else {
      // 当前消息最后一页已确认 → 进入玩家回合
      setPageDone(false)
    }
  }, [typing, streamingText, pageIndex, shownIndex, messages.length])

  // ---- 全局 Enter / 空格：对话框停留时推进（玩家回合 / 设置面板打开时不拦截）----
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (isPlayerTurnRef.current || settingsOpen) return
      e.preventDefault()
      handleDialogClick()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleDialogClick, settingsOpen])

  // ---- 玩家回合：没有流式、尾部已展示完、当前页已确认、且该轮到玩家说话 ----
  const isPlayerTurn =
    status === 'ready' &&
    !streamingText &&
    !typing &&
    !pageDone &&
    pageIndex >= pages.length - 1 &&
    shownIndex >= messages.length - 1 &&
    (messages.length === 0 || messages[messages.length - 1].role === 'model')
  const isPlayerTurnRef = useRef(isPlayerTurn)
  useEffect(() => {
    isPlayerTurnRef.current = isPlayerTurn
  }, [isPlayerTurn])

  // ---- 存档 / 读档 / 新游戏 ----
  const handleSave = useCallback(() => {
    if (bridge.saveSession()) {
      setSavedAt(Date.now())
      showToast('已存档')
    } else {
      showToast('存档失败')
    }
  }, [showToast])

  const handleLoad = useCallback(async () => {
    if (await bridge.loadSession()) {
      setSavedAt(null)
      showToast('读档完成')
    } else {
      showToast('没有找到存档')
    }
  }, [showToast])

  const handleNewGame = useCallback(async () => {
    if (await bridge.newGame()) {
      setSavedAt(null)
      showToast('新的故事开始了')
    }
  }, [showToast])

  const handleSend = useCallback((text) => {
    bridge.sendMessage(text)
  }, [])

  // ---- 设置 ----
  const handleSettingsChange = useCallback((partial) => {
    setSettingsState(setSettings(partial))
  }, [])

  // 展示文本：执行技能时显示演出旁白；流式/正常时都按当前页显示（分页打字，无全文闪现）
  const displayText =
    status === 'action'
      ? `（言叶正在施展技能「${actionDetail}」……）`
      : status === 'thinking' && !streamingText && pages.length === 0
        ? '（言叶正在思考……）'
        : curPages[pageIndex] || (streamingText ? '…' : '')
  const displaySpeaker = status === 'action'
    ? '旁白'
    : streamingText
      ? '言叶'
      : current
        ? current.name
        : '言叶'

  return (
    <div className="stage">
      <Background src={`/assets/${settings.scene}.png`} />
      {settings.showCharacter !== false && (
        <CharacterSprite src="/assets/character.png" name="言叶" />
      )}
      <TopBar scene={SCENE_LABELS[settings.scene] || settings.scene} savedAt={savedAt} />

      <ChoiceList choices={DUMMY_CHOICES} onPick={() => {}} visible={false} />

      {isPlayerTurn ? (
        <PlayerInput onSend={handleSend} />
      ) : (
        current && (
          <DialogBox
            speaker={displaySpeaker}
            text={displayText}
            speed={settings.textSpeed}
            typing={typing}
            pageDone={pageDone}
            skipSignal={skipCounter}
            onComplete={handleTypeComplete}
            onSkip={handleDialogClick}
          />
        )
      )}

      <InputBar
        disabled={status !== 'ready'}
        onNewGame={handleNewGame}
        onSave={handleSave}
        onLoad={handleLoad}
        onSettings={() => setSettingsOpen(true)}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={handleSettingsChange}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}