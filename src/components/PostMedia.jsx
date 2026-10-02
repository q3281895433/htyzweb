import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../api.js'

/**
 * 帖子媒体区（图片 + 视频）
 *
 * 视频处理的三个状态：
 *   processing —— 服务器正在自动转码（大疆等 HEVC 素材），显示封面 + 进度提示，
 *                 并轮询状态接口，完成后自动变为可播放，用户无需刷新页面
 *   ready      —— 可播放。显示封面，点击后才加载视频本体（列表页因此很轻）
 *   failed     —— 转码失败，显示可读原因（而不是让 <video> 报「格式错误」）
 */
export function PostMedia({ images = [], video, videoPoster, videoStatus, label = '帖子附图' }) {
  const [selected, setSelected] = useState(null)
  const [status, setStatus] = useState(videoStatus || (video ? 'ready' : null))
  const [poster, setPoster] = useState(videoPoster || null)
  const [playing, setPlaying] = useState(false)
  const [mediaError, setMediaError] = useState(null)
  const dialog = useRef(null)

  useEffect(() => {
    if (selected !== null) dialog.current?.showModal()
    else dialog.current?.close()
  }, [selected])
  useEffect(() => () => dialog.current?.close(), [])

  // 视频处理中时轮询状态，完成后自动切换为可播放
  useEffect(() => {
    if (!video) return undefined
    if (status !== 'processing') return undefined

    const id = String(video).split('/').pop()
    let stopped = false
    let timer = null
    let attempts = 0

    const poll = async () => {
      attempts += 1
      try {
        const data = await api(`/api/media/video/${id}/status`)
        if (stopped) return
        if (data.status && data.status !== 'processing') {
          setStatus(data.status)
          if (data.hasPoster) setPoster(`/api/media/poster/${id}`)
          return // 停止轮询
        }
        if (!poster && data.hasPoster) setPoster(`/api/media/poster/${id}`)
      } catch {
        // 网络波动忽略，继续轮询
      }
      if (stopped) return
      // 前 30 秒每 3 秒一次，之后放慢到每 10 秒，最多约 10 分钟
      if (attempts < 120) timer = setTimeout(poll, attempts < 10 ? 3000 : 10000)
    }
    timer = setTimeout(poll, 3000)

    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [video, status, poster])

  /** 依据错误类型给出可操作提示，替代浏览器原生的「格式错误」 */
  const describeError = (event) => {
    const el = event?.currentTarget || event?.target
    const code = el?.error?.code
    if (code === 4) {
      return '视频无法播放。可能是浏览器不支持该编码，或文件已损坏。请联系发布者重新上传。'
    }
    if (code === 2) return '视频加载中断，请检查网络后重试。'
    if (code === 3) return '视频解码失败，文件可能不完整。请联系发布者重新上传。'
    return '视频加载失败，请稍后重试。'
  }

  if (!images.length && !video) return null

  const posterUrl = poster || undefined

  /**
   * 点击播放前先探测可用性。
   *
   * 为什么需要：帖子被作者删除（archived）后，视频与封面接口都会返回 404，
   * 但帖子对象若仍在页面缓存中，点开会得到一个「点不动的播放器」——
   * <video> 对 404 只报笼统的解码错误，用户看不懂。
   * 一次 HEAD 探测就能给出准确提示。
   */
  const startPlayback = async () => {
    try {
      const response = await fetch(video, { method: 'HEAD', credentials: 'same-origin' })
      if (response.status === 404) {
        setMediaError('这段视频已不可访问（帖子可能已被删除）。')
        return
      }
      if (response.status === 401) {
        setMediaError('该视频需要登录后观看。')
        return
      }
      if (response.status === 409) {
        setStatus('processing')
        return
      }
      if (response.status === 422) {
        setStatus('failed')
        return
      }
    } catch {
      // 探测失败不阻断播放尝试（可能是网络抖动），交给 <video> 的 onError 兜底
    }
    setPlaying(true)
  }

  return <div className="post-media">
    {images.length ? <div className={`post-media__images post-media__images--${Math.min(images.length, 3)}`}>{images.map((src, index) => <button type="button" key={src} aria-label={`查看第 ${index + 1} 张图片`} onClick={() => setSelected(index)}><img src={src} alt={`${label} ${index + 1}`} loading="lazy" /></button>)}</div> : null}

    {video ? <div className="post-video">
      {status === 'failed' ? <div className="post-video__notice post-video__notice--error" role="alert">
        <strong>视频处理失败</strong>
        <span>这段视频服务器无法自动转换（多为大疆等设备的 H.265 格式）。请联系发布者重新上传。</span>
      </div> : null}

      {status === 'processing' ? <div className="post-video__frame">
        {posterUrl ? <img className="post-video__poster" src={posterUrl} alt="视频封面" loading="lazy" /> : <div className="post-video__poster post-video__poster--empty" aria-hidden="true" />}
        <div className="post-video__badge"><span className="post-video__spinner" aria-hidden="true" />视频处理中，稍后自动可播</div>
      </div> : null}

      {status !== 'processing' && status !== 'failed' ? (playing ? <video
        className="post-media__video"
        src={video}
        poster={posterUrl}
        controls
        autoPlay
        preload="auto"
        playsInline
        aria-label="帖子视频"
        onError={(event) => setMediaError(describeError(event))}
      /> : <button type="button" className="post-video__frame post-video__frame--clickable" onClick={startPlayback} aria-label="播放视频">
        {posterUrl ? <img className="post-video__poster" src={posterUrl} alt="视频封面" loading="lazy" /> : <div className="post-video__poster post-video__poster--empty" aria-hidden="true" />}
        <span className="post-video__play" aria-hidden="true">▶</span>
      </button>) : null}

      {mediaError ? <div className="post-video__notice post-video__notice--error" role="alert">{mediaError}</div> : null}
    </div> : null}

    <dialog ref={dialog} className="media-viewer" onClose={() => setSelected(null)} onClick={(event) => { if (event.target === dialog.current) setSelected(null) }}>
      <button className="media-viewer__close" type="button" onClick={() => setSelected(null)} aria-label="关闭图片查看"><X size={20} /></button>
      {selected !== null ? <img src={images[selected]} alt={`${label} ${selected + 1}`} /> : null}
      {images.length > 1 ? <div className="media-viewer__controls"><button type="button" onClick={() => setSelected((selected - 1 + images.length) % images.length)}>上一张</button><span>{selected + 1} / {images.length}</span><button type="button" onClick={() => setSelected((selected + 1) % images.length)}>下一张</button></div> : null}
    </dialog>
  </div>
}

export function VideoPicker({ video, onChange }) {
  return <div className="video-picker"><label className="file-input">选择视频<input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => onChange(event.target.files?.[0] || null)} /></label><small>可选，最大 50MB；每帖 1 个视频。上传后服务器会自动转成浏览器可直接播放的格式（大疆等 H.265 素材也支持），无需自行转换。</small>{video ? <span>{video.name} · {(video.size / 1024 / 1024).toFixed(1)} MB <button type="button" onClick={() => onChange(null)}>移除</button></span> : null}</div>
}

export function UploadProgress({ value }) {
  return value === null ? null : <div className="upload-progress" role="status"><span>{value === 100 ? '上传完成，正在提交…' : `上传中 · ${value}%`}</span><progress max="100" value={value} /></div>
}
