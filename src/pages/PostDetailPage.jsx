import { Link, useParams } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { useResource } from '../hooks.js'
import { PostEngagement } from '../components/PostEngagement.jsx'
import { LoadingState, Notice, formatDate } from '../components/UI.jsx'
import { PageFrame } from './PublicPages.jsx'
import { PostMedia } from '../components/PostMedia.jsx'
import { MemberIdentity } from '../components/MemberIdentity.jsx'
import { WallPoll } from '../components/WallPoll.jsx'

const channels = {
  moment: ['/moments', '空间动态'], wall: ['/wall', '校园墙'], contribution: ['/community', '投稿广场'],
  question: ['/qa', '你问我答'], answer: ['/qa', '你问我答'], news: ['/news', '校园新闻']
}

export function PostDetailPage() {
  const { type, id } = useParams()
  const { data, loading, error } = useResource(`/api/public/posts/${encodeURIComponent(type)}/${encodeURIComponent(id)}`)
  const channel = channels[type]
  return <PageFrame title={channel?.[1] || '社区内容'} intro="真实的分享与回应，留在同一个地方。">
    <div className="post-detail-back"><Link to={channel?.[0] || '/'}>返回{channel?.[1] || '社区'}</Link></div>
    {loading ? <LoadingState label="正在读取内容" /> : error ? <Notice tone="error">{error.message}</Notice> : <article className="post-detail">
      <div className="post-detail__author">{data.type === 'news' ? <strong>校园新闻</strong> : <MemberIdentity author={data.author} anonymous={data.anonymous} />}<time>{formatDate(data.publishedAt)}</time></div>
      {data.title ? <h2>{data.title}</h2> : null}
      {data.body ? <p className="preserve-lines">{data.body}</p> : null}
      {data.poll ? <WallPoll initialPoll={data.poll} /> : null}
      <PostMedia images={data.images} video={data.video} videoPoster={data.videoPoster} videoStatus={data.videoStatus} label={data.type === 'news' ? '校园新闻配图' : '帖子附图'} />
      {data.questionId ? <Link className="post-detail__question" to={`/qa?question=${encodeURIComponent(data.questionId)}`}>查看原问题与其他回答</Link> : null}
      <PostEngagement type={data.type} postId={data.id} />
    </article>}
  </PageFrame>
}
