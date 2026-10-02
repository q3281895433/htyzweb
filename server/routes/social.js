import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { nowIso } from '../db.js'
import { ApiError, audit, cleanText, id, validGrade } from '../security.js'
import { parsePage, requireUser } from '../middleware.js'
import { readWallPolls } from '../polls.js'
import { checkedImage, checkedPostImage, checkedVideo, cleanupUploadTemps, imageUpload, limitPostBody, postMediaUpload, moveImages, removeFiles } from '../uploads.js'
import { queueVideo } from '../video-worker.js'
import { applyVideoMeta } from './content.js'

function checkedFiles(files) {
  return (files || []).map(checkedImage)
}

export function createSocialRouter({ db, config }) {
  const router = Router()
  const postUpload = postMediaUpload(config)
  const avatarUpload = imageUpload(config, { maxMb: Math.min(config.uploadMaxMb, 4), files: 1, fields: 2 })
  const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false })

  router.patch('/me/profile', requireUser, writeLimiter, (req, res, next) => {
    const username = cleanText(req.body.username, { min: 2, max: 20 })
    const bio = req.body.bio ? cleanText(req.body.bio, { min: 1, max: 160 }) : null
    if (!username || !/^[\p{Script=Han}A-Za-z0-9_-]+$/u.test(username)) {
      return next(new ApiError(422, 'username_invalid', '用户名需为 2–20 位中文、字母、数字、下划线或短横线。'))
    }
    if (/^(admin|administrator|官方|管理员|htyzslowsnow)$/i.test(username)) {
      return next(new ApiError(422, 'username_reserved', '这个用户名为系统保留名称，请换一个。'))
    }
    const grade = req.body.grade ?? req.userSession.grade
    if (!validGrade(req.userSession.member_type, grade)) return next(new ApiError(422, 'grade_invalid', '请选择与你身份相符的年级或状态。'))
    try {
      const result = db.prepare('UPDATE users SET username = ?, bio = ?, grade = ?, updated_at = ? WHERE id = ?')
        .run(username, bio, grade, nowIso(), req.userSession.principal_id)
      if (!result.changes) return next(new ApiError(404, 'not_found', '用户不存在。'))
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new ApiError(409, 'username_taken', '这个用户名已被使用。'))
      return next(error)
    }
    audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'profile_updated', targetType: 'user', targetId: req.userSession.principal_id })
    res.json({ ok: true, data: { username, bio, grade, message: '个人资料已更新。' } })
  })

  router.patch('/me/grade', requireUser, writeLimiter, (req, res, next) => {
    if (!validGrade(req.userSession.member_type, req.body.grade)) return next(new ApiError(422, 'grade_invalid', '请选择与你身份相符的年级或状态。'))
    db.prepare('UPDATE users SET grade = ?, updated_at = ? WHERE id = ?').run(req.body.grade, nowIso(), req.userSession.principal_id)
    audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'grade_updated', targetType: 'user', targetId: req.userSession.principal_id })
    res.json({ ok: true, data: { grade: req.body.grade } })
  })

  router.post('/me/avatar', requireUser, writeLimiter, avatarUpload.single('avatar'), cleanupUploadTemps, (req, res, next) => {
    if (!req.file) return next(new ApiError(422, 'avatar_required', '请选择一张头像图片。'))
    let file
    try { [file] = checkedFiles([req.file]) } catch (error) { return next(error) }
    const previous = db.prepare('SELECT avatar_storage_name FROM users WHERE id = ?').get(req.userSession.principal_id)
    const written = moveImages(config, [file])
    try {
      db.prepare(`UPDATE users SET avatar_storage_name = ?, avatar_mime_type = ?, avatar_byte_size = ?, updated_at = ? WHERE id = ?`)
        .run(file.storageName, file.mime, file.byteSize, nowIso(), req.userSession.principal_id)
    } catch (error) {
      removeFiles(written)
      return next(error)
    }
    if (previous?.avatar_storage_name) removeFiles([path.join(config.uploadDir, previous.avatar_storage_name)])
    audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'avatar_updated', targetType: 'user', targetId: req.userSession.principal_id })
    res.json({ ok: true, data: { avatar: `/api/avatar/${req.userSession.principal_id}`, message: '头像已更新。' } })
  })

  router.get('/avatar/:userId', (req, res, next) => {
    const user = db.prepare(`SELECT id, status, avatar_storage_name, avatar_mime_type FROM users WHERE id = ?`).get(req.params.userId)
    if (!user?.avatar_storage_name || user.status !== 'active') return next(new ApiError(404, 'not_found', '头像不存在。'))
    res.set({ 'Content-Type': user.avatar_mime_type, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' })
    res.sendFile(path.join(config.uploadDir, user.avatar_storage_name))
  })

  router.use('/public', requireUser)

  router.get('/public/moments', (req, res) => {
    const { limit, offset } = parsePage(req)
    const rows = db.prepare(`SELECT m.*, u.id AS user_public_id, u.username, u.member_type, u.grade, u.avatar_storage_name,
      (SELECT v.id FROM post_videos v WHERE v.post_type = 'moment' AND v.post_id = m.id) AS video_id, (SELECT v.status FROM post_videos v WHERE v.post_type = 'moment' AND v.post_id = m.id) AS video_status, (SELECT v.poster_name FROM post_videos v WHERE v.post_type = 'moment' AND v.post_id = m.id) AS video_poster, GROUP_CONCAT(mi.id) AS image_ids
      FROM moments m JOIN users u ON u.id = m.user_id
      LEFT JOIN moment_images mi ON mi.moment_id = m.id
      WHERE m.status = 'approved' AND u.status = 'active'
      GROUP BY m.id ORDER BY m.published_at DESC LIMIT ? OFFSET ?`).all(limit, offset)
      .map((row) => ({ ...row, id: row.id, avatar_storage_name: row.avatar_storage_name, user_id: row.user_public_id }))
    res.json({ ok: true, data: { items: rows.map((row) => ({
      id: row.id,
      body: row.body,
      publishedAt: row.published_at,
      author: { id: row.user_public_id, username: row.username || '社区成员', memberType: row.member_type, grade: row.grade, avatar: row.avatar_storage_name ? `/api/avatar/${row.user_public_id}` : null },
      images: row.image_ids ? row.image_ids.split(',').filter(Boolean).map((imageId) => `/api/media/moment/${imageId}`) : [],
      video: row.video_id ? `/api/media/video/${row.video_id}` : null
    })).map((obj, i) => applyVideoMeta(obj, rows[i])), limit, offset } })
  })

  router.get('/public/profiles/:username', (req, res, next) => {
    const user = db.prepare(`SELECT id, username, bio, member_type, grade, created_at, avatar_storage_name
      FROM users WHERE (username = ? COLLATE NOCASE OR id = ?) AND status = 'active'`).get(req.params.username, req.params.username)
    if (!user) return next(new ApiError(404, 'not_found', '没有找到这个社区空间。'))
    const rows = db.prepare(`SELECT m.*, (SELECT v.id FROM post_videos v WHERE v.post_type = 'moment' AND v.post_id = m.id) AS video_id, (SELECT v.status FROM post_videos v WHERE v.post_type = 'moment' AND v.post_id = m.id) AS video_status, (SELECT v.poster_name FROM post_videos v WHERE v.post_type = 'moment' AND v.post_id = m.id) AS video_poster, GROUP_CONCAT(mi.id) AS image_ids FROM moments m
      LEFT JOIN moment_images mi ON mi.moment_id = m.id
      WHERE m.user_id = ? AND m.status = 'approved' GROUP BY m.id ORDER BY m.published_at DESC LIMIT 50`).all(user.id)
    res.json({ ok: true, data: {
      profile: { id: user.id, username: user.username || '社区成员', bio: user.bio, memberType: user.member_type, grade: user.grade, joinedAt: user.created_at, avatar: user.avatar_storage_name ? `/api/avatar/${user.id}` : null },
      moments: rows.map((row) => applyVideoMeta({ id: row.id, body: row.body, publishedAt: row.published_at, images: row.image_ids ? row.image_ids.split(',').filter(Boolean).map((imageId) => `/api/media/moment/${imageId}`) : [], video: row.video_id ? `/api/media/video/${row.video_id}` : null }, row))
    } })
  })

  router.post('/moments', requireUser, writeLimiter, limitPostBody, postUpload.fields([{ name: 'images', maxCount: 9 }, { name: 'video', maxCount: 1 }]), cleanupUploadTemps, (req, res, next) => {
    let files, video
    try { files = (req.files?.images || []).map((file) => checkedPostImage(file, config)); video = checkedVideo(req.files?.video?.[0]) } catch (error) { return next(error) }
    const body = cleanText(req.body.body, { min: 0, max: 2000 })
    if (body === null || (!body && !files.length && !video)) return next(new ApiError(422, 'moment_invalid', '请填写动态正文或上传图片、视频。'))
    const momentId = id()
    const now = nowIso()
    const written = moveImages(config, [...files, ...(video ? [video] : [])])
    try {
      db.transaction(() => {
        db.prepare(`INSERT INTO moments (id, user_id, body, status, published_at, created_at, updated_at) VALUES (?, ?, ?, 'approved', ?, ?, ?)`)
          .run(momentId, req.userSession.principal_id, body, now, now, now)
        const insert = db.prepare(`INSERT INTO moment_images (id, moment_id, storage_name, original_name, mime_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        files.forEach((file) => insert.run(file.id, momentId, file.storageName, file.originalName, file.mime, file.byteSize, now))
        if (video) db.prepare(`INSERT INTO post_videos (id, post_type, post_id, storage_name, original_name, mime_type, byte_size, created_at) VALUES (?, 'moment', ?, ?, ?, ?, ?, ?)`)
          .run(video.id, momentId, video.storageName, video.originalName, video.mime, video.byteSize, now)
        if (video) queueVideo(db, video.id)
      })()
    } catch (error) { removeFiles(written); return next(error) }
    audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'moment_submitted', targetType: 'moment', targetId: momentId })
    res.status(201).json({ ok: true, data: { id: momentId, status: 'approved', message: '动态已发布。' } })
  })

  router.get('/public/wall', (req, res) => {
    const { limit, offset } = parsePage(req)
    const rows = db.prepare(`SELECT w.*, u.id AS author_id, u.username, u.member_type, u.grade, u.avatar_storage_name,
      (SELECT v.id FROM post_videos v WHERE v.post_type = 'wall' AND v.post_id = w.id) AS video_id, (SELECT v.status FROM post_videos v WHERE v.post_type = 'wall' AND v.post_id = w.id) AS video_status, (SELECT v.poster_name FROM post_videos v WHERE v.post_type = 'wall' AND v.post_id = w.id) AS video_poster, GROUP_CONCAT(wi.id) AS image_ids
      FROM wall_posts w JOIN users u ON u.id = w.user_id
      LEFT JOIN wall_images wi ON wi.wall_post_id = w.id
      WHERE w.status = 'approved' AND u.status = 'active'
      GROUP BY w.id ORDER BY w.published_at DESC LIMIT ? OFFSET ?`).all(limit, offset)
    const polls = readWallPolls(db, rows.map((row) => row.id), req.userSession.principal_id)
    const items = rows.map((row) => ({
      id: row.id,
      body: row.body,
      anonymous: Boolean(row.is_anonymous),
      publishedAt: row.published_at,
      author: row.is_anonymous ? null : { id: row.author_id, username: row.username || '社区成员', memberType: row.member_type, grade: row.grade, avatar: row.avatar_storage_name ? `/api/avatar/${row.author_id}` : null },
      poll: polls.get(row.id) || null,
      images: row.image_ids ? row.image_ids.split(',').filter(Boolean).map((imageId) => `/api/media/wall/${imageId}`) : [],
      video: row.video_id ? `/api/media/video/${row.video_id}` : null
    })).map((obj, i) => applyVideoMeta(obj, rows[i]))
    res.json({ ok: true, data: { items, limit, offset } })
  })

  router.post('/wall', requireUser, writeLimiter, limitPostBody, postUpload.fields([{ name: 'images', maxCount: 9 }, { name: 'video', maxCount: 1 }]), cleanupUploadTemps, (req, res, next) => {
    let files, video
    try { files = (req.files?.images || []).map((file) => checkedPostImage(file, config)); video = checkedVideo(req.files?.video?.[0]) } catch (error) { return next(error) }
    const body = cleanText(req.body.body, { min: 0, max: 2000 })
    if (body === null || (!body && !files.length && !video)) return next(new ApiError(422, 'wall_post_invalid', '请填写内容或上传图片、视频。'))
    const anonymous = String(req.body.anonymous) === 'true'
    const postId = id()
    const now = nowIso()
    const written = moveImages(config, [...files, ...(video ? [video] : [])])
    try {
      db.transaction(() => {
        db.prepare(`INSERT INTO wall_posts (id, user_id, body, is_anonymous, status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)`)
          .run(postId, req.userSession.principal_id, body, anonymous ? 1 : 0, now, now, now)
        const insert = db.prepare(`INSERT INTO wall_images (id, wall_post_id, storage_name, original_name, mime_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        files.forEach((file) => insert.run(file.id, postId, file.storageName, file.originalName, file.mime, file.byteSize, now))
        if (video) db.prepare(`INSERT INTO post_videos (id, post_type, post_id, storage_name, original_name, mime_type, byte_size, created_at) VALUES (?, 'wall', ?, ?, ?, ?, ?, ?)`)
          .run(video.id, postId, video.storageName, video.originalName, video.mime, video.byteSize, now)
        if (video) queueVideo(db, video.id)
      })()
    } catch (error) { removeFiles(written); return next(error) }
    audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'wall_post_submitted', targetType: 'wall_post', targetId: postId, metadata: { anonymous } })
    res.status(201).json({ ok: true, data: { id: postId, status: 'approved', message: '校园墙内容已发布。匿名只对公开页面生效，管理员仍可在违规处理时追溯账号。' } })
  })

  router.post('/wall/polls', requireUser, writeLimiter, (req, res, next) => {
    const question = typeof req.body.question === 'string' ? cleanText(req.body.question, { min: 1, max: 120 }) : null
    const rawOptions = req.body.options
    if (!question || !Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 8) {
      return next(new ApiError(422, 'poll_invalid', '请填写投票问题，并提供 2–8 个选项。'))
    }
    const options = rawOptions.map((value) => typeof value === 'string' ? cleanText(value, { min: 1, max: 80 }) : null)
    if (options.some((value) => !value) || new Set(options.map((value) => value.toLocaleLowerCase())).size !== options.length) {
      return next(new ApiError(422, 'poll_options_invalid', '选项不能留空或重复，每项最多 80 字。'))
    }
    const anonymous = req.body.anonymous === true
    const postId = id()
    const pollId = id()
    const now = nowIso()
    db.transaction(() => {
      db.prepare(`INSERT INTO wall_posts (id, user_id, body, is_anonymous, status, published_at, created_at, updated_at)
        VALUES (?, ?, '', ?, 'approved', ?, ?, ?)`).run(postId, req.userSession.principal_id, anonymous ? 1 : 0, now, now, now)
      db.prepare('INSERT INTO wall_polls (id, wall_post_id, question, created_at) VALUES (?, ?, ?, ?)').run(pollId, postId, question, now)
      const insertOption = db.prepare('INSERT INTO wall_poll_options (id, poll_id, label, position) VALUES (?, ?, ?, ?)')
      options.forEach((label, position) => insertOption.run(id(), pollId, label, position))
      audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'wall_poll_created', targetType: 'wall_post', targetId: postId, metadata: { anonymous } })
    })()
    res.status(201).json({ ok: true, data: { id: postId, pollId, message: '投票已发布。' } })
  })

  router.post('/wall/polls/:pollId/votes', requireUser, writeLimiter, (req, res, next) => {
    const userId = req.userSession.principal_id
    const poll = db.prepare(`SELECT p.id, p.wall_post_id FROM wall_polls p JOIN wall_posts w ON w.id = p.wall_post_id
      JOIN users u ON u.id = w.user_id WHERE p.id = ? AND w.status = 'approved' AND u.status = 'active'`).get(req.params.pollId)
    if (!poll) return next(new ApiError(404, 'not_found', '投票不存在或已删除。'))
    const option = typeof req.body.optionId === 'string'
      ? db.prepare('SELECT id FROM wall_poll_options WHERE id = ? AND poll_id = ?').get(req.body.optionId, poll.id) : null
    if (!option) return next(new ApiError(422, 'option_invalid', '请选择这个投票中的一个选项。'))
    const now = nowIso()
    try {
      db.transaction(() => {
        db.prepare('INSERT INTO wall_poll_votes (poll_id, user_id, option_id, created_at) VALUES (?, ?, ?, ?)').run(poll.id, userId, option.id, now)
        audit(db, { actorType: 'user', actorId: userId, event: 'wall_poll_voted', targetType: 'wall_post', targetId: poll.wall_post_id })
      })()
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return next(new ApiError(409, 'already_voted', '你已参与这个投票，不能重复选择。'))
      }
      return next(error)
    }
    res.json({ ok: true, data: { poll: readWallPolls(db, [poll.wall_post_id], userId).get(poll.wall_post_id) } })
  })

  router.get('/media/moment/:id', (req, res, next) => sendPostImage({ db, config, req, res, next, kind: 'moment' }))
  router.get('/media/wall/:id', (req, res, next) => sendPostImage({ db, config, req, res, next, kind: 'wall' }))

  return router
}

function sendPostImage({ db, config, req, res, next, kind }) {
  const isMoment = kind === 'moment'
  const row = isMoment
    ? db.prepare(`SELECT i.*, p.status, p.user_id FROM moment_images i JOIN moments p ON p.id = i.moment_id WHERE i.id = ?`).get(req.params.id)
    : db.prepare(`SELECT i.*, p.status, p.user_id FROM wall_images i JOIN wall_posts p ON p.id = i.wall_post_id WHERE i.id = ?`).get(req.params.id)
  if (!row) return next(new ApiError(404, 'not_found', '图片不存在。'))
  const mayView = row.status === 'approved' || req.userSession?.principal_id === row.user_id || Boolean(req.staffSession)
  if (!mayView) return next(new ApiError(404, 'not_found', '图片不存在。'))
  res.set({ 'Content-Type': row.mime_type, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': row.status === 'approved' ? 'public, max-age=86400' : 'private, no-store' })
  res.sendFile(path.join(config.uploadDir, row.storage_name))
}
