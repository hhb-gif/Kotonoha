// 角色立绘：显示在画面一侧（右侧），淡入入场
// props:
//   src  立绘图片路径
//   name 角色名（用于悬浮提示，可扩展表情切换）
export default function CharacterSprite({ src = 'assets/character.png', name = '' }) {
  return (
    <div className="character-sprite" title={name}>
      <img src={src} alt={name || '角色立绘'} draggable="false" />
    </div>
  )
}