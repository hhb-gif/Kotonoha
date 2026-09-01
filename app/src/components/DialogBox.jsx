import Typewriter from './Typewriter'

// 底部对话框：半透明黑底 + 圆角 + 名字标签 + 打字机正文
// 交互（视觉小说式）：
//   打字中：点击 / Enter → 跳过本页（立即显示全文）
//   页打完后：停留等待 Enter → 下一页 / 下一条消息 / 进入玩家回合
// props:
//   speaker     发言角色名（模型=角色名，用户='你'）
//   text        当前显示文本（当前页）
//   speed       打字机速度（ms/字）
//   typing      是否正在打字（决定光标/跳过交互）
//   pageDone    当前页是否打完（等待 Enter 确认）
//   skipSignal  跳过信号（变化即显示全文）
//   onComplete  打字完成回调
//   onSkip      点击对话框（跳过打字 / 推进下一页）
//   onTypeSound 打字机音效回调（每个字符触发）
export default function DialogBox({
  speaker = '',
  text = '',
  speed = 40,
  typing = false,
  pageDone = false,
  skipSignal = 0,
  onComplete,
  onSkip,
  onTypeSound,
}) {
  return (
    <div className={`dialog-box ${typing ? 'is-typing' : ''}`} onClick={onSkip}>
      {speaker && <div className="dialog-name">{speaker}</div>}
      <div className="dialog-text">
        <Typewriter
          text={text}
          speed={speed}
          onComplete={onComplete}
          skipKey={skipSignal}
          onTypeSound={onTypeSound}
        />
      </div>
      {pageDone && !typing && (
        <div className="dialog-advance">▼ 按 Enter 继续</div>
      )}
    </div>
  )
}