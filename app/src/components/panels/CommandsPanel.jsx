// panels/CommandsPanel.jsx —— 命令页签：/ 命令速查（纯静态展示）
const COMMANDS = [
  { cmd: '/help', desc: '显示命令帮助' },
  { cmd: '/new', desc: '开始新对话' },
  { cmd: '/save [名称]', desc: '保存当前对话' },
  { cmd: '/load', desc: '返回主界面载入' },
  { cmd: '/model', desc: '打开模型设置' },
  { cmd: '/skills', desc: '打开技能面板' },
  { cmd: '/log', desc: '查看对话记录' },
  { cmd: '/continue', desc: '回到最近上下文' },
]

export default function CommandsPanel({ active }) {
  if (!active) return null

  return (
    <section className="ep-pane">
      <div className="ep-card">
        <h3 className="ep-card-title">/ 命令速查</h3>
        <div className="ep-commands">
          {COMMANDS.map((c) => (
            <div key={c.cmd} className="ep-command-row">
              <code className="ep-command-key">{c.cmd}</code>
              <span className="ep-command-desc">{c.desc}</span>
            </div>
          ))}
        </div>
        <div className="ep-note">在输入框输入以 / 开头的命令即可使用</div>
      </div>
    </section>
  )
}
