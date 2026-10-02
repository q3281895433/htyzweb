import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../components/AuthContext.jsx'
import { MemberIdentity } from '../components/MemberIdentity.jsx'
import { EmptyState, LoadingState, Notice, SubmitButton, formatDate } from '../components/UI.jsx'
import { PageFrame } from './PublicPages.jsx'

export function UserDirectoryPage() {
  const [search, setSearch] = useState('')
  const [data, setData] = useState({ items: [], offset: 0, limit: 20 })
  const [state, setState] = useState({ loading: true, error: '' })
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      setState({ loading: true, error: '' })
      try {
        const result = await api(`/api/public/users?search=${encodeURIComponent(search)}&limit=20`)
        if (active) { setData(result); setState({ loading: false, error: '' }) }
      } catch (error) { if (active) setState({ loading: false, error: error.message }) }
    }, 200)
    return () => { active = false; window.clearTimeout(timer) }
  }, [search])
  async function more() {
    try {
      const result = await api(`/api/public/users?search=${encodeURIComponent(search)}&limit=20&offset=${data.items.length}`)
      setData((current) => ({ ...current, items: [...current.items, ...result.items] }))
    } catch (error) { setState({ loading: false, error: error.message }) }
  }
  return <PageFrame title="社区用户" intro="只展示公开用户名、头像和年级，不公开邮箱。选择一位同学即可查看主页或发起文字私聊。">
    <div className="directory-toolbar"><label htmlFor="directory-search">查找用户</label><input id="directory-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="输入用户名或年级" /><Link to="/chats">我的私聊</Link></div>
    {state.error ? <Notice tone="error">{state.error}</Notice> : null}
    {state.loading ? <LoadingState /> : data.items.length ? <><div className="directory-list">{data.items.map((person) => <article key={person.id}><MemberIdentity author={person} /></article>)}</div>{data.items.length >= data.limit && data.items.length % data.limit === 0 ? <button className="button" type="button" onClick={more}>查看更多用户</button> : null}</> : <EmptyState title="没有找到用户">试试其他用户名或年级。</EmptyState>}
  </PageFrame>
}

export function ChatsPage() {
  const { userId } = useParams()
  const { refreshChats } = useAuth()
  const [data, setData] = useState(null)
  const [body, setBody] = useState('')
  const [state, setState] = useState({ loading: true, busy: false, error: '' })
  const bottom = useRef(null)
  const endpoint = userId ? `/api/chats/${encodeURIComponent(userId)}` : '/api/chats'
  const load = useCallback(async () => {
    try {
      const result = await api(endpoint)
      setData(result)
      setState((current) => ({ ...current, loading: false, error: '' }))
      if (userId && result.items.some((item) => !item.mine && !item.readAt)) {
        await api(`/api/chats/${encodeURIComponent(userId)}/read`, { method: 'POST' })
        refreshChats()
      }
    } catch (error) { setState((current) => ({ ...current, loading: false, error: error.message })) }
  }, [endpoint, userId, refreshChats])
  useEffect(() => { setData(null); setState({ loading: true, busy: false, error: '' }); load(); const timer = window.setInterval(load, 8000); return () => window.clearInterval(timer) }, [load])
  useEffect(() => { if (userId && data?.items?.length) bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [data?.items?.length, userId])
  async function send(event) {
    event.preventDefault(); if (!body.trim()) return
    setState((current) => ({ ...current, busy: true, error: '' }))
    try { await api(`${endpoint}/messages`, { method: 'POST', body: { body } }); setBody(''); await load() }
    catch (error) { setState((current) => ({ ...current, error: error.message })) }
    finally { setState((current) => ({ ...current, busy: false })) }
  }
  return <PageFrame title={userId ? '私聊' : '我的私聊'} intro="仅支持文字消息。发送时间和已读状态会显示在会话中。">
    <div className="chat-shell"><aside className="chat-inbox"><Link to="/users">← 社区用户</Link><h2>会话</h2>{!userId && state.loading ? <LoadingState /> : null}<ChatInbox /></aside>
      <section className="chat-conversation">{state.error ? <Notice tone="error">{state.error}</Notice> : null}{!userId ? <EmptyState title="选择一段会话">也可以从用户栏发起新的私聊。</EmptyState> : state.loading ? <LoadingState /> : data ? <><header><MemberIdentity author={data.person} chat={false} /></header><div className="chat-messages" aria-live="polite">{data.items.length ? data.items.map((item) => <div key={item.id} className={`chat-bubble ${item.mine ? 'chat-bubble--mine' : ''}`}><p>{item.body}</p><small>{formatDate(item.sentAt)}{item.mine ? ` · ${item.readAt ? '已读' : '已发送'}` : ''}</small></div>) : <EmptyState title="还没有消息">写下第一条文字消息。</EmptyState>}<span ref={bottom} /></div><form className="chat-compose" onSubmit={send}><label htmlFor="chat-body">消息内容</label><textarea id="chat-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} placeholder="写一条消息…" required /><SubmitButton busy={state.busy}>发送</SubmitButton></form></> : null}</section>
    </div>
  </PageFrame>
}

function ChatInbox() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const load = () => api('/api/chats').then((result) => { if (active) setItems(result.items) }).catch((err) => { if (active) setError(err.message) })
    load(); const timer = window.setInterval(load, 15000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  if (error) return <Notice tone="error">{error}</Notice>
  return items.length ? <nav aria-label="私聊会话">{items.map((item) => <Link key={item.person.id} to={`/chats/${encodeURIComponent(item.person.id)}`}><strong>{item.person.username}</strong>{item.person.grade ? <span className="grade-tag">{item.person.grade}</span> : null}<small>{item.lastBody || '暂无可见消息'}</small>{item.unread ? <em>{item.unread} 条未读</em> : null}</Link>)}</nav> : <p>还没有会话。</p>
}
