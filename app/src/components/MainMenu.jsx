// 主界面菜单：暗色电影玻璃风（继续 / 新游戏 / 载入 / 设置）
// props:
//   onNewGame    新游戏 → 选择界面（new 模式）
//   onLoad       载入 → 选择界面（load 模式）
//   onContinue   继续 → 直接回到最近故事+存档
//   canContinue  最近存档是否存在（false 时「继续」禁用）
//   lastStoryName / lastSaveName  最近故事与存档名（「继续」副文本）
//   onSettings   打开设置面板
import './MainMenu.css'
import { t } from '../i18n'

const iconProps = {
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

const IconContinue = () => (
  <svg {...iconProps}>
    <path d="M8 6.2v11.6c0 .8.9 1.3 1.6.9l9.4-5.8c.6-.4.6-1.4 0-1.8L9.6 5.3c-.7-.4-1.6.1-1.6.9z" />
  </svg>
)

const IconNewGame = () => (
  <svg {...iconProps}>
    <path d="M12 5.5v13M5.5 12h13" />
  </svg>
)

const IconLoad = () => (
  <svg {...iconProps}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3.2l2 2H17.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
  </svg>
)

const IconSettings = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="3.6" />
    <path d="M12 2.8v2.9M12 18.3v2.9M2.8 12h2.9M18.3 12h2.9M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" />
  </svg>
)

export default function MainMenu({
  onNewGame,
  onLoad,
  onContinue,
  canContinue = false,
  lastStoryName = '',
  lastSaveName = '',
  onSettings,
}) {
  return (
    <div className="main-menu">
      <span className="main-menu-blob main-menu-blob--gold" aria-hidden="true" />
      <span className="main-menu-blob main-menu-blob--violet" aria-hidden="true" />
      <span className="main-menu-blob main-menu-blob--gold2" aria-hidden="true" />
      <h1 className="main-menu-title">Kotonoha</h1>
      <p className="main-menu-subtitle">~ 言叶物语 ~</p>
      <nav className="main-menu-items">
        <button
          className="main-menu-item"
          onClick={onContinue}
          disabled={!canContinue}
        >
          <span className="main-menu-item-icon">
            <IconContinue />
          </span>
          <span className="main-menu-item-body">
            <span className="main-menu-item-label">{t('继续')}</span>
            {canContinue ? (
              <span className="main-menu-item-hint">
                {lastStoryName} · {lastSaveName}
              </span>
            ) : null}
          </span>
          <span className="main-menu-item-arrow" aria-hidden="true">›</span>
        </button>
        <button className="main-menu-item" onClick={onNewGame}>
          <span className="main-menu-item-icon">
            <IconNewGame />
          </span>
          <span className="main-menu-item-body">
            <span className="main-menu-item-label">{t('新游戏')}</span>
            <span className="main-menu-item-desc">{t('开始一段新的对话')}</span>
          </span>
          <span className="main-menu-item-arrow" aria-hidden="true">›</span>
        </button>
        <button className="main-menu-item" onClick={onLoad}>
          <span className="main-menu-item-icon">
            <IconLoad />
          </span>
          <span className="main-menu-item-body">
            <span className="main-menu-item-label">{t('载入')}</span>
            <span className="main-menu-item-desc">{t('选择已有的项目与对话')}</span>
          </span>
          <span className="main-menu-item-arrow" aria-hidden="true">›</span>
        </button>
        <button className="main-menu-item" onClick={onSettings}>
          <span className="main-menu-item-icon">
            <IconSettings />
          </span>
          <span className="main-menu-item-body">
            <span className="main-menu-item-label">{t('设置')}</span>
            <span className="main-menu-item-desc">{t('文本速度、场景与模型')}</span>
          </span>
          <span className="main-menu-item-arrow" aria-hidden="true">›</span>
        </button>
      </nav>
      <footer className="main-menu-version">v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}</footer>
    </div>
  )
}