// Kotonoha App：页面路由（main 主界面 | select 选择界面 | dialog 对话界面）+ 核心状态接线
// 事件流处理在 hooks/useBridgeEvents，快捷键在 hooks/useKeyboard，
// 文本分页在 utils/dialogText，审批弹窗在 components/ApprovalModal。
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
import ApprovalModal from './components/ApprovalModal'
import useTypeSound from './hooks/useTypeSound'
import useBGM from './hooks/useBGM'
import useTTS from './hooks/useTTS'
import useBridgeEvents from './hooks/useBridgeEvents'
import useKeyboard from './hooks/useKeyboard'
import { splitIntoPages } from './utils/dialogText'
import { applySlashCommand } from './utils/slashCommands'

// 首次使用引导标记：localStorage 存在即不再显示
const ONBOARDING_KEY = 'kotonoha:onboarding-done'

// 选择肢：本次仅预留骨架，不激活
const DUMMY_CHOICES = []

const SCENE_LABELS = {
  'bg-room': '书房夜景',
  'bg-night': '夜空天台',
}

export default function App() {
  // ---- 页面路由：main（主界面）| select（选择界面）| dialog（对话界面）----
  const [page, setPage] = useState('main')
  const [selectMode, setSelectMode] = useState('new') // new：可新建故事/存档；load：只能载入已有
  const [modelInfo, setModelInfo] = useState(null)
  const [skillState, setSkillState] = useState(() => skills.getSkillState())

  // ---- 对话展示状态（事件驱动部分在 useBridgeEvents 内）----
  const [pageIndex, setPageIndex] = useState(0)     // 当前展示到该条的第几页
  const [pageDone, setPageDone] = useState(false)   // 当前页是否打完（等待 Enter 确认）
  const [skipCounter, setSkipCounter] = useState(0) // 点击跳过信号
  const [savedAt, setSavedAt] = useState(null)
  const [toast, setToast] = useState('')
  const [settings, setSettingsState] = useState(() => getSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 短暂提示（存档/读档/错误反馈）
  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }, [])

  // ---- 桥接层事件订阅 + 对话核心状态（setMessages/setStreamingText 仅在 hook 内部使用）----
  const {
    messages, shownIndex, setShownIndex, typing, setTyping,
    status, actionDetail, streamingText,
    emotion, setEmotion, approval, setApproval,
    messagesRef, shownIndexRef, typingRef, streamingTextRef, log,
  } = useBridgeEvents(showToast)

  // 打字机音效 hook（preload 未使用，不再解构）
  const typeSoundEnabled = settings?.typeSound !== false
  const { play: playTypeSound } = useTypeSound(typeSoundEnabled, 0.3)

  // 背景音乐 hook（BGM 播放/停止由 hook 内部 effect 管理，仅用 setScene 切场景）
  const bgmEnabled = settings?.bgm !== false
  const bgmVolume = (settings?.bgmVolume ?? 50) / 100
  const { setScene: setBGMScene } = useBGM(bgmEnabled, bgmVolume)

  // 语音朗读 hook（TTS）：回复完成后朗读全文，新回合/停止生成时取消
  const { speak: ttsSpeak, cancel: ttsCancel, voices: ttsVoices } = useTTS({
    enabled: settings?.ttsEnabled === true,
    rate: settings?.ttsRate ?? 1.0,
    volume: settings?.ttsVolume ?? 0.8,
    voiceURI: settings?.ttsVoiceURI || '',
  })

  // 场景切换时更新 BGM
  useEffect(() => {
    setBGMScene(settings.scene)
  }, [settings.scene, setBGMScene])

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

  // 开发调试：暴露实时状态快照（配合 useBridgeEvents 的 __appLog 时间线）
  useEffect(() => {
    window.__appDebug = {
      page,
      messages: messages.map((m) => ({ role: m.role, text: (m.text || '').slice(0, 60) })),
      shownIndex, pageIndex, pageDone, typing, status, actionDetail,
      streamingText: streamingText.slice(0, 60), skipCounter, savedAt,
    }
  })

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
  const pageIndexRef = useRef(pageIndex)
  useEffect(() => {
    pageIndexRef.current = pageIndex
  }, [pageIndex])
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

  // ---- 全局快捷键（Enter/空格推进、ESC 面板、L 历史记录；logOpen/escOpen 状态在 hook 内）----
  const { logOpen, setLogOpen, escOpen, setEscOpen } = useKeyboard({
    isPlayerTurn,
    handleDialogClick,
    settingsOpen,
    approval,
    page,
  })

  // ---- 状态→情绪映射（E1 合入前的降级方案）----
  // E1 后端会 emit emotion 事件，此处仅在无 emotion 事件时根据 status 推导
  // E1 合入后，bridge emotion 事件优先级高于此 fallback
  useEffect(() => {
    // 若已收到过 bridge emotion 事件，则不再由 status 覆盖
    // （通过一个 ref 标记：首次收到 emotion 事件后锁死，不再 fallback）
    // 此处简化处理：status 变化时总是推导 emotion，但 bridge.onEvent 的 emotion 分支优先
    if (status === 'thinking') {
      setEmotion('thinking')
    } else if (status === 'action') {
      setEmotion('happy')
    } else if (status === 'ready') {
      // ready 状态：如果当前是 thinking/action 刚结束，回到 neutral
      setEmotion((prev) => {
        if (prev === 'thinking' || prev === 'action') return 'neutral'
        return prev // 保持其他情绪（如 bridge 设置的 happy/sad 等）
      })
    }
  }, [status])

  // ---- TTS 联动：新回合开始取消朗读（防叠音）；回复完成后朗读全文 ----
  const emotionRef = useRef(emotion)
  useEffect(() => {
    emotionRef.current = emotion
  }, [emotion])
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    // 新 turn 开始（thinking/action）：取消上一段朗读
    if (status === 'thinking' || status === 'action') {
      ttsCancel()
      return
    }
    // 模型回复完成（thinking/action → ready，对应 bridge 的 model:done → turn/end）：
    // 朗读最后一条模型消息全文。用户消息/系统提示不朗读；出错时尾部是 user 消息，自然跳过。
    if (
      settings?.ttsEnabled === true &&
      (prev === 'thinking' || prev === 'action') &&
      status === 'ready'
    ) {
      const msgs = messagesRef.current
      const last = msgs[msgs.length - 1]
      if (last && last.role === 'model' && last.text) {
        ttsSpeak(last.text, emotionRef.current)
      }
    }
  }, [status, settings, ttsSpeak, ttsCancel, messagesRef])

  // 离开对话界面（回主菜单/选择界面）时停止朗读
  useEffect(() => {
    if (page !== 'dialog') ttsCancel()
  }, [page, ttsCancel])

  // ---- 初始化：连接 dsh + 迁移旧存档 ----
  useEffect(() => {
    bridge.init()
  }, [])

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

  // ---- 发送消息 + 斜杠命令（本地解析见 utils/slashCommands，不进 dsh）----
  const handleSend = useCallback((text) => {
    const t = (text || '').trim()
    if (!t) {
      bridge.sendMessage(t)
      return
    }
    if (t.startsWith('/')) {
      applySlashCommand(t, {
        goMain,
        openSettings: () => setSettingsOpen(true),
        openSkills: () => setEscOpen(true),
        openLog: () => setLogOpen(true),
        showToast,
        // /save [名称]：缺省沿用当前存档名
        currentSaveName: () => {
          const ctx = stories.getContext()
          return ctx?.saveId && ctx?.storyId ? stories.getSave(ctx.storyId, ctx.saveId)?.name : null
        },
        save: (name) => {
          bridge.saveNow(name).then((res) => {
            if (res.ok) {
              setSavedAt(Date.now())
              showToast(`已存档「${name}」`)
            } else {
              showToast(res.error || '存档失败')
            }
          })
        },
      })
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
    ttsCancel() // 停止生成同时停止朗读
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
  }, [showToast, ttsCancel])

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
        <Background
          src={`assets/${settings.scene}.png`}
          transition="fade"
          scene={settings.scene}
        />
        {settings.showCharacter !== false && (
          <CharacterSprite emotion={emotion} src="assets/character.png" name="言叶" />
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
          ttsVoices={ttsVoices}
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
        <Background
          src={`assets/${settings.scene}.png`}
          transition="fade"
          scene={settings.scene}
        />
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
      <Background
        src={`assets/${settings.scene}.png`}
        transition="fade"
        scene={settings.scene}
      />
      {settings.showCharacter !== false && (
        <CharacterSprite emotion={emotion} src="assets/character.png" name="言叶" />
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
            onTypeSound={playTypeSound}
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
        ttsVoices={ttsVoices}
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
