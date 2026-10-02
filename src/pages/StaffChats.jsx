import { useState } from 'react'
import { api } from '../api.js'
import { EmptyState, LoadingState, Notice, formatDate } from '../components/UI.jsx'

export function StaffChats({ data, offset, onPage, onDone, onError }) {
  const [selected, setSelected] = useState(null)
  const [thread, setThread] = useState(null)
  const [busy, setBusy] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  async function open(item, messageOffset = 0) {
    setSelected(item); setThread(null)
    try { setThread(await api(`/api/htyzSlowSnow/chats/${encodeURIComponent(item.a)}/${encodeURIComponent(item.b)}?offset=${messageOffset}`)) }
    catch (error) { onError(error) }
  }
  async function moderate(message, action) {
    setBusy(message.id)
    try {
      await api(`/api/htyzSlowSnow/chats/messages/${encodeURIComponent(message.id)}${action === 'retain' ? '/retain' : ''}`, { method: action === 'retain' ? 'PATCH' : 'DELETE' })
      await open(selected, thread?.offset || 0)
      setConfirmId(null)
      onDone(action === 'retain' ? '已记录保留决定。' : '消息已删除，正文已从数据库清除。')
    } catch (error) { onError(error) } finally { setBusy('') }
  }
  return <section className="staff-chats"><p>仅超级管理员可查阅会话。保留与删除决定都会记入操作记录；删除会清除消息正文。</p><div className="staff-chats__layout"><div className="staff-chats__list"><h2>会话列表</h2>{data.items.length ? data.items.map((item) => <button type="button" key={`${item.a}:${item.b}`} className={selected?.a === item.a && selected?.b === item.b ? 'active' : ''} onClick={() => open(item)}><strong>{item.a.slice(0, 8)} ↔ {item.b.slice(0, 8)}</strong><span>{item.total} 条 · {formatDate(item.last_at)}</span></button>) : <EmptyState title="还没有会话">没有可查看的私聊。</EmptyState>}<div className="staff-pager"><button type="button" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - data.limit))}>上一页</button><span>第 {Math.floor(offset / data.limit) + 1} 页</span><button type="button" disabled={!data.hasMore} onClick={() => onPage(offset + data.limit)}>下一页</button></div></div><div className="staff-chats__thread">{!selected ? <EmptyState title="选择一段会话">这里会显示真实聊天内容。</EmptyState> : !thread ? <LoadingState /> : <><div className="staff-pager"><button type="button" disabled={!thread.hasMore} onClick={() => open(selected, thread.offset + thread.limit)}>更早消息</button><span>第 {Math.floor(thread.offset / thread.limit) + 1} 页</span><button type="button" disabled={thread.offset === 0} onClick={() => open(selected, Math.max(0, thread.offset - thread.limit))}>较新消息</button></div>{thread.items.length ? thread.items.map((item) => <article key={item.id}><div><strong>{item.sender_name || item.sender_email}</strong><span> → {item.recipient_name || item.recipient_email}</span><time>{formatDate(item.created_at)}</time></div><p className="preserve-lines">{item.body}</p><small>{item.read_at ? '已读' : '未读'}{item.reviewed_at ? ' · 已决定保留' : ''}</small><div className="moderation-actions"><button type="button" disabled={busy === item.id || Boolean(item.reviewed_at)} onClick={() => moderate(item, 'retain')}>保留</button>{confirmId === item.id ? <><span>确认删除这条私聊？</span><button type="button" disabled={busy === item.id} onClick={() => moderate(item, 'delete')}>确认删除</button><button type="button" onClick={() => setConfirmId(null)}>取消</button></> : <button type="button" disabled={busy === item.id} onClick={() => setConfirmId(item.id)}>删除</button>}</div></article>) : <EmptyState title="没有可见消息">这页没有可见消息。</EmptyState>}</>}</div></div></section>
}
