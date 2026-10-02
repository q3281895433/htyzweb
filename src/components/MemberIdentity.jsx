import { Link } from 'react-router-dom'
import { MessageCircle, UserRound } from 'lucide-react'
import { useAuth } from './AuthContext.jsx'

export function MemberIdentity({ author, anonymous = false, chat = true, size = '' }) {
  const { user } = useAuth()
  if (anonymous || !author) return <span className="member-identity"><span className={`avatar ${size ? `avatar--${size}` : ''}`}><UserRound aria-hidden="true" /></span><span>匿名同学</span></span>
  const profile = `/member/${encodeURIComponent(author.id)}`
  return <span className="member-identity"><Link className={`avatar ${size ? `avatar--${size}` : ''}`} to={profile} aria-label={`查看${author.username || '社区成员'}的主页`}>{author.avatar ? <img src={author.avatar} alt="" /> : <UserRound aria-hidden="true" />}</Link><Link className="member-identity__name" to={profile}>{author.username || '社区成员'}</Link>{author.grade ? <span className="grade-tag">{author.grade}</span> : null}{chat && user?.id !== author.id ? <Link className="member-identity__chat" to={`/chats/${encodeURIComponent(author.id)}`}><MessageCircle size={14} aria-hidden="true" />私聊</Link> : null}</span>
}
