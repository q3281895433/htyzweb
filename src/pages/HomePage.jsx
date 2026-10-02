import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CircleUserRound, MessageCircleQuestion, Newspaper, Pause, PenLine, Play, Send, Sparkles } from 'lucide-react'
import { useResource } from '../hooks.js'
import { EmptyState, LoadingState, Notice, formatDate } from '../components/UI.jsx'
import { SignalField } from '../components/SignalField.jsx'
import { SignalConsole } from '../components/SignalConsole.jsx'
import { PostMedia } from '../components/PostMedia.jsx'

const channels = [
  { key: 'news', to: '/news', label: '校园新闻', icon: Newspaper },
  { key: 'wall', to: '/wall', label: '校园墙', icon: Sparkles },
  { key: 'contributions', to: '/community', label: '投稿广场', icon: PenLine },
  { key: 'moments', to: '/moments', label: '空间动态', icon: CircleUserRound },
  { key: 'questions', to: '/qa', label: '你问我答', icon: MessageCircleQuestion },
  { key: 'suggestions', to: '/suggest', label: '给站长建议', icon: Send }
]

export function HomePage() {
  const { data, loading, error } = useResource('/api/public/home')
  const registeredUsers = useAnimatedNumber(data?.counts?.users || 0)
  const heroRef = useRef(null)
  const [motionEnabled, setMotionEnabled] = useState(() => {
    try { return localStorage.getItem('htyz-motion') !== 'off' } catch { return true }
  })
  const [reducedMotion, setReducedMotion] = useState(false)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(preference.matches)
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    let inView = true
    const update = () => setVisible(inView && !document.hidden)
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update() })
    observer.observe(heroRef.current)
    document.addEventListener('visibilitychange', update)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [])

  function toggleMotion() {
    const next = !motionEnabled
    setMotionEnabled(next)
    try { localStorage.setItem('htyz-motion', next ? 'on' : 'off') } catch {}
  }

  return (
    <>
      <section ref={heroRef} className="signal-hero" data-playing={motionEnabled && !reducedMotion && visible} data-motion={motionEnabled && !reducedMotion ? 'on' : 'off'}>
        <SignalField enabled={motionEnabled && !reducedMotion} />
        <div className="signal-hero__wash" aria-hidden="true" />
        <div className="signal-hero__beam" aria-hidden="true" />
        <div className="signal-hero__aurora" aria-hidden="true"><i /><i /></div>
        <div className="signal-hero__copy">
          <h1>让校园里的<br /><span>每束信号相遇。</span></h1>
          <p>这里属于会同一中的在校生与毕业生。认真投稿，诚实提问，把真正有用的经验留给下一位同学。</p>
          <div className="hero-actions">
            <Link className="button button--light" to="/submit">开始投稿 <ArrowRight size={17} /></Link>
            <Link className="text-link text-link--light" to="/privacy">先看社区规则</Link>
          </div>
          <div className="registered-counter" aria-label={loading ? '正在读取社区人数' : error ? '社区人数暂不可用' : `${data.counts.users} 位社区成员`}><strong aria-hidden="true">{loading || error ? '—' : registeredUsers.toLocaleString('zh-CN')}</strong><span aria-hidden="true">位社区成员</span></div>
        </div>
        <SignalConsole channels={channels} counts={data?.counts} loading={loading} error={error} />
        <div className="signal-hero__foot"><span>轻触空白处，让信号扩散</span><button className="motion-toggle" type="button" aria-pressed={motionEnabled && !reducedMotion} disabled={reducedMotion} onClick={toggleMotion}>{motionEnabled && !reducedMotion ? <Pause size={13} /> : <Play size={13} />}{reducedMotion ? '已按系统设置关闭动效' : motionEnabled ? '暂停粒子效果' : '开启粒子效果'}</button></div>
      </section>

      <section className="latest-section page-width">
        <div className="section-intro">
          <h2>社区此刻</h2>
          <p>以下内容全部来自社区成员公开的真实记录。数据库为空时，我们宁愿诚实地留白。</p>
        </div>
        {loading ? <LoadingState /> : error ? <Notice tone="error">{error.message}</Notice> : (
          <div className="latest-grid">
            <LatestPanel title="最新投稿" to="/community" item={data.contribution} empty="还没有公开投稿">
              {(item) => <><h3>{item.title}</h3><p>{item.body}</p><time>{formatDate(item.publishedAt)}</time></>}
            </LatestPanel>
            <LatestPanel title="校园新闻" to="/news" item={data.news} empty="还没有校园新闻">
              {(item) => <>{item.images?.length ? <PostMedia images={item.images.slice(0, 1)} label="校园新闻配图" /> : null}<h3>{item.title}</h3><p>{item.body}</p><time>{formatDate(item.published_at)}</time></>}
            </LatestPanel>
            <LatestPanel title="最新问题" to="/qa" item={data.question} empty="还没有公开问题">
              {(item) => <><h3>{item.title}</h3><p>{item.body}</p><time>{item.answer_count} 个回答 · {formatDate(item.published_at)}</time></>}
            </LatestPanel>
          </div>
        )}
      </section>

      <section className="principles-section">
        <div className="page-width principles-layout">
          <h2>自由表达，<br />也认真守护。</h2>
          <div className="principle-lines">
            <p><strong>只收必要信息。</strong><span>普通账号只需要邮箱、密码、身份类型和年级。</span></p>
            <p><strong>发布后仍可处理。</strong><span>内容提交后立即公开；管理员能删除违规帖子、封禁违规账号，所有操作留有记录。</span></p>
            <p><strong>反对伤害，不压住求助。</strong><span>色情、血腥、仇恨与违法内容不被接受；诚恳的困难表达和建设性批评不会被简单归为“负能量”。</span></p>
          </div>
        </div>
      </section>
    </>
  )
}

function useAnimatedNumber(target) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setValue(target); return undefined }
    let frame
    const start = performance.now()
    const duration = 780
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1)
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 4))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])
  return value
}

function LatestPanel({ title, to, item, empty, children }) {
  return (
    <article className="latest-panel">
      <div className="latest-panel__head"><span>{title}</span><Link to={to}>查看全部 <ArrowRight size={15} /></Link></div>
      {item ? <div className="latest-panel__body">{children(item)}</div> : (
        <EmptyState title={empty}>第一条真实内容发布后会出现在这里。</EmptyState>
      )}
    </article>
  )
}
