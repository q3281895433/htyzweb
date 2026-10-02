import { useEffect, useState } from 'react'
import { BarChart3, Check, Plus, Trash2 } from 'lucide-react'
import { api } from '../api.js'
import { Notice, SubmitButton } from './UI.jsx'

export function PollComposer({ onPublished }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [anonymous, setAnonymous] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function updateOption(index, value) {
    setOptions((current) => current.map((option, position) => position === index ? value : option))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api('/api/wall/polls', { method: 'POST', body: { question, options, anonymous } })
      setQuestion(''); setOptions(['', '']); setAnonymous(false); setMessage(result.message)
      onPublished?.()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return <form className="poll-composer" onSubmit={submit}>
    {message ? <Notice tone="success">{message}</Notice> : null}{error ? <Notice tone="error">{error}</Notice> : null}
    <label className="field"><span className="field__label">投票问题</span><input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={120} required placeholder="想听听大家的选择？" /></label>
    <div className="poll-composer__choices">
      <span className="field__label">选项 <small>单选 · 2–8 项</small></span>
      {options.map((option, index) => <div className="poll-composer__choice" key={index}>
        <span aria-hidden="true">{index + 1}</span>
        <input aria-label={`选项 ${index + 1}`} value={option} onChange={(event) => updateOption(index, event.target.value)} maxLength={80} required placeholder={`选项 ${index + 1}`} />
        {options.length > 2 ? <button type="button" className="poll-composer__remove" aria-label={`删除选项 ${index + 1}`} onClick={() => setOptions((current) => current.filter((_, position) => position !== index))}><Trash2 size={17} aria-hidden="true" /></button> : null}
      </div>)}
      {options.length < 8 ? <button className="poll-composer__add" type="button" onClick={() => setOptions((current) => [...current, ''])}><Plus size={17} aria-hidden="true" /> 添加选项</button> : null}
    </div>
    <label className="check-row"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /><span>在公开校园墙上匿名显示</span></label>
    <p className="poll-composer__hint">每人仅能投一票，提交后不能更改。投票前不显示票数和比例。</p>
    <SubmitButton busy={busy}>发起投票</SubmitButton>
  </form>
}

export function WallPoll({ initialPoll }) {
  const [poll, setPoll] = useState(initialPoll)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setPoll(initialPoll), [initialPoll])
  const hasVoted = Boolean(poll.myOptionId)

  async function vote(optionId) {
    if (busy || hasVoted) return
    setBusy(true); setError('')
    try {
      const result = await api(`/api/wall/polls/${encodeURIComponent(poll.id)}/votes`, { method: 'POST', body: { optionId } })
      setPoll(result.poll)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return <section className={`wall-poll ${hasVoted ? 'wall-poll--voted' : ''}`} aria-label={`投票：${poll.question}`}>
    <div className="wall-poll__heading"><BarChart3 size={18} aria-hidden="true" /><span>校园墙投票</span></div>
    <h3>{poll.question}</h3>
    <div className="wall-poll__options">
      {poll.options.map((option) => hasVoted
        ? <div className={`wall-poll__result ${poll.myOptionId === option.id ? 'wall-poll__result--mine' : ''}`} key={option.id}>
          <span className="wall-poll__fill" style={{ '--poll-scale': option.percent / 100 }} aria-hidden="true" />
          <span className="wall-poll__label">{poll.myOptionId === option.id ? <Check size={17} aria-hidden="true" /> : null}{option.label}</span>
          <strong>{option.votes} 票 · {option.percent}%</strong>
        </div>
        : <button className="wall-poll__option" type="button" key={option.id} disabled={busy} onClick={() => vote(option.id)}>
          <span className="wall-poll__radio" aria-hidden="true" /><span>{option.label}</span>
        </button>)}
    </div>
    <div className="wall-poll__footer" role="status">{hasVoted ? `共 ${poll.totalVotes} 票 · 已选择` : busy ? '正在提交你的选择…' : '选择一个选项后可查看结果'}</div>
    {error ? <p className="wall-poll__error" role="alert">{error}</p> : null}
  </section>
}
