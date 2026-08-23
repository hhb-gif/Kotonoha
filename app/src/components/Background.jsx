// 全屏背景层：背景图 + 暗色遮罩，保证对话框可读性
// props:
//   src  背景图路径（相对路径，file:// 打包后相对 index.html 解析，如 assets/bg-room.png）
export default function Background({ src = 'assets/bg-room.png' }) {
  return (
    <div className="background">
      <img key={src} src={src} alt="背景" className="background-image" />
      <div className="background-veil" />
    </div>
  )
}