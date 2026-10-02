import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Radio } from 'lucide-react'

export function SignalConsole({ channels, counts, loading, error }) {
  const panelRef = useRef(null)
  const [activeKey, setActiveKey] = useState(null)
  const activeChannel = channels.find((channel) => channel.key === activeKey)

  function followPointer(event) {
    const panel = panelRef.current
    if (!panel || event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const bounds = panel.getBoundingClientRect()
    panel.style.setProperty('--glow-x', `${event.clientX - bounds.left}px`)
    panel.style.setProperty('--glow-y', `${event.clientY - bounds.top}px`)
  }

  function resetPointer() {
    const panel = panelRef.current
    if (!panel) return
    panel.style.removeProperty('--glow-x')
    panel.style.removeProperty('--glow-y')
    setActiveKey(null)
  }

  return (
    <section ref={panelRef} className="signal-console" aria-label="社区频道控制台" onPointerMove={followPointer} onPointerLeave={resetPointer}>
      <div className="signal-console__top">
        <div className="signal-console__title"><Radio size={18} aria-hidden="true" /><h2>社区信号台</h2></div>
        <span className="signal-console__status">{error ? '数据暂不可用' : loading ? '正在读取' : '频道已更新'}</span>
      </div>
      <div className="signal-console__display" aria-hidden="true">
        <div className="signal-console__sweep" />
        <div className="signal-console__orbit signal-console__orbit--outer" />
        <div className="signal-console__orbit signal-console__orbit--middle" />
        <div className="signal-console__orbit signal-console__orbit--inner" />
        <div className="signal-console__core" data-active={Boolean(activeChannel)}><span>{activeChannel?.label || 'HTYZ'}</span><small>{activeChannel ? '连接你与校园' : 'SPACE / COMMUNITY'}</small></div>
        <span className="signal-console__beacon signal-console__beacon--a" />
        <span className="signal-console__beacon signal-console__beacon--b" />
        <span className="signal-console__beacon signal-console__beacon--c" />
      </div>
      <div className="signal-console__channels">
        {channels.map(({ key, to, label, icon: Icon }) => {
          const count = key === 'suggestions' ? null : counts?.[key]
          return <Link className="console-channel" key={key} to={to} onPointerEnter={() => setActiveKey(key)} onFocus={() => setActiveKey(key)} onBlur={() => setActiveKey(null)}>
            <span className="console-channel__icon"><Icon size={18} aria-hidden="true" /></span>
            <span className="console-channel__copy"><strong>{label}</strong><small>{count === null ? '给站长留言' : loading ? '读取中' : count === undefined ? '查看频道' : `${count} 条已公开`}</small></span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        })}
      </div>
    </section>
  )
}
