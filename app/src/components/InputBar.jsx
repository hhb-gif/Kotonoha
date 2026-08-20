// 底部控制区：主菜单 / 设置 按钮栏
// （新游戏/存档/读档已移入主界面与 ESC 面板，见 App.jsx 路由）
// props:
//   disabled  模型思考中时禁用
//   onMenu / onSettings
export default function InputBar({ disabled = false, onMenu, onSettings }) {
  return (
    <div className="input-bar">
      <button className="btn" onClick={onMenu} disabled={disabled}>主菜单</button>
      <button className="btn" onClick={onSettings}>设置</button>
    </div>
  )
}