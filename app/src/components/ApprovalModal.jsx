// ApprovalModal —— 越界审批弹窗：用户选择「允许一次 / 始终允许 / 拒绝」
// 原 App.jsx 内联组件迁移；数据由 bridge 审批流（approval 事件）驱动。
import { t } from '../i18n'

export default function ApprovalModal({ approval, onChoose }) {
  if (!approval) return null
  return (
    <div className="appr-overlay">
      <div className="appr-panel" role="alertdialog" aria-label={t('审批请求')}>
        <h3 className="appr-title">{t('审批请求')}</h3>
        <p className="appr-line">
          <span className="appr-label">{t('工具')}</span>
          <span className="appr-value appr-mono">{approval.toolName || t('未知')}</span>
        </p>
        {approval.reason ? (
          <p className="appr-line">
            <span className="appr-label">{t('原因')}</span>
            <span className="appr-value">{approval.reason}</span>
          </p>
        ) : null}
        <div className="appr-actions">
          <button
            type="button"
            className="appr-btn appr-once"
            onClick={() => onChoose('allowed-once')}
          >
            {t('允许一次')}
          </button>
          <button
            type="button"
            className="appr-btn appr-always"
            onClick={() => onChoose('always')}
          >
            {t('始终允许')}
          </button>
          <button
            type="button"
            className="appr-btn appr-deny"
            onClick={() => onChoose('rejected')}
          >
            {t('拒绝')}
          </button>
        </div>
        <p className="appr-note">{t('「始终允许」会将该工具加入放行规则，后续不再询问。')}</p>
      </div>
    </div>
  )
}
