import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, UserRound } from 'lucide-react'
import { api } from '../api.js'
import { useAuth } from '../components/AuthContext.jsx'
import { EmptyState, FormField, LoadingState, Notice, StatusMark, SubmitButton, formatDate } from '../components/UI.jsx'
import { PageFrame } from './PublicPages.jsx'
import { gradeOptions } from '../grades.js'

export function AccountPage() {
  const { user, refresh } = useAuth()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({ applicantType: user?.memberType || 'current_student', commuteMode: 'day', className: '', studyStable: true, studentUnion: false, collegeYear: '', major: '', consent: false })
  const [state, setState] = useState({ busy: false, message: '', error: '' })
  const [profile, setProfile] = useState({ username: '', bio: '', grade: '' })
  const [avatar, setAvatar] = useState(null)

  async function load() {
    try {
      const result = await api('/api/me')
      setData(result); setProfile({ username: result.user.username || '', bio: result.user.bio || '', grade: result.user.grade || '' }); setLoadError('')
    } catch (error) { setLoadError(error.message) }
  }
  useEffect(() => { if (user) load() }, [user])

  async function apply(event) {
    event.preventDefault(); setState({ busy: true, message: '', error: '' })
    try { const result = await api('/api/staff-applications', { method: 'POST', body: form }); setState({ busy: false, message: result.message, error: '' }); load() }
    catch (error) { setState({ busy: false, message: '', error: error.message }) }
  }

  async function verifyForStaff() {
    setState({ busy: true, message: '', error: '' })
    try { const result = await api('/api/auth/verify-for-staff', { method: 'POST' }); setState({ busy: false, message: result.message, error: '' }) }
    catch (error) { setState({ busy: false, message: '', error: error.message }) }
  }

  async function saveProfile(event) {
    event.preventDefault(); setState({ busy: true, message: '', error: '' })
    try {
      const result = await api('/api/me/profile', { method: 'PATCH', body: profile })
      if (avatar) {
        const payload = new FormData(); payload.append('avatar', avatar)
        await api('/api/me/avatar', { method: 'POST', body: payload })
      }
      setAvatar(null); setState({ busy: false, message: result.message, error: '' }); await refresh(); await load()
    } catch (error) { setState({ busy: false, message: '', error: error.message }) }
  }

  if (!user) return <PageFrame title="我的空间" intro="查看投稿状态与管理员申请。"><EmptyState title="请先登录"><Link className="button button--primary" to="/login">前往登录</Link></EmptyState></PageFrame>
  if (!data && !loadError) return <PageFrame title="我的空间"><LoadingState /></PageFrame>
  if (loadError) return <PageFrame title="我的空间"><Notice tone="error">{loadError}</Notice></PageFrame>

  return (
    <PageFrame title="我的空间" intro={`${data.user.email} · ${data.user.member_type === 'current_student' ? '在校生' : '毕业生'}`}>
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}{state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <section className="profile-editor">
        <div className="profile-editor__intro"><span className="avatar avatar--large">{data.user.avatar ? <img src={data.user.avatar} alt="当前头像" /> : <UserRound aria-hidden="true" />}</span><div><h2>公开身份</h2><p>邮箱不会公开。用户名、头像和简介会显示在你的空间动态中。</p>{data.user.username ? <Link to={`/space/${encodeURIComponent(data.user.username)}`}>查看公开空间</Link> : null}</div></div>
        <form onSubmit={saveProfile}>
          <FormField label="用户名" hint="2–20 位中文、字母、数字、下划线或短横线。"><input value={profile.username} onChange={(event) => setProfile({ ...profile, username: event.target.value })} minLength={2} maxLength={20} required /></FormField>
          <FormField label="年级 / 当前状态"><select value={profile.grade} onChange={(event) => setProfile({ ...profile, grade: event.target.value })} required><option value="">请选择</option>{gradeOptions[user.memberType].map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></FormField>
          <FormField label="个人简介" hint="可选，最多 160 字。"><textarea value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} maxLength={160} /></FormField>
          <FormField label="头像" hint={avatar ? avatar.name : 'JPG、PNG 或 WebP，最大 4MB。'}><label className="file-input"><Camera aria-hidden="true" />选择头像<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setAvatar(event.target.files?.[0] || null)} /></label></FormField>
          <SubmitButton busy={state.busy}>保存个人资料</SubmitButton>
        </form>
      </section>
      <div className="account-grid">
        <section><h2>我的内容</h2><ContentStatuses title="投稿" items={data.submissions} empty="还没有投稿" /> <ContentStatuses title="空间动态" items={data.moments} empty="还没有动态" /> <ContentStatuses title="校园墙" items={data.wallPosts} empty="还没有校园墙内容" /></section>
        <section className="application-sheet"><h2>申请成为管理员</h2>{data.staffApplication ? <div className="application-status"><StatusMark value={data.staffApplication.status} /><p>提交于 {formatDate(data.staffApplication.created_at)}</p>{data.staffApplication.review_note ? <p>审核说明：{data.staffApplication.review_note}</p> : null}<small>申请资料在审核结束 30 天后自动清理。</small></div> : !data.user.email_verified_at ? <div className="application-status"><p>普通账号可直接使用；申请管理员前，需要验证注册邮箱 {data.user.email}。</p><button className="button button--primary" type="button" onClick={verifyForStaff} disabled={state.busy}>发送管理员申请验证邮件</button><p>点击邮件里的链接后，返回此页刷新即可填写申请。</p></div> : (
          <form onSubmit={apply}>
            {user.memberType === 'current_student' ? <>
              <FormField label="走读或住校"><select value={form.commuteMode} onChange={(event) => setForm({ ...form, commuteMode: event.target.value })}><option value="day">走读</option><option value="boarding">住校</option></select></FormField>
              <FormField label="在校班级"><input value={form.className} onChange={(event) => setForm({ ...form, className: event.target.value })} maxLength={40} required /></FormField>
              <FormField label="当前学习状态"><select value={String(form.studyStable)} onChange={(event) => setForm({ ...form, studyStable: event.target.value === 'true' })}><option value="true">相对稳定</option><option value="false">正在调整</option></select></FormField>
              <FormField label="是否参加学生会"><select value={String(form.studentUnion)} onChange={(event) => setForm({ ...form, studentUnion: event.target.value === 'true' })}><option value="false">否</option><option value="true">是</option></select></FormField>
            </> : <><FormField label="大学年级"><input value={form.collegeYear} onChange={(event) => setForm({ ...form, collegeYear: event.target.value })} maxLength={20} required /></FormField><FormField label="专业"><input value={form.major} onChange={(event) => setForm({ ...form, major: event.target.value })} maxLength={80} required /></FormField></>}
            <label className="check-row"><input type="checkbox" checked={form.consent} onChange={(event) => setForm({ ...form, consent: event.target.checked })} required /><span>我确认这些信息仅用于管理员资格审核，并可在审核结束 30 天后清理。</span></label>
            <SubmitButton busy={state.busy}>提交管理员申请</SubmitButton>
          </form>
        )}</section>
      </div>
    </PageFrame>
  )
}

function ContentStatuses({ title, items, empty }) {
  return <div className="content-status-group"><h3>{title}</h3>{items.length === 0 ? <p className="quiet-empty">{empty}</p> : <div className="submission-list">{items.map((item) => <article key={item.id}><div><h4>{item.title || item.body?.slice(0, 38) || '图片动态'}</h4><time>{formatDate(item.created_at)}</time></div><StatusMark value={item.status} />{item.rejection_reason ? <p>审核说明：{item.rejection_reason}</p> : null}</article>)}</div>}</div>
}
