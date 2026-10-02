import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../components/AuthContext.jsx'
import { FormField, LoadingState, Notice, SubmitButton } from '../components/UI.jsx'
import { PageFrame } from './PublicPages.jsx'
import { gradeOptions } from '../grades.js'

export function LoginPage() {
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState(searchParams.get('mode') === 'register' ? 'register' : 'login')
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '', memberType: 'current_student', grade: '', privacyAccepted: false })
  const [state, setState] = useState({ busy: false, message: '', error: '' })

  async function submit(event) {
    event.preventDefault()
    setState({ busy: true, message: '', error: '' })
    try {
      if (mode === 'login') {
        await api('/api/auth/login', { method: 'POST', body: { email: form.email, password: form.password } })
        await refresh()
        const next = searchParams.get('next')
        navigate(next?.startsWith('/') && !next.startsWith('//') ? next : '/me', { replace: true })
      } else {
        const result = await api('/api/auth/register', { method: 'POST', body: form })
        setMode('login')
        setState({ busy: false, message: result.message, error: '' })
      }
    } catch (error) { setState({ busy: false, message: '', error: error.message }) }
  }

  async function resend() {
    setState({ busy: true, message: '', error: '' })
    try {
      const result = await api('/api/auth/resend-verification', { method: 'POST', body: { email: form.email } })
      setState({ busy: false, message: result.message, error: '' })
    } catch (error) { setState({ busy: false, message: '', error: error.message }) }
  }

  return (
    <PageFrame title={mode === 'login' ? '回到社区' : '创建社区账号'} intro="普通账号只需要邮箱、密码、身份类型和年级。">
      <div className="auth-layout">
        <div className="auth-switch" role="tablist" aria-label="登录或注册">
          <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>登录</button>
          <button role="tab" aria-selected={mode === 'register'} onClick={() => setMode('register')}>注册</button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {state.message ? <Notice tone="success">{state.message}</Notice> : null}{state.error ? <Notice tone="error">{state.error}</Notice> : null}
          <FormField label="邮箱" hint={mode === 'register' ? 'QQ 邮箱可直接用 QQ 号加 @qq.com，例如 123456@qq.com。' : null}><input type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></FormField>
          <FormField label="密码" hint={mode === 'register' ? '至少 10 位，同时包含字母和数字。' : null}><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={10} maxLength={128} required /></FormField>
          {mode === 'register' ? <>
            <FormField label="身份类型"><select value={form.memberType} onChange={(event) => setForm({ ...form, memberType: event.target.value, grade: '' })}><option value="current_student">在校生</option><option value="graduate">毕业生</option></select></FormField>
            <FormField label="年级 / 当前状态"><select value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })} required><option value="">请选择</option>{gradeOptions[form.memberType].map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></FormField>
            <label className="check-row"><input type="checkbox" checked={form.privacyAccepted} onChange={(event) => setForm({ ...form, privacyAccepted: event.target.checked })} required /><span>我已阅读并同意<Link to="/privacy">隐私与社区规则</Link></span></label>
          </> : <div className="form-side-links"><Link to="/forgot-password">忘记密码</Link></div>}
          <SubmitButton busy={state.busy}>{mode === 'login' ? '登录' : '注册账号'}</SubmitButton>
        </form>
      </div>
    </PageFrame>
  )
}

export function VerifyPage() {
  const [params] = useSearchParams()
  const [state, setState] = useState({ loading: true, message: '', error: '' })
  useEffect(() => {
    api('/api/auth/verify', { method: 'POST', body: { token: params.get('token') || '' } })
      .then((result) => setState({ loading: false, message: result.message, error: '' }))
      .catch((error) => setState({ loading: false, message: '', error: error.message }))
  }, [params])
  return <PageFrame title="验证邮箱" intro="验证链接只能使用一次。">{state.loading ? <LoadingState label="正在验证" /> : state.error ? <Notice tone="error">{state.error}</Notice> : <><Notice tone="success">{state.message}</Notice><Link className="button button--primary" to="/login">前往登录</Link></>}</PageFrame>
}

export function ForgotPage() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState({ busy: false, message: '', error: '' })
  async function submit(event) {
    event.preventDefault(); setState({ busy: true, message: '', error: '' })
    try { const result = await api('/api/auth/forgot-password', { method: 'POST', body: { email } }); setState({ busy: false, message: result.message, error: '' }) }
    catch (error) { setState({ busy: false, message: '', error: error.message }) }
  }
  return <PageFrame title="重置密码" intro="为了避免泄露账号是否存在，提交后的提示对所有邮箱一致。"><form className="auth-form" onSubmit={submit}>{state.message ? <Notice tone="success">{state.message}</Notice> : null}{state.error ? <Notice tone="error">{state.error}</Notice> : null}<FormField label="注册邮箱"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></FormField><SubmitButton busy={state.busy}>发送重置邮件</SubmitButton></form></PageFrame>
}

export function ResetPasswordPage({ staff = false }) {
  const [params] = useSearchParams()
  const [password, setPassword] = useState('')
  const [state, setState] = useState({ busy: false, message: '', error: '' })
  async function submit(event) {
    event.preventDefault(); setState({ busy: true, message: '', error: '' })
    try {
      const result = await api(staff ? '/api/htyzSlowSnow/auth/activate' : '/api/auth/reset-password', { method: 'POST', body: { token: params.get('token') || '', password } })
      setState({ busy: false, message: result.message, error: '' })
    } catch (error) { setState({ busy: false, message: '', error: error.message }) }
  }
  return <PageFrame title={staff ? '激活管理员账号' : '设置新密码'} intro={staff ? '密码由你本人设置，不会通过邮件明文发送。' : '重置后，其他浏览器中的登录状态会同时失效。'}><form className="auth-form" onSubmit={submit}>{state.message ? <Notice tone="success">{state.message}</Notice> : null}{state.error ? <Notice tone="error">{state.error}</Notice> : null}<FormField label="新密码" hint="至少 10 位，同时包含字母和数字。"><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={128} required /></FormField><SubmitButton busy={state.busy}>{staff ? '激活账号' : '更新密码'}</SubmitButton></form></PageFrame>
}
