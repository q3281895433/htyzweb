import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Check, ImagePlus, LogOut, ShieldCheck, UserPlus, X } from 'lucide-react'
import { api, uploadForm } from '../api.js'
import { useAuth } from '../components/AuthContext.jsx'
import { EmptyState, FormField, LoadingState, Notice, StatusMark, SubmitButton, formatDate } from '../components/UI.jsx'
import { PostsAdmin, StaffAccounts, UsersAdmin } from './StaffManagement.jsx'
import { UploadProgress, VideoPicker } from '../components/PostMedia.jsx'
import { StaffChats } from './StaffChats.jsx'

const tabs = [
  ['overview', '工作概览'], ['posts', '帖子管理'], ['users', '账号管理'], ['accounts', '管理员账号'], ['news', '校园新闻'], ['suggestions', '建议箱'], ['applications', '管理员申请'], ['staff', '手动添加管理员'], ['chats', '聊天管理'], ['audit', '操作记录']
]

export function StaffPortal() {
  const { staff, refresh, logout } = useAuth()
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const [state, setState] = useState({ busy: false, error: '' })

  async function login(event) {
    event.preventDefault(); setState({ busy: true, error: '' })
    try { await api('/api/htyzSlowSnow/auth/login', { method: 'POST', body: credentials }); await refresh(); setState({ busy: false, error: '' }) }
    catch (error) { setState({ busy: false, error: error.message }) }
  }

  if (!staff) {
    return (
      <div className="staff-login">
        <div className="staff-login__mark"><ShieldCheck size={32} /><span>STAFF ACCESS</span></div>
        <form onSubmit={login}>
          <h1>社区管理入口</h1><p>该入口与普通用户登录分离，但安全仍依赖账号、权限、CSRF 和审计，不依赖网址保密。</p>
          {state.error ? <Notice tone="error">{state.error}</Notice> : null}
          <FormField label="管理员邮箱"><input type="email" autoComplete="username" value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} required /></FormField>
          <FormField label="密码"><input type="password" autoComplete="current-password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></FormField>
          <SubmitButton busy={state.busy}>进入管理台</SubmitButton>
        </form>
      </div>
    )
  }

  if (staff.mustChangePassword) return <StaffPasswordChange staff={staff} logout={() => logout('staff')} refresh={refresh} />
  return <StaffDashboard staff={staff} logout={() => logout('staff')} />
}

function StaffPasswordChange({ staff, logout, refresh }) {
  const [form, setForm] = useState({ oldPassword: '', newPassword: '' })
  const [state, setState] = useState({ busy: false, error: '', message: '' })
  async function change(event) {
    event.preventDefault()
    setState({ busy: true, error: '', message: '' })
    try {
      const result = await api('/api/htyzSlowSnow/auth/change-password', { method: 'POST', body: form })
      await refresh()
      setState({ busy: false, error: '', message: result.message })
    } catch (error) { setState({ busy: false, error: error.message, message: '' }) }
  }
  return <div className="staff-login"><div className="staff-login__mark"><ShieldCheck size={32} /><span>FIRST LOGIN</span></div><form onSubmit={change}><h1>先更换初始密码</h1><p>{staff.email} · 完成后用新密码重新登录。</p>{state.error ? <Notice tone="error">{state.error}</Notice> : null}{state.message ? <Notice tone="success">{state.message}</Notice> : null}<FormField label="当前密码"><input type="password" autoComplete="current-password" value={form.oldPassword} onChange={(event) => setForm({ ...form, oldPassword: event.target.value })} required /></FormField><FormField label="新密码" hint="至少 10 位，包含字母和数字。"><input type="password" autoComplete="new-password" minLength={10} value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} required /></FormField><SubmitButton busy={state.busy}>更换密码</SubmitButton><button className="button" type="button" onClick={logout}>退出管理台</button></form></div>
}

function StaffDashboard({ staff, logout }) {
  const visibleTabs = tabs.filter(([key]) => !['applications', 'staff', 'accounts', 'chats', 'audit'].includes(key) || staff.role === 'super_admin').filter(([key]) => key !== 'users' || ['super_admin', 'moderator'].includes(staff.role))
  const [tab, setTab] = useState('overview')
  const [postType, setPostType] = useState('moment')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [loadedKey, setLoadedKey] = useState('')
  const requestId = useRef(0)
  const [state, setState] = useState({ loading: true, busy: false, message: '', error: '' })
  const resourceKey = `${tab}:${postType}:${offset}`

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    const key = `${tab}:${postType}:${offset}`
    setData(null)
    setLoadedKey('')
    setState((current) => ({ ...current, loading: true, error: '' }))
    const paths = { overview: '/api/htyzSlowSnow/dashboard', posts: `/api/htyzSlowSnow/posts?type=${postType}&offset=${offset}`, users: `/api/htyzSlowSnow/users?offset=${offset}`, accounts: `/api/htyzSlowSnow/staff/accounts?offset=${offset}`, news: '/api/htyzSlowSnow/news', suggestions: '/api/htyzSlowSnow/suggestions', applications: '/api/htyzSlowSnow/applications', chats: `/api/htyzSlowSnow/chats?offset=${offset}`, audit: '/api/htyzSlowSnow/audit' }
    if (tab === 'staff') { setData({}); setLoadedKey(key); setState((current) => ({ ...current, loading: false })); return }
    try {
      const result = await api(paths[tab])
      if (currentRequest !== requestId.current) return
      setData(result)
      setLoadedKey(key)
      setState((current) => ({ ...current, loading: false }))
    } catch (error) {
      if (currentRequest !== requestId.current) return
      setLoadedKey(key)
      setState((current) => ({ ...current, loading: false, error: error.message }))
    }
  }, [tab, postType, offset])

  useEffect(() => { load() }, [load])
  const notify = (message) => setState((current) => ({ ...current, message, error: '' }))
  const fail = (error) => setState((current) => ({ ...current, error: error.message, message: '' }))

  return (
    <div className="staff-console">
      <aside className="staff-sidebar">
        <div className="staff-brand"><ShieldCheck /><div><strong>社区管理台</strong><span>htyz.space · {staff.role}</span></div></div>
        <nav aria-label="管理栏目">{visibleTabs.map(([key, label]) => <button type="button" key={key} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setOffset(0) }}>{label}</button>)}</nav>
        <button className="staff-logout" type="button" onClick={logout}><LogOut size={17} />退出管理台</button>
      </aside>
      <main className="staff-main">
        <header><div><h1>{visibleTabs.find(([key]) => key === tab)?.[1]}</h1><p>{staff.email}</p></div><span className="live-mark"><Activity size={14} />管理会话有效</span></header>
        {state.message ? <Notice tone="success">{state.message}</Notice> : null}{state.error ? <Notice tone="error">{state.error}</Notice> : null}
        <div className="staff-panel" key={tab}>{state.loading || loadedKey !== resourceKey ? <LoadingState /> : !data ? <button className="button" type="button" onClick={load}>重新加载当前栏目</button> : tab === 'overview' ? <OverviewAdmin data={data} onNavigate={setTab} /> : tab === 'posts' ? <PostsAdmin data={data} postType={postType} onType={(type) => { setPostType(type); setOffset(0) }} offset={offset} onPage={setOffset} onDone={(message) => { notify(message); load() }} onError={fail} /> : tab === 'users' ? <UsersAdmin data={data} superAdmin={staff.role === 'super_admin'} offset={offset} onPage={setOffset} onDone={(message) => { notify(message); load() }} onError={fail} /> : tab === 'accounts' ? <StaffAccounts data={data} selfId={staff.id} offset={offset} onPage={setOffset} onDone={(message) => { notify(message); load() }} onError={fail} /> : tab === 'news' ? <NewsAdmin data={data} staff={staff} onDone={(message) => { notify(message); load() }} onError={fail} /> : tab === 'suggestions' ? <SuggestionsAdmin data={data} onDone={(message) => { notify(message); load() }} onError={fail} /> : tab === 'applications' ? <ApplicationsAdmin data={data} onDone={(message) => { notify(message); load() }} onError={fail} /> : tab === 'staff' ? <ManualStaffAdmin onDone={notify} onError={fail} /> : tab === 'chats' ? <StaffChats data={data} offset={offset} onPage={setOffset} onDone={notify} onError={fail} /> : <AuditAdmin data={data} />}</div>
      </main>
    </div>
  )
}

function OverviewAdmin({ data, onNavigate }) {
  const counts = data.counts
  const points = data.dailyPosts || []
  const max = Math.max(1, ...points.map((point) => point.count))
  const line = points.map((point, index) => `${20 + index * 40},${148 - point.count / max * 115}`).join(' ')
  return <section className="staff-overview"><p>管理真实内容和账号。数字直接读取数据库，不包含演示数据。</p><div className="staff-overview__grid"><button type="button" onClick={() => onNavigate('posts')}><span>已发布内容</span><strong>{counts.publishedPosts}</strong><small>查看帖子管理 →</small></button><button type="button" onClick={() => onNavigate('suggestions')}><span>新建议</span><strong>{counts.newSuggestions}</strong><small>打开建议箱 →</small></button>{counts.pendingStaffApplications !== null ? <button type="button" onClick={() => onNavigate('applications')}><span>待处理管理员申请</span><strong>{counts.pendingStaffApplications}</strong><small>查看申请 →</small></button> : null}</div><div className="staff-trend"><h2>每日发帖曲线</h2><p>最近 14 天，按北京时间统计校园墙、投稿、空间动态、问题与新闻。</p><div className="staff-trend__plot"><svg viewBox="0 0 560 170" role="img" aria-label={`最近 14 天发帖量，最高单日 ${max} 条`} preserveAspectRatio="none"><path d="M20 148 H540" /><polyline points={line} />{points.map((point, index) => <circle key={point.day} cx={20 + index * 40} cy={148 - point.count / max * 115} r="4"><title>{point.day}：{point.count} 条</title></circle>)}</svg></div><div className="staff-trend__axis"><span>{points[0]?.day}</span><span>{points.at(-1)?.day}</span></div><details><summary>查看每日数据</summary><table><thead><tr><th>日期</th><th>帖子数</th></tr></thead><tbody>{points.map((point) => <tr key={point.day}><td>{point.day}</td><td>{point.count}</td></tr>)}</tbody></table></details></div></section>
}

function ManualStaffAdmin({ onDone, onError }) {
  const [email, setEmail] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  async function add(event) {
    event.preventDefault()
    if (!confirmed) return
    setBusy(true)
    try { const result = await api('/api/htyzSlowSnow/staff/manual', { method: 'POST', body: { email } }); setCreated(result); setEmail(''); setConfirmed(false); onDone(result.message) }
    catch (error) { onError(error) } finally { setBusy(false) }
  }
  return <section className="staff-manual"><div><UserPlus size={28} /><h2>手动开通管理员</h2><p>仅超级管理员可操作。目标邮箱必须是数据库中已有的可用普通用户账号。系统自动按其在校生／毕业生身份分配管理员角色，并生成一次性初始密码；此流程不依赖邮件。</p></div><form onSubmit={add}><FormField label="已有用户的邮箱"><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setConfirmed(false); setCreated(null) }} required /></FormField><label className="check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required /><span>已核对邮箱及申请人身份，确认授予管理员权限</span></label><SubmitButton busy={busy}>确认添加并生成密码</SubmitButton></form>{created ? <div className="staff-password-result" role="status"><strong>{created.email} 已添加为{created.role === 'campus_admin' ? '在校管理员' : '毕业生管理员'}</strong><p>初始密码只在此处显示一次，请通过安全方式交给本人。首次登录必须修改。</p><code>{created.initialPassword}</code><button type="button" onClick={() => navigator.clipboard?.writeText(created.initialPassword)}>复制密码</button></div> : null}</section>
}

function AuditAdmin({ data }) {
  return <section className="staff-audit"><p>最近 300 条真实操作记录，仅超级管理员可见。</p>{data.items.length ? <div className="admin-list">{data.items.map((item) => <article key={item.id}><div><strong>{item.event_name}</strong><p>{item.actor_type} · {item.target_type || '系统'} · {item.target_id || '—'}</p></div><time>{formatDate(item.created_at)}</time></article>)}</div> : <EmptyState title="暂无操作记录">真实管理操作会记录在此。</EmptyState>}</section>
}

function NewsAdmin({ data, staff, onDone, onError }) {
  const canPublish = ['campus_admin', 'super_admin'].includes(staff.role)
  const [form, setForm] = useState({ title: '', body: '' })
  const [files, setFiles] = useState([])
  const [video, setVideo] = useState(null)
  const [progress, setProgress] = useState(null)
  const [busy, setBusy] = useState(false)
  async function publish(event) {
    event.preventDefault(); setBusy(true)
    const payload = new FormData()
    Object.entries(form).forEach(([key, value]) => payload.append(key, value))
    files.forEach((file) => payload.append('images', file))
    if (video) payload.append('video', video)
    setProgress(0)
    try { await uploadForm('/api/htyzSlowSnow/news', payload, setProgress); setForm({ title: '', body: '' }); setFiles([]); setVideo(null); onDone('校园新闻已发布。') }
    catch (error) { onError(error) } finally { setBusy(false); setProgress(null) }
  }
  async function archive(item) {
    try { await api(`/api/htyzSlowSnow/news/${item.id}`, { method: 'PATCH', body: { title: item.title, body: item.body, status: 'archived' } }); onDone('新闻已归档。') }
    catch (error) { onError(error) }
  }
  return <div className="admin-two-column">{canPublish ? <form className="admin-composer" encType="multipart/form-data" onSubmit={publish}><h2>发布真实校园新闻</h2><FormField label="标题"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={120} required /></FormField><FormField label="正文" hint="可只上传图片或视频，无最低字数"><textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} maxLength={12000} /></FormField><FormField label="图片" hint={files.length ? `${files.length} 张图片待上传` : '可选，最多 9 张，每张不超过 6MB。'}><label className="file-input"><ImagePlus aria-hidden="true" />选择 JPG、PNG 或 WebP<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 9))} /></label>{files.length ? <div className="upload-file-list">{files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}</div> : null}</FormField><VideoPicker video={video} onChange={setVideo} /><UploadProgress value={progress} /><SubmitButton busy={busy}>立即发布</SubmitButton></form> : <Notice tone="warning">当前角色只能查看新闻，不能发布。</Notice>}<section><h2>已创建新闻</h2>{data.items.length ? <div className="admin-list">{data.items.map((item) => <article key={item.id}><div><StatusMark value={item.status} /><h3>{item.title}</h3><time>{formatDate(item.published_at)}</time>{item.images?.length ? <small className="admin-image-count">{item.images.length} 张配图</small> : null}{item.video ? <small className="admin-image-count">含视频</small> : null}</div>{item.status === 'published' && canPublish ? <button type="button" onClick={() => archive(item)}>归档</button> : null}</article>)}</div> : <EmptyState title="还没有新闻">此处没有示例新闻。</EmptyState>}</section></div>
}

function SuggestionsAdmin({ data, onDone, onError }) {
  async function update(id, status) {
    try { await api(`/api/htyzSlowSnow/suggestions/${id}`, { method: 'PATCH', body: { status } }); onDone('建议状态已更新。') }
    catch (error) { onError(error) }
  }
  if (!data.items.length) return <EmptyState title="建议箱为空">用户提交的真实建议会出现在这里。</EmptyState>
  return <div className="suggestion-admin-list">{data.items.map((item) => <article key={item.id}><div className="moderation-item__meta"><StatusMark value={item.status} /><time>{formatDate(item.created_at)}</time></div><p className="preserve-lines">{item.body}</p>{item.contact ? <small>自愿联系方式：{item.contact}</small> : null}<div className="moderation-actions"><button type="button" onClick={() => update(item.id, 'reviewing')}>标记处理中</button><button type="button" onClick={() => update(item.id, 'closed')}>关闭</button></div></article>)}</div>
}

function ApplicationsAdmin({ data, onDone, onError }) {
  async function decide(id, action, note) {
    try { await api(`/api/htyzSlowSnow/applications/${id}/decision`, { method: 'POST', body: { action, note } }); onDone(action === 'approve' ? '申请已批准，初始密码已发送。' : '申请已拒绝。') }
    catch (error) { onError(error) }
  }
  if (!data.items.length) return <EmptyState title="没有管理员申请">收到申请后，只有超级管理员能在这里查看资格资料。</EmptyState>
  return <div className="application-admin-list">{data.items.map((item) => <article key={item.id}><div className="moderation-item__meta"><StatusMark value={item.status} /><time>{formatDate(item.created_at)}</time></div><h3>{item.email}</h3><p>{item.applicant_type === 'current_student' ? '在校生申请' : '毕业生申请'}</p><dl>{Object.entries(item.details || {}).map(([key, value]) => <div key={key}><dt>{detailLabel(key)}</dt><dd>{typeof value === 'boolean' ? (value ? '是' : '否') : value}</dd></div>)}</dl>{item.status === 'pending' ? <ReviewDecision approveLabel="批准" noteLabel="审核备注（拒绝时必填）" onDecide={(action, note) => decide(item.id, action, note)} /> : null}</article>)}</div>
}

function ReviewDecision({ onDecide, approveLabel = '通过', noteLabel = '审核备注（拒绝时必填）' }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')

  async function submit(action) {
    if (action === 'reject' && !note.trim()) return
    setBusy(action)
    try { await onDecide(action, note.trim() || null) }
    finally { setBusy('') }
  }

  return (
    <div className="review-decision">
      <label>
        <span>{noteLabel}</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder="通过时可留空；拒绝时请说明具体原因。" />
      </label>
      <div className="moderation-actions">
        <button className="button button--approve" type="button" disabled={Boolean(busy)} onClick={() => submit('approve')}><Check size={16} />{busy === 'approve' ? '处理中…' : approveLabel}</button>
        <button className="button button--reject" type="button" disabled={Boolean(busy) || !note.trim()} onClick={() => submit('reject')}><X size={16} />{busy === 'reject' ? '处理中…' : '拒绝'}</button>
      </div>
    </div>
  )
}

function detailLabel(key) {
  return ({ commuteMode: '走读/住校', className: '班级', studyStable: '学习状态稳定', studentUnion: '参加学生会', collegeYear: '大学年级', major: '专业' })[key] || key
}
