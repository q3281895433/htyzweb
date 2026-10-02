import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { nowIso } from '../db.js'
import { parsePage, requireUser } from '../middleware.js'
import { ApiError, audit, cleanText, id } from '../security.js'

const personFields = 'id, username, grade, avatar_storage_name'

function publicPerson(person) {
  return { id: person.id, username: person.username || '社区成员', grade: person.grade, avatar: person.avatar_storage_name ? `/api/avatar/${person.id}` : null }
}

export function createChatRouter({ db }) {
  const router = Router()
  const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false })
  router.use('/public/users', requireUser)
  router.use('/chats', requireUser)

  router.get('/public/users', (req, res) => {
    const { limit, offset } = parsePage(req)
    const search = String(req.query.search || '').trim().slice(0, 40)
    const items = db.prepare(`SELECT ${personFields} FROM users
      WHERE status = 'active' AND grade IS NOT NULL AND id != ? AND (? = '' OR username LIKE ? ESCAPE '\\' OR grade LIKE ? ESCAPE '\\')
      ORDER BY COALESCE(username, email) COLLATE NOCASE LIMIT ? OFFSET ?`)
      .all(req.userSession.principal_id, search, `%${search.replace(/[\\%_]/g, '\\$&')}%`, `%${search.replace(/[\\%_]/g, '\\$&')}%`, limit, offset)
    res.json({ ok: true, data: { items: items.map(publicPerson), limit, offset } })
  })

  router.get('/chats/unread-count', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM direct_messages WHERE recipient_id = ? AND read_at IS NULL AND deleted_at IS NULL').get(req.userSession.principal_id).count
    res.json({ ok: true, data: { count } })
  })

  router.get('/chats', (req, res) => {
    const me = req.userSession.principal_id
    const items = db.prepare(`SELECT u.id, u.username, u.grade, u.avatar_storage_name,
      (SELECT body FROM direct_messages m WHERE ((m.sender_id = ? AND m.recipient_id = u.id) OR (m.sender_id = u.id AND m.recipient_id = ?)) AND m.deleted_at IS NULL ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
      (SELECT created_at FROM direct_messages m WHERE ((m.sender_id = ? AND m.recipient_id = u.id) OR (m.sender_id = u.id AND m.recipient_id = ?)) AND m.deleted_at IS NULL ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM direct_messages m WHERE m.sender_id = u.id AND m.recipient_id = ? AND m.read_at IS NULL AND m.deleted_at IS NULL) AS unread
      FROM users u WHERE u.status = 'active' AND u.id IN
      (SELECT sender_id FROM direct_messages WHERE recipient_id = ? UNION SELECT recipient_id FROM direct_messages WHERE sender_id = ?)
      ORDER BY last_at DESC LIMIT 50`).all(me, me, me, me, me, me, me)
    res.json({ ok: true, data: { items: items.map((row) => ({ person: publicPerson(row), lastBody: row.last_body, lastAt: row.last_at, unread: row.unread })) } })
  })

  router.get('/chats/:userId', (req, res, next) => {
    const me = req.userSession.principal_id
    const person = db.prepare(`SELECT ${personFields} FROM users WHERE id = ? AND status = 'active'`).get(req.params.userId)
    if (!person || person.id === me) return next(new ApiError(404, 'chat_unavailable', '找不到可以私聊的用户。'))
    const before = typeof req.query.before === 'string' ? req.query.before : null
    const items = db.prepare(`SELECT id, sender_id, recipient_id, body, created_at, read_at FROM direct_messages
      WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
      AND deleted_at IS NULL AND (? IS NULL OR created_at < ?)
      ORDER BY created_at DESC, id DESC LIMIT 50`).all(me, person.id, person.id, me, before, before).reverse()
    res.json({ ok: true, data: { person: publicPerson(person), items: items.map((row) => ({ id: row.id, mine: row.sender_id === me, body: row.body, sentAt: row.created_at, readAt: row.read_at })), hasMore: items.length === 50 } })
  })

  router.post('/chats/:userId/messages', writeLimiter, (req, res, next) => {
    const me = req.userSession.principal_id
    const recipient = db.prepare('SELECT id FROM users WHERE id = ? AND status = ?').get(req.params.userId, 'active')
    if (!recipient || recipient.id === me) return next(new ApiError(404, 'chat_unavailable', '找不到可以私聊的用户。'))
    const body = typeof req.body.body === 'string' ? cleanText(req.body.body, { min: 1, max: 2000 }) : null
    if (!body) return next(new ApiError(422, 'message_invalid', '私聊仅支持 1–2000 字文字。'))
    const messageId = id()
    const now = nowIso()
    db.prepare('INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(messageId, me, recipient.id, body, now)
    res.status(201).json({ ok: true, data: { id: messageId, mine: true, body, sentAt: now, readAt: null } })
  })

  router.post('/chats/:userId/read', (req, res) => {
    const now = nowIso()
    db.prepare('UPDATE direct_messages SET read_at = ? WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL AND deleted_at IS NULL')
      .run(now, req.params.userId, req.userSession.principal_id)
    res.json({ ok: true, data: { readAt: now } })
  })

  return router
}

export function createStaffChatRouter({ db }) {
  const router = Router()
  router.get('/', (req, res) => {
    const { limit, offset } = parsePage(req)
    const items = db.prepare(`SELECT m.sender_id AS a, m.recipient_id AS b,
      COUNT(*) AS total, MAX(m.created_at) AS last_at
      FROM direct_messages m WHERE m.deleted_at IS NULL GROUP BY MIN(m.sender_id, m.recipient_id), MAX(m.sender_id, m.recipient_id)
      ORDER BY last_at DESC LIMIT ? OFFSET ?`).all(limit + 1, offset)
    res.json({ ok: true, data: { items: items.slice(0, limit), limit, offset, hasMore: items.length > limit } })
  })

  router.get('/:a/:b', (req, res) => {
    const { limit, offset } = parsePage(req)
    const items = db.prepare(`SELECT m.id, m.body, m.created_at, m.read_at, m.reviewed_at,
      sender.id AS sender_id, sender.username AS sender_name, sender.email AS sender_email,
      recipient.id AS recipient_id, recipient.username AS recipient_name, recipient.email AS recipient_email
      FROM direct_messages m JOIN users sender ON sender.id = m.sender_id JOIN users recipient ON recipient.id = m.recipient_id
      WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)) AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`).all(req.params.a, req.params.b, req.params.b, req.params.a, limit + 1, offset)
    res.json({ ok: true, data: { items: items.slice(0, limit).reverse(), limit, offset, hasMore: items.length > limit } })
  })

  router.patch('/messages/:id/retain', (req, res, next) => {
    const now = nowIso()
    const result = db.prepare('UPDATE direct_messages SET reviewed_at = ?, reviewed_by = ? WHERE id = ? AND deleted_at IS NULL').run(now, req.staffSession.principal_id, req.params.id)
    if (!result.changes) return next(new ApiError(404, 'not_found', '消息不存在。'))
    audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'chat_message_retained', targetType: 'direct_message', targetId: req.params.id })
    res.json({ ok: true, data: { id: req.params.id, reviewedAt: now } })
  })

  router.delete('/messages/:id', (req, res, next) => {
    const now = nowIso()
    const result = db.prepare('UPDATE direct_messages SET body = ?, deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
      .run('', now, req.staffSession.principal_id, req.params.id)
    if (!result.changes) return next(new ApiError(404, 'not_found', '消息不存在或已删除。'))
    audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'chat_message_deleted', targetType: 'direct_message', targetId: req.params.id })
    res.json({ ok: true, data: { id: req.params.id, deleted: true } })
  })
  return router
}
