import { Router } from 'express'
import { applyVideoMeta } from './content.js'
import rateLimit from 'express-rate-limit'
import { nowIso } from '../db.js'
import { parsePage, requireUser } from '../middleware.js'
import { readWallPolls } from '../polls.js'
import { ApiError, audit, cleanText, id } from '../security.js'

const postTypes = new Set(['moment', 'wall', 'contribution', 'question', 'answer', 'news'])
const authorPostTables = { moment: 'moments', wall: 'wall_posts', contribution: 'contributions', question: 'questions', answer: 'answers' }

function visiblePost(db, type, postId) {
  if (!postTypes.has(type)) return null
  if (type === 'moment') return db.prepare(`SELECT p.id, p.user_id FROM moments p JOIN users u ON u.id = p.user_id
    WHERE p.id = ? AND p.status = 'approved' AND u.status = 'active'`).get(postId)
  if (type === 'wall') return db.prepare(`SELECT p.id, p.user_id, p.is_anonymous FROM wall_posts p JOIN users u ON u.id = p.user_id
    WHERE p.id = ? AND p.status = 'approved' AND u.status = 'active'`).get(postId)
  if (type === 'contribution') return db.prepare("SELECT id, user_id FROM contributions WHERE id = ? AND status = 'approved'").get(postId)
  if (type === 'question') return db.prepare("SELECT id, user_id FROM questions WHERE id = ? AND status = 'approved'").get(postId)
  if (type === 'answer') return db.prepare(`SELECT a.id, a.user_id, a.question_id FROM answers a
    JOIN questions q ON q.id = a.question_id WHERE a.id = ? AND a.status = 'approved' AND q.status = 'approved'`).get(postId)
  return db.prepare("SELECT id, NULL AS user_id FROM news WHERE id = ? AND status = 'published'").get(postId)
}

function targetPath(type, postId) {
  return `/post/${type}/${encodeURIComponent(postId)}`
}

function engagement(db, type, postId, userId) {
  return {
    likes: db.prepare('SELECT COUNT(*) AS count FROM post_likes WHERE post_type = ? AND post_id = ?').get(type, postId).count,
    comments: db.prepare(`SELECT COUNT(*) AS count FROM post_comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_type = ? AND c.post_id = ? AND c.status = 'approved' AND u.status = 'active'`).get(type, postId).count,
    liked: Boolean(userId && db.prepare('SELECT 1 FROM post_likes WHERE post_type = ? AND post_id = ? AND user_id = ?').get(type, postId, userId))
  }
}

export function createEngagementRouter({ db }) {
  const router = Router()
  const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false })

  router.use('/public', requireUser)

  router.get('/public/posts/:type/:id', (req, res, next) => {
    const { type, id: postId } = req.params
    const post = visiblePost(db, type, postId)
    if (!post) return next(new ApiError(404, 'not_found', '内容不存在或已删除。'))
    if (type === 'news') {
      const row = db.prepare(`SELECT n.title, n.body, n.published_at,
        (SELECT v.id FROM post_videos v WHERE v.post_type = 'news' AND v.post_id = n.id) AS video_id, (SELECT v.status FROM post_videos v WHERE v.post_type = 'news' AND v.post_id = n.id) AS video_status, (SELECT v.poster_name FROM post_videos v WHERE v.post_type = 'news' AND v.post_id = n.id) AS video_poster, GROUP_CONCAT(i.id) AS image_ids
        FROM news n LEFT JOIN news_images i ON i.news_id = n.id
        WHERE n.id = ? GROUP BY n.id`).get(postId)
      const images = row.image_ids ? row.image_ids.split(',').filter(Boolean).map((imageId) => `/api/media/news/${imageId}`) : []
      return res.json({ ok: true, data: applyVideoMeta({ id: postId, type, title: row.title, body: row.body, publishedAt: row.published_at, images, video: row.video_id ? `/api/media/video/${row.video_id}` : null }, row) })
    }
    const tables = { moment: 'moments', wall: 'wall_posts', contribution: 'contributions', question: 'questions', answer: 'answers' }
    const row = db.prepare(`SELECT p.*, u.username, u.member_type, u.grade, u.avatar_storage_name FROM ${tables[type]} p
      JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(postId)
    const imageTables = { moment: ['moment_images', 'moment_id', 'moment'], wall: ['wall_images', 'wall_post_id', 'wall'], contribution: ['contribution_images', 'contribution_id', ''] }
    const imageTarget = imageTables[type]
    const images = imageTarget ? db.prepare(`SELECT id FROM ${imageTarget[0]} WHERE ${imageTarget[1]} = ? ORDER BY created_at ASC`).all(postId)
      .map((image) => imageTarget[2] ? `/api/media/${imageTarget[2]}/${image.id}` : `/api/media/${image.id}`) : []
    const anonymous = type === 'wall' && Boolean(row.is_anonymous)
    const videoRecord = ['moment', 'wall', 'contribution'].includes(type)
      ? db.prepare('SELECT id, status, poster_name FROM post_videos WHERE post_type = ? AND post_id = ?').get(type, postId)
      : null
    res.json({ ok: true, data: {
      id: postId, type, title: row.title || null, body: row.body, category: row.category || null,
      publishedAt: row.published_at, questionId: row.question_id || null, anonymous,
      poll: type === 'wall' ? readWallPolls(db, [postId], req.userSession.principal_id).get(postId) || null : null,
      author: anonymous ? null : { id: row.user_id, username: row.username || '社区成员', memberType: row.member_type, grade: row.grade,
        avatar: row.avatar_storage_name ? `/api/avatar/${row.user_id}` : null }, images,
      video: videoRecord ? `/api/media/video/${videoRecord.id}` : null,
      videoPoster: videoRecord?.poster_name ? `/api/media/poster/${videoRecord.id}` : null,
      videoStatus: videoRecord ? (videoRecord.status || 'ready') : null
    } })
  })

  router.get('/public/posts/:type/:id/engagement', (req, res, next) => {
    const post = visiblePost(db, req.params.type, req.params.id)
    if (!post) return next(new ApiError(404, 'not_found', '内容不存在或已删除。'))
    const owned = Boolean(post.user_id && post.user_id === req.userSession?.principal_id)
    res.json({ ok: true, data: { ...engagement(db, req.params.type, req.params.id, req.userSession?.principal_id), canDelete: owned, defaultAnonymous: req.params.type === 'wall' && owned && Boolean(post.is_anonymous) } })
  })

  router.delete('/posts/:type/:id', requireUser, writeLimiter, (req, res, next) => {
    const table = authorPostTables[req.params.type]
    if (!table) return next(new ApiError(403, 'author_delete_unavailable', '此内容不能通过普通账号删除。'))
    const post = visiblePost(db, req.params.type, req.params.id)
    if (!post) return next(new ApiError(404, 'not_found', '内容不存在或已删除。'))
    if (post.user_id !== req.userSession.principal_id) return next(new ApiError(403, 'not_owner', '只能删除自己发布的内容。'))
    const now = nowIso()
    db.transaction(() => {
      db.prepare(`UPDATE ${table} SET status = 'archived', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'approved'`)
        .run(now, post.id, req.userSession.principal_id)
      db.prepare('DELETE FROM notifications WHERE post_type = ? AND post_id = ?').run(req.params.type, post.id)
      audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'post_deleted_by_author', targetType: req.params.type, targetId: post.id })
    })()
    res.json({ ok: true, data: { id: post.id, status: 'archived', message: '帖子已删除，其他人将无法浏览。' } })
  })

  router.get('/public/posts/:type/:id/comments', (req, res, next) => {
    const post = visiblePost(db, req.params.type, req.params.id)
    if (!post) return next(new ApiError(404, 'not_found', '内容不存在或已删除。'))
    const page = parsePage(req)
    const { limit } = page
    let { offset } = page
    if (typeof req.query.focus === 'string') {
      const focused = db.prepare(`SELECT published_at FROM post_comments WHERE id = ? AND post_type = ? AND post_id = ? AND status = 'approved'`)
        .get(req.query.focus, req.params.type, req.params.id)
      if (focused) {
        const preceding = db.prepare(`SELECT COUNT(*) AS count FROM post_comments c JOIN users u ON u.id = c.user_id
          WHERE c.post_type = ? AND c.post_id = ? AND c.status = 'approved' AND u.status = 'active'
          AND (c.published_at < ? OR (c.published_at = ? AND c.id < ?))`)
          .get(req.params.type, req.params.id, focused.published_at, focused.published_at, req.query.focus).count
        offset = Math.max(0, preceding - 3)
      }
    }
    const items = db.prepare(`SELECT c.id, c.user_id, c.body, c.is_anonymous, c.published_at, c.parent_comment_id,
      u.username, u.member_type, u.grade, u.avatar_storage_name,
      parent.status AS parent_status, parent.user_id AS parent_user_id, parent.is_anonymous AS parent_anonymous,
      parent_user.username AS parent_username FROM post_comments c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN post_comments parent ON parent.id = c.parent_comment_id
      LEFT JOIN users parent_user ON parent_user.id = parent.user_id
      WHERE c.post_type = ? AND c.post_id = ? AND c.status = 'approved' AND u.status = 'active'
      ORDER BY c.published_at ASC, c.id ASC LIMIT ? OFFSET ?`).all(req.params.type, req.params.id, limit, offset)
      .map((row) => {
        const anonymous = Boolean(row.is_anonymous || (req.params.type === 'wall' && post.is_anonymous && post.user_id === row.user_id))
        return {
          id: row.id, body: row.body, publishedAt: row.published_at, anonymous,
          mine: req.userSession?.principal_id === row.user_id,
          replyTo: row.parent_comment_id ? {
            id: row.parent_comment_id,
            name: row.parent_status === 'approved'
              ? (row.parent_anonymous || (req.params.type === 'wall' && post.is_anonymous && post.user_id === row.parent_user_id)
                  ? '匿名同学' : (row.parent_username || '社区成员'))
              : '已删除的评论'
          } : null,
          author: anonymous ? null : { id: row.user_id, username: row.username || '社区成员', memberType: row.member_type, grade: row.grade,
            avatar: row.avatar_storage_name ? `/api/avatar/${row.user_id}` : null }
        }
      })
    const total = db.prepare(`SELECT COUNT(*) AS count FROM post_comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_type = ? AND c.post_id = ? AND c.status = 'approved' AND u.status = 'active'`).get(req.params.type, req.params.id).count
    res.json({ ok: true, data: { items, total, limit, offset } })
  })

  router.post('/posts/:type/:id/comments', requireUser, writeLimiter, (req, res, next) => {
    const post = visiblePost(db, req.params.type, req.params.id)
    if (!post) return next(new ApiError(404, 'not_found', '内容不存在或已删除。'))
    const body = cleanText(req.body.body, { min: 2, max: 1000 })
    if (!body) return next(new ApiError(422, 'comment_invalid', '评论需要 2–1000 个字符。'))
    const userId = req.userSession.principal_id
    const parentId = req.body.parentCommentId == null ? null : req.body.parentCommentId
    if (parentId !== null && (typeof parentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(parentId))) {
      return next(new ApiError(422, 'reply_target_invalid', '回复目标无效。'))
    }
    const parent = parentId ? db.prepare(`SELECT c.id, c.user_id FROM post_comments c JOIN users u ON u.id = c.user_id
      WHERE c.id = ? AND c.post_type = ? AND c.post_id = ? AND c.status = 'approved' AND u.status = 'active'`)
      .get(parentId, req.params.type, post.id) : null
    if (parentId && !parent) return next(new ApiError(422, 'reply_target_invalid', '回复目标不存在或已删除。'))
    const anonymous = req.params.type === 'wall' && (req.body.anonymous === true || Boolean(post.is_anonymous && post.user_id === userId))
    const commentId = id()
    const now = nowIso()
    db.transaction(() => {
      db.prepare(`INSERT INTO post_comments (id, post_type, post_id, user_id, body, is_anonymous, parent_comment_id, status, published_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`).run(commentId, req.params.type, post.id, userId, body, anonymous ? 1 : 0, parentId, now, now, now)
      const notify = (recipientId, eventKey) => {
        db.prepare(`INSERT INTO notifications
          (id, recipient_id, actor_id, kind, post_type, post_id, comment_id, is_anonymous, target_path, event_key, created_at)
          VALUES (?, ?, ?, 'comment', ?, ?, ?, ?, ?, ?, ?)`).run(
          id(), recipientId, userId, req.params.type, post.id, commentId, anonymous ? 1 : 0,
          `${targetPath(req.params.type, post.id)}#comment-${commentId}`, eventKey, now
        )
      }
      if (parent?.user_id && parent.user_id !== userId) notify(parent.user_id, `reply:${commentId}`)
      if (post.user_id && post.user_id !== userId && post.user_id !== parent?.user_id) notify(post.user_id, `comment:${commentId}`)
      audit(db, { actorType: 'user', actorId: userId, event: 'comment_published', targetType: 'comment', targetId: commentId })
    })()
    res.status(201).json({ ok: true, data: { id: commentId, message: '评论已发布。', ...engagement(db, req.params.type, post.id, userId) } })
  })

  router.delete('/comments/:id', requireUser, writeLimiter, (req, res, next) => {
    const comment = db.prepare("SELECT id, user_id, status FROM post_comments WHERE id = ?").get(req.params.id)
    if (!comment || comment.status !== 'approved') return next(new ApiError(404, 'not_found', '评论不存在或已删除。'))
    if (comment.user_id !== req.userSession.principal_id) return next(new ApiError(403, 'not_owner', '只能删除自己发表的评论。'))
    db.transaction(() => {
      db.prepare("UPDATE post_comments SET status = 'archived', updated_at = ? WHERE id = ?").run(nowIso(), comment.id)
      db.prepare('DELETE FROM notifications WHERE comment_id = ?').run(comment.id)
      audit(db, { actorType: 'user', actorId: comment.user_id, event: 'comment_deleted', targetType: 'comment', targetId: comment.id })
    })()
    res.json({ ok: true, data: { id: comment.id, status: 'archived' } })
  })

  router.put('/posts/:type/:id/like', requireUser, writeLimiter, (req, res, next) => {
    const post = visiblePost(db, req.params.type, req.params.id)
    if (!post) return next(new ApiError(404, 'not_found', '内容不存在或已删除。'))
    const userId = req.userSession.principal_id
    const now = nowIso()
    db.transaction(() => {
      const result = db.prepare('INSERT OR IGNORE INTO post_likes (post_type, post_id, user_id, created_at) VALUES (?, ?, ?, ?)')
        .run(req.params.type, post.id, userId, now)
      if (result.changes && post.user_id && post.user_id !== userId) {
        db.prepare(`INSERT OR IGNORE INTO notifications
          (id, recipient_id, actor_id, kind, post_type, post_id, is_anonymous, target_path, event_key, created_at)
          VALUES (?, ?, ?, 'like', ?, ?, 0, ?, ?, ?)`).run(
          id(), post.user_id, userId, req.params.type, post.id,
          targetPath(req.params.type, post.id), `like:${req.params.type}:${post.id}:${userId}`, now
        )
      }
    })()
    res.json({ ok: true, data: engagement(db, req.params.type, post.id, userId) })
  })

  router.delete('/posts/:type/:id/like', requireUser, writeLimiter, (req, res, next) => {
    const post = visiblePost(db, req.params.type, req.params.id)
    if (!post) return next(new ApiError(404, 'not_found', '内容不存在或已删除。'))
    db.prepare('DELETE FROM post_likes WHERE post_type = ? AND post_id = ? AND user_id = ?')
      .run(req.params.type, post.id, req.userSession.principal_id)
    res.json({ ok: true, data: engagement(db, req.params.type, post.id, req.userSession.principal_id) })
  })

  router.get('/notifications', requireUser, (req, res) => {
    const { limit, offset } = parsePage(req)
    const userId = req.userSession.principal_id
    const items = db.prepare(`SELECT n.id, n.kind, n.post_type, n.post_id, n.is_anonymous, n.target_path, n.event_key, n.read_at, n.created_at,
      u.username AS actor_name FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.recipient_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`).all(userId, limit, offset)
      .map((item) => ({ id: item.id, kind: item.kind, isReply: item.event_key.startsWith('reply:'), postType: item.post_type,
        actor: item.is_anonymous ? '匿名同学' : (item.actor_name || '社区成员'),
        path: item.target_path, readAt: item.read_at, createdAt: item.created_at }))
    const unread = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND read_at IS NULL').get(userId).count
    const total = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ?').get(userId).count
    res.json({ ok: true, data: { items, unread, total, limit, offset } })
  })

  router.get('/notifications/unread-count', requireUser, (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND read_at IS NULL').get(req.userSession.principal_id).count
    res.json({ ok: true, data: { count } })
  })

  router.post('/notifications/:id/read', requireUser, (req, res, next) => {
    const result = db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND recipient_id = ?')
      .run(nowIso(), req.params.id, req.userSession.principal_id)
    if (!result.changes) return next(new ApiError(404, 'not_found', '消息不存在。'))
    res.json({ ok: true, data: { id: req.params.id, read: true } })
  })

  router.post('/notifications/read-all', requireUser, (req, res) => {
    const result = db.prepare('UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL')
      .run(nowIso(), req.userSession.principal_id)
    res.json({ ok: true, data: { marked: result.changes } })
  })

  return router
}
