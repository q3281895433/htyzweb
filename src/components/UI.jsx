import { LoaderCircle } from 'lucide-react'

export function FormField({ label, hint, error, children }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && !error ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error" role="alert">{error}</span> : null}
    </label>
  )
}

export function SubmitButton({ busy, children, className = '' }) {
  return (
    <button className={`button button--primary ${className}`} type="submit" disabled={busy}>
      {busy ? <><LoaderCircle aria-hidden="true" className="spin" size={18} /> 正在处理</> : children}
    </button>
  )
}

export function Notice({ tone = 'info', children }) {
  return <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  )
}

export function LoadingState({ label = '正在读取真实数据' }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" aria-hidden="true" />{label}</div>
}

export function StatusMark({ value }) {
  const labels = {
    pending: '待审核', approved: '已发布', rejected: '未通过', archived: '已归档',
    new: '新建议', reviewing: '处理中', closed: '已关闭', published: '已发布',
    active: '已启用', suspended: '已封禁', pending_activation: '待激活'
  }
  return <span className={`status status--${value}`}>{labels[value] || value}</span>
}

export function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}
