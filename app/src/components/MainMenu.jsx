// 主界面菜单：竖排居中菜单（继续 / 新游戏 / 载入 / 设置）
// props:
//   onNewGame    新游戏 → 选择界面（new 模式）
//   onLoad       载入 → 选择界面（load 模式）
//   onContinue   继续 → 直接回到最近故事+存档
//   canContinue  最近存档是否存在（false 时「继续」禁用）
//   lastStoryName / lastSaveName  最近故事与存档名（「继续」副文本）
//   onSettings   打开设置面板
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
      <h1 className="main-menu-title">Kotonoha</h1>
      <p className="main-menu-subtitle">~ 言叶物语 ~</p>
      <nav className="main-menu-items">
        <button
          className="main-menu-item"
          onClick={onContinue}
          disabled={!canContinue}
        >
          <span className="main-menu-item-label">继续</span>
          {canContinue && (
            <span className="main-menu-item-hint">
              {lastStoryName} · {lastSaveName}
            </span>
          )}
        </button>
        <button className="main-menu-item" onClick={onNewGame}>
          <span className="main-menu-item-label">新游戏</span>
        </button>
        <button className="main-menu-item" onClick={onLoad}>
          <span className="main-menu-item-label">载入</span>
        </button>
        <button className="main-menu-item" onClick={onSettings}>
          <span className="main-menu-item-label">设置</span>
        </button>
      </nav>
    </div>
  )
}