// 顶部标题栏：返回按钮 + 游戏名 + 场景 / 存档信息 / 日志入口
// props:
//   scene    当前场景名
//   savedAt  最近存档时间戳（毫秒），无存档显示 '无存档'
//   onBack   返回主界面回调（可选）
//   onLog    打开历史对话记录（可选）
export default function TopBar({ scene = '序章', savedAt = null, onBack = null, onLog = null }) {
  const timeStr = savedAt
    ? new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })
    : '无存档'

  return (
    <header className="top-bar">
      {onBack && (
        <button className="top-back" onClick={onBack}>‹ 主菜单</button>
      )}
      <span className="top-title">Kotonoha</span>
      <span className="top-divider">·</span>
      <span className="top-scene">场景：{scene}</span>
      <span className="top-save">存档：{timeStr}</span>
      {onLog && (
        <button className="top-log" onClick={onLog} title="查看对话记录 (L)">☰ 记录</button>
      )}
    </header>
  )
}