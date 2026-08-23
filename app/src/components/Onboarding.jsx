// 首次使用引导（onboarding）：视觉小说风格的分步遮罩
// props:
//   open          是否显示（由父组件按 localStorage 标记控制）
//   hidden        设置面板打开时临时隐藏（保留内部步骤进度，关闭后继续）
//   onFinish      完成/跳过（父组件负责写 kotonoha:onboarding-done 并关闭）
//   onGoSettings  引导「去设置」按钮（父组件负责打开设置面板）
import { useEffect, useState } from 'react'

const STEPS = [
  {
    title: '欢迎来到 Kotonoha',
    body: '这是一座以「言叶」为名的视觉小说式 AI 工作台。你将在书房与夜空之间，与 AI 助手「言叶」对话，共同完成项目、写作与头脑风暴。',
    hint: '点击对话框、按 Enter 或空格，即可推进剧情。',
  },
  {
    title: '第一步：配置模型',
    body: '进入「设置」，选择模型提供商并填入 API 密钥，言叶就有了与你对话的「心」。',
    hint: '每个模型有不同的性格与特长，试试看谁最合拍。',
    action: true, // 该步显示「去设置」按钮
  },
  {
    title: '如何开始对话',
    body: '在主菜单选择「新游戏」，挑选一个工作区（故事），输入你的想法，言叶就会回应你。',
    hint: '也可以从「载入」恢复之前的故事与对话。',
  },
  {
    title: '快捷键速查',
    body: '按 ESC 打开角色面板（会话、技能、模型）；按 L 打开历史日志；输入 /help 可查看全部命令。',
    hint: '随时保存进度，你的故事不会丢失。',
  },
]

export default function Onboarding({ open = false, hidden = false, onFinish, onGoSettings }) {
  const [step, setStep] = useState(0)

  // 再次打开时重置到第一步（正常情况下只会出现一次；hidden 不触发重置）
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  if (!open) return null

  const isLast = step === STEPS.length - 1
  const cur = STEPS[step]

  const handleNext = () => {
    if (isLast) onFinish()
    else setStep((s) => s + 1)
  }

  return (
    <div className={`onb-overlay${hidden ? ' onb-hidden' : ''}`}>
      <div className="onb-card">
        <div className="onb-art">
          <img src="assets/character.png" alt="言叶" />
        </div>
        <div className="onb-content" key={step}>
          <span className="onb-step">{step + 1} / {STEPS.length}</span>
          <h2 className="onb-title">{cur.title}</h2>
          <p className="onb-body">{cur.body}</p>
          {cur.hint ? <p className="onb-hint">{cur.hint}</p> : null}
        </div>
        <div className="onb-footer">
          <div className="onb-dots">
            {STEPS.map((_, i) => (
              <span key={i} className={`onb-dot${i === step ? ' active' : ''}`} />
            ))}
          </div>
          <div className="onb-actions">
            <button type="button" className="onb-btn onb-skip" onClick={onFinish}>
              跳过
            </button>
            {cur.action ? (
              <button type="button" className="onb-btn onb-primary" onClick={onGoSettings}>
                去设置
              </button>
            ) : (
              <button type="button" className="onb-btn onb-primary" onClick={handleNext}>
                {isLast ? '开始使用' : '下一步'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}