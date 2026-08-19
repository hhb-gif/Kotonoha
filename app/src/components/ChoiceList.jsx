// 选择肢（视觉小说选项）组件骨架
// 本次不做真实分支，仅预留 UI 与交互签名：
// props:
//   choices [{ id, label }]
//   onPick(id)
//   visible 控制是否显示
export default function ChoiceList({ choices = [], onPick = () => {}, visible = false }) {
  if (!visible || choices.length === 0) return null
  return (
    <div className="choice-list">
      {choices.map((c) => (
        <button key={c.id} className="choice-item" onClick={() => onPick(c.id)}>
          {c.label}
        </button>
      ))}
    </div>
  )
}