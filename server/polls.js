export function readWallPolls(db, postIds, userId) {
  const pollsByPost = new Map()
  if (!postIds.length) return pollsByPost
  const placeholders = postIds.map(() => '?').join(',')
  const polls = db.prepare(`SELECT id, wall_post_id, question FROM wall_polls WHERE wall_post_id IN (${placeholders})`).all(...postIds)
  if (!polls.length) return pollsByPost
  const pollIds = polls.map((poll) => poll.id)
  const pollPlaceholders = pollIds.map(() => '?').join(',')
  const options = db.prepare(`SELECT id, poll_id, label FROM wall_poll_options WHERE poll_id IN (${pollPlaceholders}) ORDER BY position`).all(...pollIds)
  const myVotes = userId
    ? db.prepare(`SELECT poll_id, option_id FROM wall_poll_votes WHERE user_id = ? AND poll_id IN (${pollPlaceholders})`).all(userId, ...pollIds)
    : []
  const votedByPoll = new Map(myVotes.map((vote) => [vote.poll_id, vote.option_id]))
  const votedPollIds = [...votedByPoll.keys()]
  const counts = votedPollIds.length
    ? db.prepare(`SELECT poll_id, option_id, COUNT(*) AS votes FROM wall_poll_votes WHERE poll_id IN (${votedPollIds.map(() => '?').join(',')}) GROUP BY poll_id, option_id`).all(...votedPollIds)
    : []
  const countsByOption = new Map(counts.map((row) => [row.option_id, row.votes]))
  const totals = new Map()
  for (const row of counts) totals.set(row.poll_id, (totals.get(row.poll_id) || 0) + row.votes)
  for (const poll of polls) {
    const myOptionId = votedByPoll.get(poll.id) || null
    const totalVotes = totals.get(poll.id) || 0
    pollsByPost.set(poll.wall_post_id, {
      id: poll.id,
      question: poll.question,
      myOptionId,
      ...(myOptionId ? { totalVotes } : {}),
      options: options.filter((option) => option.poll_id === poll.id).map((option) => ({
        id: option.id,
        label: option.label,
        ...(myOptionId ? { votes: countsByOption.get(option.id) || 0, percent: Math.round(((countsByOption.get(option.id) || 0) / totalVotes) * 100) } : {})
      }))
    })
  }
  return pollsByPost
}
