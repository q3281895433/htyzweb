import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CornerDownRight, Heart, MessageCircle, Trash2, UserRound } from 'lucide-react'
import { api } from '../api.js'
import { useAuth } from './AuthContext.jsx'
import { Notice, SubmitButton, formatDate } from './UI.jsx'
import { MemberIdentity } from './MemberIdentity.jsx'

const postChannels = { moment: '/moments', wall: '/wall', contribution: '/community', question: '/qa', answer: '/qa' }

export function PostEngagement({ type, postId, onDeleted }) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const focusId = location.hash.startsWith('#comment-') ? location.hash.slice(9) : null
  const [stats, setStats] = useState(null)
  const [open, setOpen] = useState(false)
  const [thread, setThread] = useState({ items: [], total: 0, offset: 0, loading: false, error: '' })
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [replyBody, setReplyBody] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [forcedAnonymous, setForcedAnonymous] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  const [confirmPostDelete, setConfirmPostDelete] = useState(false)
  const base = `/api/posts/${type}/${postId}`

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/public/posts/${type}/${postId}/engagement`, { signal: controller.signal })
      .then((result) => { setStats(result); setAnonymous(result.defaultAnonymous); setForcedAnonymous(result.defaultAnonymous) }).catch((err) => { if (err.name !== 'AbortError') setError(err.message) })
    return () => controller.abort()
  }, [type, postId])

  const loadComments = useCallback(async (offset = 0, focus = null, append = false) => {
    setThread((current) => ({ ...current, loading: true, error: '' }))
    try {
      const result = await api(`/api/public/posts/${type}/${postId}/comments?offset=${offset}&limit=20${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`)
      setThread((current) => ({ items: append ? [...current.items, ...result.items] : result.items,
        total: result.total, offset: append ? current.offset : result.offset, loading: false, error: '' }))
    } catch (err) { setThread((current) => ({ ...current, loading: false, error: err.message })) }
  }, [type, postId])

  useEffect(() => { if (focusId) setOpen(true) }, [focusId])
  useEffect(() => { if (open) loadComments(0, focusId) }, [open, loadComments, focusId])
  useEffect(() => {
    if (!focusId || !open || thread.loading) return
    document.getElementById(`comment-${focusId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusId, open, thread.items, thread.loading])

  async function toggleLike() {
    if (!user || busy) return
    setBusy(true); setError('')
    try { const result = await api(`${base}/like`, { method: stats?.liked ? 'DELETE' : 'PUT' }); setStats((current) => ({ ...current, ...result })) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function submit(event, parentCommentId = null) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await api(`${base}/comments`, { method: 'POST', body: { body: parentCommentId ? replyBody : body, anonymous: type === 'wall' && anonymous, parentCommentId } })
      setStats((current) => ({ ...current, likes: result.likes, comments: result.comments, liked: result.liked }))
      if (parentCommentId) { setReplyBody(''); setReplyTo(null) } else setBody('')
      await loadComments(0, result.id)
      requestAnimationFrame(() => document.getElementById(`comment-${result.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function remove(commentId) {
    setBusy(true); setError('')
    try {
      await api(`/api/comments/${commentId}`, { method: 'DELETE' })
      setConfirmId(null)
      setStats((current) => current ? { ...current, comments: Math.max(0, current.comments - 1) } : current)
      await loadComments()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function deletePost() {
    setBusy(true); setError('')
    try {
      await api(base, { method: 'DELETE' })
      setConfirmPostDelete(false)
      if (onDeleted) onDeleted()
      else navigate(postChannels[type] || '/', { replace: true })
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return <section className="post-engagement" aria-label="点赞与评论">
    <div className="post-engagement__actions">
      <button type="button" className={stats?.liked ? 'post-action post-action--liked' : 'post-action'}
        aria-pressed={Boolean(stats?.liked)} disabled={busy || !stats || !user} onClick={toggleLike}>
        <Heart size={17} fill={stats?.liked ? 'currentColor' : 'none'} aria-hidden="true" />{stats?.liked ? '已赞' : '点赞'}{stats ? ` ${stats.likes}` : ''}
      </button>
      <button type="button" className="post-action" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <MessageCircle size={17} aria-hidden="true" />评论{stats ? ` ${stats.comments}` : ''}
      </button>
      {stats?.canDelete ? <button type="button" className="post-action post-action--delete" aria-expanded={confirmPostDelete} disabled={busy} onClick={() => setConfirmPostDelete(true)}><Trash2 size={16} aria-hidden="true" />删除帖子</button> : null}
      {!user ? <Link className="post-engagement__login" to="/login">登录后参与</Link> : null}
    </div>
    {confirmPostDelete ? <div className="post-delete-confirm" role="group" aria-label="确认删除帖子"><span>删除后帖子及评论将不再公开，确定删除？</span><button type="button" disabled={busy} onClick={deletePost}>{busy ? '正在删除…' : '确认删除'}</button><button type="button" disabled={busy} onClick={() => setConfirmPostDelete(false)}>取消</button></div> : null}
    {error ? <Notice tone="error">{error}</Notice> : null}
    {open ? <div className="comment-thread">
      {thread.error ? <Notice tone="error">{thread.error}</Notice> : null}
      {thread.loading && !thread.items.length ? <p className="comment-thread__empty">正在读取评论…</p> : null}
      {!thread.loading && !thread.items.length && !thread.error ? <p className="comment-thread__empty">还没有评论，欢迎留下第一条真实回应。</p> : null}
      {thread.offset > 0 ? <button className="post-action" type="button" disabled={thread.loading} onClick={() => loadComments()}>查看更早评论</button> : null}
      {thread.items.length ? <ol className="comment-thread__list" start={thread.offset + 1}>{thread.items.map((item) => <li id={`comment-${item.id}`} key={item.id} className={`comment-item${item.replyTo ? ' comment-item--reply' : ''}`}>
        <div className="comment-item__content"><div className="comment-item__meta"><MemberIdentity author={item.author} anonymous={item.anonymous} /><time>{formatDate(item.publishedAt)}</time></div>
          {item.replyTo ? <span className="comment-item__reply-target"><CornerDownRight size={13} aria-hidden="true" />回复 {item.replyTo.name}</span> : null}
          <p className="preserve-lines">{item.body}</p>
          <button type="button" className="comment-item__reply-button" onClick={() => { setReplyTo(replyTo === item.id ? null : item.id); setReplyBody('') }}>{type === 'question' || type === 'answer' ? '答' : '回复'}</button>
          {replyTo === item.id ? <form className="comment-reply-form" onSubmit={(event) => submit(event, item.id)}><label htmlFor={`reply-${item.id}`}>回复 {item.anonymous ? '匿名同学' : item.author?.username}</label><textarea id={`reply-${item.id}`} autoFocus value={replyBody} onChange={(event) => setReplyBody(event.target.value)} minLength={2} maxLength={1000} placeholder="写下你的回复…" required />{type === 'wall' ? <label className="check-row"><input type="checkbox" checked={anonymous} disabled={forcedAnonymous} onChange={(event) => setAnonymous(event.target.checked)} /><span>匿名回复{forcedAnonymous ? '（匿名发帖者默认匿名）' : ''}</span></label> : null}<div><button type="button" onClick={() => setReplyTo(null)}>取消</button><SubmitButton busy={busy}>发布回复</SubmitButton></div></form> : null}
          {item.mine ? <div className="comment-item__delete">{confirmId === item.id ? <><span>确定删除这条评论？</span><button type="button" disabled={busy} onClick={() => remove(item.id)}>确定</button><button type="button" onClick={() => setConfirmId(null)}>取消</button></> : <button type="button" disabled={busy} onClick={() => setConfirmId(item.id)}><Trash2 size={14} aria-hidden="true" />删除</button>}</div> : null}
        </div>
      </li>)}</ol> : null}
      {thread.offset + thread.items.length < thread.total ? <button className="post-action" type="button" disabled={thread.loading} onClick={() => loadComments(thread.offset + thread.items.length, null, true)}>{thread.loading ? '正在加载…' : '查看更多评论'}</button> : null}
      {user ? <form className="comment-form" onSubmit={submit}>
        <label htmlFor={`comment-${postId}`}>写评论</label>
        <textarea id={`comment-${postId}`} value={body} onChange={(event) => setBody(event.target.value)} minLength={2} maxLength={1000} placeholder="写下友善、具体的回应…" required />
        {type === 'wall' ? <label className="check-row"><input type="checkbox" checked={anonymous} disabled={forcedAnonymous} onChange={(event) => setAnonymous(event.target.checked)} /><span>匿名评论{forcedAnonymous ? '（匿名发帖者默认匿名）' : ''}</span></label> : null}
        <SubmitButton busy={busy}>发布评论</SubmitButton>
      </form> : <p className="comment-thread__empty"><Link to="/login">登录</Link>后可以评论。</p>}
    </div> : null}
  </section>
}
