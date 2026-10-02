import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, Heart, MessageCircle } from 'lucide-react'
import { api } from '../api.js'
import { useAuth } from '../components/AuthContext.jsx'
import { LoadingState, Notice, formatDate } from '../components/UI.jsx'
import { PageFrame } from './PublicPages.jsx'

const typeNames = { moment: '空间动态', wall: '校园墙', contribution: '投稿', question: '问题', answer: '回答', news: '校园新闻' }

export function NotificationsPage() {
  const { user, refreshNotifications } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)

  async function load(offset = 0) {
    setLoading(true); setError('')
    try {
      const result = await api(`/api/notifications?offset=${offset}&limit=20`)
      setItems((current) => offset ? [...current, ...result.items] : result.items)
      setUnread(result.unread)
      setHasMore(offset + result.items.length < result.total)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (user) load() }, [user?.id])

  async function visit(item) {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (!item.readAt) {
        await api(`/api/notifications/${item.id}/read`, { method: 'POST' })
        await refreshNotifications()
      }
      navigate(item.path)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function markAllRead() {
    setBusy(true); setError('')
    try {
      await api('/api/notifications/read-all', { method: 'POST' })
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })))
      setUnread(0)
      await refreshNotifications()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return <PageFrame title="消息通知" intro="有人点赞或评论你的内容时，消息会留在这里；不会额外向你的邮箱发送提醒。">
    {!user ? <div className="notification-empty"><Bell size={28} aria-hidden="true" /><p>登录后查看与你有关的互动。</p><Link className="button button--primary" to="/login">前往登录</Link></div> : <section className="notification-center">
      <div className="notification-center__head"><strong>{unread ? `${unread} 条未读` : '所有消息已读'}</strong>{unread ? <button type="button" disabled={busy} onClick={markAllRead}>全部标为已读</button> : null}</div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {loading && !items.length ? <LoadingState label="正在读取消息" /> : null}
      {!loading && !items.length && !error ? <div className="notification-empty"><Bell size={28} aria-hidden="true" /><p>暂时没有消息。真实互动出现后会显示在这里。</p></div> : null}
      {items.length ? <ul className="notification-list">{items.map((item) => <li key={item.id} className={item.readAt ? 'notification-item' : 'notification-item notification-item--unread'}>
        <span className="notification-item__icon">{item.kind === 'like' ? <Heart size={18} aria-hidden="true" /> : <MessageCircle size={18} aria-hidden="true" />}</span>
        <button type="button" disabled={busy} onClick={() => visit(item)}><strong>{item.actor}</strong>{item.kind === 'like' ? '赞了你的' : item.isReply ? '回复了你在' : '评论了你的'}{typeNames[item.postType] || '内容'}{item.isReply ? '中的评论' : ''}<span>{formatDate(item.createdAt)} · {item.readAt ? '已读' : '未读'}</span></button>
      </li>)}</ul> : null}
      {hasMore ? <button className="button notification-more" type="button" disabled={loading} onClick={() => load(items.length)}>{loading ? '正在加载…' : '加载更多消息'}</button> : null}
    </section>}
  </PageFrame>
}
