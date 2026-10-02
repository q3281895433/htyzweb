import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ImagePlus, ShieldAlert } from 'lucide-react'
import { uploadForm } from '../api.js'
import { usePostAnchor, useResource } from '../hooks.js'
import { useAuth } from '../components/AuthContext.jsx'
import { EmptyState, FormField, LoadingState, Notice, SubmitButton, formatDate } from '../components/UI.jsx'
import { PageFrame } from './PublicPages.jsx'
import { PostEngagement } from '../components/PostEngagement.jsx'
import { MemberIdentity } from '../components/MemberIdentity.jsx'
import { PostMedia, UploadProgress, VideoPicker } from '../components/PostMedia.jsx'
import { PollComposer, WallPoll } from '../components/WallPoll.jsx'

export function MomentsPage() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useResource('/api/public/moments')
  usePostAnchor(Boolean(data))
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [video, setVideo] = useState(null)
  const [progress, setProgress] = useState(null)
  const [state, setState] = useState({ busy: false, message: '', error: '' })
  const summary = useMemo(() => files.length ? `${files.length} 张图片待上传` : '最多 9 张，每张不超过 6MB', [files])

  async function submit(event) {
    event.preventDefault()
    const payload = new FormData()
    payload.append('body', body)
    files.forEach((file) => payload.append('images', file))
    if (video) payload.append('video', video)
    setState({ busy: true, message: '', error: '' })
    setProgress(0)
    try {
      const result = await uploadForm('/api/moments', payload, setProgress)
      setBody(''); setFiles([]); setVideo(null); setState({ busy: false, message: result.message, error: '' }); reload()
    } catch (err) { setState({ busy: false, message: '', error: err.message }) } finally { setProgress(null) }
  }

  return (
    <PageFrame title="空间动态" intro="像 QQ 空间一样记录近况。动态提交后立即公开，邮箱和个人资料不会公开。">
      <div className="social-layout">
        <aside className="social-composer">
          <h2>发布动态</h2>
          {!user ? <><p>登录后可发布文字与图片。</p><Link className="button button--primary" to="/login">前往登录</Link></> : <form onSubmit={submit}>
            {state.message ? <Notice tone="success">{state.message}</Notice> : null}{state.error ? <Notice tone="error">{state.error}</Notice> : null}
            {!user.username ? <Notice tone="warning">建议先在“我的空间”设置用户名；未设置时公开显示“社区成员”。</Notice> : null}
            <FormField label="此刻想说"><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} placeholder="可以只发图片，也可以写下 1–2000 字。" /></FormField>
            <ImagePicker files={files} setFiles={setFiles} max={9} summary={summary} />
            <VideoPicker video={video} onChange={setVideo} /><UploadProgress value={progress} />
            <SubmitButton busy={state.busy}>发布动态</SubmitButton>
          </form>}
        </aside>
        <section className="social-feed">
          {loading ? <LoadingState /> : error ? <Notice tone="error">{error.message}</Notice> : data.items.length ? data.items.map((item) => <MomentCard key={item.id} item={item} onDeleted={reload} />) : <EmptyState title="还没有公开动态">这里不放示例用户和虚构内容。第一条真实动态会出现在这里。</EmptyState>}
        </section>
      </div>
    </PageFrame>
  )
}

export function WallPage() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useResource('/api/public/wall')
  usePostAnchor(Boolean(data))
  const [form, setForm] = useState({ body: '', anonymous: false })
  const [files, setFiles] = useState([])
  const [video, setVideo] = useState(null)
  const [progress, setProgress] = useState(null)
  const [state, setState] = useState({ busy: false, message: '', error: '' })
  const [composerMode, setComposerMode] = useState('post')

  async function submit(event) {
    event.preventDefault()
    const payload = new FormData()
    payload.append('body', form.body); payload.append('anonymous', String(form.anonymous))
    files.forEach((file) => payload.append('images', file))
    if (video) payload.append('video', video)
    setState({ busy: true, message: '', error: '' })
    setProgress(0)
    try {
      const result = await uploadForm('/api/wall', payload, setProgress)
      setForm({ body: '', anonymous: false }); setFiles([]); setVideo(null); setState({ busy: false, message: result.message, error: '' }); reload()
    } catch (err) { setState({ busy: false, message: '', error: err.message }) } finally { setProgress(null) }
  }

  return (
    <PageFrame title="校园墙" intro="可以选择前台匿名，适合提问、寻物、活动与校园生活分享；提交后立即公开。">
      <div className="social-layout">
        <aside className="social-composer">
          <h2>写到墙上</h2>
          {!user ? <><p>登录后才能提交，公开时可以隐藏身份。</p><Link className="button button--primary" to="/login">前往登录</Link></> : <>
            <div className="wall-composer-switch" aria-label="校园墙发布类型"><button type="button" aria-pressed={composerMode === 'post'} onClick={() => setComposerMode('post')}>发布内容</button><button type="button" aria-pressed={composerMode === 'poll'} onClick={() => setComposerMode('poll')}>发起投票</button></div>
            {composerMode === 'poll' ? <PollComposer onPublished={reload} /> : <form onSubmit={submit}>
            {state.message ? <Notice tone="success">{state.message}</Notice> : null}{state.error ? <Notice tone="error">{state.error}</Notice> : null}
            <FormField label="内容" hint="可只上传图片，无最低字数"><textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} maxLength={2000} /></FormField>
            <label className="check-row"><input type="checkbox" checked={form.anonymous} onChange={(event) => setForm({ ...form, anonymous: event.target.checked })} /><span>在公开校园墙上匿名显示</span></label>
            <ImagePicker files={files} setFiles={setFiles} max={9} summary={files.length ? `${files.length} 张图片待上传` : '可选，最多 9 张'} />
            <VideoPicker video={video} onChange={setVideo} /><UploadProgress value={progress} />
            <SubmitButton busy={state.busy}>发布到校园墙</SubmitButton>
          </form>}</>}
        </aside>
        <div className="wall-safety"><ShieldAlert aria-hidden="true" /><p><strong>匿名不等于无法追溯。</strong>公开页面不会显示你的账号；为处理欺凌、违法和安全问题，管理员处理违规内容时仍能确认提交账号。</p></div>
        <section className="wall-feed">
          {loading ? <LoadingState /> : error ? <Notice tone="error">{error.message}</Notice> : data.items.length ? data.items.map((item) => <WallCard key={item.id} item={item} onDeleted={reload} />) : <EmptyState title="校园墙暂时是空的">不伪造留言。真实内容会从这里开始。</EmptyState>}
        </section>
      </div>
    </PageFrame>
  )
}

export function ProfilePage() {
  const { username, userId } = useParams()
  const { data, loading, error, reload } = useResource(`/api/public/profiles/${encodeURIComponent(userId || username)}`)
  if (loading) return <PageFrame title="社区空间"><LoadingState /></PageFrame>
  if (error) return <PageFrame title="社区空间"><Notice tone="error">{error.message}</Notice></PageFrame>
  return <PageFrame title={data.profile.username} intro={data.profile.bio || '这个用户还没有填写个人简介。'}>
    <div className="profile-identity"><MemberIdentity author={data.profile} size="large" /><div><strong>{data.profile.memberType === 'graduate' ? '毕业生' : '在校生'}</strong><span>加入于 {formatDate(data.profile.joinedAt)}</span></div></div>
    <div className="social-feed profile-feed">{data.moments.length ? data.moments.map((item) => <MomentCard key={item.id} item={{ ...item, author: data.profile }} hideAuthor onDeleted={reload} />) : <EmptyState title="空间还没有公开动态">发布的动态会显示在这里。</EmptyState>}</div>
  </PageFrame>
}

function MomentCard({ item, hideAuthor = false, onDeleted }) {
  return <article id={`post-${item.id}`} className="moment-card">{!hideAuthor ? <div className="social-author"><div><MemberIdentity author={item.author} /><span>{formatDate(item.publishedAt)}</span></div></div> : <time>{formatDate(item.publishedAt)}</time>} {item.body ? <p className="preserve-lines">{item.body}</p> : null}<PostMedia images={item.images} video={item.video} videoPoster={item.videoPoster} videoStatus={item.videoStatus} label="动态附图" /><PostEngagement type="moment" postId={item.id} onDeleted={onDeleted} /></article>
}

function WallCard({ item, onDeleted }) {
  return <article id={`post-${item.id}`} className="wall-card"><div className="social-author"><div><MemberIdentity author={item.author} anonymous={item.anonymous} /><span>{formatDate(item.publishedAt)}</span></div></div>{item.body ? <p className="preserve-lines">{item.body}</p> : null}{item.poll ? <WallPoll initialPoll={item.poll} /> : null}<PostMedia images={item.images} video={item.video} videoPoster={item.videoPoster} videoStatus={item.videoStatus} label="校园墙附图" /><PostEngagement type="wall" postId={item.id} onDeleted={onDeleted} /></article>
}

function ImagePicker({ files, setFiles, max, summary }) {
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files])
  useEffect(() => () => previews.forEach((item) => URL.revokeObjectURL(item.url)), [previews])
  return <FormField label="图片" hint={summary}><label className="file-input"><ImagePlus aria-hidden="true" />选择图片<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, max))} /></label>{previews.length ? <div className="upload-previews">{previews.map((item) => <img key={item.url} src={item.url} alt="待上传预览" />)}</div> : null}</FormField>
}
