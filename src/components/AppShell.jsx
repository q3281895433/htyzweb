import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowUpRight, Bell, LogOut, MessageCircle } from 'lucide-react'
import { useAuth } from './AuthContext.jsx'
import { CompleteGrade } from './MemberGate.jsx'

const navItems = [
  ['/news', '新闻'],
  ['/wall', '校园墙'],
  ['/community', '投稿'],
  ['/moments', '空间动态'],
  ['/qa', '问答'],
  ['/suggest', '建议'],
  ['/users', '用户']
]

export function AppShell() {
  const location = useLocation()
  const navRef = useRef(null)
  const { user, loading, logout, unreadCount, chatUnreadCount, refresh } = useAuth()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    const nav = navRef.current
    const active = nav?.querySelector('a.active')
    if (nav && active && nav.scrollWidth > nav.clientWidth) {
      nav.scrollTo({ left: active.offsetLeft - (nav.clientWidth - active.clientWidth) / 2, behavior: 'smooth' })
    }
  }, [location.pathname])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">跳到正文</a>
      <header className="site-header">
        <div className="site-header__identity">
          <Link className="brand" to="/" aria-label="会同一中学生社区中心首页">
            <span className="brand__signal" aria-hidden="true" />
            <span>会同一中学生社区中心</span>
          </Link>
          <span className="brand-domain">HTYZ.SPACE</span>
        </div>
        <nav ref={navRef} className="site-nav" aria-label="社区栏目">
          {navItems.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        </nav>
        <div className="header-actions">
          {!loading && user ? (
            <>
              <Link className="header-notifications" to="/notifications" aria-label={`消息通知，${unreadCount} 条未读`}><Bell size={18} aria-hidden="true" />{unreadCount ? <span>{unreadCount > 99 ? '99+' : unreadCount}</span> : null}</Link>
              <Link className="header-notifications" to="/chats" aria-label={`私聊，${chatUnreadCount} 条未读`}><MessageCircle size={18} aria-hidden="true" />{chatUnreadCount ? <span>{chatUnreadCount > 99 ? '99+' : chatUnreadCount}</span> : null}</Link>
              <Link className="text-action" to="/me" aria-label="我的空间">我的</Link>
              <button className="header-logout" type="button" onClick={() => logout()} aria-label="退出登录"><LogOut size={17} aria-hidden="true" /></button>
            </>
          ) : (
            <Link className="button button--compact" to="/login">登录 / 注册 <ArrowUpRight size={15} /></Link>
          )}
        </div>
      </header>
      <main id="main"><div className="route-stage" key={location.pathname}>{user && !user.grade ? <CompleteGrade user={user} refresh={refresh} /> : <Outlet />}</div></main>
      <footer className="site-footer">
        <div><strong>会同一中学生社区中心</strong><p>htyz.space · 在校生与毕业生交流社区</p></div>
        <div className="footer-links">
          <Link to="/privacy">隐私与社区规则</Link>
          <span>站长 QQ 3281895433</span>
        </div>
      </footer>
    </div>
  )
}
