import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import bridge from './bridge/bridge'
import { getSettings, setSettings, getModelInfo } from './bridge/settings'
import * as stories from './bridge/stories'
import * as skills from './bridge/skills'
import Background from './components/Background'
import CharacterSprite from './components/CharacterSprite'
import DialogBox from './components/DialogBox'
import PlayerInput from './components/PlayerInput'
import ChoiceList from './components/ChoiceList'
import TopBar from './components/TopBar'
import InputBar from './components/InputBar'
import SettingsPanel from './components/SettingsPanel'
import MainMenu from './components/MainMenu'
import SelectScreen from './components/SelectScreen'
import EscapePanel from './components/EscapePanel'
import LogViewer from './components/LogViewer'
import Onboarding from './components/Onboarding'

// 首次使用引导标记：localStorage 存在即不再显示
const ONBOARDING_KEY = 'kotonoha:onboarding-done'

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
// maxLines=4：用户反馈断句太碎，每次显示的话语要多一点
function splitIntoPages(text, maxLines = 4, maxChars = 100) {
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
  // ---- 页面路由：main（主界面）| select（选择界面）| dialog（对话界面）----
  const [page, setPage] = useState('main')
  const [selectMode, setSelectMode] = useState('new') // new：可新建故事/存档；load：只能载入已有
  const [escOpen, setEscOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [modelInfo, setModelInfo] = useState(null)
  const [skillState, setSkillState] = useState(() => skills.getSkillState())

  // ---- 对话状态 ----
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
  // 首次使用引导：localStorage 无标记时显示
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      return !localStorage.getItem(ONBOARDING_KEY)
    } catch {
      return true
    }
  })
  // 引导「去设置」后关闭设置 → 递增信号，让引导自动前进到下一步
  const [onbAdvance, setOnbAdvance] = useState(0)
  const onbWentSettingsRef = useRef(false)
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
  const pageIndexRef = useRef(pageIndex)
  useEffect(() => {
    pageIndexRef.current = pageIndex
  }, [pageIndex])
  const pageDoneRef = useRef(pageDone)
  useEffect(() => {
    pageDoneRef.current = pageDone
  }, [pageDone])
  const pageRef = useRef(page)
  useEffect(() => {
    pageRef.current = page
  }, [page])

  // 开发调试：暴露实时状态 + 关键状态转换日志
  window.__appLog = window.__appLog || []
  const log = (tag, extra) => {
    window.__appLog.push({ t: Date.now(), tag, ...extra })
    if (window.__appLog.length > 200) window.__appLog.shift()
  }
  useEffect(() => {
    window.__appDebug = {
      page,
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
        bridge.updateSavePreview(ev.text || '')
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

  // ---- 初始化：连接 dsh + 迁移旧存档 ----
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

  // ---- 玩家回合：没有流式、尾部已展示完、当前页已确认、且该轮到玩家说话 ----
  // status==='ready' 已保证无正在进行的 turn；最后一条是 user 或 model 都允许输入
  // （出错/无回复时最后是 user，也应能重试，否则界面会卡住）
  const isPlayerTurn =
    status === 'ready' &&
    !streamingText &&
    !typing &&
    !pageDone &&
    pageIndex >= pages.length - 1 &&
    shownIndex >= messages.length - 1 &&
    (messages.length === 0 || ['model', 'user'].includes(messages[messages.length - 1].role))
  const isPlayerTurnRef = useRef(isPlayerTurn)
  useEffect(() => {
    isPlayerTurnRef.current = isPlayerTurn
  }, [isPlayerTurn])

  // ---- 设置 ----
  const handleSettingsChange = useCallback((partial) => {
    setSettingsState(setSettings(partial))
  }, [])

  // ---- 首次使用引导：完成/跳过 → 写标记，不再显示 ----
  const finishOnboarding = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1')
    } catch (err) {
      console.error('[onboarding] write flag failed:', err)
    }
    setOnboardingOpen(false)
  }, [])

  // 引导「去设置」：打开设置面板（不完成引导；关闭设置后引导自动前进到下一步）
  const handleOnboardGoSettings = useCallback(() => {
    onbWentSettingsRef.current = true
    setSettingsOpen(true)
  }, [])

  // 设置面板关闭时：若引导曾去设置，自动前进引导到下一步（第 2 步配置完成）
  useEffect(() => {
    if (!settingsOpen && onbWentSettingsRef.current && onboardingOpen) {
      onbWentSettingsRef.current = false
      setOnbAdvance((t) => t + 1)
    }
  }, [settingsOpen, onboardingOpen])

  // ---- 页面导航 ----
  const goMain = useCallback(() => {
    setEscOpen(false)
    setPage('main')
  }, [])

  const goSelect = useCallback((mode) => {
    setSelectMode(mode)
    setPage('select')
  }, [])

  // ---- 发送消息 + 斜杠命令（本地解析，不进 dsh；dsh 的 / 命令路由不暴露 HTTP）----
  const handleSend = useCallback((text) => {
    const t = (text || '').trim()
    if (!t) {
      bridge.sendMessage(t)
      return
    }
    if (t.startsWith('/')) {
      const [cmd, ...rest] = t.split(/\s+/)
      const arg = rest.join(' ').trim()
      switch (cmd.toLowerCase()) {
        case '/help':
          showToast('/help /new /save /load /model /skills /log /continue')
          break
        case '/new':
          goMain()
          showToast('已返回主界面，可开始新对话')
          break
        case '/save': {
          const ctx = stories.getContext()
          const curName =
            ctx?.saveId && ctx?.storyId ? stories.getSave(ctx.storyId, ctx.saveId)?.name : null
          const name = arg || curName || '对话'
          bridge.saveNow(name).then((res) => {
            if (res.ok) {
              setSavedAt(Date.now())
              showToast(`已存档「${name}」`)
            } else {
              showToast(res.error || '存档失败')
            }
          })
          break
        }
        case '/load':
          goMain()
          showToast('已返回主界面，可载入其他对话')
          break
        case '/model':
          setSettingsOpen(true)
          showToast('设置面板已打开')
          break
        case '/skills':
          setEscOpen(true)
          showToast('ESC 面板已打开 → 技能')
          break
        case '/log':
          setLogOpen(true)
          break
        case '/continue':
          showToast('已处于当前对话中')
          break
        default:
          showToast(`未知命令「${cmd}」，输入 /help 查看`)
      }
      return
    }
    bridge.sendMessage(t)
  }, [showToast, goMain])

  // 「继续」：上下文存在且有效 → 直接回到最近故事+存档；否则回退到选择界面
  const goContinue = useCallback(async () => {
    let story = null
    let save = null
    const ctx = stories.getContext()
    if (ctx?.storyId) {
      story = stories.getStory(ctx.storyId)
      save = ctx.saveId ? stories.getSave(ctx.storyId, ctx.saveId) : null
    }
    if (!story) story = stories.lastStory()
    if (story && !save) save = stories.lastSave(story.id)
    if (!story) {
      setSelectMode('new')
      setPage('select')
      return
    }
    const res = await bridge.enterStory(story.id, save?.id || null)
    if (res.ok) {
      setPage('dialog')
    } else {
      showToast(res.error || '进入故事失败')
    }
  }, [showToast])

  // 选择界面：载入存档
  const handlePickSave = useCallback(async (storyId, saveId) => {
    const res = await bridge.enterStory(storyId, saveId)
    if (res.ok) {
      setPage('dialog')
    } else {
      showToast(res.error || '载入失败')
    }
  }, [showToast])

  // 选择界面：新建存档（新游戏）
  const handleNewSave = useCallback(async (storyId, saveName) => {
    const res = await bridge.newSave(storyId, saveName)
    if (res.ok) {
      setSavedAt(Date.now())
      setPage('dialog')
    } else {
      showToast(res.error || '新建失败')
    }
  }, [showToast])

  // ESC 面板：保存（覆盖当前存档）
  const handlePanelSave = useCallback(() => {
    const ctx = stories.getContext()
    const save = ctx?.saveId ? stories.getSave(ctx.storyId, ctx.saveId) : null
    bridge.saveNow(save?.name || '对话').then((res) => {
      if (res.ok) {
        setSavedAt(Date.now())
        showToast('已存档')
      } else {
        showToast(res.error || '存档失败')
      }
    })
  }, [showToast])

  // ESC 面板：技能开关
  const handleToggleSkill = useCallback((id, on) => {
    setSkillState(skills.setSkillState(id, on))
  }, [])

  // 审批弹窗：用户选择 outcome 并应答（allowed-once | always | rejected）
  const handleApprovalChoose = useCallback(
    async (outcome) => {
      if (!approval) return
      const res = await bridge.respondApproval({
        rpcId: approval.rpcId,
        sessionId: approval.sessionId,
        approvalId: approval.approvalId,
        outcome,
      })
      const label =
        outcome === 'always' ? '已始终允许' : outcome === 'rejected' ? '已拒绝' : '已放行'
      if (res?.ok) {
        showToast(`越界操作「${approval.toolName || '未知'}」${label}`)
      } else {
        showToast(`审批应答失败：${res?.error || '未知错误'}`)
      }
      setApproval(null)
    },
    [approval, showToast]
  )

  // 停止当前生成（status 为 thinking/action 时显示「■ 停止」按钮）
  const handleStop = useCallback(async () => {
    const sid = window.__bridgeDebug?.state?.sessionId
    if (!sid) {
      showToast('会话未就绪')
      return
    }
    if (!bridge.interruptSession) {
      showToast('停止接口未就绪（等待 bridge 合入）')
      return
    }
    try {
      const res = await bridge.interruptSession(sid)
      showToast(res?.ok ? '已发送停止指令' : res?.error || '停止失败')
    } catch (err) {
      showToast(`停止失败：${err.message}`)
    }
  }, [showToast])

  // ESC 面板打开时刷新模型信息
  useEffect(() => {
    if (!escOpen) return
    let alive = true
    getModelInfo().then((info) => {
      if (alive) setModelInfo(info)
    })
    return () => {
      alive = false
    }
  }, [escOpen])

  // ---- 展示文本：执行技能时显示演出旁白；流式/正常时都按当前页显示（分页打字，无全文闪现）----
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

  // ---- 主界面 / 选择界面 ----
  if (page === 'main') {
    const ctx = stories.getContext()
    const last = ctx?.storyId ? stories.getStory(ctx.storyId) : null
    return (
      <div className="stage">
        <Background src={`assets/${settings.scene}.png`} />
        {settings.showCharacter !== false && (
          <CharacterSprite src="assets/character.png" name="言叶" />
        )}
        <MainMenu
          onNewGame={() => goSelect('new')}
          onLoad={() => goSelect('load')}
          onContinue={goContinue}
          canContinue={!!(last && lastSaveInfo(last))}
          lastStoryName={last?.name || ''}
          lastSaveName={last ? lastSaveInfo(last) : ''}
          onSettings={() => setSettingsOpen(true)}
        />
        <SettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onChange={handleSettingsChange}
        />
        <Onboarding
          open={onboardingOpen}
          hidden={settingsOpen}
          advanceSignal={onbAdvance}
          onFinish={finishOnboarding}
          onGoSettings={handleOnboardGoSettings}
        />
        <ApprovalModal approval={approval} onChoose={handleApprovalChoose} />
        {toast && <div className="toast">{toast}</div>}
      </div>
    )
  }

  if (page === 'select') {
    return (
      <div className="stage">
        <Background src={`assets/${settings.scene}.png`} />
        <SelectScreen
          mode={selectMode}
          onPickSave={handlePickSave}
          onNewSave={handleNewSave}
          onBack={goMain}
        />
        <ApprovalModal approval={approval} onChoose={handleApprovalChoose} />
        {toast && <div className="toast">{toast}</div>}
      </div>
    )
  }

  // ---- 对话界面 ----
  return (
    <div className="stage">
      <Background src={`assets/${settings.scene}.png`} />
      {settings.showCharacter !== false && (
        <CharacterSprite src="assets/character.png" name="言叶" />
      )}
      <TopBar
        scene={SCENE_LABELS[settings.scene] || settings.scene}
        savedAt={savedAt}
        onBack={goMain}
      />

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
        onLog={() => setLogOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      {/* 思考/执行技能中：显示「■ 停止」小按钮，中断当前生成 */}
      {status !== 'ready' && (
        <button type="button" className="btn-stop" onClick={handleStop} aria-label="停止生成">
          ■ 停止
        </button>
      )}

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={handleSettingsChange}
      />

      <EscapePanel
        open={escOpen}
        onClose={() => setEscOpen(false)}
        context={{
          storyName: stories.getContext()?.storyId ? stories.getStory(stories.getContext().storyId)?.name : null,
          saveName: (() => {
            const ctx = stories.getContext()
            if (!ctx?.storyId || !ctx?.saveId) return null
            return stories.getSave(ctx.storyId, ctx.saveId)?.name || null
          })(),
          sessionId: window.__bridgeDebug?.state?.sessionId || null,
        }}
        modelInfo={modelInfo}
        skills={skillState}
        skillCatalog={skills.getSkillCatalog()}
        onToggleSkill={handleToggleSkill}
        messageCount={messages.length}
        onSave={handlePanelSave}
        onBackToMenu={goMain}
        busy={status !== 'ready'}
      />

      <LogViewer
        open={logOpen}
        onClose={() => setLogOpen(false)}
        messages={messages}
      />

      <ApprovalModal approval={approval} onChoose={handleApprovalChoose} />

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// 「继续」入口是否可用 + 最近存档名
function lastSaveInfo(story) {
  const save = stories.lastSave(story.id)
  return save ? save.name : null
}

// 越界审批弹窗：用户选择「允许一次 / 始终允许 / 拒绝」
function ApprovalModal({ approval, onChoose }) {
  if (!approval) return null
  return (
    <div className="appr-overlay">
      <div className="appr-panel" role="alertdialog" aria-label="审批请求">
        <h3 className="appr-title">审批请求</h3>
        <p className="appr-line">
          <span className="appr-label">工具</span>
          <span className="appr-value appr-mono">{approval.toolName || '未知'}</span>
        </p>
        {approval.reason ? (
          <p className="appr-line">
            <span className="appr-label">原因</span>
            <span className="appr-value">{approval.reason}</span>
          </p>
        ) : null}
        <div className="appr-actions">
          <button
            type="button"
            className="appr-btn appr-once"
            onClick={() => onChoose('allowed-once')}
          >
            允许一次
          </button>
          <button
            type="button"
            className="appr-btn appr-always"
            onClick={() => onChoose('always')}
          >
            始终允许
          </button>
          <button
            type="button"
            className="appr-btn appr-deny"
            onClick={() => onChoose('rejected')}
          >
            拒绝
          </button>
        </div>
        <p className="appr-note">「始终允许」会将该工具加入放行规则，后续不再询问。</p>
      </div>
    </div>
  )
}