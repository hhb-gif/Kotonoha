// 底部控制区：新游戏 / 存档 / 读档 / 设置 按钮栏
// （玩家输入已移入对话框位置，见 PlayerInput）
// props:
//   disabled  模型思考中时禁用
//   onNewGame / onSave / onLoad / onSettings
export default function InputBar({ disabled = false, onNewGame, onSave, onLoad, onSettings }) {
  return (
    <div className="input-bar">
      <button className="btn" onClick={onNewGame} disabled={disabled}>新游戏</button>
      <button className="btn" onClick={onSave} disabled={disabled}>存档</button>
      <button className="btn" onClick={onLoad} disabled={disabled}>读档</button>
      <button className="btn" onClick={onSettings}>设置</button>
    </div>
  )
}