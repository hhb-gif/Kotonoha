// utils/slashCommands.js —— 对话输入的本地斜杠命令解析（不进 dsh；dsh 的 / 命令路由不暴露 HTTP）
// 原 App.jsx 内联 switch 迁移；handlers 由 App 注入（页面跳转/面板开关/存档回调）。

/**
 * 解析并执行一条 / 命令。
 * @param {string} input    已 trim 的输入（以 / 开头）
 * @param {object} handlers { goMain, openSettings, openSkills, openLog, showToast, save }
 *   save(name) - 存档回调（App 内接 bridge.saveNow + toast 反馈）
 */
export function applySlashCommand(input, handlers) {
  const [cmd, ...rest] = input.split(/\s+/)
  const arg = rest.join(' ').trim()
  switch (cmd.toLowerCase()) {
    case '/help':
      handlers.showToast('/help /new /save /load /model /skills /log /continue')
      break
    case '/new':
      handlers.goMain()
      handlers.showToast('已返回主界面，可开始新对话')
      break
    case '/save': {
      const name = arg || handlers.currentSaveName() || '对话'
      handlers.save(name)
      break
    }
    case '/load':
      handlers.goMain()
      handlers.showToast('已返回主界面，可载入其他对话')
      break
    case '/model':
      handlers.openSettings()
      handlers.showToast('设置面板已打开')
      break
    case '/skills':
      handlers.openSkills()
      handlers.showToast('ESC 面板已打开 → 技能')
      break
    case '/log':
      handlers.openLog()
      break
    case '/continue':
      handlers.showToast('已处于当前对话中')
      break
    default:
      handlers.showToast(`未知命令「${cmd}」，输入 /help 查看`)
  }
}
