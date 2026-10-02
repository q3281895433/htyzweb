import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, ImagePlus } from 'lucide-react'
import { api, uploadForm } from '../api.js'
import { usePostAnchor, useResource } from '../hooks.js'
import { useAuth } from '../components/AuthContext.jsx'
import { EmptyState, FormField, LoadingState, Notice, SubmitButton, formatDate } from '../components/UI.jsx'
import { PostEngagement } from '../components/PostEngagement.jsx'
import { PostMedia, UploadProgress, VideoPicker } from '../components/PostMedia.jsx'
import { MemberIdentity } from '../components/MemberIdentity.jsx'

const categoryLabels = {
  campus_life: '校园生活', writing: '文字作品', photo_story: '图片故事', graduate_note: '毕业生心得'
}

export function CommunityPage() {
  const { data, loading, error, reload } = useResource('/api/public/contributions')
  usePostAnchor(Boolean(data))
  return (
    <PageFrame title="投稿广场" intro="作品提交后立即公开。作者邮箱和个人身份信息不会出现在这里；违规内容可由管理员删除。" action={<Link className="button button--primary" to="/submit">提交作品</Link>}>
      {loading ? <LoadingState /> : error ? <Notice tone="error">{error.message}</Notice> : data.items.length === 0 ? (
        <EmptyState title="等待第一篇投稿">这里不会用示例文章填满版面。成为第一个认真投稿的人。</EmptyState>
      ) : <div className="editorial-list">{data.items.map((item) => <Contribution key={item.id} item={item} onDeleted={reload} />)}</div>}
    </PageFrame>
  )
}

function Contribution({ item, onDeleted }) {
  return (
    <article id={`post-${item.id}`} className="editorial-entry">
      <div className="editorial-entry__meta"><span>{categoryLabels[item.category]}</span><time>{formatDate(item.publishedAt)}</time></div>
      <h2>{item.title}</h2>
      <p className="post-byline">投稿人：<MemberIdentity author={item.author} /></p>
      <p className="preserve-lines">{item.body}</p>
      <PostMedia images={item.images} video={item.video} videoPoster={item.videoPoster} videoStatus={item.videoStatus} label="投稿附图" />
      <PostEngagement type="contribution" postId={item.id} onDeleted={onDeleted} />
    </article>
  )
}

export function NewsPage() {
  const { data, loading, error } = useResource('/api/public/news')
  usePostAnchor(Boolean(data))
  return (
    <PageFrame title="校园新闻" intro="仅由已审核通过的在校管理员发布。">
      {loading ? <LoadingState /> : error ? <Notice tone="error">{error.message}</Notice> : data.items.length === 0 ? (
        <EmptyState title="暂无校园新闻">管理员发布的真实消息会按时间出现在这里。</EmptyState>
      ) : <div className="news-list">{data.items.map((item) => <article id={`post-${item.id}`} key={item.id}><time>{formatDate(item.published_at)}</time><h2>{item.title}</h2><p className="preserve-lines">{item.body}</p><PostMedia images={item.images} video={item.video} videoPoster={item.videoPoster} videoStatus={item.videoStatus} label="校园新闻配图" /><PostEngagement type="news" postId={item.id} /></article>)}</div>}
    </PageFrame>
  )
}

export function QAPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data, loading, error, reload } = useResource('/api/public/questions')
  const [selected, setSelected] = useState(null)
  const [answerVersion, setAnswerVersion] = useState(0)
  const [form, setForm] = useState({ title: '', body: '' })
  const [answer, setAnswer] = useState('')
  const [state, setState] = useState({ busy: false, message: '', error: '' })

  const selectedId = searchParams.get('question')
  useEffect(() => {
    setSelected(selectedId ? data?.items.find((item) => item.id === selectedId) || { id: selectedId, title: '所选问题' } : null)
  }, [data, selectedId])

  async function ask(event) {
    event.preventDefault()
    setState({ busy: true, message: '', error: '' })
    try {
      const result = await api('/api/questions', { method: 'POST', body: form })
      setForm({ title: '', body: '' })
      setState({ busy: false, message: result.message, error: '' })
      reload()
    } catch (err) { setState({ busy: false, message: '', error: err.message }) }
  }

  async function sendAnswer(event) {
    event.preventDefault()
    setState({ busy: true, message: '', error: '' })
    try {
      const result = await api(`/api/questions/${selected.id}/answers`, { method: 'POST', body: { body: answer } })
      setAnswer('')
      setState({ busy: false, message: result.message, error: '' })
      setAnswerVersion((value) => value + 1)
      reload()
    } catch (err) { setState({ busy: false, message: '', error: err.message }) }
  }

  return (
    <PageFrame title="你问，我答" intro="在校生和毕业生都可以提问、回答。问题和回答提交后即可公开。">
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <div className="split-layout">
        <div>
          {loading ? <LoadingState /> : error ? <Notice tone="error">{error.message}</Notice> : data.items.length === 0 ? (
            <EmptyState title="等待第一个问题">没有示例问答。第一个真实问题会出现在这里。</EmptyState>
          ) : <div className="question-list">{data.items.map((item) => (
            <button key={item.id} type="button" className={selected?.id === item.id ? 'question-row question-row--active' : 'question-row'} onClick={() => { setSelected(item); setSearchParams({ question: item.id }) }}>
              <span>{item.title}</span><small>{item.authorName || '社区成员'}{item.grade ? ` · ${item.grade}` : ''}提问 · {item.answer_count} 个回答 · {formatDate(item.published_at)}</small>
            </button>
          ))}</div>}
          {selected ? <QuestionDetail key={`${selected.id}-${answerVersion}`} questionId={selected.id} answerId={searchParams.get('answer')} answer={answer} setAnswer={setAnswer} onAnswer={sendAnswer} busy={state.busy} onQuestionDeleted={() => { setSearchParams({}); reload() }} onAnswerDeleted={reload} /> : null}
        </div>
        <aside className="task-sheet">
          {!user ? <><h2>登录后参与</h2><p>注册仅需邮箱、密码与年级。</p><Link className="button button--primary" to="/login">登录 / 注册</Link></> : <div className="qa-composers"><form onSubmit={ask}><h2>提出问题</h2><FormField label="问题标题"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={100} required /></FormField><FormField label="详细说明"><textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} maxLength={5000} required /></FormField><SubmitButton busy={state.busy}>发布问题</SubmitButton></form></div>}
        </aside>
      </div>
    </PageFrame>
  )
}

function QuestionDetail({ questionId, answerId, answer, setAnswer, onAnswer, busy, onQuestionDeleted, onAnswerDeleted }) {
  const { data, loading, error, reload } = useResource(`/api/public/questions/${questionId}`)
  useEffect(() => {
    if (!data) return
    document.getElementById(`post-${answerId || data.id}`)?.scrollIntoView({ block: 'center' })
  }, [data, answerId])
  if (loading) return <LoadingState label="正在读取问题与回答" />
  if (error) return <Notice tone="error">{error.message}</Notice>
  return <section className="question-detail" aria-label="问题详情与回答">
    <article id={`post-${data.id}`} className="question-detail__post"><h2>{data.title}</h2><MemberIdentity author={{ id: data.authorId, username: data.authorName || '社区成员', grade: data.grade }} /><time>提问 · {formatDate(data.published_at)}</time><p className="preserve-lines">{data.body}</p><PostEngagement type="question" postId={data.id} onDeleted={onQuestionDeleted} /></article>
    <form className="qa-answer-form" onSubmit={onAnswer}><h3>答</h3><FormField label="你的回答"><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={5000} required /></FormField><SubmitButton busy={busy}>发布回答</SubmitButton></form>
    <h3>大家的回答 · {data.answers.length}</h3>
    {data.answers.length ? data.answers.map((item) => <article id={`post-${item.id}`} key={item.id} className="question-answer"><MemberIdentity author={{ id: item.authorId, username: item.authorName || '社区成员', grade: item.grade }} /><time>回答 · {formatDate(item.published_at)}</time><p className="preserve-lines">{item.body}</p><PostEngagement type="answer" postId={item.id} onDeleted={() => { reload(); onAnswerDeleted() }} /></article>) : <p className="quiet-empty">还没有回答，欢迎分享你的经验。</p>}
  </section>
}

export function SubmitPage() {
  const { user } = useAuth()
  const [form, setForm] = useState({ category: 'campus_life', title: '', body: '' })
  const [files, setFiles] = useState([])
  const [video, setVideo] = useState(null)
  const [progress, setProgress] = useState(null)
  const [state, setState] = useState({ busy: false, message: '', error: '' })
  const fileSummary = useMemo(() => files.length ? `${files.length} 张图片待上传` : '可选，最多 9 张，每张不超过 6MB', [files])

  async function submit(event) {
    event.preventDefault()
    const data = new FormData()
    Object.entries(form).forEach(([key, value]) => data.append(key, value))
    files.forEach((file) => data.append('images', file))
    if (video) data.append('video', video)
    setState({ busy: true, message: '', error: '' })
    setProgress(0)
    try {
      const result = await uploadForm('/api/contributions', data, setProgress)
      setForm({ category: 'campus_life', title: '', body: '' })
      setFiles([])
      setVideo(null)
      setState({ busy: false, message: result.message, error: '' })
    } catch (err) { setState({ busy: false, message: '', error: err.message }) } finally { setProgress(null) }
  }

  if (!user) return <PageFrame title="投稿" intro="登录社区账号后即可投稿。"><EmptyState title="请先登录">登录后可以发布文字与图片。<br /><Link className="button button--primary" to="/login">前往登录</Link></EmptyState></PageFrame>

  return (
    <PageFrame title="提交一份值得留下的内容" intro="我们接受校园生活、文字作品、图片故事与毕业生心得。拒绝色情、血腥、仇恨、违法和针对个人的伤害性内容。">
      <form className="long-form" onSubmit={submit}>
        {state.message ? <Notice tone="success">{state.message}</Notice> : null}
        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        <FormField label="分类"><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="标题"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={100} required /></FormField>
        <FormField label="正文" hint="可只上传图片，无最低字数"><textarea className="textarea-large" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} maxLength={12000} /></FormField>
        <FormField label="图片" hint={fileSummary}><label className="file-input"><ImagePlus aria-hidden="true" />选择 JPG、PNG 或 WebP<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 9))} /></label></FormField>
        <VideoPicker video={video} onChange={setVideo} /><UploadProgress value={progress} />
        <SubmitButton busy={state.busy}>立即发布</SubmitButton>
      </form>
    </PageFrame>
  )
}

export function SuggestPage() {
  const { user } = useAuth()
  const [form, setForm] = useState({ category: 'feature', body: '', contact: '' })
  const [state, setState] = useState({ busy: false, message: '', error: '' })
  async function submit(event) {
    event.preventDefault()
    setState({ busy: true, message: '', error: '' })
    try {
      const result = await api('/api/suggestions', { method: 'POST', body: form })
      setForm({ category: 'feature', body: '', contact: '' })
      setState({ busy: false, message: result.message, error: '' })
    } catch (err) { setState({ busy: false, message: '', error: err.message }) }
  }
  return (
    <PageFrame title="把建议送到负责人手里" intro="告诉我们希望网站增加什么、哪里不好用，或为什么希望加入。站长 QQ：3281895433。">
      {!user ? <EmptyState title="请先登录">为减少垃圾信息，建议接口只对已验证用户开放。<br /><Link className="button button--primary" to="/login">前往登录</Link></EmptyState> : (
        <form className="long-form" onSubmit={submit}>
          {state.message ? <Notice tone="success">{state.message}</Notice> : null}{state.error ? <Notice tone="error">{state.error}</Notice> : null}
          <FormField label="建议类型"><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="feature">希望增加功能</option><option value="experience">使用体验</option><option value="join_us">希望加入我们</option><option value="other">其他</option></select></FormField>
          <FormField label="详细说明"><textarea className="textarea-large" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} maxLength={3000} required /></FormField>
          <FormField label="可选联系方式" hint="不填也可以；请勿填写不必要的个人信息。"><input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} maxLength={100} /></FormField>
          <SubmitButton busy={state.busy}>提交建议</SubmitButton>
        </form>
      )}
    </PageFrame>
  )
}

export function PrivacyPage() {
  return (
    <PageFrame title="隐私与社区规则" intro="用最少的数据完成注册，用明确的流程保护公开内容。">
      <div className="policy-copy">
        <h2>我们收集什么</h2><p>普通账号保存邮箱、经过哈希处理的密码、在校生或毕业生身份与年级，以及你主动提交的内容。校园墙投票会保存账号与所选选项，用于保证每人一票；公开结果只展示汇总，不展示投票者。用户名、头像和简介由你自愿设置；不会要求真实姓名、身份证、手机号、住址或精确位置。</p>
        <h2>登录与保存期限</h2><p>登录凭证只保存在当前浏览器的 HttpOnly Cookie 中，并在 60 天后强制失效。密码不会明文保存。管理员申请中的资格信息在审核完成 30 天后自动清理。</p>
        <h2>哪些内容不会公开</h2><p>邮箱、管理员申请资料、建议中的可选联系方式和登录凭证都不会出现在公共页面。校园墙的“匿名”只对公共页面隐藏身份；管理员在违规处理时仍可确认提交账号。</p>
        <h2>私聊与管理</h2><p>私聊仅支持文字，会保存发送者、接收者、内容、发送及已读时间。其他普通用户不能浏览你与他人的会话；为处理骚扰和安全问题，超级管理员有权查阅、决定保留或删除私聊消息。删除的消息正文会被清除，管理操作留有审计记录。请勿在私聊发送敏感个人信息。</p>
        <h2>账号删除</h2><p>超级管理员删除账号时，会撤销登录权限、移除公开身份、清除该用户参与的私聊并归档其历史帖子；必要的管理审计归属仍以去标识方式保留。</p>
        <h2>内容边界</h2><p>不接受色情、血腥、违法、仇恨、侮辱国家与民族、针对个人的骚扰和鼓励伤害的内容。表达困难、寻求帮助和有事实依据的建设性批评不因“情绪负面”而自动被拒绝。</p>
        <h2>安全措施</h2><p>接口使用参数化数据库查询、CSRF 校验、来源校验、速率限制、文件类型魔数验证、分级权限、一次性邮件令牌和管理员审计记录。独立管理员地址仅用于减少暴露面，不替代身份与权限检查。</p>
      </div>
    </PageFrame>
  )
}

const sectionLabels = {
  '空间动态': ['moments', '01 / SIGNAL STREAM', '在这里，日常有了回声'],
  '校园墙': ['wall', '02 / OPEN WALL', '匿名也能被认真倾听'],
  '投稿广场': ['community', '03 / EDITORIAL', '让每一份表达被看见'],
  '你问，我答': ['qa', '04 / CONNECTION', '问题与答案，在此相遇'],
  '校园新闻': ['news', '05 / CAMPUS NOW', '记录正在发生的校园'],
  '把建议送到负责人手里': ['suggest', '06 / BUILD TOGETHER', '下一次更新，由你定义']
}

function PageFrame({ title, intro, action, section, children }) {
  const identity = sectionLabels[title]
  return (
    <div className="paper-page" data-section={section || identity?.[0] || 'inner'}>
      <header className="page-heading page-width"><div>{identity ? <span className="page-heading__eyebrow">{identity[1]}</span> : null}<h1>{title}</h1>{identity ? <strong className="page-heading__strapline">{identity[2]}</strong> : null}<p>{intro}</p></div>{action}<span className="page-heading__motif" aria-hidden="true" /></header>
      <div className="page-width page-content">{children}</div>
    </div>
  )
}

export { PageFrame }
