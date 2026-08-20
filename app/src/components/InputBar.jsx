// 底部控制区：记录（历史对话）/ 设置 按钮栏
// （主菜单入口在顶栏左上角，避免重复；新游戏/存档/读档在主界面与 ESC 面板）
// props:
//   disabled  模型思考中时禁用
//   onLog / onSettings
export default function InputBar({ disabled = false, onLog, onSettings }) {
  return (
    <div className="input-bar">
      <button className="btn" onClick={onLog} disabled={disabled}>记录</button>
      <button className="btn" onClick={onSettings}>设置</button>
    </div>
  )
}