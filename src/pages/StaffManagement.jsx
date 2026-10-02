import { useState } from 'react'
import { KeyRound, Trash2, UserRoundX } from 'lucide-react'
import { api } from '../api.js'
import { EmptyState, StatusMark, formatDate } from '../components/UI.jsx'

const postTypes = [
  ['moment', '空间动态'], ['wall', '校园墙'], ['contribution', '投稿'],
  ['question', '问题'], ['answer', '回答'], ['comment', '评论']
]

export function PostsAdmin({ data, postType, onType, offset, onPage, onDone, onError }) {
  const [confirmId, setConfirmId] = useState(null)

  async function remove(item) {
    try {
      await api(`/api/htyzSlowSnow/posts/${postType}/${item.id}`, { method: 'DELETE' })
      setConfirmId(null)
      onDone('帖子已删除，前台不再显示。')
    } catch (error) { onError(error) }
  }

  return <section className="staff-list-section">
    <label className="staff-filter">查看栏目
      <select value={postType} onChange={(event) => { onType(event.target.value); setConfirmId(null) }}>
        {postTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {data.items.length ? <div className="moderation-groups">
      {data.items.map((item) => <article className="moderation-item" key={item.id}>
        <div className="moderation-item__meta"><StatusMark value={item.status} /><time>{formatDate(item.created_at)}</time></div>
        <small className="review-identity">{item.username || item.email} · {item.email}</small>
        {item.post_type ? <small>评论于{postTypes.find(([key]) => key === item.post_type)?.[1] || '内容'} · {item.post_id}</small> : null}
        {item.title ? <h3>{item.title}</h3> : null}
        <p className="preserve-lines">{item.body}</p>
        {item.status !== 'archived' ? <div className="moderation-actions">
          {confirmId === item.id ? <><span>确定删除这条内容？</span><button className="button button--reject" type="button" onClick={() => remove(item)}>确定删除</button><button className="button" type="button" onClick={() => setConfirmId(null)}>取消</button></> : <button className="button button--reject" type="button" onClick={() => setConfirmId(item.id)}><Trash2 size={16} />删除帖子</button>}
        </div> : null}
      </article>)}
    </div> : <EmptyState title="此栏目还没有帖子">用户发布的内容会显示在这里。</EmptyState>}
    <StaffPager count={data.items.length} offset={offset} limit={data.limit} onPage={onPage} />
  </section>
}

export function UsersAdmin({ data, offset, onPage, onDone, onError, superAdmin = false }) {
  const [confirmId, setConfirmId] = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [generated, setGenerated] = useState(null)

  async function update(item, status) {
    try {
      await api(`/api/htyzSlowSnow/users/${item.id}/status`, { method: 'PATCH', body: { status } })
      setConfirmId(null)
      onDone(status === 'suspended' ? '账号已封禁，现有登录状态已失效。' : '账号已恢复。')
    } catch (error) { onError(error) }
  }

  async function resetPassword(item) {
    try { const result = await api(`/api/htyzSlowSnow/users/${item.id}/reset-password`, { method: 'POST' }); setGenerated({ email: item.email, password: result.initialPassword }) }
    catch (error) { onError(error) }
  }

  async function deleteAccount(item) {
    try { await api(`/api/htyzSlowSnow/users/${item.id}`, { method: 'DELETE', body: { confirmEmail } }); setDeleteId(null); setConfirmEmail(''); onDone('用户账号已删除并去标识归档。') }
    catch (error) { onError(error) }
  }

  return <section className="staff-list-section">
    {generated ? <div className="staff-password-result" role="status"><strong>{generated.email} 的新初始密码</strong><p>仅显示一次，请通过安全渠道交给本人。</p><code>{generated.password}</code><button type="button" onClick={() => setGenerated(null)}>我已保存，关闭</button></div> : null}
    {data.items.length ? <div className="moderation-groups">
      {data.items.map((item) => <article className="moderation-item" key={item.id}>
        <div className="moderation-item__meta"><StatusMark value={item.status} /><time>{formatDate(item.created_at)}</time></div>
        <h3>{item.username || '尚未设置用户名'}</h3>
        <p>{item.email} · {item.grade || (item.member_type === 'graduate' ? '毕业生' : '在校生')}</p>
        {item.status === 'active' ? <div className="moderation-actions">
          {confirmId === item.id ? <><span>封禁后该账号会立即退出，确定继续？</span><button className="button button--reject" type="button" onClick={() => update(item, 'suspended')}>确定封禁</button><button className="button" type="button" onClick={() => setConfirmId(null)}>取消</button></> : <button className="button button--reject" type="button" onClick={() => setConfirmId(item.id)}><UserRoundX size={16} />封禁账号</button>}
        </div> : item.status === 'suspended' ? <button className="button button--approve" type="button" onClick={() => update(item, 'active')}>恢复账号</button> : null}
        {superAdmin ? <div className="moderation-actions"><button type="button" onClick={() => resetPassword(item)} disabled={item.status !== 'active'}><KeyRound size={16} />重置密码</button>{deleteId === item.id ? <div className="staff-delete-confirm"><label>输入目标邮箱确认删除<input type="email" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} /></label><button type="button" disabled={confirmEmail.toLowerCase().trim() !== item.email.toLowerCase()} onClick={() => deleteAccount(item)}>确认删除</button><button type="button" onClick={() => { setDeleteId(null); setConfirmEmail('') }}>取消</button></div> : <button type="button" onClick={() => { setDeleteId(item.id); setConfirmEmail('') }}><Trash2 size={16} />删除账号</button>}</div> : null}
      </article>)}
    </div> : <EmptyState title="还没有用户">注册账号会显示在这里。</EmptyState>}
    <StaffPager count={data.items.length} offset={offset} limit={data.limit} onPage={onPage} />
  </section>
}

export function StaffAccounts({ data, selfId, offset, onPage, onDone, onError }) {
  const [generated, setGenerated] = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [confirmEmail, setConfirmEmail] = useState('')
  async function reset(item) {
    try { const result = await api(`/api/htyzSlowSnow/staff/accounts/${item.id}/reset-password`, { method: 'POST' }); setGenerated({ email: item.email, password: result.initialPassword }) }
    catch (error) { onError(error) }
  }
  async function remove(item) {
    try { await api(`/api/htyzSlowSnow/staff/accounts/${item.id}`, { method: 'DELETE', body: { confirmEmail } }); setDeleteId(null); setConfirmEmail(''); onDone('管理员登录权限已移除。') }
    catch (error) { onError(error) }
  }
  return <section className="staff-list-section"><p>密码不可读取。超级管理员可重置初始密码并撤销账号；历史审核和操作记录仍需保留。</p>{generated ? <div className="staff-password-result" role="status"><strong>{generated.email} 的新初始密码</strong><p>仅显示一次，首次登录必须修改。</p><code>{generated.password}</code><button type="button" onClick={() => setGenerated(null)}>我已保存，关闭</button></div> : null}{data.items.length ? <div className="moderation-groups">{data.items.map((item) => <article className="moderation-item" key={item.id}><div className="moderation-item__meta"><StatusMark value={item.status} /><time>{formatDate(item.created_at)}</time></div><h3>{item.email}</h3><p>{item.role}</p>{item.id !== selfId ? <div className="moderation-actions"><button type="button" disabled={item.status !== 'active'} onClick={() => reset(item)}><KeyRound size={16} />重置密码</button>{deleteId === item.id ? <div className="staff-delete-confirm"><label>输入目标邮箱确认撤销<input type="email" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} /></label><button type="button" disabled={confirmEmail.toLowerCase().trim() !== item.email.toLowerCase()} onClick={() => remove(item)}>确认撤销</button><button type="button" onClick={() => { setDeleteId(null); setConfirmEmail('') }}>取消</button></div> : <button type="button" onClick={() => { setDeleteId(item.id); setConfirmEmail('') }}><Trash2 size={16} />撤销账号</button>}</div> : <small>当前登录账号，请通过密码修改入口管理。</small>}</article>)}</div> : <EmptyState title="暂无管理员账号">管理员申请通过后会显示在这里。</EmptyState>}<div className="staff-pager"><button type="button" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - data.limit))}>上一页</button><span>第 {Math.floor(offset / data.limit) + 1} 页</span><button type="button" disabled={!data.hasMore} onClick={() => onPage(offset + data.limit)}>下一页</button></div></section>
}

function StaffPager({ count, offset, limit, onPage }) {
  return <div className="staff-pager"><button type="button" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>上一页</button><span>第 {Math.floor(offset / limit) + 1} 页</span><button type="button" disabled={count < limit} onClick={() => onPage(offset + limit)}>下一页</button></div>
}
