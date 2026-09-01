// 顶部标题栏：返回按钮 + 游戏名 + 场景 / 存档信息 / 日志入口
// props:
//   scene    当前场景名
//   savedAt  最近存档时间戳（毫秒），无存档显示「无存档」
//   onBack   返回主界面回调（可选）
//   onLog    打开历史对话记录（可选）
import { t } from '../i18n'

export default function TopBar({ scene = '序章', savedAt = null, onBack = null, onLog = null }) {
  const timeStr = savedAt
    ? new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })
    : t('无存档')

  return (
    <header className="top-bar">
      {onBack && (
        <button className="top-back" onClick={onBack}>{t('‹ 主菜单')}</button>
      )}
      <span className="top-title">Kotonoha</span>
      <span className="top-divider">·</span>
      {/* 场景名是动态值：先翻译模板再替换（场景名本身也过一遍 t()，未收录则原样回落） */}
      <span className="top-scene">{t('场景：{s}').replace('{s}', t(scene))}</span>
      <span className="top-save">{t('存档：{s}').replace('{s}', timeStr)}</span>
      {onLog && (
        <button className="top-log" onClick={onLog} title={t('查看对话记录 (L)')}>{t('☰ 记录')}</button>
      )}
    </header>
  )
}
