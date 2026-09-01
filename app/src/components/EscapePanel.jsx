// ESC 角色面板（壳层）：左侧竖排分类页签 + 右侧内容区
// 内容区按页签分发到 panels/ 下的自包含组件（各面板自己管理加载与操作状态）：
//   SavePanel（存档）/ ModelPanel（模型）/ SkillsPanel（技能）/ SessionPanel（会话）
//   / GitPanel / McpPanel / CommandsPanel（命令）/ CredsPanel（凭据）/ BondPanel（羁绊）/ StatsPanel（统计）
// props（与原版一致）：
//   open           是否显示（全屏遮罩 modal）
//   onClose        关闭回调（点遮罩 / × / 关闭按钮触发）
//   context        当前故事上下文 { storyName, saveName, sessionId }（字段可能为 null）
//   modelInfo      模型信息 { current:{provider,model,reasoningEffort?}, groups, providers } | null（初始值）
//   skills         技能开关状态 { 'file-read':bool, ..., approval:bool }
//   skillCatalog   技能目录 [{ id, name, icon, desc, tools }]
//   onToggleSkill(id, on)  技能开关回调
//   messageCount   当前对话消息条数
//   onSave         保存到当前存档
//   onBackToMenu   返回主界面
//   busy           当前会话是否正在生成（驱动会话页「停止生成」按钮）
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookmarkIcon,
  ChipIcon,
  ShieldIcon,
  MessageIcon,
  GitBranchIcon,
  PlugIcon,
  TerminalIcon,
  KeyIcon,
  HeartIcon,
  ChartIcon,
} from './panels/shared'
import SavePanel from './panels/SavePanel'
import ModelPanel from './panels/ModelPanel'
import SkillsPanel from './panels/SkillsPanel'
import SessionPanel from './panels/SessionPanel'
import GitPanel from './panels/GitPanel'
import McpPanel from './panels/McpPanel'
import CommandsPanel from './panels/CommandsPanel'
import CredsPanel from './panels/CredsPanel'
import BondPanel from './panels/BondPanel'
import StatsPanel from './panels/StatsPanel'
import { t } from '../i18n'
import './EscapePanel.css'

// 页签 label 存中文原文（即 i18n key），渲染时经 t() 翻译（reload 切语言方案下安全）
const TABS = [
  { id: 'save', label: '存档', icon: <BookmarkIcon /> },
  { id: 'model', label: '模型', icon: <ChipIcon /> },
  { id: 'skills', label: '技能', icon: <ShieldIcon /> },
  { id: 'session', label: '会话', icon: <MessageIcon /> },
  { id: 'git', label: 'Git', icon: <GitBranchIcon /> },
  { id: 'mcp', label: 'MCP', icon: <PlugIcon /> },
  { id: 'commands', label: '命令', icon: <TerminalIcon /> },
  { id: 'creds', label: '凭据', icon: <KeyIcon /> },
  { id: 'bond', label: '羁绊', icon: <HeartIcon /> },
  { id: 'stats', label: '统计', icon: <ChartIcon /> },
]

export default function EscapePanel({
  open = false,
  onClose,
  context,
  modelInfo: modelInfoProp = null,
  skills = {},
  skillCatalog = [],
  onToggleSkill,
  messageCount = 0,
  onSave,
  onBackToMenu,
  busy = false, // 当前会话是否正在生成（对话页 status 传入，驱动「停止生成」按钮）
}) {
  const [tab, setTab] = useState('save')
  // 轻量提示条（绝对定位底部，2.5s 消失；会话/Git/技能页操作反馈共用）
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const showMsg = useCallback((msg) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }, [])

  useEffect(() => {
    if (!open) setToast(null)
  }, [open])

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  if (!open) return null

  return (
    <div className="ep-overlay" onClick={onClose}>
      <div
        className="ep-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('角色面板')}
      >
        <header className="ep-head">
          <h2 className="ep-title">{t('角色面板')}</h2>
          <button type="button" className="ep-close" onClick={onClose} aria-label={t('关闭（按钮）')}>
            ×
          </button>
        </header>

        <div className="ep-body">
          <nav className="ep-nav" aria-label={t('面板分类')}>
            {/* 注意：lambda 参数用 tb，避免遮蔽 state 变量 tab 与导入的 t() 翻译函数 */}
            {TABS.map((tb) => (
              <button
                key={tb.id}
                type="button"
                className={`ep-nav-btn${tab === tb.id ? ' active' : ''}`}
                onClick={() => setTab(tb.id)}
              >
                {tb.icon}
                <span>{t(tb.label)}</span>
              </button>
            ))}
          </nav>

          <div className="ep-content">
            <SavePanel active={tab === 'save'} context={context} messageCount={messageCount} />
            <ModelPanel active={tab === 'model'} modelInfo={modelInfoProp} />
            <SkillsPanel
              active={tab === 'skills'}
              context={context}
              skills={skills}
              skillCatalog={skillCatalog}
              onToggleSkill={onToggleSkill}
              showMsg={showMsg}
            />
            <SessionPanel active={tab === 'session'} context={context} busy={busy} showMsg={showMsg} />
            <GitPanel active={tab === 'git'} context={context} showMsg={showMsg} />
            <McpPanel active={tab === 'mcp'} />
            <CommandsPanel active={tab === 'commands'} />
            <CredsPanel active={tab === 'creds'} />
            <BondPanel active={tab === 'bond'} />
            <StatsPanel active={tab === 'stats'} context={context} messageCount={messageCount} />
          </div>
        </div>

        {toast && (
          <div className="ep-toast" role="status">
            {toast}
          </div>
        )}

        <footer className="ep-actions">
          <button type="button" className="ep-btn ep-btn-primary" onClick={onSave}>
            {t('保存当前进度')}
          </button>
          <button type="button" className="ep-btn ep-btn-secondary" onClick={onBackToMenu}>
            {t('返回主界面')}
          </button>
          <button type="button" className="ep-btn ep-btn-text" onClick={onClose}>
            {t('关闭（按钮）')}
          </button>
        </footer>
      </div>
    </div>
  )
}
