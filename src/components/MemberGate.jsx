import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { LockKeyhole } from 'lucide-react'
import { useAuth } from './AuthContext.jsx'
import { LoadingState } from './UI.jsx'
import { PageFrame } from '../pages/PublicPages.jsx'
import { FormField, Notice, SubmitButton } from './UI.jsx'
import { api } from '../api.js'
import { gradeOptions } from '../grades.js'

export function MemberGate() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageFrame title="正在进入社区" section="gate"><LoadingState /></PageFrame>
  if (user) return <Outlet />

  const next = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)
  return <PageFrame title="先加入，再走进来" intro="登录或注册后即可浏览社区栏目，与同学交流。" section="gate">
    <section className="member-gate" aria-label="登录后浏览">
      <div className="member-gate__icon"><LockKeyhole size={30} aria-hidden="true" /></div>
      <div><h2>这页留给社区成员</h2><p>注册只需要邮箱、密码、在校生或毕业生身份及年级。完成后会返回刚才选择的页面。</p></div>
      <div className="member-gate__actions">
        <Link className="button button--primary" to={`/login?next=${next}`}>登录后继续</Link>
        <Link className="button member-gate__secondary" to={`/login?mode=register&next=${next}`}>注册账号</Link>
      </div>
    </section>
  </PageFrame>
}

export function CompleteGrade({ user, refresh }) {
  const [grade, setGrade] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await api('/api/me/grade', { method: 'PATCH', body: { grade } }); await refresh() }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <div className="grade-gate" role="dialog" aria-modal="true" aria-labelledby="grade-gate-title"><form className="grade-gate__sheet" onSubmit={save}><h1 id="grade-gate-title">先完善年级</h1><p>为了让交流时的身份标签准确，请选择你目前的年级或状态。之后可在“我的空间”修改。</p>{error ? <Notice tone="error">{error}</Notice> : null}<FormField label="年级 / 当前状态"><select autoFocus value={grade} onChange={(event) => setGrade(event.target.value)} required><option value="">请选择</option>{gradeOptions[user.memberType].map((item) => <option key={item} value={item}>{item}</option>)}</select></FormField><SubmitButton busy={busy}>保存并进入社区</SubmitButton></form></div>
}
